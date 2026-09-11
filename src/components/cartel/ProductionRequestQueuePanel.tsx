import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/cartel/Section";
import { ReadoutLine } from "@/components/cartel/CanaryReadout";
import {
  reviewActionsFor,
  type PlatformProductionRequest,
  type PlatformRequestStatusTarget,
} from "@/lib/launch-production-request-platform.functions";

/**
 * Launcher-B3 — owner-only production request queue (presentation only).
 *
 * This component renders rows and raises intent to its parent. It holds no
 * authority: every action it can offer is re-authorized server-side, and there
 * is deliberately NO manual "executing" and NO manual "completed" control here.
 * `COMPLETED` is derived by the database from verified deployment and managed
 * finality evidence only.
 */

const TARGET_LABEL: Record<PlatformRequestStatusTarget, string> = {
  IN_REVIEW: "Start review",
  APPROVED: "Approve",
  DECLINED: "Decline",
};

export type ProductionRequestQueuePanelProps = {
  requests: PlatformProductionRequest[];
  loading: boolean;
  notice: string | null;
  selectedRequestId: string | null;
  busy: boolean;
  onSelect: (requestId: string | null) => void;
  onDecision: (
    requestId: string,
    target: PlatformRequestStatusTarget,
    note: string,
  ) => void | Promise<void>;
};

export function ProductionRequestQueuePanel({
  requests,
  loading,
  notice,
  selectedRequestId,
  busy,
  onSelect,
  onDecision,
}: ProductionRequestQueuePanelProps) {
  const [notes, setNotes] = useState<Record<string, string>>({});

  return (
    <Section
      variant="surface"
      title="Production deployment requests"
      description="Customer requests for a Robinhood Chain production deployment. Reviewing a request deploys nothing: approval is a decision only, and execution stays a separate deliberate action."
    >
      {loading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the request queue…
        </p>
      ) : notice ? (
        <p className="text-xs text-danger">
          Queue unavailable ({notice}). Nothing is assumed about pending requests.
        </p>
      ) : requests.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No production deployment requests are on record.
        </p>
      ) : (
        <ul className="space-y-3">
          {requests.map((request) => {
            const actions = reviewActionsFor(request.status);
            const note = notes[request.id] ?? "";
            const isSelected = request.id === selectedRequestId;
            const completed = request.effectiveStatus === "COMPLETED";
            return (
              <li
                key={request.id}
                className={`rounded-md border p-3 ${
                  isSelected ? "border-primary/60 bg-surface-raised/60" : "border-border/40"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">
                    {request.projectName ?? "Project"} — {request.tokenSymbol}
                  </p>
                  <span className="rounded border border-border/60 px-2 py-0.5 font-mono text-[11px] uppercase text-foreground">
                    {completed ? "COMPLETED (derived)" : request.status}
                  </span>
                </div>

                <div className="mt-2 grid gap-1 sm:grid-cols-2">
                  <ReadoutLine label={"Request id"} value={request.id} />
                  <ReadoutLine label={"Workspace"} value={request.workspaceName ?? request.workspaceId} />
                  <ReadoutLine label={"Launch"} value={request.launchName ?? request.launchId} />
                  <ReadoutLine label={"Launch status"} value={request.launchStatus} />
                  <ReadoutLine label={"Launch kind"} value={request.launchKind} />
                  <ReadoutLine label={"Requested at"} value={request.requestedAt} />
                  <ReadoutLine label={"Token name"} value={request.tokenName} />
                  <ReadoutLine label={"Onchain symbol"} value={request.tokenSymbol} />
                  <ReadoutLine label={"Supply (whole)"} value={request.tokenSupplyWhole} />
                  <ReadoutLine label={"Base units"} value={request.tokenTotalSupplyBaseUnits} />
                  <ReadoutLine label={"Immutable recipient"} value={request.tokenRecipient} />
                  <ReadoutLine
                    label={"Execution deployment id"}
                    value={request.executionDeploymentId}
                  />
                  <ReadoutLine label={"Decision note"} value={request.decisionNote} />
                </div>

                {actions.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {actions.includes("DECLINED") ? (
                      <Input
                        value={note}
                        onChange={(event) =>
                          setNotes((prev) => ({ ...prev, [request.id]: event.target.value }))
                        }
                        placeholder="Decline reason (required, min 8 characters)"
                        className="max-w-xl"
                      />
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      {actions.map((target) => (
                        <Button
                          key={target}
                          size="sm"
                          variant={target === "DECLINED" ? "destructive" : "outline"}
                          className="min-h-11"
                          disabled={
                            busy || (target === "DECLINED" && note.trim().length < 8)
                          }
                          onClick={() => void onDecision(request.id, target, note.trim())}
                        >
                          {TARGET_LABEL[target]}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={isSelected ? "secondary" : "outline"}
                    className="min-h-11"
                    disabled={busy}
                    onClick={() => onSelect(isSelected ? null : request.id)}
                  >
                    {isSelected ? "Close request execution" : "Open request execution"}
                  </Button>
                </div>

                {request.status === "EXECUTING" ? (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Protected execution has begun for this request. Status can no longer be changed
                    by hand; only the existing protected stages continue it.
                  </p>
                ) : null}
                {completed ? (
                  <p className="mt-2 text-[11px] text-success">
                    Completion is derived from verified deployment and managed finality evidence.
                    The project owner can now register the official contract in Launch Control.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
