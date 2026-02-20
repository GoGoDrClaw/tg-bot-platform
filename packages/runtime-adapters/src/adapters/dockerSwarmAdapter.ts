import { DeployRequest, RuntimeAdapter } from "../types";
import { runCommand } from "../utils";
import { createLogger } from "../logger";
import { existsSync } from "fs";
import { resolve } from "path";

const log = createLogger("SwarmAdapter");

const DEFAULT_CPU_LIMIT = "0.5";
const DEFAULT_MEMORY_LIMIT = "256m";

export class DockerSwarmAdapter implements RuntimeAdapter {
  private serviceName(botId: string): string {
    return `bot-${botId}`;
  }

  async deployBot(request: DeployRequest): Promise<void> {
    log.info(`deploy ${request.botId} image=${request.imageName} port=${request.port}`);
    const serviceName = this.serviceName(request.botId);
    await this.stopBot(request.botId); // best-effort cleanup

    const envArgs = Object.entries(request.env).flatMap(([key, value]) => [
      "--env",
      `${key}=${value}`,
    ]);

    const limits = request.resources ?? {};
    const args = [
      "service",
      "create",
      "--name",
      serviceName,
      "--replicas",
      "1",
      "--limit-cpu",
      limits.cpu ?? DEFAULT_CPU_LIMIT,
      "--limit-memory",
      limits.memory ?? DEFAULT_MEMORY_LIMIT,
      "--publish",
      `mode=host,target=${request.port},published=${request.port}`,
      "--restart-condition",
      "any",
      ...envArgs,
    ];

    // Mount SQLite database file for bot (if exists)
    const dbPath = resolve(process.cwd(), "storage", "bots", request.botId, "bot.db");
    if (existsSync(dbPath)) {
      args.push("--mount", `type=bind,src=${dbPath},dst=/app/data/bot.db`);
      log.info(`mounting bot database ${dbPath} -> /app/data/bot.db`);
    }

    args.push(request.imageName);

    await runCommand("docker", args);
  }

  async stopBot(botId: string): Promise<void> {
    const serviceName = this.serviceName(botId);
    await runCommand("docker", ["service", "rm", serviceName]).catch(() => undefined);
    log.info(`removed service ${serviceName}`);
  }

  async restartBot(botId: string): Promise<void> {
    const serviceName = this.serviceName(botId);
    await runCommand("docker", ["service", "update", "--force", serviceName]);
    log.info(`restart issued ${serviceName}`);
  }

  async getStatus(botId: string): Promise<string> {
    const serviceName = this.serviceName(botId);
    const output = await runCommand("docker", [
      "service",
      "ls",
      "--filter",
      `name=${serviceName}`,
      "--format",
      "{{.Name}} {{.Mode}} {{.Replicas}}",
    ]);
    return output.trim();
  }

  async getLogs(botId: string, tail = 100): Promise<string> {
    const serviceName = this.serviceName(botId);
    const output = await runCommand("docker", [
      "service",
      "logs",
      `--tail=${tail}`,
      serviceName,
    ]);
    return output;
  }
}
