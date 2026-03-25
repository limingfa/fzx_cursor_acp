import { describe, expect, it } from "vitest";
import { PermissionPolicy } from "./policy";

describe("PermissionPolicy", () => {
  it("does not emit permission_timeout after fast sync decision", async () => {
    const audits: { type?: string }[] = [];
    const policy = new PermissionPolicy("approve-all", 100, (p) => audits.push(p as { type?: string }));
    await policy.decide({
      jsonrpc: "2.0",
      id: 1,
      method: "session/request_permission",
      params: { title: "run tests" },
    });
    await new Promise((r) => setTimeout(r, 150));
    expect(audits.some((a) => a.type === "permission_timeout")).toBe(false);
  });
});
