import type { WorkbenchContextSnapshotV1 } from "@/types/api-contract";

export type CocoServerMessage = {
  contract_version: "1.0";
  type: string;
  session_id: string;
  request_id: string;
  event_id: string;
  timestamp: string;
  context_hash: string;
  data?: Record<string, unknown> | null;
  error?: { detail?: string; code?: string } | null;
};

export type CocoPermissionRequest = {
  permission_id: string;
  tool: string;
  resource: string;
  reason: string;
  expected_effect: string;
  risk: string;
  reversible: boolean;
  input?: Record<string, unknown>;
  questions?: Array<{
    question: string;
    header?: string;
    options?: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  }>;
  plan?: string;
};

function frame(
  type: string,
  contextHash: string,
  data: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    contract_version: "1.0",
    type,
    request_id: crypto.randomUUID(),
    event_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    context_hash: contextHash,
    data,
  });
}

function getCloseCodeMessage(code: number): string {
  switch (code) {
    case 4401:
      return "CoCo: Authentication required - please log in again";
    case 4403:
      return "CoCo: Permission denied - check your access rights";
    case 4404:
      return "CoCo: Service not found - CoCo may not be enabled";
    case 4500:
      return "CoCo: Internal server error - please try again";
    case 4503:
      return "CoCo: Service unavailable - CoCo may be starting up";
    case 1006:
      return "CoCo: Connection lost unexpectedly";
    default:
      return `CoCo: Connection closed (code ${code})`;
  }
}

export type CocoDiagnostics = {
  status: "ok" | "degraded" | "error";
  sdk_loaded: boolean;
  cli_available: boolean;
  cli_version: string | null;
  knowledge_dir_exists: boolean;
  error?: string;
};

export async function fetchCocoDiagnostics(): Promise<CocoDiagnostics> {
  try {
    const response = await fetch("/api/v1/coco/diagnostics");
    if (!response.ok) {
      return {
        status: "error",
        sdk_loaded: false,
        cli_available: false,
        cli_version: null,
        knowledge_dir_exists: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }
    return await response.json();
  } catch (err) {
    return {
      status: "error",
      sdk_loaded: false,
      cli_available: false,
      cli_version: null,
      knowledge_dir_exists: false,
      error: err instanceof Error ? err.message : "Failed to fetch diagnostics",
    };
  }
}

export function getDiagnosticsErrorMessage(diagnostics: CocoDiagnostics): string | null {
  if (diagnostics.status === "ok") return null;
  if (!diagnostics.sdk_loaded) return "CoCo service not available - SDK not loaded";
  if (!diagnostics.cli_available) return "CoCo CLI not configured on server";
  if (!diagnostics.knowledge_dir_exists) return "CoCo knowledge directory not found";
  return diagnostics.error || "CoCo service unavailable";
}

export class CocoSessionClient {
  private socket: WebSocket | null = null;
  private ready = false;

  connect(
    snapshot: WorkbenchContextSnapshotV1,
    onMessage: (message: CocoServerMessage) => void,
    onDisconnect: () => void,
  ): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN && this.ready) return Promise.resolve();
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${scheme}://${window.location.host}/api/v1/coco/ws`);
    this.socket = socket;
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.close();
        reject(new Error("Timed out waiting for CoCo session readiness."));
      }, 60000);
      const settleReady = () => {
        if (settled) return;
        settled = true;
        this.ready = true;
        window.clearTimeout(timeout);
        resolve();
      };
      const settleError = (error: Error) => {
        if (settled) return;
        settled = true;
        this.ready = false;
        window.clearTimeout(timeout);
        reject(error);
      };
      socket.onopen = () => {
        socket.send(
          frame("session.start", snapshot.context_hash, {
            workspace_context: snapshot,
          }),
        );
      };
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as CocoServerMessage;
        if (message.type === "session.ready") {
          settleReady();
        }
        if (message.type === "assistant.error" && !settled) {
          settleError(new Error(message.error?.detail ?? "CoCo deep-agent session could not start."));
        }
        onMessage(message);
      };
      socket.onerror = () => settleError(new Error("Unable to connect to CoCo deep-agent service."));
      socket.onclose = (event) => {
        this.ready = false;
        if (!settled) {
          const errorMsg = event.code ? getCloseCodeMessage(event.code) : "CoCo deep-agent service disconnected before the session was ready.";
          settleError(new Error(errorMsg));
        }
        onDisconnect();
      };
    });
  }

  sendMessage(message: string, snapshot: WorkbenchContextSnapshotV1): void {
    this.send("message.send", snapshot.context_hash, { message, workspace_context: snapshot });
  }

  decidePermission(
    contextHash: string,
    permissionId: string,
    decision: "allow_once" | "allow_session" | "deny" | "deny_with_feedback" | "cancel",
    feedback = "",
  ): void {
    this.send("permission.decide", contextHash, {
      permission_id: permissionId,
      decision,
      feedback,
    });
  }

  answerQuestion(contextHash: string, permissionId: string, answers: Record<string, string>): void {
    this.send("question.answer", contextHash, { permission_id: permissionId, answers });
  }

  reviewPlan(
    contextHash: string,
    permissionId: string,
    decision: "approve" | "request_changes" | "cancel",
    feedback = "",
  ): void {
    this.send("plan.review", contextHash, { permission_id: permissionId, decision, feedback });
  }

  cancel(contextHash: string): void {
    this.send("session.cancel", contextHash);
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
    this.ready = false;
  }

  private send(type: string, contextHash: string, data: Record<string, unknown> = {}): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("CoCo session is not connected.");
    }
    this.socket.send(frame(type, contextHash, data));
  }
}
