import { describe, expect, it, vi } from "vitest";
import { Router } from "./router";
import { Logger } from "../logger";
import { PermissionPolicy } from "../permission/policy";
import { SessionStore } from "../session/store";
import path from "node:path";
import os from "node:os";
import { mkdtempSync } from "node:fs";

describe("Router", () => {
  it("maps downstream request id to upstream and back", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "router-test-"));
    const router = new Router(
      new Logger("error"),
      new PermissionPolicy("approve-all", 1000, () => {}),
      new SessionStore(dir)
    );
    const up: unknown[] = [];
    const down: unknown[] = [];

    await router.onDownstream(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      (m) => up.push(m),
      (m) => down.push(m)
    );
    const upstreamReq = up[0] as { id: string };
    await router.onUpstream(
      { jsonrpc: "2.0", id: upstreamReq.id, result: { ok: true } },
      (m) => down.push(m),
      (m) => up.push(m)
    );
    expect((down[0] as { id: number }).id).toBe(1);
  });

  it("auto handles session/request_permission", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "router-test-"));
    const router = new Router(
      new Logger("error"),
      new PermissionPolicy("deny-all", 1000, vi.fn()),
      new SessionStore(dir)
    );
    const up: unknown[] = [];
    await router.onUpstream(
      {
        jsonrpc: "2.0",
        id: "p1",
        method: "session/request_permission",
        params: { title: "run command" },
      },
      () => {},
      (m) => up.push(m)
    );
    const reply = up[0] as { result: { outcome: { optionId: string } } };
    expect(reply.result.outcome.optionId).toBe("reject-once");
  });

  it("remaps sessionId for session/cancel when store has mapping", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "router-test-"));
    const store = new SessionStore(dir);
    store.set("local-1", "upstream-1");
    const router = new Router(new Logger("error"), new PermissionPolicy("approve-all", 1000, () => {}), store);
    const up: unknown[] = [];
    await router.onDownstream(
      {
        jsonrpc: "2.0",
        id: 9,
        method: "session/cancel",
        params: { sessionId: "local-1" },
      },
      (m) => up.push(m),
      () => {}
    );
    const forwarded = up[0] as { params: { sessionId: string } };
    expect(forwarded.params.sessionId).toBe("upstream-1");
  });

  it("remaps session/load -32602 to -32001 so acpx can fall back to new session", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "router-test-"));
    const router = new Router(new Logger("error"), new PermissionPolicy("approve-all", 1000, () => {}), new SessionStore(dir));
    const up: unknown[] = [];
    const down: unknown[] = [];
    await router.onDownstream(
      {
        jsonrpc: "2.0",
        id: 42,
        method: "session/load",
        params: { sessionId: "s1", cwd: "D:/tmp", mcpServers: [] },
      },
      (m) => up.push(m),
      (m) => down.push(m)
    );
    const upstreamReq = up[0] as { id: string };
    await router.onUpstream(
      {
        jsonrpc: "2.0",
        id: upstreamReq.id,
        error: { code: -32602, message: "Invalid params" },
      },
      (m) => down.push(m),
      () => {}
    );
    const errRes = down[0] as { id: number; error: { code: number } };
    expect(errRes.id).toBe(42);
    expect(errRes.error.code).toBe(-32001);
  });
});
