import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";

export type PermissionMode = "approve-all" | "approve-reads" | "deny-all";

const schema = z.object({
  cursor: z
    .object({
      command: z.string().optional(),
      args: z.array(z.string()).optional(),
    })
    .optional(),
  permissionMode: z.enum(["approve-all", "approve-reads", "deny-all"]).optional(),
  permissionTimeoutMs: z.number().int().positive().optional(),
  sessionDir: z.string().optional(),
});

export type AdapterConfig = {
  cursorCommand: string;
  cursorArgs: string[];
  permissionMode: PermissionMode;
  permissionTimeoutMs: number;
  sessionDir: string;
};

export function loadConfig(cwd: string, argv: string[]): AdapterConfig {
  const cli = parseCli(argv);
  const fileConfig = loadConfigFile(cwd);
  const cursorCommand = cli.cursorCommand ?? fileConfig.cursor?.command ?? detectCursorCommand();
  const cursorArgs = fileConfig.cursor?.args ?? [];
  return {
    cursorCommand,
    cursorArgs,
    permissionMode: cli.permissionMode ?? fileConfig.permissionMode ?? "approve-reads",
    permissionTimeoutMs: fileConfig.permissionTimeoutMs ?? 15_000,
    sessionDir: fileConfig.sessionDir ?? path.join(os.homedir(), ".cursor-acp-adapter", "sessions"),
  };
}

function parseCli(argv: string[]): { cursorCommand?: string; permissionMode?: PermissionMode } {
  const result: { cursorCommand?: string; permissionMode?: PermissionMode } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const value = argv[i + 1];
    if (token === "--cursor-command" && value) result.cursorCommand = value;
    if (token === "--permission-mode" && value) result.permissionMode = value as PermissionMode;
  }
  return result;
}

function loadConfigFile(cwd: string): z.infer<typeof schema> {
  const candidates = [
    path.join(cwd, ".cursor-acp-adapter.json"),
    path.join(os.homedir(), ".cursor-acp-adapter.json"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const raw = readFileSync(p, "utf8");
    return schema.parse(JSON.parse(raw));
  }
  return {};
}

function detectCursorCommand(): string {
  const candidates = ["cursor-agent", "agent"];
  for (const c of candidates) {
    if (isCommandAvailable(c)) return c;
  }
  if (process.platform === "win32") {
    const fromWellKnown = resolveWindowsCursorCliFromWellKnownPaths(process.env.LOCALAPPDATA);
    if (fromWellKnown) return fromWellKnown;
  }
  if (process.platform === "darwin") {
    const fromWellKnown = resolveDarwinCursorCliFromWellKnownPaths();
    if (fromWellKnown) return fromWellKnown;
  }
  return "agent";
}

/** 不依赖 PATH：官方安装器常见的 `%LOCALAPPDATA%\cursor-agent\*.cmd` */
function resolveWindowsCursorCliFromWellKnownPaths(localAppData: string | undefined): string | undefined {
  if (!localAppData) return undefined;
  const dir = path.join(localAppData, "cursor-agent");
  for (const name of ["cursor-agent.cmd", "agent.cmd"]) {
    const full = path.join(dir, name);
    if (existsSync(full)) return full;
  }
  return undefined;
}

/** 不依赖 PATH：macOS 常见位置（Homebrew Apple Silicon / Intel、用户目录） */
function resolveDarwinCursorCliFromWellKnownPaths(): string | undefined {
  const dirs = ["/opt/homebrew/bin", "/usr/local/bin", path.join(os.homedir(), ".local/bin")];
  const names = ["cursor-agent", "agent"];
  for (const dir of dirs) {
    for (const name of names) {
      const full = path.join(dir, name);
      if (!existsSync(full)) continue;
      try {
        accessSync(full, constants.X_OK);
        return full;
      } catch {
        // continue
      }
    }
  }
  return undefined;
}

function isCommandAvailable(command: string): boolean {
  const pathValue = process.env.PATH ?? "";
  const paths = pathValue.split(path.delimiter).filter(Boolean);
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const folder of paths) {
    for (const ext of exts) {
      const fullPath = path.join(folder, `${command}${ext}`);
      if (!existsSync(fullPath)) continue;
      if (process.platform === "win32") return true;
      try {
        accessSync(fullPath, constants.X_OK);
        return true;
      } catch {
        // continue
      }
    }
  }
  return false;
}
