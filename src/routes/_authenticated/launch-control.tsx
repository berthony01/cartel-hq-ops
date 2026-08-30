import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, IdCard, Loader2, Plus, Rocket, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/workspace-context";
import { getProjectProfile } from "@/lib/project-profile";
import {
  CHAIN_MAX,
  CONTRACT_MAX,
  LAUNCH_STATUSES,
  LAUNCH_STATUS_HELP,
  LAUNCH_STATUS_LABELS,
  NOTES_MAX,
  SLUG_MAX,
  SLUG_RULE_HINT,
  TICKER_MAX,
  TOKEN_NAME_MAX,
  canDeleteLaunch,
  createLaunch,
  deleteDraftLaunch,
  deviceTimezone,
  formatTimestamp,
  getLaunchAccess,
  hasSchedule,
  identityLocked,
  isValidLaunchSlug,
  isoToLocalInput,
  launchStatusIndex,
  listLaunches,
  localInputToIso,
  nextLaunchStatus,
  nullableText,
  scheduleLocked,
  setLaunchContractAddress,
  slugifyLaunch,
  toLaunchStatus,
  transitionLaunchStatus,
  updateLaunchDetails,
  type LaunchRow,
  type LaunchStatus,
} from "@/lib/launch-control";

import { PageHeader } from "@/components/cartel/PageHeader";
import { Section } from "@/components/cartel/Section";
import { EmptyState } from "@/components/cartel/EmptyState";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { StickyActionBar } from "@/components/cartel/StickyActionBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

export const Route = createFileRoute("/_authenticated/launch-control")({
  head: () => ({
    meta: [
      { title: "Launch Control — CARTEL HQ" },
      {
        name: "description",
        content:
          "Operator control center for the authenticated project's token launch lifecycle, schedule and official contract registration.",
      },
      { property: "og:title", content: "Launch Control — CARTEL HQ" },
      {
        property: "og:description",
        content:
          "Manage launch records, lifecycle status and official contract registration inside CARTEL HQ.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LaunchControlPage,
});

type ScheduleMode = "none" | "exact" | "window";

type EditorForm = {
  token_name: string;
  ticker: string;
  chain: string;
  public_slug: string;
  schedule_mode: ScheduleMode;
  launch_at: string;
  window_start: string;
  window_end: string;
  internal_notes: string;
};

const STATUS_TONE: Record<LaunchStatus, "gold" | "green" | "muted"> = {
  DRAFT: "muted",
  ANNOUNCED: "gold",
  WATCHLIST_OPEN: "gold",
  LAUNCH_APPROACHING: "gold",
  CONTRACT_PENDING: "gold",
  OFFICIAL_CONTRACT_REGISTERED: "green",
  LIVE: "green",
  COMPLETED: "muted",
};

function formFromRow(row: LaunchRow): EditorForm {
  const mode: ScheduleMode = row.launch_at
    ? "exact"
    : row.launch_window_start || row.launch_window_end
      ? "window"
      : "none";
  return {
    token_name: row.token_name,
    ticker: row.ticker,
    chain: row.chain,
    public_slug: row.public_slug,
    schedule_mode: mode,
    launch_at: isoToLocalInput(row.launch_at),
    window_start: isoToLocalInput(row.launch_window_start),
    window_end: isoToLocalInput(row.launch_window_end),
    internal_notes: row.internal_notes ?? "",
  };
}

function LaunchControlPage() {
  const { workspaceId, workspace, loading: workspaceLoading } = useWorkspace();
  const queryClient = useQueryClient();
  const tz = useMemo(() => deviceTimezone(), []);

  const profileQuery = useQuery({
    queryKey: ["project-profile", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => getProjectProfile(workspaceId!),
  });
  const profile = profileQuery.data ?? null;

  const launchesQuery = useQuery({
    queryKey: ["launches", workspaceId],
    enabled: !!workspaceId && !!profile,
    queryFn: () => listLaunches(workspaceId!),
  });
  const launches = useMemo(() => launchesQuery.data ?? [], [launchesQuery.data]);

  // Local permission hint only. RLS and the RPCs remain authoritative.
  const accessQuery = useQuery({
    queryKey: ["launch-access", workspaceId, workspace?.owner_id ?? null],
    enabled: !!workspaceId,
    queryFn: () => getLaunchAccess(workspaceId!, workspace?.owner_id ?? null),
  });
  const canManage = accessQuery.data?.canManage ?? false;
  const readOnly = !canManage;



  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = launches.find((l) => l.id === selectedId) ?? null;

  useEffect(() => {
    if (launches.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!launches.some((l) => l.id === selectedId)) setSelectedId(launches[0]!.id);
  }, [launches, selectedId]);

  const [form, setForm] = useState<EditorForm | null>(null);
  useEffect(() => {
    setForm(selected ? formFromRow(selected) : null);
  }, [selected]);

  const set = (patch: Partial<EditorForm>) =>
    setForm((f) => (f ? { ...f, ...patch } : f));

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["launches", workspaceId] });

  // ---- create -------------------------------------------------------------
  const [creating, setCreating] = useState(false);
  const [newLaunch, setNewLaunch] = useState({
    token_name: "",
    ticker: "",
    chain: "",
    public_slug: "",
  });

  const startCreate = () => {
    if (!profile) return;
    setNewLaunch({
      token_name: profile.project_name,
      ticker: profile.ticker ?? "",
      chain: profile.primary_chain ?? "",
      public_slug: slugifyLaunch(`${profile.public_slug}-launch`),
    });
    setCreating(true);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!workspaceId || !profile) throw new Error("No active project profile.");
      return createLaunch({
        workspaceId,
        projectProfileId: profile.id,
        token_name: newLaunch.token_name,
        ticker: newLaunch.ticker,
        chain: newLaunch.chain,
        public_slug: newLaunch.public_slug,
        timezone: tz,
      });
    },
    onSuccess: (row) => {
      toast.success("Draft launch created");
      setCreating(false);
      setSelectedId(row.id);
      void invalidate();
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Could not create the launch."),
  });

  const newSlugValid = isValidLaunchSlug(newLaunch.public_slug.trim().toLowerCase());
  const canCreate =
    newLaunch.token_name.trim().length > 0 &&
    newLaunch.ticker.trim().length > 0 &&
    newLaunch.chain.trim().length > 0 &&
    newSlugValid;

  // ---- save details -------------------------------------------------------
  const status: LaunchStatus = selected ? toLaunchStatus(selected.status) : "DRAFT";
  const idLocked = identityLocked(status);
  const schedLocked = scheduleLocked(status);

  // UX guards only. The database remains the authoritative validator.
  const identityError =
    !form || idLocked
      ? null
      : !form.token_name.trim()
        ? "Token name is required."
        : !form.ticker.trim()
          ? "Ticker is required."
          : !form.chain.trim()
            ? "Chain is required."
            : !isValidLaunchSlug(form.public_slug.trim().toLowerCase())
              ? `Public launch slug must be ${SLUG_RULE_HINT.toLowerCase()}`
              : null;

  const scheduleError = (() => {
    if (!form || schedLocked) return null;
    if (form.schedule_mode === "exact") {
      return localInputToIso(form.launch_at)
        ? null
        : "Set a valid launch date and time, or switch the schedule mode to Not set.";
    }
    if (form.schedule_mode === "window") {
      const start = localInputToIso(form.window_start);
      const end = localInputToIso(form.window_end);
      if (!start || !end) return "A launch window needs both a valid start and end.";
      if (new Date(end).getTime() < new Date(start).getTime())
        return "Window end must be the same as or after the window start.";
      return null;
    }
    return null;
  })();

  const notesError =
    form && form.internal_notes.length > NOTES_MAX
      ? `Internal notes are limited to ${NOTES_MAX} characters.`
      : null;

  const saveError = identityError ?? scheduleError ?? notesError;
  const canSave = !!form && !saveError && canManage;


  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selected || !form) throw new Error("No launch selected.");
      const payload: Parameters<typeof updateLaunchDetails>[1] = {
        internal_notes: nullableText(form.internal_notes),
      };
      if (!idLocked) {
        payload.token_name = form.token_name.trim();
        payload.ticker = form.ticker.trim();
        payload.chain = form.chain.trim();
        payload.public_slug = form.public_slug.trim().toLowerCase();
      }
      if (!schedLocked) {
        payload.timezone = tz;
        if (form.schedule_mode === "exact") {
          payload.launch_at = localInputToIso(form.launch_at);
          payload.launch_window_start = null;
          payload.launch_window_end = null;
        } else if (form.schedule_mode === "window") {
          payload.launch_at = null;
          payload.launch_window_start = localInputToIso(form.window_start);
          payload.launch_window_end = localInputToIso(form.window_end);
        } else {
          payload.launch_at = null;
          payload.launch_window_start = null;
          payload.launch_window_end = null;
        }
      }
      return updateLaunchDetails(selected.id, payload);
    },
    onSuccess: () => {
      toast.success("Launch details saved");
      void invalidate();
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Could not save launch details."),
  });

  const transitionMutation = useMutation({
    mutationFn: async (target: LaunchStatus) => {
      if (!selected) throw new Error("No launch selected.");
      return transitionLaunchStatus(selected.id, target);
    },
    onSuccess: (row) => {
      toast.success(`Status is now ${LAUNCH_STATUS_LABELS[toLaunchStatus(row.status)]}`);
      void invalidate();
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Status transition was rejected."),
  });

  const [contractInput, setContractInput] = useState("");
  useEffect(() => {
    setContractInput(selected?.official_contract_address ?? "");
  }, [selected?.id, selected?.official_contract_address]);

  const contractMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No launch selected.");
      return setLaunchContractAddress(selected.id, contractInput);
    },
    onSuccess: () => {
      toast.success("Official contract address saved");
      void invalidate();
    },
    onError: (err: unknown) =>
      toast.error(
        err instanceof Error ? err.message : "Could not save the official contract address.",
      ),
  });

  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No launch selected.");
      return deleteDraftLaunch(selected.id);
    },
    onSuccess: () => {
      toast.success("Draft launch deleted");
      setConfirmDelete(false);
      setSelectedId(null);
      void invalidate();
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Could not delete the draft launch."),
  });

  const next = nextLaunchStatus(status);
  const scheduleReady = selected ? hasSchedule(selected) : false;
  const contractSaved = Boolean(selected?.official_contract_address);
  const blockedReason =
    next === "LAUNCH_APPROACHING" && !scheduleReady
      ? "Set an exact launch time or a complete launch window before advancing."
      : next === "OFFICIAL_CONTRACT_REGISTERED" && !contractSaved
        ? "Save the official contract address before advancing."
        : null;

  const saveButton =
    selected && canManage ? (
      <Button
        type="submit"
        form="launch-editor-form"
        className="min-h-11"
        disabled={saveMutation.isPending || !canSave}
      >
        {saveMutation.isPending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Save className="size-4" aria-hidden="true" />
        )}
        Save launch details
      </Button>
    ) : null;


  return (
    <div className="space-y-6 pb-24 sm:space-y-8 lg:pb-0">
      <PageHeader
        eyebrow="Launch Operations"
        title="Launch Control"
        description="Manage the authenticated project's launch lifecycle: launch records, schedule, status progression and official contract registration. Public Cartel Network discovery and Telegram delivery arrive in later phases."
        status={workspace ? workspace.name : "No workspace"}
      />

      {workspaceLoading ? (
        <Section variant="surface">
          <p className="text-sm text-muted-foreground">Loading workspace…</p>
        </Section>
      ) : !workspaceId ? (
        <EmptyState
          icon={Rocket}
          title="No workspace yet"
          description="Create a workspace from the switcher in the header before setting up launches."
        />
      ) : profileQuery.isLoading ? (
        <Section variant="surface">
          <p className="text-sm text-muted-foreground">Loading project profile…</p>
        </Section>
      ) : profileQuery.isError ? (
        <Section variant="surface" title="Could not load project profile">
          <p className="text-sm text-muted-foreground">
            {(profileQuery.error as Error)?.message ?? "Unexpected error."}
          </p>
          <Button
            variant="outline"
            className="mt-3 min-h-11"
            onClick={() => void profileQuery.refetch()}
          >
            Retry
          </Button>
        </Section>
      ) : !profile ? (
        <EmptyState
          icon={IdCard}
          title="Project Profile required"
          description="Launch Control operates on the workspace project identity record. Create the Project Profile first, then return here to add a launch."
          action={
            <Button asChild className="min-h-11">
              <Link to="/project-profile">Go to Project Profile</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid min-w-0 gap-4 sm:gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-4 sm:space-y-6">
            {readOnly && !accessQuery.isLoading ? (
              <Section variant="surface">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <StatusBadge tone="muted">
                    <span>Read only</span>
                  </StatusBadge>
                  <p className="min-w-0 text-xs leading-relaxed text-muted-foreground">
                    You can view launches for this workspace. Creating, editing, advancing or
                    deleting a launch requires the workspace owner or admin role.
                  </p>
                </div>
              </Section>
            ) : null}

            <Section
              variant="surface"
              title="Launches"
              description={`Launch records for ${profile.project_name}. One project profile can hold multiple launches.`}
              actions={
                canManage ? (
                  <Button size="sm" className="min-h-11" onClick={startCreate}>
                    <Plus className="size-4" aria-hidden="true" />
                    New launch
                  </Button>
                ) : null
              }

            >
              {launchesQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading launches…</p>
              ) : launchesQuery.isError ? (
                <div>
                  <p className="text-sm text-muted-foreground">
                    {(launchesQuery.error as Error)?.message ?? "Could not load launches."}
                  </p>
                  <Button
                    variant="outline"
                    className="mt-3 min-h-11"
                    onClick={() => void launchesQuery.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              ) : launches.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No launches yet. Create a draft launch to begin the lifecycle.
                </p>
              ) : (
                <ul className="space-y-2">
                  {launches.map((launch) => {
                    const s = toLaunchStatus(launch.status);
                    const active = launch.id === selectedId;
                    return (
                      <li key={launch.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(launch.id)}
                          className={`flex w-full min-w-0 items-center justify-between gap-3 rounded-lg border px-3 py-3 text-left transition-colors ${
                            active
                              ? "border-gold/50 bg-gold/5"
                              : "border-border bg-background/40 hover:bg-surface-raised/60"
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-foreground">
                              {launch.token_name}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {launch.ticker} · {launch.chain} · /{launch.public_slug}
                            </span>
                          </span>
                          <StatusBadge tone={STATUS_TONE[s]}>
                            <span>{LAUNCH_STATUS_LABELS[s]}</span>
                          </StatusBadge>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>

            {creating && canManage ? (
              <Section
                variant="surface"
                title="New launch"
                description="Prefilled from the Project Profile. Nothing is saved until you press Create. The Project Profile is not modified."
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="min-w-0">
                    <Label htmlFor="new-token-name">Token name</Label>
                    <Input
                      id="new-token-name"
                      maxLength={TOKEN_NAME_MAX}
                      value={newLaunch.token_name}
                      onChange={(e) =>
                        setNewLaunch((n) => ({ ...n, token_name: e.target.value }))
                      }
                    />
                  </div>
                  <div className="min-w-0">
                    <Label htmlFor="new-ticker">Ticker</Label>
                    <Input
                      id="new-ticker"
                      maxLength={TICKER_MAX}
                      value={newLaunch.ticker}
                      onChange={(e) => setNewLaunch((n) => ({ ...n, ticker: e.target.value }))}
                    />
                  </div>
                  <div className="min-w-0">
                    <Label htmlFor="new-chain">Chain</Label>
                    <Input
                      id="new-chain"
                      maxLength={CHAIN_MAX}
                      value={newLaunch.chain}
                      onChange={(e) => setNewLaunch((n) => ({ ...n, chain: e.target.value }))}
                    />
                  </div>
                  <div className="min-w-0">
                    <Label htmlFor="new-slug">Public launch slug</Label>
                    <Input
                      id="new-slug"
                      maxLength={SLUG_MAX}
                      value={newLaunch.public_slug}
                      onChange={(e) =>
                        setNewLaunch((n) => ({ ...n, public_slug: e.target.value }))
                      }
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {newSlugValid
                        ? "Reserved for a future public launch path. No public page exists yet."
                        : SLUG_RULE_HINT}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Timezone recorded from this device: {tz}. New launches always start in Draft.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    className="min-h-11"
                    disabled={!canCreate || !canManage || createMutation.isPending}
                    onClick={() => createMutation.mutate()}
                  >
                    {createMutation.isPending ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Plus className="size-4" aria-hidden="true" />
                    )}
                    Create draft launch
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    onClick={() => setCreating(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </Section>
            ) : null}

            {selected && form ? (
              <form
                id="launch-editor-form"
                className="min-w-0 space-y-4 sm:space-y-6"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!canSave) return;
                  saveMutation.mutate();
                }}

              >
                <Section
                  variant="surface"
                  title="Launch identity"
                  description={
                    idLocked
                      ? "Identity fields are locked once the launch is announced."
                      : "Identity fields can only be edited while the launch is a draft."
                  }
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="min-w-0">
                      <Label htmlFor="token-name">Token name</Label>
                      <Input
                        id="token-name"
                        maxLength={TOKEN_NAME_MAX}
                        disabled={idLocked || readOnly}
                        value={form.token_name}
                        onChange={(e) => set({ token_name: e.target.value })}
                      />
                    </div>
                    <div className="min-w-0">
                      <Label htmlFor="ticker">Ticker</Label>
                      <Input
                        id="ticker"
                        maxLength={TICKER_MAX}
                        disabled={idLocked || readOnly}
                        value={form.ticker}
                        onChange={(e) => set({ ticker: e.target.value })}
                      />
                    </div>
                    <div className="min-w-0">
                      <Label htmlFor="chain">Chain</Label>
                      <Input
                        id="chain"
                        maxLength={CHAIN_MAX}
                        disabled={idLocked || readOnly}
                        value={form.chain}
                        onChange={(e) => set({ chain: e.target.value })}
                      />
                    </div>
                    <div className="min-w-0">
                      <Label htmlFor="slug">Public launch slug</Label>
                      <Input
                        id="slug"
                        maxLength={SLUG_MAX}
                        disabled={idLocked || readOnly}
                        value={form.public_slug}
                        onChange={(e) => set({ public_slug: e.target.value })}
                      />
                      <p className="mt-1 text-xs text-muted-foreground">{SLUG_RULE_HINT}</p>
                    </div>
                  </div>
                  {identityError ? (
                    <p className="mt-3 text-xs text-destructive">{identityError}</p>
                  ) : null}
                </Section>


                <Section
                  variant="surface"
                  title="Schedule"
                  description={
                    schedLocked
                      ? "Schedule fields are locked once the launch is live."
                      : `Times are entered and displayed in this device's timezone (${tz}) and stored as absolute timestamps. There is no arbitrary timezone conversion in this phase.`
                  }
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="min-w-0">
                      <Label htmlFor="schedule-mode">Schedule mode</Label>
                      <Select
                        value={form.schedule_mode}
                        disabled={schedLocked || readOnly}
                        onValueChange={(v) => set({ schedule_mode: v as ScheduleMode })}
                      >
                        <SelectTrigger id="schedule-mode" className="min-h-11">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Not set</SelectItem>
                          <SelectItem value="exact">Exact time</SelectItem>
                          <SelectItem value="window">Launch window</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {form.schedule_mode === "exact" ? (
                      <div className="min-w-0">
                        <Label htmlFor="launch-at">Launch time</Label>
                        <Input
                          id="launch-at"
                          type="datetime-local"
                          disabled={schedLocked || readOnly}
                          value={form.launch_at}
                          onChange={(e) => set({ launch_at: e.target.value })}
                        />
                      </div>
                    ) : null}
                    {form.schedule_mode === "window" ? (
                      <>
                        <div className="min-w-0">
                          <Label htmlFor="window-start">Window start</Label>
                          <Input
                            id="window-start"
                            type="datetime-local"
                            disabled={schedLocked || readOnly}
                            value={form.window_start}
                            onChange={(e) => set({ window_start: e.target.value })}
                          />
                        </div>
                        <div className="min-w-0">
                          <Label htmlFor="window-end">Window end</Label>
                          <Input
                            id="window-end"
                            type="datetime-local"
                            disabled={schedLocked || readOnly}
                            value={form.window_end}
                            onChange={(e) => set({ window_end: e.target.value })}
                          />
                        </div>
                      </>
                    ) : null}
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Recorded timezone on this launch: {selected.timezone}
                  </p>
                  {scheduleError ? (
                    <p className="mt-2 text-xs text-destructive">{scheduleError}</p>
                  ) : null}
                </Section>

                <Section
                  variant="surface"
                  title="Internal notes"
                  description="Operator-only. Never shown outside this workspace."
                >
                  <Textarea
                    id="internal-notes"
                    rows={4}
                    maxLength={NOTES_MAX}
                    disabled={readOnly}
                    value={form.internal_notes}
                    onChange={(e) => set({ internal_notes: e.target.value })}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {form.internal_notes.length} / {NOTES_MAX} characters.
                  </p>
                  {notesError ? <p className="mt-1 text-xs text-destructive">{notesError}</p> : null}
                </Section>


                <div className="hidden lg:flex lg:justify-end">{saveButton}</div>
              </form>
            ) : null}

            {selected && canDeleteLaunch(status) ? (
              <Section
                variant="surface"
                title="Delete draft"
                description="Only draft launches can be deleted. Once announced, a launch record is permanent."
              >
                <Button
                  variant="destructive"
                  className="min-h-11"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  Delete draft launch
                </Button>
              </Section>
            ) : null}
          </div>

          <div className="min-w-0 space-y-4 sm:space-y-6">
            {selected ? (
              <>
                <Section
                  variant="surface"
                  title="Lifecycle"
                  description="Only the single next step is available. The database enforces every transition rule."
                >
                  <ol className="space-y-1.5">
                    {LAUNCH_STATUSES.map((s) => {
                      const current = s === status;
                      const done = launchStatusIndex(s) < launchStatusIndex(status);
                      return (
                        <li
                          key={s}
                          className={`flex min-w-0 items-start gap-2 rounded-md border px-3 py-2 ${
                            current
                              ? "border-gold/50 bg-gold/5"
                              : "border-transparent bg-background/30"
                          }`}
                        >
                          <span
                            className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px] ${
                              done
                                ? "border-pepe/50 text-pepe"
                                : current
                                  ? "border-gold/60 text-gold"
                                  : "border-border text-muted-foreground"
                            }`}
                          >
                            {done ? <Check className="size-3" aria-hidden="true" /> : null}
                          </span>
                          <span className="min-w-0">
                            <span
                              className={`block text-xs font-semibold uppercase tracking-[0.12em] ${
                                current ? "text-gold" : "text-foreground"
                              }`}
                            >
                              {LAUNCH_STATUS_LABELS[s]}
                            </span>
                            {current ? (
                              <span className="block text-xs leading-relaxed text-muted-foreground">
                                {LAUNCH_STATUS_HELP[s]}
                              </span>
                            ) : null}
                          </span>
                        </li>
                      );
                    })}
                  </ol>

                  {next ? (
                    <div className="mt-4 space-y-2">
                      {blockedReason ? (
                        <p className="text-xs text-muted-foreground">{blockedReason}</p>
                      ) : null}
                      <Button
                        className="min-h-11 w-full"
                        disabled={transitionMutation.isPending || !!blockedReason}
                        onClick={() => transitionMutation.mutate(next)}
                      >
                        {transitionMutation.isPending ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        ) : null}
                        Advance to {LAUNCH_STATUS_LABELS[next]}
                      </Button>
                    </div>
                  ) : (
                    <p className="mt-4 text-xs text-muted-foreground">
                      This launch has reached the final lifecycle state.
                    </p>
                  )}

                  <div className="mt-4 space-y-1.5 rounded-md border border-border bg-background/40 px-3 py-2">
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Telegram Join Launch Watch subscriptions are not connected yet. Watchlist
                      open is an internal lifecycle state until Phase 4.
                    </p>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Launch and contract DM notification delivery is not active until Phase 5.
                      Advancing status does not send anything to anyone.
                    </p>
                  </div>
                </Section>

                <Section variant="surface" title="Official contract">
                  {status === "CONTRACT_PENDING" ? (
                    <div className="space-y-3">
                      <div className="min-w-0">
                        <Label htmlFor="contract-address">Official contract address</Label>
                        <Input
                          id="contract-address"
                          value={contractInput}
                          onChange={(e) => setContractInput(e.target.value)}
                          placeholder="Paste the official contract address"
                        />
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Not registered yet. You can correct and re-save the address while the
                        launch is still contract pending.
                      </p>
                      <Button
                        className="min-h-11"
                        disabled={contractMutation.isPending || !contractInput.trim()}
                        onClick={() => contractMutation.mutate()}
                      >
                        {contractMutation.isPending ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Save className="size-4" aria-hidden="true" />
                        )}
                        Save official contract address
                      </Button>
                    </div>
                  ) : contractSaved ? (
                    <div className="space-y-2">
                      <p className="break-all rounded-md border border-border bg-background/40 px-3 py-2 font-mono text-xs text-foreground">
                        {selected.official_contract_address}
                      </p>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Official contract registered by the authenticated project. This confirms
                        the address submitted by the project that controls this workspace. It is
                        not a safety check, an audit, or an investment guarantee.
                      </p>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Replacing a registered address is not available. It requires a future
                        controlled authorization and history flow.
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Contract registration becomes available later in the lifecycle, once the
                      launch reaches contract pending.
                    </p>
                  )}
                </Section>

                <Section variant="surface" title="Lifecycle timestamps">
                  <dl className="space-y-1.5 text-xs">
                    {(
                      [
                        ["Created", selected.created_at],
                        ["Status changed", selected.status_changed_at],
                        ["Announced", selected.announced_at],
                        ["Watchlist opened", selected.watchlist_opened_at],
                        ["Launch approaching", selected.launch_approaching_at],
                        ["Contract pending", selected.contract_pending_at],
                        ["Contract registered", selected.contract_registered_at],
                        ["Live", selected.live_at],
                        ["Completed", selected.completed_at],
                      ] as const
                    )
                      .filter(([, value]) => Boolean(value))
                      .map(([label, value]) => (
                        <div key={label} className="flex min-w-0 justify-between gap-3">
                          <dt className="shrink-0 text-muted-foreground">{label}</dt>
                          <dd className="min-w-0 truncate text-right text-foreground">
                            {formatTimestamp(value)}
                          </dd>
                        </div>
                      ))}
                  </dl>
                </Section>

                <Section
                  variant="surface"
                  title="Launch preview"
                  description="Private operator preview. No public launch page exists yet."
                >
                  <dl className="space-y-1.5 text-xs">
                    <PreviewRow label="Project" value={profile.project_name} />
                    <PreviewRow label="Token" value={selected.token_name} />
                    <PreviewRow label="Ticker" value={selected.ticker} />
                    <PreviewRow label="Chain" value={selected.chain} />
                    <PreviewRow label="Status" value={LAUNCH_STATUS_LABELS[status]} />
                    <PreviewRow
                      label="Schedule"
                      value={
                        selected.launch_at
                          ? formatTimestamp(selected.launch_at)
                          : selected.launch_window_start && selected.launch_window_end
                            ? `${formatTimestamp(selected.launch_window_start)} → ${formatTimestamp(selected.launch_window_end)}`
                            : "Not set"
                      }
                    />
                    <PreviewRow
                      label="Future path"
                      value={`/network/launch/${selected.public_slug}`}
                    />
                  </dl>
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                    The future path is reserved only. Public Cartel Network routes are not built
                    in this phase.
                  </p>
                </Section>
              </>
            ) : null}
          </div>
        </div>
      )}

      {selected && saveButton ? (
        <StickyActionBar desktop="hidden" end={saveButton} />
      ) : null}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft launch?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the draft launch record. Only drafts can be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                deleteMutation.mutate();
              }}
            >
              Delete draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right text-foreground">{value}</dd>
    </div>
  );
}
