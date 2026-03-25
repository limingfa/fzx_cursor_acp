import type { PermissionMode } from "../config";
import type { JsonRpcRequest } from "../types";

type PermissionOutcome = {
  outcome: {
    outcome: "selected";
    optionId: "allow-once" | "allow-always" | "reject-once";
  };
};

export class PermissionPolicy {
  constructor(
    private readonly mode: PermissionMode,
    private readonly timeoutMs: number,
    private readonly onAudit: (payload: Record<string, unknown>) => void
  ) {}

  async decide(req: JsonRpcRequest): Promise<PermissionOutcome> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutOutcome: PermissionOutcome = {
      outcome: { outcome: "selected", optionId: "reject-once" },
    };
    const timeout = new Promise<PermissionOutcome>((resolve) => {
      timeoutId = setTimeout(() => {
        this.onAudit({
          type: "permission_timeout",
          method: req.method,
          timeoutMs: this.timeoutMs,
          defaultOptionId: "reject-once",
        });
        resolve(timeoutOutcome);
      }, this.timeoutMs);
    });
    const decided = Promise.resolve(this.computeDecision(req)).finally(() => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    });
    return Promise.race([decided, timeout]);
  }

  /** 同步决策；若未来接入交互式确认，可改为 async 并由 `decide` 的 race 在超时后回退为 reject-once。 */
  private computeDecision(req: JsonRpcRequest): PermissionOutcome {
    const params = (req.params ?? {}) as Record<string, unknown>;
    const title = String(params.title ?? "");
    const isRead = /read|list|search|show/i.test(title);
    const optionId =
      this.mode === "approve-all"
        ? "allow-once"
        : this.mode === "approve-reads"
          ? isRead
            ? "allow-once"
            : "reject-once"
          : "reject-once";
    this.onAudit({
      type: "permission_decision",
      method: req.method,
      mode: this.mode,
      optionId,
      timeoutMs: this.timeoutMs,
      title,
    });
    return { outcome: { outcome: "selected", optionId } };
  }
}
