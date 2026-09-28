import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileLock2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { usePlatformAccess } from "@/hooks/usePlatformAccess";
import {
  activationConfirmPhrase,
  canActivatePolicy,
  findPlaceholders,
  policyContent,
  POLICY_DRAFTS,
  POLICY_TYPES,
  sha256Hex,
  type PolicyType,
} from "@/lib/legal-policies";
import { fetchActivePolicies, policyKeys } from "@/lib/policy-acceptance";
import { Section } from "@/components/cartel/Section";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Owner-only legal policy versions (Phase 1B-1 staging).
 * Fail closed: activation is disabled while any placeholder remains, needs
 * an exact typed confirmation phrase, and is additionally unavailable in
 * this preview because the staged activation RPC is not applied.
 */
function PolicyRow({ type, activeVersion }: { type: PolicyType; activeVersion: number | null }) {
  const draft = POLICY_DRAFTS[type];
  const text = policyContent(draft);
  const placeholders = findPlaceholders(text);
  const blocked = !canActivatePolicy(text);
  const phrase = activationConfirmPhrase(type, draft.draftVersion);
  const [typed, setTyped] = useState("");
  const hash = useQuery({ queryKey: ["policy-hash", type, draft.draftVersion], queryFn: () => sha256Hex(text), staleTime: Infinity });

  return (
    <li className="rounded-md border border-border/70 bg-surface-raised/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link to={draft.path} className="font-semibold text-foreground underline-offset-4 hover:underline">{draft.title}</Link>
        <StatusBadge tone="muted">Draft v{draft.draftVersion}</StatusBadge>
        <StatusBadge tone={activeVersion ? "gold" : "muted"}>{activeVersion ? `Active v${activeVersion}` : "No active version"}</StatusBadge>
      </div>
      <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">sha256 {hash.data ?? "…"}</p>
      {blocked ? (
        <p className="mt-2 text-xs text-signal">
          Activation blocked: {placeholders.length} unresolved placeholder{placeholders.length === 1 ? "" : "s"} ({placeholders.slice(0, 4).join(", ")}{placeholders.length > 4 ? ", …" : ""}).
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Input
          aria-label={`Type ${phrase} to confirm`}
          placeholder={`Type ${phrase}`}
          value={typed}
          disabled={blocked}
          onChange={(e) => setTyped(e.target.value)}
          className="min-h-11 max-w-xs"
        />
        <Button disabled title="Unavailable in this preview until placeholders are resolved and the policy contract is applied" className="min-h-11">
          Activate
        </Button>
      </div>
    </li>
  );
}

export function PolicyAdminSection() {
  const access = usePlatformAccess();
  const active = useQuery({ queryKey: policyKeys.active(), queryFn: fetchActivePolicies, enabled: access.isPlatformOwner === true });
  if (access.isPlatformOwner !== true) return null;
  return (
    <Section
      title="Legal policies"
      description="Versioned Terms, Privacy, Refund and Partner Agreement. Drafts are not effective. Activation requires zero placeholders and a typed confirmation."
      leading={<FileLock2 className="size-4 text-gold" aria-hidden="true" />}
    >
      <ul className="space-y-3">
        {POLICY_TYPES.map((t) => (
          <PolicyRow key={t} type={t} activeVersion={active.data?.find((p) => p.document_type === t)?.version ?? null} />
        ))}
      </ul>
    </Section>
  );
}
