import "reflect-metadata";
import { DataSource } from "typeorm";
import { mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { Bot } from "@/entities/Bot";
import { BotEnv } from "@/entities/BotEnv";
import { BotRuntimeMeta } from "@/entities/BotRuntimeMeta";
import { User } from "@/entities/User";
import { BotAccess } from "@/entities/BotAccess";

// Database type selection
// Priority: DB_TYPE env var > NODE_ENV
const dbType = process.env.DB_TYPE?.toLowerCase() || (process.env.NODE_ENV === "production" ? "postgres" : "sqlite");

// Validate DB_TYPE
if (!["postgres", "sqlite"].includes(dbType)) {
  throw new Error(`Invalid DB_TYPE: ${dbType}. Must be "postgres" or "sqlite"`);
}

// Common entities for both databases
const entities = [Bot, BotEnv, BotRuntimeMeta, User, BotAccess];

// PostgreSQL configuration
const postgresOptions = {
  type: "postgres" as const,
  url: process.env.DB_URL,
  entities,
  synchronize: true,
  logging: process.env.LOG_LEVEL === "debug",
};

// SQLite configuration
const sqlitePath = process.env.SQLITE_PATH || resolve("storage/data.sqlite");
mkdirSync(dirname(sqlitePath), { recursive: true });

const sqliteOptions = {
  type: "sqlite" as const,
  database: sqlitePath,
  entities,
  synchronize: true,
  logging: process.env.LOG_LEVEL === "debug",
};

// Select database based on DB_TYPE
const dataSourceOptions = dbType === "postgres" ? postgresOptions : sqliteOptions;

// Log selected database (only in debug mode)
if (process.env.LOG_LEVEL === "debug") {
  console.log(`[DataSource] Using ${dbType.toUpperCase()} database`);
  if (dbType === "sqlite") {
    console.log(`[DataSource] SQLite path: ${sqlitePath}`);
  } else {
    console.log(`[DataSource] PostgreSQL URL: ${process.env.DB_URL?.replace(/:[^:@]+@/, ':****@')}`);
  }
}

export const AppDataSource = new DataSource(dataSourceOptions);
