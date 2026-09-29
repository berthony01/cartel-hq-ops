import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Users } from "lucide-react";
import { toast } from "sonner";

import { Section } from "@/components/cartel/Section";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  WELCOME_AUTO_DELETE_MAX,
  WELCOME_AUTO_DELETE_MIN,
  WELCOME_MESSAGE_MAX,
  getPartnerWelcomeSettings,
  listPartnerCommunityGroups,
  partnerCommunityErrorMessage,
  partnerCommunityKeys,
  savePartnerWelcomeSettings,
  sendPartnerWelcomeTest,
  type PartnerWelcomeEdit,
} from "@/lib/partner-community-management";

/**
 * SP-B4 V1 — Service Partner community welcome settings.
 * Uses only partner_* reads and the existing server save/test path. No connect,
 * reconnect, disconnect, bot/admin, sticker, broadcast, mission or Launch Watch
 * configuration controls mount here.
 */
export function PartnerCommunityPanel() {
  const { workspaceId, workspace } = useWorkspace();
  const qc = useQueryClient();
  const [groupId, setGroupId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PartnerWelcomeEdit | null>(null);
  const [secondsText, setSecondsText] = useState("45");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const groupsQ = useQuery({
    queryKey: partnerCommunityKeys.groups(workspaceId),
    queryFn: () => listPartnerCommunityGroups(workspaceId as string),
    enabled: !!workspaceId,
  });
  const groups = useMemo(() => groupsQ.data ?? [], [groupsQ.data]);

  useEffect(() => {
    if (groups.length === 0) return;
    if (!groupId || !groups.some((g) => g.group_connection_id === groupId)) {
      const next = groups.find((g) => g.operational) ?? groups[0];
      if (next) setGroupId(next.group_connection_id);
    }
  }, [groups, groupId]);
  const selected = groups.find((g) => g.group_connection_id === groupId) ?? null;

  const settingsQ = useQuery({
    queryKey: partnerCommunityKeys.settings(workspaceId, groupId),
    queryFn: () => getPartnerWelcomeSettings(workspaceId as string, groupId as string),
    enabled: !!workspaceId && !!groupId,
  });

  useEffect(() => {
    const s = settingsQ.data;
    if (!s) return;
    setDraft({
      welcomeEnabled: s.welcome_enabled,
      welcomeMessage: s.welcome_message,
      mentionMember: s.mention_member,
      autoDeleteEnabled: s.auto_delete_enabled,
      autoDeleteSeconds: s.auto_delete_seconds,
    });
    setSecondsText(String(s.auto_delete_seconds));
  }, [settingsQ.data]);

  const trimmed = (draft?.welcomeMessage ?? "").trim();
  const seconds = Number(secondsText);
  const secondsValid = Number.isInteger(seconds) && seconds >= WELCOME_AUTO_DELETE_MIN && seconds <= WELCOME_AUTO_DELETE_MAX;
  const tooLong = trimmed.length > WELCOME_MESSAGE_MAX;
  const canSave = !!draft && !!groupId && trimmed.length > 0 && !tooLong && secondsValid;

  const save = useMutation({
    mutationFn: () =>
      savePartnerWelcomeSettings(workspaceId as string, groupId as string, {
        ...(draft as PartnerWelcomeEdit),
        welcomeMessage: trimmed,
        autoDeleteSeconds: seconds,
      }),
    onSuccess: () => {
      toast.success("Welcome settings saved.");
      void qc.invalidateQueries({ queryKey: partnerCommunityKeys.all });
    },
    onError: (e) => toast.error(partnerCommunityErrorMessage(e)),
  });

  const test = useMutation({
    mutationFn: () => sendPartnerWelcomeTest(workspaceId as string, groupId as string),
    onSuccess: (r) => {
      setConfirmOpen(false);
      toast.success(`Welcome test posted to ${r.groupTitle ?? selected?.title ?? "the community"}${r.launchWatchCtaIncluded ? " with the Launch Watch card" : ""}.`);
    },
    onError: (e) => {
      setConfirmOpen(false);
      toast.error(partnerCommunityErrorMessage(e));
    },
  });

  if (groupsQ.isError) {
    return (
      <Section variant="primary" title="Community welcome" leading={<Users className="size-4" aria-hidden="true" />}>
        <p className="text-sm text-muted-foreground">{partnerCommunityErrorMessage(groupsQ.error)}</p>
      </Section>
    );
  }

  const s = settingsQ.data;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Section
        variant="primary"
        title="Community welcome"
        leading={<Users className="size-4" aria-hidden="true" />}
        description={`Manage the welcome message new members see in ${workspace?.name ?? "the client"}'s Telegram communities.`}
      >
        {groupsQ.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading communities…</p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Telegram community is connected yet. The project owner connects communities.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="partner-community-group">Community</Label>
              <Select value={groupId ?? ""} onValueChange={(v) => setGroupId(v)}>
                <SelectTrigger id="partner-community-group" className="min-h-11"><SelectValue placeholder="Choose a community" /></SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem key={g.group_connection_id} value={g.group_connection_id} className="min-h-11">
                      {g.title}{g.operational ? "" : " (needs owner attention)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selected ? (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <StatusBadge tone={selected.operational ? "green" : "gold"}>{selected.operational ? "Ready" : "Needs owner attention"}</StatusBadge>
                  {!selected.operational ? <span>The bot needs admin rights in this community. Ask the project owner to fix it.</span> : null}
                </div>
              ) : null}
            </div>

            {settingsQ.isLoading || !draft ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading welcome settings…</p>
            ) : settingsQ.isError ? (
              <p className="text-sm text-muted-foreground">{partnerCommunityErrorMessage(settingsQ.error)}</p>
            ) : (
              <>
                <div className="flex min-h-11 items-center justify-between gap-3">
                  <Label htmlFor="partner-welcome-enabled">Send a welcome when members join</Label>
                  <Switch id="partner-welcome-enabled" checked={draft.welcomeEnabled} onCheckedChange={(v) => setDraft({ ...draft, welcomeEnabled: v })} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="partner-welcome-message">Welcome message</Label>
                  <Textarea
                    id="partner-welcome-message"
                    rows={6}
                    value={draft.welcomeMessage}
                    onChange={(e) => setDraft({ ...draft, welcomeMessage: e.target.value })}
                    aria-invalid={tooLong || trimmed.length === 0}
                  />
                  <p className={`text-xs ${tooLong ? "text-destructive" : "text-muted-foreground"}`}>
                    {trimmed.length}/{WELCOME_MESSAGE_MAX} · You can use {"{first_name}"}, {"{username}"}, {"{member}"} and {"{community_name}"}.
                  </p>
                </div>
                <div className="flex min-h-11 items-center justify-between gap-3">
                  <Label htmlFor="partner-welcome-mention">Mention the new member</Label>
                  <Switch id="partner-welcome-mention" checked={draft.mentionMember} onCheckedChange={(v) => setDraft({ ...draft, mentionMember: v })} />
                </div>
                <div className="flex min-h-11 items-center justify-between gap-3">
                  <Label htmlFor="partner-welcome-autodelete">Delete the welcome automatically</Label>
                  <Switch id="partner-welcome-autodelete" checked={draft.autoDeleteEnabled} onCheckedChange={(v) => setDraft({ ...draft, autoDeleteEnabled: v })} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="partner-welcome-seconds">Delete after (seconds, {WELCOME_AUTO_DELETE_MIN}–{WELCOME_AUTO_DELETE_MAX})</Label>
                  <Input
                    id="partner-welcome-seconds"
                    type="number"
                    inputMode="numeric"
                    min={WELCOME_AUTO_DELETE_MIN}
                    max={WELCOME_AUTO_DELETE_MAX}
                    className="min-h-11 max-w-40"
                    value={secondsText}
                    onChange={(e) => setSecondsText(e.target.value)}
                    aria-invalid={!secondsValid}
                  />
                  {!secondsValid ? <p className="text-xs text-destructive">Enter a whole number from 10 to 120.</p> : null}
                </div>

                <div className="rounded-md border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">Launch Watch card</span>
                    <StatusBadge tone="gold">Owner controlled</StatusBadge>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    {!s?.launch_watch_cta_enabled
                      ? "Off. The project owner decides whether a Launch Watch card follows the welcome."
                      : s.launch_watch_available
                        ? `On for ${s.launch_watch_label ?? "the project"}${s.launch_watch_ticker ? ` (${s.launch_watch_ticker})` : ""}. Saving keeps the owner's setting.`
                        : "On, but the selected launch is currently unavailable. Ask the project owner to review it."}
                  </p>
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button className="min-h-11" disabled={!canSave || save.isPending} onClick={() => save.mutate()}>
                    {save.isPending ? "Saving…" : "Save welcome"}
                  </Button>
                  <Button variant="outline" className="min-h-11" disabled={!selected?.operational || !s?.has_saved_settings || test.isPending} onClick={() => setConfirmOpen(true)}>
                    Send welcome test
                  </Button>
                </div>
                {!s?.has_saved_settings ? <p className="text-xs text-muted-foreground">Save the welcome once before sending a test.</p> : null}
              </>
            )}
          </div>
        )}
      </Section>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send a welcome test to {selected?.title ?? "community"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This posts the saved welcome publicly in the group as @PepeCartelHQBot, marked as a preview.
              {s?.launch_watch_cta_enabled && s.launch_watch_available ? " The owner's Launch Watch card is included." : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" disabled={test.isPending} onClick={(e) => { e.preventDefault(); test.mutate(); }}>
              {test.isPending ? "Sending…" : "Send test"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
