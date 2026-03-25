import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Logger } from "../logger";
import type { PermissionPolicy } from "../permission/policy";
import type { SessionStore } from "../session/store";
import {
  isNotification,
  isRequest,
  isResponse,
  type JsonRpcError,
  type JsonRpcMessage,
  type JsonRpcRequest,
  type JsonRpcSuccess,
} from "../types";

type SendFn = (msg: JsonRpcMessage) => void;

export class Router {
  private readonly downstreamToUpstream = new Map<string | number, string | number>();
  private readonly upstreamToDownstream = new Map<string | number, string | number>();
  private readonly upstreamMethodById = new Map<string | number, string>();
  private readonly knownSessions = new Set<string>();

  constructor(
    private readonly logger: Logger,
    private readonly policy: PermissionPolicy,
    private readonly sessionStore: SessionStore
  ) {}

  async onDownstream(msg: JsonRpcMessage, sendUpstream: SendFn, sendDownstream: SendFn): Promise<void> {
    if (isNotification(msg)) {
      sendUpstream(msg);
      return;
    }
    if (!isRequest(msg)) {
      sendUpstream(msg);
      return;
    }
    const request = msg as JsonRpcRequest;
    let params = request.params;
    if (request.method === "session/new" || request.method === "session/load") {
      params = this.normalizeSessionSetupParams(params);
    }
    if (this.sessionMethodNeedsRemap(request.method)) {
      params = this.remapSessionInParams(params);
    }
    const upstreamId = randomUUID();
    this.downstreamToUpstream.set(request.id as string | number, upstreamId);
    this.upstreamToDownstream.set(upstreamId, request.id as string | number);
    this.upstreamMethodById.set(upstreamId, request.method);
    sendUpstream({ ...request, id: upstreamId, params });
    this.logger.debug("forwarded-request-to-upstream", { method: request.method });

    // Keep TS aware sendDownstream is used in async permission path.
    void sendDownstream;
  }

  async onUpstream(msg: JsonRpcMessage, sendDownstream: SendFn, sendUpstream: SendFn): Promise<void> {
    if (isNotification(msg)) {
      sendDownstream(this.remapSessionInNotification(msg));
      return;
    }
    if (isRequest(msg) && msg.method === "session/request_permission") {
      const outcome = await this.policy.decide(msg);
      sendUpstream({ jsonrpc: "2.0", id: msg.id, result: outcome });
      return;
    }
    if (isRequest(msg)) {
      sendDownstream(msg);
      return;
    }
    if (isResponse(msg)) {
      let processed: JsonRpcMessage = msg;
      if ("error" in msg) {
        processed = this.maybeRewriteSessionLoadFailure(msg as JsonRpcError);
      }
      const mapped = this.remapResponseId(processed as JsonRpcSuccess | JsonRpcError);
      const withSessionMap = this.captureSessionMapping(mapped);
      sendDownstream(withSessionMap);
    }
  }

  remapSessionForRecovery(localSessionId: string): string | undefined {
    return this.sessionStore.get(localSessionId);
  }

  private remapResponseId(msg: JsonRpcSuccess | JsonRpcError): JsonRpcMessage {
    const upstreamId = msg.id as string | number;
    const downstreamId = this.upstreamToDownstream.get(upstreamId);
    if (downstreamId === undefined) return msg;
    this.upstreamToDownstream.delete(upstreamId);
    this.downstreamToUpstream.delete(downstreamId);
    this.upstreamMethodById.delete(upstreamId);
    return { ...msg, id: downstreamId };
  }

  /**
   * Cursor 在会话已失效时可能对 session/load 返回 JSON-RPC -32602。
   * acpx 仅在 ACP「资源不存在」类错误（如 -32001）上回退到 session/new；
   * 此处映射以便自动恢复，而无需用户手动 sessions new。
   */
  private maybeRewriteSessionLoadFailure(msg: JsonRpcError): JsonRpcMessage {
    const upstreamId = msg.id as string | number;
    const method = this.upstreamMethodById.get(upstreamId);
    if (method !== "session/load") return msg;
    const code = msg.error.code;
    if (code === -32602 || code === -32601) {
      this.logger.info("session/load upstream error remapped for acpx fallback", {
        from: code,
        message: msg.error.message,
      });
      return {
        ...msg,
        error: {
          ...msg.error,
          code: -32001,
          message: msg.error.message || "Session not found",
        },
      };
    }
    return msg;
  }

  private normalizeSessionSetupParams(params: unknown): unknown {
    if (!params || typeof params !== "object") return params;
    const p = { ...(params as Record<string, unknown>) };
    if (p.mcpServers === undefined || p.mcpServers === null) p.mcpServers = [];
    if (typeof p.cwd === "string") p.cwd = path.resolve(p.cwd);
    return p;
  }

  private captureSessionMapping(msg: JsonRpcMessage): JsonRpcMessage {
    if (!isResponse(msg) || !("result" in msg)) return msg;
    const result = msg.result as Record<string, unknown>;
    const sessionId = typeof result.sessionId === "string" ? result.sessionId : undefined;
    if (!sessionId || this.knownSessions.has(sessionId)) return msg;
    this.knownSessions.add(sessionId);
    this.sessionStore.set(sessionId, sessionId);
    return msg;
  }

  private sessionMethodNeedsRemap(method: string): boolean {
    return (
      method === "session/prompt" ||
      method === "session/load" ||
      method === "session/cancel" ||
      method === "session/set_mode" ||
      method === "session/set_config_option"
    );
  }

  private remapSessionInParams(params: unknown): unknown {
    if (!params || typeof params !== "object") return params;
    const p = { ...(params as Record<string, unknown>) };
    if (typeof p.sessionId === "string") {
      p.sessionId = this.sessionStore.get(p.sessionId) ?? p.sessionId;
    }
    return p;
  }

  private remapSessionInNotification(msg: JsonRpcMessage): JsonRpcMessage {
    if (!isNotification(msg)) return msg;
    const params = msg.params;
    if (!params || typeof params !== "object") return msg;
    const p = { ...(params as Record<string, unknown>) };
    if (typeof p.sessionId === "string") {
      p.sessionId = this.sessionStore.get(p.sessionId) ?? p.sessionId;
    }
    return { ...msg, params: p };
  }
}
