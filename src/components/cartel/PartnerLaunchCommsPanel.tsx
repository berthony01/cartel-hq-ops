import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Megaphone, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";

import { Section } from "@/components/cartel/Section";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { LAUNCH_STATUS_LABELS, toLaunchStatus } from "@/lib/launch-control";
import {
  WATCHER_UPDATE_BODY_MAX,
  WATCHER_UPDATE_TITLE_MAX,
  createPartnerWatcherUpdate,
  getPartnerWatcherStats,
  listPartnerCommsLaunches,
  listPartnerWatcherUpdates,
  partnerLaunchCommsErrorMessage,
  partnerLaunchCommsKeys,
} from "@/lib/partner-launch-comms";

/**
 * SP-B2 V1 — Service Partner Launch Watch messages.
 *
 * Partner-only surface for a managed client project. Uses ONLY the partner_*
 * launch comms RPCs. Shows aggregate counts and past update text — never
 * watcher identities. No launch status, contract, schedule, deployment or
 * owner Launch Control controls mount here.
 */
export function PartnerLaunchCommsPanel() {
  const { workspaceId, workspace } = useWorkspace();
  const qc = useQueryClient();
  const [launchId, setLaunchId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  // One request id per draft: retries of the same draft replay, never double-send.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const launchesQ = useQuery({
    queryKey: partnerLaunchCommsKeys.launches(workspaceId),
    queryFn: () => listPartnerCommsLaunches(workspaceId as string),
    enabled: !!workspaceId,
  });
  const launches = useMemo(() => launchesQ.data ?? [], [launchesQ.data]);

  useEffect(() => {
    if (launches.length === 0) return;
    if (!launchId || !launches.some((l) => l.launch_id === launchId)) {
      const next = launches.find((l) => l.can_send) ?? launches[0];
      if (next) setLaunchId(next.launch_id);
    }
  }, [launches, launchId]);

  const selected = launches.find((l) => l.launch_id === launchId) ?? null;

  const statsQ = useQuery({
    queryKey: partnerLaunchCommsKeys.stats(workspaceId, launchId),
    queryFn: () => getPartnerWatcherStats(workspaceId as string, launchId as string),
    enabled: !!workspaceId && !!launchId,
  });
  const historyQ = useQuery({
    queryKey: partnerLaunchCommsKeys.history(workspaceId, launchId),
    queryFn: () => listPartnerWatcherUpdates(workspaceId as string, launchId as string, 10),
    enabled: !!workspaceId && !!launchId,
  });

  const send = useMutation({
    mutationFn: () =>
      createPartnerWatcherUpdate({
        workspaceId: workspaceId as string,
        launchId: launchId as string,
        clientRequestId: requestId,
        title: title.trim() ? title.trim() : null,
        body,
      }),
    onSuccess: () => {
      toast.success("Update queued for opted-in watchers.");
      setTitle("");
      setBody("");
      setRequestId(crypto.randomUUID());
      setConfirmOpen(false);
      void qc.invalidateQueries({ queryKey: partnerLaunchCommsKeys.all });
    },
    onError: (e) => {
      setConfirmOpen(false);
      toast.error(partnerLaunchCommsErrorMessage(e));
    },
  });

  const trimmedBody = body.trim();
  const titleTooLong = title.trim().length > WATCHER_UPDATE_TITLE_MAX;
  const bodyTooLong = trimmedBody.length > WATCHER_UPDATE_BODY_MAX;
  const reachable = statsQ.data?.updates_enabled_watchers ?? 0;
  const canCompose = !!selected?.can_send;
  const canSend = canCompose && trimmedBody.length > 0 && !titleTooLong && !bodyTooLong && reachable > 0 && !send.isPending;

  if (launchesQ.isError) {
    return (
      <Section variant="primary" title="Launch Watch messages" leading={<Megaphone className="size-4" aria-hidden="true" />}>
        <p className="text-sm text-muted-foreground">{partnerLaunchCommsErrorMessage(launchesQ.error)}</p>
      </Section>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Section
        variant="primary"
        title="Launch Watch messages"
        leading={<Megaphone className="size-4" aria-hidden="true" />}
        description={`Send updates to people who already chose to watch a ${workspace?.name ?? "client"} launch. Muted and unsubscribed watchers never receive them.`}
      >
        {launchesQ.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading launches…</p>
        ) : launches.length === 0 ? (
          <p className="text-sm text-muted-foreground">This project has no launches yet. The project owner creates launches.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="partner-comms-launch">Launch</Label>
              <Select value={launchId ?? ""} onValueChange={(v) => { setLaunchId(v); setRequestId(crypto.randomUUID()); }}>
                <SelectTrigger id="partner-comms-launch" className="min-h-11"><SelectValue placeholder="Choose a launch" /></SelectTrigger>
                <SelectContent>
                  {launches.map((l) => (
                    <SelectItem key={l.launch_id} value={l.launch_id} className="min-h-11">
                      {l.token_name}{l.ticker ? ` · ${l.ticker}` : ""} — {LAUNCH_STATUS_LABELS[toLaunchStatus(l.status)] ?? l.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <dl className="grid grid-cols-3 gap-2" aria-label="Watcher counts">
              <Stat label="Watching" value={statsQ.data?.active_watchers} />
              <Stat label="Will receive" value={statsQ.data?.updates_enabled_watchers} />
              <Stat label="Muted" value={statsQ.data?.updates_muted_watchers} />
            </dl>

            {!canCompose && selected ? (
              <p className="rounded-md border border-border-subtle p-3 text-sm text-muted-foreground">
                Updates can be sent once the launch watchlist is open and the Project Profile is published. Only the project owner can change those.
              </p>
            ) : null}

            <div className="grid gap-2">
              <Label htmlFor="partner-comms-title">Title (optional)</Label>
              <Input id="partner-comms-title" className="min-h-11" value={title} maxLength={WATCHER_UPDATE_TITLE_MAX} disabled={!canCompose} onChange={(e) => setTitle(e.target.value)} />
              <p className="text-xs text-muted-foreground">{title.length}/{WATCHER_UPDATE_TITLE_MAX}</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="partner-comms-body">Update</Label>
              <Textarea id="partner-comms-body" rows={6} value={body} maxLength={WATCHER_UPDATE_BODY_MAX} disabled={!canCompose} onChange={(e) => setBody(e.target.value)} />
              <p className="text-xs text-muted-foreground">{body.length}/{WATCHER_UPDATE_BODY_MAX}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button className="min-h-11" disabled={!canSend} onClick={() => setConfirmOpen(true)}>Preview and send</Button>
              {canCompose && reachable === 0 && statsQ.isSuccess ? (
                <span className="text-sm text-muted-foreground">No watchers currently allow project updates.</span>
              ) : null}
            </div>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5" aria-hidden="true" /> Watcher identities are never shown. At most one update per minute and 20 per day per launch.
            </p>
          </div>
        )}
      </Section>

      {launchId ? (
        <Section title="Recent updates" leading={<Users className="size-4" aria-hidden="true" />} description="Delivery counts only.">
          {historyQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : historyQ.isError ? (
            <p className="text-sm text-muted-foreground">{partnerLaunchCommsErrorMessage(historyQ.error)}</p>
          ) : (historyQ.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No updates sent for this launch yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {(historyQ.data ?? []).map((u) => (
                <li key={u.event_id} className="surface-quiet rounded-lg p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="min-w-0 font-medium text-foreground">{u.title ?? "Project update"}</p>
                    <time className="text-xs text-muted-foreground" dateTime={u.created_at}>{new Date(u.created_at).toLocaleString()}</time>
                  </div>
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-sm text-muted-foreground">{u.body}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <StatusBadge tone="green">{u.sent_count} sent</StatusBadge>
                    {u.pending_count ? <StatusBadge tone="muted">{u.pending_count} pending</StatusBadge> : null}
                    {u.failed_count ? <StatusBadge tone="red">{u.failed_count} failed</StatusBadge> : null}
                    {u.ambiguous_count ? <StatusBadge tone="gold">{u.ambiguous_count} uncertain</StatusBadge> : null}
                    {u.skipped_count ? <StatusBadge tone="muted">{u.skipped_count} skipped</StatusBadge> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}

      <AlertDialog open={confirmOpen} onOpenChange={(o) => !send.isPending && setConfirmOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send this update?</AlertDialogTitle>
            <AlertDialogDescription>
              It goes to {reachable} opted-in watcher{reachable === 1 ? "" : "s"} of {selected?.token_name ?? "this launch"} on behalf of {workspace?.name ?? "the client project"}. Sent messages cannot be recalled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="surface-quiet max-h-64 overflow-auto rounded-md p-3 text-sm">
            {title.trim() ? <p className="font-medium text-foreground">{title.trim()}</p> : null}
            <p className="whitespace-pre-wrap break-words text-muted-foreground">{trimmedBody}</p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" disabled={send.isPending}>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11"
              disabled={send.isPending}
              onClick={(e) => { e.preventDefault(); send.mutate(); }}
            >
              {send.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null} Send update
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="surface-quiet min-w-0 rounded-lg p-3">
      <dt className="type-eyebrow text-muted-foreground">{label}</dt>
      <dd className="mt-1.5 font-display text-xl leading-none text-foreground">{value ?? "—"}</dd>
    </div>
  );
}
