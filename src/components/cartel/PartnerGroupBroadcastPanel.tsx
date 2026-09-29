import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Radio } from "lucide-react";
import { toast } from "sonner";

import { Section } from "@/components/cartel/Section";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useWorkspace } from "@/lib/workspace-context";
import {
  PARTNER_BROADCAST_MAX,
  listPartnerBroadcastGroups,
  listPartnerGroupBroadcasts,
  partnerBroadcastErrorMessage,
  partnerBroadcastKeys,
  sendPartnerGroupBroadcast,
} from "@/lib/partner-group-broadcasts";

const ACTOR_LABEL: Record<string, string> = { you: "You", project_team: "Project team", service_partner: "Service Partner" };

/**
 * SP-B3 V1 — Service Partner community broadcasts (plain text only).
 * Uses only partner_* reads and the existing server send path. No group setup,
 * branding, Launch Watch button, contract or owner controls mount here.
 */
export function PartnerGroupBroadcastPanel() {
  const { workspaceId, workspace } = useWorkspace();
  const qc = useQueryClient();
  const [groupId, setGroupId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  // One request id per draft: a retry of the same draft never posts twice.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const groupsQ = useQuery({
    queryKey: partnerBroadcastKeys.groups(workspaceId),
    queryFn: () => listPartnerBroadcastGroups(workspaceId as string),
    enabled: !!workspaceId,
  });
  const groups = useMemo(() => groupsQ.data ?? [], [groupsQ.data]);
  const historyQ = useQuery({
    queryKey: partnerBroadcastKeys.history(workspaceId),
    queryFn: () => listPartnerGroupBroadcasts(workspaceId as string, 10),
    enabled: !!workspaceId,
  });

  useEffect(() => {
    if (groups.length === 0) return;
    if (!groupId || !groups.some((g) => g.group_connection_id === groupId)) {
      const next = groups.find((g) => g.operational) ?? groups[0];
      if (next) setGroupId(next.group_connection_id);
    }
  }, [groups, groupId]);
  const selected = groups.find((g) => g.group_connection_id === groupId) ?? null;

  const send = useMutation({
    mutationFn: () =>
      sendPartnerGroupBroadcast({
        workspaceId: workspaceId as string,
        groupConnectionId: groupId as string,
        message: message.trim(),
        clientRequestId: requestId,
      }),
    onSuccess: (r) => {
      setConfirmOpen(false);
      const where = r.groupTitle ?? selected?.title ?? "the community";
      if (r.status === "SENT") toast.success(r.duplicate ? `Already posted to ${where}. Nothing was sent twice.` : `Posted to ${where}.`);
      else if (r.status === "FAILED") toast.error(`Not posted to ${where}. Nothing was delivered.`);
      else toast.warning(`Delivery to ${where} could not be confirmed. Check the group before posting again.`);
      if (r.status === "SENT" || r.status === "FAILED") {
        setMessage("");
      }
      setRequestId(crypto.randomUUID());
      void qc.invalidateQueries({ queryKey: partnerBroadcastKeys.all });
    },
    onError: (e) => {
      setConfirmOpen(false);
      toast.error(partnerBroadcastErrorMessage(e));
    },
  });

  const trimmed = message.trim();
  const tooLong = trimmed.length > PARTNER_BROADCAST_MAX;
  const canSend = !!selected?.operational && trimmed.length > 0 && !tooLong && !send.isPending;

  if (groupsQ.isError) {
    return (
      <Section variant="primary" title="Community broadcasts" leading={<Radio className="size-4" aria-hidden="true" />}>
        <p className="text-sm text-muted-foreground">{partnerBroadcastErrorMessage(groupsQ.error)}</p>
      </Section>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Section
        variant="primary"
        title="Community broadcasts"
        leading={<Radio className="size-4" aria-hidden="true" />}
        description={`Post a plain-text update to a ${workspace?.name ?? "client"} Telegram community on the project's behalf.`}
      >
        {groupsQ.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading communities…</p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Telegram community is connected yet. The project owner connects communities.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="partner-broadcast-group">Community</Label>
              <Select value={groupId ?? ""} onValueChange={(v) => { setGroupId(v); setRequestId(crypto.randomUUID()); }}>
                <SelectTrigger id="partner-broadcast-group" className="min-h-11"><SelectValue placeholder="Choose a community" /></SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem key={g.group_connection_id} value={g.group_connection_id} className="min-h-11">
                      {g.title}{g.operational ? "" : " (needs owner attention)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selected && !selected.operational ? (
                <p className="text-xs text-muted-foreground">The bot is not an admin in this community. Ask the project owner to fix it.</p>
              ) : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="partner-broadcast-message">Message</Label>
              <Textarea
                id="partner-broadcast-message"
                rows={6}
                value={message}
                onChange={(e) => { setMessage(e.target.value); setRequestId(crypto.randomUUID()); }}
                aria-invalid={tooLong}
              />
              <p className={`text-xs ${tooLong ? "text-destructive" : "text-muted-foreground"}`}>{trimmed.length}/{PARTNER_BROADCAST_MAX}</p>
            </div>
            <Button className="min-h-11 self-start" disabled={!canSend} onClick={() => setConfirmOpen(true)}>Review broadcast</Button>
          </div>
        )}
      </Section>

      <Section variant="secondary" title="Recent community broadcasts">
        {historyQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (historyQ.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No community broadcasts yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {(historyQ.data ?? []).map((h) => (
              <li key={h.announcement_id} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <StatusBadge tone={h.status === "SENT" ? "green" : h.status === "FAILED" ? "red" : "gold"}>{h.status}</StatusBadge>
                  <span>{h.group_title}</span>
                  <span>· {ACTOR_LABEL[h.actor_kind] ?? "Team"}</span>
                  <span>· {new Date(h.sent_at ?? h.requested_at).toLocaleString()}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm">{h.message_text}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Post to {selected?.title ?? "community"}?</AlertDialogTitle>
            <AlertDialogDescription>This posts publicly in the group as @PepeCartelHQBot for {workspace?.name ?? "the client"}.</AlertDialogDescription>
          </AlertDialogHeader>
          <p className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border p-3 text-sm">{trimmed}</p>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" disabled={!canSend} onClick={(e) => { e.preventDefault(); send.mutate(); }}>
              {send.isPending ? "Posting…" : "Post broadcast"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
