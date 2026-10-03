import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Sparkles } from "lucide-react";
import {
  miniAppReadMissionSetup,
  miniAppCloseCommunityLaunch,
  miniAppSaveMissionSetup,
  miniAppStartMissionSetup,
} from "@/lib/telegram-miniapp-bridge.functions";
import { closeTelegramMiniApp, miniAppFailureMessage, newRequestId, parseOptionalPositiveInt } from "@/lib/telegram-miniapp-client";
import { MiniAppActionButton, MiniAppFieldRow, MiniAppMessage, MiniAppNotice, MiniAppPanel, MiniAppRetryButton, MiniAppSkeleton } from "./MiniAppPieces";

type Draft = { likes: string; replies: string; reposts: string; bookmarks: string };
const EMPTY: Draft = { likes: "", replies: "", reposts: "", bookmarks: "" };

function values(draft: Draft) {
  const parsed = Object.fromEntries(Object.entries(draft).map(([key, raw]) => [key, parseOptionalPositiveInt(raw)]));
  if (Object.values(parsed).some((result) => !result.ok)) return null;
  const out = Object.fromEntries(
    Object.entries(parsed)
      .map(([key, result]) => [key, result.ok ? result.value : null] as const)
      .filter((entry) => entry[1] !== null),
  );
  return Object.keys(out).length > 0 ? out : null;
}

export function MiniAppMissionSetup({ initData }: { initData: string }) {
  const read = useServerFn(miniAppReadMissionSetup);
  const save = useServerFn(miniAppSaveMissionSetup);
  const start = useServerFn(miniAppStartMissionSetup);
  const close = useServerFn(miniAppCloseCommunityLaunch);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [notice, setNotice] = useState<{ tone: "success" | "warning" | "error"; message: string } | null>(null);
  const query = useQuery({ queryKey: ["tg", "mission-setup"], retry: false, queryFn: () => read({ data: { initData } }) });
  const setup = query.data?.ok ? query.data.setup : null;
  useEffect(() => {
    if (!setup) return;
    setDraft(Object.fromEntries(Object.entries(setup.targets).map(([key, value]) => [key, value == null ? "" : String(value)])) as Draft);
  }, [setup]);
  const saveMutation = useMutation({
    mutationFn: async () => {
      const targets = values(draft); const requestId = newRequestId();
      if (!targets || !requestId) throw new Error("Choose at least one positive whole-number target.");
      const result = await save({ data: { initData, requestId, ...targets } });
      if (!result.ok) throw new Error(miniAppFailureMessage(result.reason));
      return result;
    },
    onSuccess: () => setNotice({ tone: "success", message: "Draft targets saved. No mission has started." }),
    onError: (error) => setNotice({ tone: "error", message: String(error instanceof Error ? error.message : "Draft could not be saved.").slice(0, 180) }),
  });
  const startMutation = useMutation({
    mutationFn: async () => {
      const targets = values(draft); const requestId = newRequestId();
      if (!targets || !requestId) throw new Error("Choose at least one positive whole-number target.");
      const result = await start({ data: { initData, requestId, ...targets } });
      if (!result.ok) throw new Error(miniAppFailureMessage(result.reason));
      return result;
    },
    onSuccess: () => setNotice({ tone: "success", message: "Mission started with the reviewed targets." }),
    onError: (error) => setNotice({ tone: "error", message: String(error instanceof Error ? error.message : "Mission could not be started.").slice(0, 180) }),
  });
  const closeMutation = useMutation({
    mutationFn: async () => {
      if (!setup?.cleanupAvailable) return { ok: true as const, cleanup: "unavailable" as const };
      return close({ data: { initData } });
    },
    onSuccess: (result) => {
      if (result.ok && (result.cleanup === "queued" || !setup?.cleanupAvailable)) closeTelegramMiniApp();
      else setNotice({ tone: "error", message: "Cleanup could not be confirmed. You can retry or close normally. A fresh /missioncontrol post supports cleanup." });
    },
    onError: () => setNotice({ tone: "error", message: "Cleanup could not be confirmed. You can retry or close normally. A fresh /missioncontrol post supports cleanup." }),
  });
  if (query.isPending) return <MiniAppSkeleton label="Opening mission setup…" />;
  if (!setup) return <MiniAppMessage title="Mission setup unavailable" description={miniAppFailureMessage(query.data && !query.data.ok ? query.data.reason : "mission_setup_unavailable")} action={<MiniAppRetryButton onRetry={() => void query.refetch()} pending={query.isFetching} />} />;
  const busy = saveMutation.isPending || startMutation.isPending;
  return <>
    <MiniAppPanel heading={`Set up mission · ${setup.communityTitle}`} note={`Official post by @${setup.authorHandle}`}>
      <a href={setup.canonicalUrl} target="_blank" rel="noreferrer" className="block truncate text-xs text-gold underline">View official X post</a>
      <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-1">
        {([['likes','Likes'],['replies','Comments / replies'],['reposts','Shares / reposts'],['bookmarks','Favorites / bookmarks']] as const).map(([key,label]) => <MiniAppFieldRow key={key} label={label} value={draft[key]} disabled={busy} placeholder="Off" onValueChange={(value) => setDraft((current) => ({ ...current, [key]: value }))} hint={key === 'bookmarks' ? 'Aspirational target; tracking stays unavailable unless X supplies this metric.' : undefined} />)}
      </div>
    </MiniAppPanel>
    <MiniAppPanel heading="Auto-select suggestion">
      <div className="flex items-start gap-3"><Sparkles className="mt-0.5 size-4 shrink-0 text-gold" /><p className="text-xs leading-5 text-muted-foreground">{setup.suggestion.basis}</p></div>
    </MiniAppPanel>
    {notice ? <MiniAppNotice tone={notice.tone} message={notice.message} /> : null}
    <div className="grid grid-cols-2 gap-2">
      <MiniAppActionButton label="Save draft" tone="quiet" pending={saveMutation.isPending} disabled={busy} onPress={() => { setNotice(null); saveMutation.mutate(); }} />
      <MiniAppActionButton label="Start Mission" pendingLabel="Starting…" pending={startMutation.isPending} disabled={busy} onPress={() => { setNotice(null); startMutation.mutate(); }} />
    </div>
    <MiniAppActionButton label={setup.cleanupAvailable ? "Close & clear post" : "Close Mission Control"} tone="quiet" pending={closeMutation.isPending} onPress={() => closeMutation.mutate()} />
    <p className="flex items-start gap-2 text-[11px] leading-4 text-muted-foreground"><Check className="mt-0.5 size-3.5 shrink-0 text-pepe" />No mission, schedule, metrics launch, or quota use occurs until Start Mission.</p>
  </>;
}