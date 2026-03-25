import path from "node:path";
import { loadConfig } from "./config";
import { Logger } from "./logger";
import { PermissionPolicy } from "./permission/policy";
import { SessionStore } from "./session/store";
import { CursorProcess } from "./bridge/cursorProcess";
import { Router } from "./bridge/router";
import { DownstreamServer } from "./protocol/server";
import type { JsonRpcMessage } from "./types";

async function main(): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(cwd, process.argv.slice(2));
  const logger = new Logger((process.env.LOG_LEVEL as "debug" | "info" | "warn" | "error") ?? "info");
  const sessionStore = new SessionStore(path.resolve(config.sessionDir));
  const permissionPolicy = new PermissionPolicy(config.permissionMode, config.permissionTimeoutMs, (payload) => {
    logger.info("permission-audit", payload);
  });
  const router = new Router(logger, permissionPolicy, sessionStore);

  const downstream = new DownstreamServer(logger);
  const cursor = new CursorProcess(logger, { command: config.cursorCommand, args: config.cursorArgs });

  const sendUpstream = (msg: JsonRpcMessage) => cursor.send(msg);
  const sendDownstream = (msg: JsonRpcMessage) => downstream.send(msg);

  let restartWindowStart = Date.now();
  let rapidRestarts = 0;
  const maxRapidRestarts = 12;
  const windowMs = 8000;

  const onUpstreamExit = (info: { code: number | null; signal: NodeJS.Signals | null; stderrTail: string }) => {
    const now = Date.now();
    if (now - restartWindowStart > windowMs) {
      restartWindowStart = now;
      rapidRestarts = 0;
    }
    rapidRestarts += 1;
    if (rapidRestarts >= maxRapidRestarts) {
      logger.error(
        "cursor-agent 连续退出：请确认已安装 Cursor CLI，且 `agent` 或 `cursor-agent` 在 PATH 中（Windows 可执行 `where agent`）。也可在 ~/.cursor-acp-adapter.json 设置 cursor.command 为绝对路径。最后一次 stderr 片段：",
        { stderrTail: info.stderrTail || "(empty)" }
      );
      process.exit(1);
    }
    setTimeout(() => {
      logger.warn("upstream exited, restarting after backoff");
      cursor.restart();
    }, 400);
  };

  cursor.start(
    (msg) => {
      void router.onUpstream(msg, sendDownstream, sendUpstream);
    },
    onUpstreamExit
  );

  downstream.start((msg) => {
    void router.onDownstream(msg, sendUpstream, sendDownstream);
  });

  process.on("SIGINT", () => {
    cursor.stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cursor.stop();
    process.exit(0);
  });
}

void main().catch((error) => {
  process.stderr.write(`fatal: ${String(error)}\n`);
  process.exit(1);
});
