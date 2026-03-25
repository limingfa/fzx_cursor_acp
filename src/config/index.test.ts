import { describe, expect, it } from "vitest";
import { loadConfig } from "./index";

describe("loadConfig", () => {
  it("supports cli override for cursor command", () => {
    const cfg = loadConfig(process.cwd(), ["--cursor-command", "agent"]);
    expect(cfg.cursorCommand).toBe("agent");
  });

  it("supports permission mode arg", () => {
    const cfg = loadConfig(process.cwd(), ["--permission-mode", "deny-all"]);
    expect(cfg.permissionMode).toBe("deny-all");
  });
});
