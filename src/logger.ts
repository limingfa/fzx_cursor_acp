type LogLevel = "debug" | "info" | "warn" | "error";

const order: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class Logger {
  constructor(private readonly level: LogLevel = "info") {}

  debug(msg: string, meta?: unknown): void {
    this.log("debug", msg, meta);
  }

  info(msg: string, meta?: unknown): void {
    this.log("info", msg, meta);
  }

  warn(msg: string, meta?: unknown): void {
    this.log("warn", msg, meta);
  }

  error(msg: string, meta?: unknown): void {
    this.log("error", msg, meta);
  }

  private log(level: LogLevel, msg: string, meta?: unknown): void {
    if (order[level] < order[this.level]) return;
    const suffix = meta === undefined ? "" : ` ${JSON.stringify(meta)}`;
    process.stderr.write(`[${new Date().toISOString()}] ${level.toUpperCase()} ${msg}${suffix}\n`);
  }
}
