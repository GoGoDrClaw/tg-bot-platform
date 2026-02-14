type LogLevel = "debug" | "info" | "warn" | "error";

const COLORS: Record<string, string> = {
  reset: "\x1b[0m",
  gray: "\x1b[90m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: COLORS.gray,
  info: COLORS.green,
  warn: COLORS.yellow,
  error: COLORS.red,
};

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const ENV_LEVEL = (process.env.LOG_LEVEL ?? "info").toLowerCase() as LogLevel;
const MIN_LEVEL = LEVEL_ORDER[ENV_LEVEL] ?? LEVEL_ORDER.info;

export class Logger {
  constructor(private scope: string) {}

  private shouldLog(level: LogLevel) {
    return LEVEL_ORDER[level] >= MIN_LEVEL;
  }

  private format(level: LogLevel, message: string) {
    const ts = new Date().toISOString();
    const color = LEVEL_COLOR[level] ?? COLORS.reset;
    return `${COLORS.gray}${ts}${COLORS.reset} ${color}${level.toUpperCase()}${COLORS.reset} ${COLORS.cyan}[${this.scope}]${COLORS.reset} ${message}`;
  }

  debug(msg: string) {
    if (!this.shouldLog("debug")) return;
    console.log(this.format("debug", msg));
  }
  info(msg: string) {
    if (!this.shouldLog("info")) return;
    console.log(this.format("info", msg));
  }
  warn(msg: string) {
    if (!this.shouldLog("warn")) return;
    console.warn(this.format("warn", msg));
  }
  error(msg: string, err?: unknown) {
    if (!this.shouldLog("error")) return;
    console.error(this.format("error", msg), err ?? "");
  }
}

export const createLogger = (scope: string) => new Logger(scope);
