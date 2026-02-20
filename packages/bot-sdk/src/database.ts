import { BotConfig } from "./config";
import { BotLogger } from "./logger";

export type DatabaseType = "sqlite" | "postgres" | "none";

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

export abstract class BotDatabase {
  protected config: BotConfig;
  protected logger: BotLogger;

  constructor(config: BotConfig, logger: BotLogger) {
    this.config = config;
    this.logger = logger;
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>>;
  abstract run(sql: string, params?: any[]): Promise<void>;
}

export class SqliteDatabase extends BotDatabase {
  private db: any = null;
  private dbLogger: BotLogger;

  constructor(config: BotConfig, logger: BotLogger) {
    super(config, logger);
    this.dbLogger = logger.child("sqlite");
  }

  async connect(): Promise<void> {
    if (!this.config.databaseUrl) {
      throw new Error("DATABASE_URL not configured");
    }

    const Database = require("better-sqlite3");
    const dbPath = this.config.databaseUrl.replace("sqlite://", "");
    this.db = new Database(dbPath);
    this.dbLogger.info("Database connected", { path: dbPath });
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.dbLogger.info("Database disconnected");
    }
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<QueryResult<T>> {
    if (!this.db) {
      throw new Error("Database not connected");
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as T[];

    return {
      rows,
      rowCount: rows.length,
    };
  }

  async run(sql: string, params: any[] = []): Promise<void> {
    if (!this.db) {
      throw new Error("Database not connected");
    }

    const stmt = this.db.prepare(sql);
    stmt.run(...params);
  }
}

export class PostgresDatabase extends BotDatabase {
  private pool: any = null;
  private dbLogger: BotLogger;

  constructor(config: BotConfig, logger: BotLogger) {
    super(config, logger);
    this.dbLogger = logger.child("postgres");
  }

  async connect(): Promise<void> {
    if (!this.config.databaseUrl) {
      throw new Error("DATABASE_URL not configured");
    }

    const { Pool } = require("pg");
    this.pool = new Pool({
      connectionString: this.config.databaseUrl,
    });

    // Test connection
    await this.pool.query("SELECT 1");
    this.dbLogger.info("Database connected");
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.dbLogger.info("Database disconnected");
    }
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<QueryResult<T>> {
    if (!this.pool) {
      throw new Error("Database not connected");
    }

    const result = await this.pool.query(sql, params);

    return {
      rows: result.rows as T[],
      rowCount: result.rowCount || 0,
    };
  }

  async run(sql: string, params: any[] = []): Promise<void> {
    await this.query(sql, params);
  }
}

export class NoDatabase extends BotDatabase {
  private dbLogger: BotLogger;

  constructor(config: BotConfig, logger: BotLogger) {
    super(config, logger);
    this.dbLogger = logger.child("database");
  }

  async connect(): Promise<void> {
    this.dbLogger.info("No database configured");
  }

  async disconnect(): Promise<void> {
    // Nothing to do
  }

  async query<T = any>(): Promise<QueryResult<T>> {
    throw new Error("Database not configured");
  }

  async run(): Promise<void> {
    throw new Error("Database not configured");
  }
}

export function createDatabase(config: BotConfig, logger: BotLogger): BotDatabase {
  if (!config.databaseUrl) {
    return new NoDatabase(config, logger);
  }

  if (config.databaseUrl.startsWith("sqlite:")) {
    return new SqliteDatabase(config, logger);
  }

  if (config.databaseUrl.startsWith("postgresql:") || config.databaseUrl.startsWith("postgres:")) {
    return new PostgresDatabase(config, logger);
  }

  throw new Error(`Unsupported database type: ${config.databaseUrl}`);
}
