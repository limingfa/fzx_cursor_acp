import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

type SessionMap = Record<string, { upstreamSessionId: string; updatedAt: string }>;

export class SessionStore {
  private readonly filePath: string;
  private cache: SessionMap = {};

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.filePath = path.join(dir, "sessions.json");
    this.cache = this.load();
  }

  set(localSessionId: string, upstreamSessionId: string): void {
    this.cache[localSessionId] = { upstreamSessionId, updatedAt: new Date().toISOString() };
    this.save();
  }

  get(localSessionId: string): string | undefined {
    return this.cache[localSessionId]?.upstreamSessionId;
  }

  private load(): SessionMap {
    if (!existsSync(this.filePath)) return {};
    try {
      return JSON.parse(readFileSync(this.filePath, "utf8")) as SessionMap;
    } catch {
      return {};
    }
  }

  private save(): void {
    writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2), "utf8");
  }
}
