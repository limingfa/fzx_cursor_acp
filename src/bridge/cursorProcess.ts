import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import type { Logger } from "../logger";
import type { JsonRpcMessage } from "../types";

type CommandSpec = { command: string; args: string[] };

export class CursorProcess {
  private child: ChildProcessWithoutNullStreams | undefined;
  private onMessage?: (msg: JsonRpcMessage) => void;
  private onExit?: (info: { code: number | null; signal: NodeJS.Signals | null; stderrTail: string }) => void;
  private stderrBuf = "";

  constructor(private readonly logger: Logger, private readonly spec: CommandSpec) {}

  start(
    onMessage: (msg: JsonRpcMessage) => void,
    onExit: (info: { code: number | null; signal: NodeJS.Signals | null; stderrTail: string }) => void
  ): void {
    this.onMessage = onMessage;
    this.onExit = onExit;
    const args = [...this.spec.args, "acp"];
    this.stderrBuf = "";
    const useShell =
      process.platform === "win32" && /\.(cmd|bat)$/i.test(this.spec.command.trim());
    this.child = spawn(this.spec.command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: useShell,
    });
    this.child.stderr.on("data", (buf) => {
      const text = String(buf);
      this.stderrBuf = (this.stderrBuf + text).slice(-8000);
      this.logger.debug("cursor-stderr", { text });
    });
    this.child.on("exit", (code, signal) => {
      const stderrTail = this.stderrBuf.trim().slice(-2000);
      this.logger.warn("cursor-process-exited", { code, signal, stderrTail: stderrTail || undefined });
      this.onExit?.({ code, signal, stderrTail });
    });
    const rl = readline.createInterface({ input: this.child.stdout });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        const msg = JSON.parse(line) as JsonRpcMessage;
        this.onMessage?.(msg);
      } catch (error) {
        this.logger.error("cursor-message-parse-failed", { line, error: String(error) });
      }
    });
  }

  send(msg: JsonRpcMessage): void {
    if (!this.child?.stdin.writable) throw new Error("cursor process is not writable");
    this.child.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  restart(): void {
    this.stop();
    if (!this.onMessage || !this.onExit) return;
    this.start(this.onMessage, this.onExit);
  }

  stop(): void {
    if (this.child && !this.child.killed) this.child.kill();
    this.child = undefined;
  }
}
