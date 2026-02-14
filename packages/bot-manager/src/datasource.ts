import "reflect-metadata";
import { DataSource } from "typeorm";
import { mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { Bot } from "@/entities/Bot";
import { BotEnv } from "@/entities/BotEnv";
import { BotRuntimeMeta } from "@/entities/BotRuntimeMeta";
import { User } from "@/entities/User";
import { BotAccess } from "@/entities/BotAccess";

const isProd = process.env.NODE_ENV === "production";
const sqlitePath = resolve("storage/dev.sqlite");
mkdirSync(dirname(sqlitePath), { recursive: true });

const prodOptions = {
  type: "postgres" as const,
  url: process.env.DB_URL,
  entities: [Bot, BotEnv, BotRuntimeMeta, User, BotAccess],
  synchronize: true,
  logging: false,
};

const devOptions = {
  type: "sqlite" as const,
  database: sqlitePath,
  entities: [Bot, BotEnv, BotRuntimeMeta, User, BotAccess],
  synchronize: true,
  logging: false,
};

export const AppDataSource = new DataSource(isProd ? prodOptions : devOptions);
