import { randomBytes } from "crypto";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { Pool } from "pg";
import { createLogger } from "@/utils/logger";

const log = createLogger("DatabaseService");

export type DatabaseType = "sqlite" | "postgres";

export interface BotDatabaseCredentials {
  type: DatabaseType;
  url: string;
  username?: string;
  password?: string;
}

export class DatabaseService {
  private dbType: DatabaseType;
  private adminPool?: Pool;

  constructor() {
    const dbTypeEnv = process.env.DB_TYPE?.toLowerCase() ||
      (process.env.NODE_ENV === "production" ? "postgres" : "sqlite");

    if (!["postgres", "sqlite"].includes(dbTypeEnv)) {
      throw new Error(`Invalid DB_TYPE: ${dbTypeEnv}`);
    }

    this.dbType = dbTypeEnv as DatabaseType;

    if (this.dbType === "postgres") {
      this.adminPool = new Pool({
        connectionString: process.env.DB_URL,
      });
    }
  }

  async createBotDatabase(botId: string): Promise<BotDatabaseCredentials> {
    if (this.dbType === "sqlite") {
      return this.createSqliteDatabase(botId);
    } else {
      return this.createPostgresDatabase(botId);
    }
  }

  private createSqliteDatabase(botId: string): BotDatabaseCredentials {
    const botDir = join("storage/bots", botId);
    mkdirSync(botDir, { recursive: true });

    const dbPath = join(botDir, "bot.db");

    // Create empty SQLite database file
    if (!existsSync(dbPath)) {
      writeFileSync(dbPath, "");
      log.info(`SQLite database created for bot ${botId}: ${dbPath}`);
    }

    return {
      type: "sqlite",
      url: `sqlite:///app/data/bot.db`, // Path inside container
    };
  }

  private async createPostgresDatabase(botId: string): Promise<BotDatabaseCredentials> {
    if (!this.adminPool) {
      throw new Error("PostgreSQL admin pool not initialized");
    }

    const schemaName = `bot_${botId.replace(/-/g, "_")}`;
    const username = schemaName;
    const password = randomBytes(32).toString("hex");

    try {
      // Create schema
      await this.adminPool.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);
      log.info(`Schema created: ${schemaName}`);

      // Create user
      await this.adminPool.query(`CREATE USER ${username} WITH PASSWORD '${password}'`);
      log.info(`User created: ${username}`);

      // Grant privileges only on this schema
      await this.adminPool.query(`GRANT USAGE ON SCHEMA ${schemaName} TO ${username}`);
      await this.adminPool.query(`GRANT ALL ON ALL TABLES IN SCHEMA ${schemaName} TO ${username}`);
      await this.adminPool.query(`GRANT ALL ON ALL SEQUENCES IN SCHEMA ${schemaName} TO ${username}`);
      await this.adminPool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaName} GRANT ALL ON TABLES TO ${username}`);
      await this.adminPool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaName} GRANT ALL ON SEQUENCES TO ${username}`);

      // Set default search path
      await this.adminPool.query(`ALTER USER ${username} SET search_path TO ${schemaName}`);

      // Revoke access to public schema and other schemas
      await this.adminPool.query(`REVOKE ALL ON SCHEMA public FROM ${username}`);
      await this.adminPool.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${username}`);

      log.info(`Privileges granted to ${username} for schema ${schemaName}`);

      // Build connection URL
      const dbUrl = process.env.DB_URL || "";
      const urlMatch = dbUrl.match(/postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^/]+)\/(.+)/);

      if (!urlMatch) {
        throw new Error("Invalid DB_URL format");
      }

      const [, , , host, database] = urlMatch;
      const url = `postgresql://${username}:${password}@${host}/${database}?schema=${schemaName}`;

      return {
        type: "postgres",
        url,
        username,
        password,
      };
    } catch (error) {
      log.error(`Failed to create PostgreSQL database for bot ${botId}:`, error);
      // Cleanup on failure
      try {
        await this.adminPool.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
        await this.adminPool.query(`DROP USER IF EXISTS ${username}`);
      } catch (cleanupError) {
        log.error("Cleanup failed:", cleanupError);
      }
      throw error;
    }
  }

  async deleteBotDatabase(botId: string): Promise<void> {
    if (this.dbType === "sqlite") {
      this.deleteSqliteDatabase(botId);
    } else {
      await this.deletePostgresDatabase(botId);
    }
  }

  private deleteSqliteDatabase(botId: string): void {
    const dbPath = join("storage/bots", botId, "bot.db");

    if (existsSync(dbPath)) {
      unlinkSync(dbPath);
      log.info(`SQLite database deleted for bot ${botId}`);
    }
  }

  private async deletePostgresDatabase(botId: string): Promise<void> {
    if (!this.adminPool) {
      throw new Error("PostgreSQL admin pool not initialized");
    }

    const schemaName = `bot_${botId.replace(/-/g, "_")}`;
    const username = schemaName;

    try {
      // Terminate existing connections to schema
      await this.adminPool.query(`
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE usename = '${username}'
      `);

      // Drop schema and user
      await this.adminPool.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
      await this.adminPool.query(`DROP USER IF EXISTS ${username}`);

      log.info(`PostgreSQL schema and user deleted for bot ${botId}`);
    } catch (error) {
      log.error(`Failed to delete PostgreSQL database for bot ${botId}:`, error);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.adminPool) {
      await this.adminPool.end();
      log.info("DatabaseService closed");
    }
  }
}
