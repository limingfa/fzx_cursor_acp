import readline from "node:readline";
import type { Logger } from "../logger";
import type { JsonRpcMessage } from "../types";

export class DownstreamServer {
  private readonly rl = readline.createInterface({ input: process.stdin });

  constructor(private readonly logger: Logger) {}

  start(onMessage: (msg: JsonRpcMessage) => void): void {
    this.rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        const msg = JSON.parse(line) as JsonRpcMessage;
        onMessage(msg);
      } catch (error) {
        this.logger.error("downstream-message-parse-failed", { error: String(error), line });
      }
    });
  }

  send(msg: JsonRpcMessage): void {
    process.stdout.write(`${JSON.stringify(msg)}\n`);
  }
}
