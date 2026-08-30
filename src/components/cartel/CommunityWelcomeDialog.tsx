import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";

import {
  DEFAULT_WELCOME_MESSAGE,
  WELCOME_AUTO_DELETE_MAX,
  WELCOME_AUTO_DELETE_MIN,
  WELCOME_MESSAGE_MAX,
  fetchCommunityWelcomeSettings,
  saveCommunityWelcomeSettings,
  sendCommunityWelcomeTest,
  type LaunchWatchCtaOption,
  type TelegramCommunitySettingsMetadata,
  type TelegramGroupConnection,
} from "@/lib/telegram-group";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/cartel/StatusBadge";


/**
 * Welcome & onboarding controls for ONE connected Telegram community.
 * Settings are fetched lazily when the dialog opens, never per group on load.
 */

const PLACEHOLDERS: Array<{ token: string; hint: string }> = [
  { token: "{first_name}", hint: "the new member's first name" },
  { token: "{username}", hint: "their @username when available" },
  { token: "{member}", hint: "a tappable mention of the new member" },
  { token: "{community_name}", hint: "this community's title" },
];

function renderPreview(template: string, communityName: string, mention: boolean) {
  const name = "New Member";
  return template
    .replaceAll("{first_name}", name)
    .replaceAll("{username}", "@newmember")
    .replaceAll("{member}", mention ? `@${name}` : name)
    .replaceAll("{community_name}", communityName);
}

/** Human wording for the webhook's last-join diagnostic codes. */
function describeJoinResult(result: string | null | undefined) {
  switch (result) {
    case "sent":
      return "Welcome sent to the community.";
    case "send_failed":
      return "Welcome could not be delivered by Telegram.";
    case "skipped_disabled":
      return "Welcome skipped because real joins were disabled.";
    case "skipped_no_message":
      return "Welcome skipped because no message was saved.";
    default:
      return result ? `Result: ${result}` : "No result recorded.";
  }
}

function formatDiagnosticTime(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

export function CommunityWelcomeDialog({
  open,
  onOpenChange,
  workspaceId,
  group,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string | null | undefined;
  group: TelegramGroupConnection;
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [dirty, setDirty] = useState(false);

  const [enabled, setEnabled] = useState(false);
  /** Last state confirmed by the server. Drives the unmistakable ON/OFF banner. */
  const [savedEnabled, setSavedEnabled] = useState(false);
  const [diagnostic, setDiagnostic] = useState<TelegramCommunitySettingsMetadata | null>(null);
  const [message, setMessage] = useState(DEFAULT_WELCOME_MESSAGE);
  const [mention, setMention] = useState(true);
  const [autoDelete, setAutoDelete] = useState(true);
  const [seconds, setSeconds] = useState(45);

  /** Phase 5.1 — optional public Launch Watch CTA. Off by default. */
  const [ctaEnabled, setCtaEnabled] = useState(false);
  const [ctaLaunchId, setCtaLaunchId] = useState<string | null>(null);
  const [ctaShowWebsite, setCtaShowWebsite] = useState(true);
  const [ctaShowTelegram, setCtaShowTelegram] = useState(false);
  const [ctaShowX, setCtaShowX] = useState(true);
  const [eligibleLaunches, setEligibleLaunches] = useState<LaunchWatchCtaOption[]>([]);

  useEffect(() => {
    if (!open || !workspaceId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetchCommunityWelcomeSettings({ workspaceId, groupConnectionId: group.id })
      .then((result) => {
        if (cancelled) return;
        const s = result.settings;
        setEnabled(s.welcome_enabled === true);
        setSavedEnabled(s.welcome_enabled === true);
        setDiagnostic(
          s.metadata && typeof s.metadata === "object"
            ? (s.metadata as TelegramCommunitySettingsMetadata)
            : null,
        );
        setMessage(s.welcome_message || DEFAULT_WELCOME_MESSAGE);
        setMention(s.mention_member !== false);
        setAutoDelete(s.auto_delete_enabled !== false);
        setSeconds(Number(s.auto_delete_seconds) || 45);
        setCtaEnabled(s.launch_watch_cta_enabled === true);
        setCtaLaunchId(s.launch_watch_launch_id ?? null);
        setCtaShowWebsite(s.launch_watch_show_website !== false);
        setCtaShowTelegram(s.launch_watch_show_telegram === true);
        setCtaShowX(s.launch_watch_show_x !== false);
        setEligibleLaunches(Array.isArray(result.eligibleLaunches) ? result.eligibleLaunches : []);
        setCanManage(result.canManage === true);
        setDirty(false);
      })

      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(
          error instanceof Error ? error.message : "Could not load community welcome settings.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, workspaceId, group.id]);

  const trimmed = message.trim();
  const invalidMessage = trimmed.length === 0 || trimmed.length > WELCOME_MESSAGE_MAX;
  const invalidSeconds =
    !Number.isInteger(seconds) ||
    seconds < WELCOME_AUTO_DELETE_MIN ||
    seconds > WELCOME_AUTO_DELETE_MAX;

  const selectedLaunch = useMemo(
    () => eligibleLaunches.find((o) => o.launchId === ctaLaunchId) ?? null,
    [eligibleLaunches, ctaLaunchId],
  );
  const noEligibleLaunches = eligibleLaunches.length === 0;
  const ctaSelectionInvalid = ctaEnabled && !selectedLaunch;

  const preview = useMemo(
    () => renderPreview(trimmed || DEFAULT_WELCOME_MESSAGE, group.title, mention),
    [trimmed, group.title, mention],
  );

  /** Conceptual button summary only — this is not a Telegram rendering. */
  const buttonSummary = useMemo(() => {
    if (!ctaEnabled || !selectedLaunch) return null;
    const parts = ["🔔 Watch this launch"];
    if (ctaShowWebsite && selectedLaunch.hasWebsite) parts.push("🌐 Website");
    if (ctaShowTelegram && selectedLaunch.hasTelegram) parts.push("💬 Telegram");
    if (ctaShowX && selectedLaunch.hasX) parts.push("𝕏 X");
    return `Buttons: ${parts.join(" · ")}`;
  }, [ctaEnabled, selectedLaunch, ctaShowWebsite, ctaShowTelegram, ctaShowX]);

  const touch = () => setDirty(true);

  const handleSave = async () => {
    if (!workspaceId || invalidMessage || invalidSeconds || ctaSelectionInvalid) return;
    setSaving(true);
    try {
      const result = await saveCommunityWelcomeSettings({
        workspaceId,
        groupConnectionId: group.id,
        settings: {
          welcomeEnabled: enabled,
          welcomeMessage: trimmed,
          mentionMember: mention,
          autoDeleteEnabled: autoDelete,
          autoDeleteSeconds: seconds,
          launchWatchCtaEnabled: ctaEnabled,
          launchWatchLaunchId: ctaEnabled ? (ctaLaunchId ?? null) : null,
          launchWatchShowWebsite: ctaShowWebsite,
          launchWatchShowTelegram: ctaShowTelegram,
          launchWatchShowX: ctaShowX,
        },
      });
      if (Array.isArray(result.eligibleLaunches)) setEligibleLaunches(result.eligibleLaunches);
      if (!ctaEnabled) setCtaLaunchId(null);
      setCanManage(result.canManage === true || result.saved === true);
      setDirty(false);
      setSavedEnabled(enabled);

      toast.success(
        enabled
          ? `Saved. Real join welcomes are now ON for ${group.title}.`
          : `Saved. Real join welcomes are now OFF for ${group.title}. New members receive nothing.`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save community welcome settings.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!workspaceId) return;
    setTesting(true);
    try {
      const result = await sendCommunityWelcomeTest({
        workspaceId,
        groupConnectionId: group.id,
      });
      const base = result.autoDeleteSeconds
        ? `Test welcome posted in ${group.title}. The bot removes it in ${result.autoDeleteSeconds}s.`
        : `Test welcome posted in ${group.title}.`;
      if (savedEnabled) toast.success(base);
      else
        toast.warning(
          `${base} This was a preview only. Real join welcomes are OFF, so new members receive nothing.`,
        );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send the test welcome.");
    } finally {
      setTesting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm uppercase tracking-[0.14em]">
            Welcome &amp; onboarding
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            Posted publicly in <strong>{group.title}</strong> when someone joins. CARTEL HQ only
            deletes its own welcome message. Telegram’s join notice is never touched.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading community settings…
          </p>
        ) : loadError ? (
          <p className="rounded-md border border-signal/40 bg-signal/5 p-3 text-xs text-signal">
            {loadError}
          </p>
        ) : (
          <div className="space-y-4">
            <div
              className={
                savedEnabled
                  ? "rounded-md border border-pepe/50 bg-pepe/10 p-3"
                  : "rounded-md border border-signal/50 bg-signal/10 p-3"
              }
            >
              <p
                className={
                  savedEnabled
                    ? "text-xs font-semibold uppercase tracking-[0.14em] text-pepe"
                    : "text-xs font-semibold uppercase tracking-[0.14em] text-signal"
                }
              >
                {savedEnabled ? "Real join welcome: ON" : "Real join welcome: OFF"}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {savedEnabled
                  ? "New members joining this community receive the saved welcome message."
                  : "Test sends are previews only. New members joining this community receive nothing until you turn this on and save."}
              </p>
              {dirty ? (
                <p className="mt-1 text-[11px] leading-relaxed text-gold">
                  Unsaved changes. This state updates only after you press Save.
                </p>
              ) : null}
            </div>

            {diagnostic?.last_join_detected_at ? (
              <div className="rounded-md border border-border/60 bg-background/40 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Last join diagnostic
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-foreground">
                  Join detected
                  {formatDiagnosticTime(diagnostic.last_join_detected_at)
                    ? ` ${formatDiagnosticTime(diagnostic.last_join_detected_at)}`
                    : ""}
                  {" · "}
                  {describeJoinResult(diagnostic.last_welcome_result)}
                </p>
              </div>
            ) : null}

            {!canManage ? (
              <p className="rounded-md border border-border bg-surface-raised p-2.5 text-xs text-muted-foreground">
                Only workspace owners and admins can change these settings.
              </p>
            ) : null}

            <div className="flex min-h-11 items-center justify-between gap-3">
              <Label htmlFor={`welcome-enabled-${group.id}`} className="text-xs">
                Enable for real member joins
              </Label>
              <Switch
                id={`welcome-enabled-${group.id}`}
                checked={enabled}
                disabled={!canManage}
                onCheckedChange={(v) => {
                  setEnabled(v === true);
                  touch();
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`welcome-message-${group.id}`} className="text-xs">
                Message
              </Label>
              <Textarea
                id={`welcome-message-${group.id}`}
                value={message}
                rows={5}
                disabled={!canManage}
                maxLength={WELCOME_MESSAGE_MAX}
                onChange={(e) => {
                  setMessage(e.target.value);
                  touch();
                }}
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>Plain text. Telegram formatting tags are not allowed.</span>
                <span>
                  {trimmed.length}/{WELCOME_MESSAGE_MAX}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {PLACEHOLDERS.map((p) => (
                  <StatusBadge key={p.token} tone="muted" className="font-mono">
                    <span title={p.hint}>{p.token}</span>
                  </StatusBadge>
                ))}
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {PLACEHOLDERS.map((p) => `${p.token}: ${p.hint}`).join(" · ")}
              </p>
            </div>

            <div className="flex min-h-11 items-center justify-between gap-3">
              <Label htmlFor={`welcome-mention-${group.id}`} className="text-xs">
                Mention the new member
              </Label>
              <Switch
                id={`welcome-mention-${group.id}`}
                checked={mention}
                disabled={!canManage}
                onCheckedChange={(v) => {
                  setMention(v === true);
                  touch();
                }}
              />
            </div>

            <div className="flex min-h-11 items-center justify-between gap-3">
              <Label htmlFor={`welcome-autodelete-${group.id}`} className="text-xs">
                Auto-delete the welcome
              </Label>
              <Switch
                id={`welcome-autodelete-${group.id}`}
                checked={autoDelete}
                disabled={!canManage}
                onCheckedChange={(v) => {
                  setAutoDelete(v === true);
                  touch();
                }}
              />
            </div>

            {autoDelete ? (
              <div className="space-y-1.5">
                <Label htmlFor={`welcome-seconds-${group.id}`} className="text-xs">
                  Delete after (seconds)
                </Label>
                <Input
                  id={`welcome-seconds-${group.id}`}
                  type="number"
                  inputMode="numeric"
                  min={WELCOME_AUTO_DELETE_MIN}
                  max={WELCOME_AUTO_DELETE_MAX}
                  step={1}
                  value={String(seconds)}
                  disabled={!canManage}
                  className="min-h-11 max-w-32"
                  onChange={(e) => {
                    setSeconds(Number.parseInt(e.target.value, 10));
                    touch();
                  }}
                />
                {invalidSeconds ? (
                  <p className="text-[11px] text-signal">
                    Choose between {WELCOME_AUTO_DELETE_MIN} and {WELCOME_AUTO_DELETE_MAX} seconds.
                  </p>
                ) : null}
              </div>
            ) : null}


            <div className="space-y-3 rounded-md border border-gold/40 bg-gold/5 p-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold">
                  Launch Watch CTA
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  Optional. Adds a public button to this welcome that opens the private
                  @PepeCartelHQBot Launch Watch opt-in. Mute and stop-watching controls stay in the
                  private DM and never appear in the group. This is only a route to opt-in launch
                  notifications — it is not a safety, audit or approval signal.
                </p>
              </div>

              <div className="flex min-h-11 items-center justify-between gap-3">
                <Label htmlFor={`welcome-cta-${group.id}`} className="text-xs">
                  Include Launch Watch button
                </Label>
                <Switch
                  id={`welcome-cta-${group.id}`}
                  checked={ctaEnabled}
                  disabled={!canManage || noEligibleLaunches}
                  onCheckedChange={(v) => {
                    setCtaEnabled(v === true);
                    touch();
                  }}
                />
              </div>

              {noEligibleLaunches ? (
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  No eligible launches. A launch can be used here only once its Project Profile is
                  Published and its watchlist is open (Watchlist Open, Launch Approaching, Contract
                  Pending or Official Contract Registered).
                </p>
              ) : ctaEnabled ? (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Launch</Label>
                    <Select
                      value={ctaLaunchId ?? ""}
                      disabled={!canManage}
                      onValueChange={(v) => {
                        setCtaLaunchId(v || null);
                        touch();
                      }}
                    >
                      <SelectTrigger className="min-h-11 text-xs">
                        <SelectValue placeholder="Select an eligible launch" />
                      </SelectTrigger>
                      <SelectContent>
                        {eligibleLaunches.map((o) => (
                          <SelectItem key={o.launchId} value={o.launchId} className="text-xs">
                            {`${o.projectName} — ${o.tokenName} ($${o.ticker}) · ${o.chain} · ${o.status}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {ctaSelectionInvalid ? (
                      <p className="text-[11px] leading-relaxed text-signal">
                        The saved launch is no longer eligible for this community. Select an
                        eligible launch or turn the CTA off before saving.
                      </p>
                    ) : null}
                  </div>

                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    “🔔 Watch this launch” is always included while the CTA is on. Optional official
                    link buttons appear only when the Project Profile has a valid link saved.
                  </p>

                  <div className="flex min-h-11 items-center justify-between gap-3">
                    <Label htmlFor={`welcome-cta-web-${group.id}`} className="text-xs">
                      Website button
                    </Label>
                    <Switch
                      id={`welcome-cta-web-${group.id}`}
                      checked={ctaShowWebsite}
                      disabled={!canManage}
                      onCheckedChange={(v) => {
                        setCtaShowWebsite(v === true);
                        touch();
                      }}
                    />
                  </div>
                  <div className="flex min-h-11 items-center justify-between gap-3">
                    <Label htmlFor={`welcome-cta-tg-${group.id}`} className="text-xs">
                      Official Telegram button
                    </Label>
                    <Switch
                      id={`welcome-cta-tg-${group.id}`}
                      checked={ctaShowTelegram}
                      disabled={!canManage}
                      onCheckedChange={(v) => {
                        setCtaShowTelegram(v === true);
                        touch();
                      }}
                    />
                  </div>
                  <div className="flex min-h-11 items-center justify-between gap-3">
                    <Label htmlFor={`welcome-cta-x-${group.id}`} className="text-xs">
                      X button
                    </Label>
                    <Switch
                      id={`welcome-cta-x-${group.id}`}
                      checked={ctaShowX}
                      disabled={!canManage}
                      onCheckedChange={(v) => {
                        setCtaShowX(v === true);
                        touch();
                      }}
                    />
                  </div>

                  {autoDelete ? (
                    <p className="text-[11px] leading-relaxed text-gold">
                      Auto-delete is on. The Launch Watch buttons disappear with the welcome message
                      after {seconds}s.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="rounded-md border border-border/60 bg-background/40 p-3">

              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Preview
              </p>
              <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">
                {preview}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                className="min-h-11"
                disabled={!canManage || saving || invalidMessage || invalidSeconds}
                onClick={() => void handleSave()}
              >
                {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                Save
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={!canManage || testing || dirty || saving}
                onClick={() => void handleTest()}
              >
                {testing ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="size-4" aria-hidden="true" />
                )}
                Send test welcome
              </Button>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {dirty
                ? "Save your changes before sending a test. The test uses the saved settings."
                : savedEnabled
                  ? "Real joins will receive this message."
                  : "Real join welcomes are OFF, so new members get nothing. A test still posts the saved message as a preview so you can check it."}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
