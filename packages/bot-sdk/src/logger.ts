import chalk from "chalk";
import { BotConfig } from "./config";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export class BotLogger {
  private config: BotConfig;
  private buffer: LogEntry[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly BUFFER_SIZE = 50;
  private readonly FLUSH_INTERVAL_MS = 5000;
  private scope: string;
  private debugEnabled: boolean;

  constructor(config: BotConfig, scope = "bot", debugEnabled = false) {
    this.config = config;
    this.scope = scope;
    this.debugEnabled = debugEnabled || process.env.DEBUG === "true";
    this.startAutoFlush();
  }

  private startAutoFlush() {
    this.flushInterval = setInterval(() => {
      this.flush().catch((err) => {
        // Use plain console to avoid recursion
        const ts = new Date().toISOString();
        console.error(`[${ts}] ERROR Failed to flush logs:`, err);
      });
    }, this.FLUSH_INTERVAL_MS);
  }

  private formatMessage(level: LogLevel, message: string, metadata?: Record<string, any>): string {
    const ts = new Date().toISOString();
    const tag = level.toUpperCase().padEnd(5, " ");
    const scopeTag = this.scope ? `[${this.scope}]` : "";
    const metaStr = metadata ? ` ${JSON.stringify(metadata)}` : "";
    return `[${ts}] ${tag} ${scopeTag} ${message}${metaStr}`;
  }

  private log(level: LogLevel, message: string, metadata?: Record<string, any>) {
    // Skip debug logs if not enabled
    if (level === "debug" && !this.debugEnabled) {
      return;
    }

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date(),
      metadata,
    };

    // Log to console with colors
    const formattedMessage = this.formatMessage(level, message, metadata);
    const colorFn =
      level === "info"
        ? chalk.cyan
        : level === "warn"
        ? chalk.yellow
        : level === "error"
        ? chalk.red
        : chalk.magenta;

    if (level === "error") {
      console.error(colorFn(formattedMessage));
    } else if (level === "warn") {
      console.warn(colorFn(formattedMessage));
    } else {
      console.log(colorFn(formattedMessage));
    }

    // Buffer for sending to manager
    this.buffer.push(entry);

    if (this.buffer.length >= this.BUFFER_SIZE) {
      this.flush().catch((err) => {
        const ts = new Date().toISOString();
        console.error(`[${ts}] ERROR Failed to flush logs:`, err);
      });
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const logsToSend = [...this.buffer];
    this.buffer = [];

    try {
      const response = await fetch(
        `${this.config.managerUrl}/logs/${this.config.botId}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ logs: logsToSend }),
        }
      );

      if (!response.ok) {
        // Put logs back in buffer on failure (but limit buffer size to prevent memory issues)
        if (this.buffer.length < 500) {
          this.buffer.unshift(...logsToSend);
        }
      }
    } catch (err) {
      // Put logs back in buffer on failure (but limit buffer size)
      if (this.buffer.length < 500) {
        this.buffer.unshift(...logsToSend);
      }
    }
  }

  debug(message: string, metadata?: Record<string, any>) {
    this.log("debug", message, metadata);
  }

  info(message: string, metadata?: Record<string, any>) {
    this.log("info", message, metadata);
  }

  warn(message: string, metadata?: Record<string, any>) {
    this.log("warn", message, metadata);
  }

  error(message: string, metadata?: Record<string, any>) {
    this.log("error", message, metadata);
  }

  /**
   * Create a child logger with a different scope
   */
  child(scope: string): BotLogger {
    return new BotLogger(this.config, scope, this.debugEnabled);
  }

  async close() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    await this.flush();
  }
}
