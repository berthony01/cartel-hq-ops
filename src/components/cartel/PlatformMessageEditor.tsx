import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, MessageSquare, RotateCcw, Save, Send } from "lucide-react";

import {
  fetchPlatformMessageTemplates,
  formatTimestamp,
  platformErrorMessage,
  publishPlatformMessage,
  restorePlatformMessageDefault,
  savePlatformMessageDraft,
  type PlatformMessageTemplate,
  type PlatformMessageTemplateKey,
} from "@/lib/platform";
import { Section } from "@/components/cartel/Section";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Owner-only editor for the three platform Telegram system messages.
 * Every read and write goes through the server-verified `platform-admin`
 * Edge Function. Community owners have no access to these templates.
 */

const BODY_MAX = 3500;
const SAMPLE_TITLE = "Pepe Cartel Lounge";

const TABS: Array<{ key: PlatformMessageTemplateKey; label: string; hint: string }> = [
  {
    key: "bot_installed",
    label: "Bot Installed",
    hint: "Sent when the bot is added to a group by someone with no linked Cartel HQ account.",
  },
  {
    key: "account_found",
    label: "Account Found",
    hint: "Sent when the installer already has a linked Cartel HQ account.",
  },
  {
    key: "community_connected",
    label: "Cartel HQ Connected",
    hint: "Sent after a community is verified and connected to a workspace.",
  },
];

/** Plain-text preview. HTML is never injected into the DOM. */
function previewText(body: string): string {
  return body
    .split("{group_title}")
    .join(SAMPLE_TITLE)
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function PlatformMessageEditor() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<PlatformMessageTemplate[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const applyTemplates = (rows: PlatformMessageTemplate[]) => {
    setTemplates(rows);
    setDrafts(Object.fromEntries(rows.map((row) => [row.key, row.draft_body])));
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchPlatformMessageTemplates();
        if (cancelled) return;
        applyTemplates(rows);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(platformErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const byKey = useMemo(
    () => new Map(templates.map((row) => [row.key, row] as const)),
    [templates],
  );

  const run = async (
    key: PlatformMessageTemplateKey,
    label: string,
    action: () => Promise<PlatformMessageTemplate[]>,
  ) => {
    setBusy(`${key}:${label}`);
    try {
      applyTemplates(await action());
      setError(null);
      toast.success(label);
    } catch (err) {
      toast.error(platformErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section
      leading={<MessageSquare className="size-4" aria-hidden="true" />}
      title="Telegram System Messages"
      description="Platform-controlled first-install and connection messages. Community owners cannot edit these."
      actions={
        <StatusBadge tone="muted">
          <span>Owner only</span>
        </StatusBadge>
      }
    >
      {loading ? (
        <span className="flex items-center gap-2 text-xs text-muted-foreground sm:text-sm">
          <Loader2 className="size-4 animate-spin text-gold" aria-hidden="true" />
          Loading messages…
        </span>
      ) : error ? (
        <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm">{error}</p>
      ) : (
        <Tabs defaultValue={TABS[0]!.key} className="flex min-w-0 flex-col gap-3">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
            {TABS.map((tab) => (
              <TabsTrigger key={tab.key} value={tab.key} className="text-xs sm:text-sm">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {TABS.map((tab) => {
            const row = byKey.get(tab.key);
            const draft = drafts[tab.key] ?? "";
            const published = row?.published_body ?? null;
            const dirty = !!row && draft !== row.draft_body;
            const pending =
              !!row && (dirty || (published ?? "") !== (row.draft_body ?? ""));
            const state = published
              ? pending
                ? { tone: "gold" as const, label: "Draft changes pending" }
                : { tone: "green" as const, label: "Published" }
              : { tone: "muted" as const, label: "Using built-in default" };
            const isBusy = (label: string) => busy === `${tab.key}:${label}`;
            const anyBusy = busy?.startsWith(`${tab.key}:`) ?? false;

            return (
              <TabsContent key={tab.key} value={tab.key} className="mt-0 flex min-w-0 flex-col gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <StatusBadge tone={state.tone}>
                    <span>{state.label}</span>
                  </StatusBadge>
                  <span className="text-[11px] text-muted-foreground sm:text-xs">
                    Draft saved {formatTimestamp(row?.draft_updated_at)} · Published{" "}
                    {formatTimestamp(row?.published_at)}
                  </span>
                </div>

                <p className="text-[11px] leading-relaxed text-muted-foreground sm:text-xs">
                  {tab.hint} Use <code>{"{group_title}"}</code> where the community name should
                  appear. Telegram HTML formatting is supported.
                </p>

                <Textarea
                  value={draft}
                  onChange={(event) =>
                    setDrafts((prev) => ({ ...prev, [tab.key]: event.target.value.slice(0, BODY_MAX) }))
                  }
                  rows={12}
                  className="min-h-[220px] font-mono text-xs leading-relaxed"
                  aria-label={`${tab.label} message`}
                />
                <span className="text-[11px] text-muted-foreground">
                  {draft.length} / {BODY_MAX} characters
                </span>

                <div className="min-w-0 rounded-md border border-border/60 bg-muted/20 p-3">
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Preview · {SAMPLE_TITLE}
                  </p>
                  <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/90">
                    {previewText(draft)}
                  </p>
                </div>

                <div className="flex min-w-0 flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={anyBusy}
                    onClick={() =>
                      run(tab.key, "Default restored to draft", () =>
                        restorePlatformMessageDefault(tab.key),
                      )
                    }
                  >
                    {isBusy("Default restored to draft") ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <RotateCcw className="size-4" aria-hidden="true" />
                    )}
                    Restore Default
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={anyBusy || !draft.trim()}
                    onClick={() =>
                      run(tab.key, "Draft saved", () => savePlatformMessageDraft(tab.key, draft))
                    }
                  >
                    {isBusy("Draft saved") ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Save className="size-4" aria-hidden="true" />
                    )}
                    Save Draft
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={anyBusy || !draft.trim()}
                    onClick={() => {
                      const ok = window.confirm(
                        `Publish the ${tab.label} message? This changes what future Telegram communities receive.`,
                      );
                      if (!ok) return;
                      void run(tab.key, "Message published", () =>
                        publishPlatformMessage(tab.key, draft),
                      );
                    }}
                  >
                    {isBusy("Message published") ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Send className="size-4" aria-hidden="true" />
                    )}
                    Publish
                  </Button>
                </div>
              </TabsContent>
            );
          })}
        </Tabs>
      )}
    </Section>
  );
}

export default PlatformMessageEditor;
