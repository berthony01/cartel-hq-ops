import { useState } from "react";
import { Loader2, Radio } from "lucide-react";
import { Section } from "@/components/cartel/Section";
import { Button } from "@/components/ui/button";
import type { OfficialContractBroadcastResult } from "@/lib/telegram-group";

/**
 * C8.7D — the ONLY surface that posts a registered official contract to a
 * connected Telegram community.
 *
 * This component owns no data access and no authority: it never composes the
 * posted text and never sends a contract address. The `telegram-group` function
 * re-reads the launch, re-derives the address from its bound deployment
 * evidence, enforces owner-only workspace authority and writes the durable
 * broadcast ledger row before any Telegram call.
 *
 * Registering an official contract posts nothing. Notifying Launch Watch
 * subscribers posts nothing to a group. This is a separate, explicit action and
 * it states only that the authenticated project registered this contract from a
 * verified deployment record — never that it is safe, reviewed or approved.
 */

export type BroadcastGroupOption = {
  id: string;
  title: string;
  /** False when @PepeCartelHQBot is not an administrator of that community. */
  ready: boolean;
};

export type OfficialContractGroupBroadcastPanelProps = {
  launchStatus: string;
  /** True only when address, bound deployment and registration timestamp are all present. */
  registrationComplete: boolean;
  /** Registration-derived, read-only. Never editable and never posted from here. */
  officialContractAddress: string | null;
  chain: string | null;
  /** Presentation hint only. The server enforces owner-only broadcasting. */
  isWorkspaceOwner: boolean;
  groups: BroadcastGroupOption[];
  groupsLoading?: boolean;
  disabled?: boolean;
  pending?: boolean;
  result: OfficialContractBroadcastResult | null;
  error: string | null;
  onBroadcast: (groupConnectionId: string) => void;
};

const REGISTERED_STATUS = "OFFICIAL_CONTRACT_REGISTERED";

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>;
}

export function OfficialContractGroupBroadcastPanel({
  launchStatus,
  registrationComplete,
  officialContractAddress,
  chain,
  isWorkspaceOwner,
  groups,
  groupsLoading,
  disabled,
  pending,
  result,
  error,
  onBroadcast,
}: OfficialContractGroupBroadcastPanelProps) {
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [armed, setArmed] = useState(false);

  const atBroadcastStage = launchStatus === REGISTERED_STATUS;
  const readyGroups = groups.filter((g) => g.ready);
  const selectedGroup = readyGroups.find((g) => g.id === selectedGroupId) ?? null;

  let body: React.ReactNode;

  if (!registrationComplete) {
    body = (
      <Note>
        There is no complete evidence-bound official contract registration on this launch yet, so
        there is nothing to post. Registering a contract never posts to a community by itself.
      </Note>
    );
  } else if (!atBroadcastStage) {
    body = (
      <Note>
        Posting to a community becomes available once this launch reaches Official Contract
        Registered. It is {launchStatus}. Moving the launch into that stage posts nothing on its
        own.
      </Note>
    );
  } else if (!isWorkspaceOwner) {
    body = (
      <Note>
        Only the project owner can post the official contract to a Telegram community. Admin access
        is not sufficient, even where admins can send ordinary community broadcasts.
      </Note>
    );
  } else if (groupsLoading) {
    body = <Note>Loading connected Telegram communities…</Note>;
  } else if (readyGroups.length === 0) {
    body = (
      <Note>
        No connected Telegram community is ready. Connect a community and add @PepeCartelHQBot as an
        administrator in Community Command first.
      </Note>
    );
  } else {
    body = (
      <div className="space-y-3">
        <Note>
          This posts one message to one chosen community. It is separate from the direct message to
          Launch Watch subscribers — running one never runs the other.
        </Note>

        <div className="space-y-1">
          <label
            htmlFor="official-contract-broadcast-group"
            className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground"
          >
            Community
          </label>
          <select
            id="official-contract-broadcast-group"
            className="min-h-11 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
            value={selectedGroupId}
            disabled={disabled || pending}
            onChange={(e) => {
              setSelectedGroupId(e.target.value);
              setArmed(false);
            }}
          >
            <option value="">Choose a connected community…</option>
            {readyGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Registration-derived preview
          </p>
          <dl className="mt-1 space-y-1 text-xs">
            <div>
              <dt className="inline text-muted-foreground">Chain: </dt>
              <dd className="inline font-mono text-foreground">{chain ?? "—"}</dd>
            </div>
            <div className="min-w-0">
              <dt className="inline text-muted-foreground">Contract: </dt>
              <dd className="inline break-all font-mono text-foreground">
                {officialContractAddress ?? "—"}
              </dd>
            </div>
          </dl>
          <Note>
            Read-only. The exact wording and the address that get posted are rebuilt on the server
            from this launch&apos;s verified deployment record, not from this screen.
          </Note>
        </div>

        <Note>
          The message says only that this is the official contract registered by the authenticated
          project, derived from its verified deployment record. It is not a safety review, an audit,
          a guarantee, or an endorsement.
        </Note>
        <Note>
          One launch can only be posted once per community. Retrying reports the recorded outcome
          instead of posting a second message.
        </Note>

        {armed && selectedGroup ? (
          <div className="flex flex-wrap gap-2">
            <Button
              className="min-h-11"
              disabled={disabled || pending}
              onClick={() => onBroadcast(selectedGroup.id)}
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Radio className="size-4" aria-hidden="true" />
              )}
              Confirm — post to {selectedGroup.title}
            </Button>
            <Button
              variant="outline"
              className="min-h-11"
              disabled={disabled || pending}
              onClick={() => setArmed(false)}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            className="min-h-11"
            disabled={disabled || pending || !selectedGroup}
            onClick={() => setArmed(true)}
          >
            <Radio className="size-4" aria-hidden="true" />
            Post official contract to community
          </Button>
        )}
      </div>
    );
  }

  return (
    <Section
      variant="surface"
      title="Post to community"
      description="Owner only. Registration, watcher notification and this community post are three separate steps — only this one posts to Telegram."
      leading={
        <Radio className="size-4 text-[color:var(--cartel-gold,#D4A82A)]" aria-hidden="true" />
      }
    >
      <div className="space-y-3">
        {body}

        {result ? (
          <div
            role="status"
            className={
              result.status === "SENT"
                ? "rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2"
                : "rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2"
            }
          >
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground">
              {result.status === "SENT"
                ? result.duplicate
                  ? "Already posted"
                  : "Posted"
                : result.status === "FAILED"
                  ? "Not posted"
                  : "Outcome unconfirmed"}
            </p>
            <Note>{result.message ?? "The community post outcome was recorded."}</Note>
            {result.technical ? <Note>{result.technical}</Note> : null}
          </div>
        ) : null}

        {error ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-destructive">
              Not posted
            </p>
            <Note>{error}</Note>
          </div>
        ) : null}
      </div>
    </Section>
  );
}
