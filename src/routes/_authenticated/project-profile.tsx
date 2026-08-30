import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IdCard, Loader2, Save, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace-context";
import { listWorkspaceAssets, signedUrlMap, type MediaAsset } from "@/lib/media";
import {
  DESCRIPTION_MAX,
  DISCOVERY_STATUSES,
  DISCOVERY_STATUS_HELP,
  DISCOVERY_STATUS_LABELS,
  PRIMARY_CHAIN_MAX,
  PROJECT_NAME_MAX,
  SLUG_MAX,
  TICKER_MAX,
  getProjectProfile,
  isValidSlug,
  saveProjectProfile,
  slugifyProjectName,
  type DiscoveryStatus,
} from "@/lib/project-profile";
import { PageHeader } from "@/components/cartel/PageHeader";
import { Section } from "@/components/cartel/Section";
import { EmptyState } from "@/components/cartel/EmptyState";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { LaunchReadinessCallout } from "@/components/cartel/LaunchReadiness";
import { launchReadinessQueryKey } from "@/lib/launch-readiness";

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

export const Route = createFileRoute("/_authenticated/project-profile")({
  head: () => ({
    meta: [
      { title: "Project Profile — CARTEL HQ" },
      {
        name: "description",
        content:
          "Configure the project identity record used by future Cartel Network and Launch Control features.",
      },
      { property: "og:title", content: "Project Profile — CARTEL HQ" },
      {
        property: "og:description",
        content: "Operator configuration for the workspace project identity record.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProjectProfilePage,
});

type Form = {
  project_name: string;
  ticker: string;
  primary_chain: string;
  public_slug: string;
  description: string;
  website_url: string;
  telegram_url: string;
  x_url: string;
  logo_asset_id: string;
  discovery_status: DiscoveryStatus;
};

const EMPTY_FORM: Form = {
  project_name: "",
  ticker: "",
  primary_chain: "",
  public_slug: "",
  description: "",
  website_url: "",
  telegram_url: "",
  x_url: "",
  logo_asset_id: "",
  discovery_status: "draft",
};

const NO_LOGO = "__none__";

const STATUS_TONE: Record<DiscoveryStatus, "gold" | "green" | "muted"> = {
  draft: "gold",
  published: "green",
  hidden: "muted",
};

function ProjectProfilePage() {
  const { workspaceId, workspace, loading: workspaceLoading } = useWorkspace();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const prefilledFor = useRef<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);

  const profileQuery = useQuery({
    queryKey: ["project-profile", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => getProjectProfile(workspaceId!),
  });

  const brandKitQuery = useQuery({
    queryKey: ["project-profile-brand-kit", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brand_kits")
        .select("brand_name,ticker,description,website_url,x_url,telegram_url")
        .eq("workspace_id", workspaceId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const logosQuery = useQuery({
    queryKey: ["project-profile-logos", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const all = await listWorkspaceAssets(workspaceId!);
      return all.filter((a) => a.asset_type === "logo");
    },
  });

  const logos = useMemo(() => logosQuery.data ?? [], [logosQuery.data]);

  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    if (logos.length === 0) {
      setUrls({});
      return;
    }
    signedUrlMap(logos.map((a) => a.storage_path)).then((map) => {
      if (active) setUrls(map);
    });
    return () => {
      active = false;
    };
  }, [logos]);

  const profile = profileQuery.data ?? null;

  // Saved profile is authoritative once it exists. Brand Kit never syncs over it.
  useEffect(() => {
    if (!profile) return;
    setForm({
      project_name: profile.project_name,
      ticker: profile.ticker ?? "",
      primary_chain: profile.primary_chain ?? "",
      public_slug: profile.public_slug,
      description: profile.description ?? "",
      website_url: profile.website_url ?? "",
      telegram_url: profile.telegram_url ?? "",
      x_url: profile.x_url ?? "",
      logo_asset_id: profile.logo_asset_id ?? "",
      discovery_status: profile.discovery_status,
    });
    setSlugTouched(true);
    prefilledFor.current = profile.workspace_id;
  }, [profile]);

  // One-time prefill for a brand new profile only; never overwrites typing.
  useEffect(() => {
    if (!workspaceId) return;
    if (profileQuery.isLoading || brandKitQuery.isLoading || logosQuery.isLoading) return;
    if (profile) return;
    if (prefilledFor.current === workspaceId) return;
    prefilledFor.current = workspaceId;

    const kit = brandKitQuery.data;
    const name = (kit?.brand_name ?? workspace?.name ?? "").trim();
    const workspaceSlug = workspace?.slug ?? "";
    const slug = isValidSlug(workspaceSlug) ? workspaceSlug : slugifyProjectName(name);

    setForm({
      project_name: name,
      ticker: kit?.ticker ?? "",
      primary_chain: "",
      public_slug: slug,
      description: kit?.description ?? "",
      website_url: kit?.website_url ?? "",
      telegram_url: kit?.telegram_url ?? "",
      x_url: kit?.x_url ?? "",
      logo_asset_id: logos[0]?.id ?? "",
      discovery_status: "draft",
    });
  }, [
    workspaceId,
    workspace,
    profile,
    profileQuery.isLoading,
    brandKitQuery.data,
    brandKitQuery.isLoading,
    logos,
    logosQuery.isLoading,
  ]);

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  const fillFromBrandKit = () => {
    const kit = brandKitQuery.data;
    if (!kit) return;
    setForm((f) => ({
      ...f,
      project_name: f.project_name.trim() ? f.project_name : (kit.brand_name ?? ""),
      ticker: f.ticker.trim() ? f.ticker : (kit.ticker ?? ""),
      description: f.description.trim() ? f.description : (kit.description ?? ""),
      website_url: f.website_url.trim() ? f.website_url : (kit.website_url ?? ""),
      telegram_url: f.telegram_url.trim() ? f.telegram_url : (kit.telegram_url ?? ""),
      x_url: f.x_url.trim() ? f.x_url : (kit.x_url ?? ""),
    }));
    toast.success("Empty fields filled from Brand Kit");
  };

  const nameValid = form.project_name.trim().length > 0 &&
    form.project_name.trim().length <= PROJECT_NAME_MAX;
  const slugValid = isValidSlug(form.public_slug.trim().toLowerCase());
  const canSave = nameValid && slugValid && !!workspaceId;

  const save = useMutation({
    mutationFn: async () => {
      if (!workspaceId) throw new Error("No active workspace.");
      return saveProjectProfile(workspaceId, profile?.id ?? null, {
        project_name: form.project_name,
        public_slug: form.public_slug,
        ticker: form.ticker,
        primary_chain: form.primary_chain,
        description: form.description,
        logo_asset_id: form.logo_asset_id || null,
        website_url: form.website_url,
        telegram_url: form.telegram_url,
        x_url: form.x_url,
        discovery_status: form.discovery_status,
      });
    },
    onSuccess: () => {
      toast.success(profile ? "Project profile saved" : "Project profile created");
      queryClient.invalidateQueries({ queryKey: ["project-profile", workspaceId] });
      queryClient.invalidateQueries({ queryKey: launchReadinessQueryKey(workspaceId) });

    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Could not save the project profile.");
    },
  });

  const selectedLogo: MediaAsset | undefined = logos.find((a) => a.id === form.logo_asset_id);

  const saveButton = (
    <Button
      type="submit"
      form="project-profile-form"
      className="min-h-11"
      disabled={save.isPending || profileQuery.isLoading || !canSave}
    >
      {save.isPending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <Save className="size-4" aria-hidden="true" />
      )}
      {profile ? "Save changes" : "Create project profile"}
    </Button>
  );

  return (
    <div className="space-y-6 pb-24 sm:space-y-8 lg:pb-0">
      <PageHeader
        eyebrow="Project Identity"
        title="Project Profile"
        description="One project identity record per workspace. This profile is the identity that future Cartel Network discovery and Launch Control features will build on. Cartel Network public pages are not live in this phase."
        status={workspace ? workspace.name : "No workspace"}
      />

      <LaunchReadinessCallout workspaceId={workspaceId} title="Setup guide" />



      {workspaceLoading ? (
        <Section variant="surface">
          <p className="text-sm text-muted-foreground">Loading workspace…</p>
        </Section>
      ) : !workspaceId ? (
        <EmptyState
          icon={IdCard}
          title="No workspace yet"
          description="Create a workspace from the switcher in the header before setting up a project profile."
        />
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
      ) : (
        <div className="grid gap-4 sm:gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <form
            id="project-profile-form"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
            className="min-w-0 space-y-4 sm:space-y-6"
          >
            <Section
              variant="surface"
              title="Identity"
              actions={
                brandKitQuery.data ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="min-h-11"
                    onClick={fillFromBrandKit}
                  >
                    <Wand2 className="size-4" aria-hidden="true" />
                    Fill empty fields from Brand Kit
                  </Button>
                ) : null
              }
            >
              <div className="grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
                <div>
                  <Label htmlFor="project_name">Project name</Label>
                  <Input
                    id="project_name"
                    required
                    maxLength={PROJECT_NAME_MAX}
                    className="mt-2 min-h-11"
                    value={form.project_name}
                    onChange={(e) => {
                      const value = e.target.value;
                      set({ project_name: value });
                      if (!profile && !slugTouched) {
                        set({ public_slug: slugifyProjectName(value) });
                      }
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor="ticker">Ticker</Label>
                  <Input
                    id="ticker"
                    maxLength={TICKER_MAX}
                    className="mt-2 min-h-11"
                    placeholder="$PCART"
                    value={form.ticker}
                    onChange={(e) => set({ ticker: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="primary_chain">Primary chain</Label>
                  <Input
                    id="primary_chain"
                    maxLength={PRIMARY_CHAIN_MAX}
                    className="mt-2 min-h-11"
                    placeholder="Solana"
                    value={form.primary_chain}
                    onChange={(e) => set({ primary_chain: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="public_slug">Public slug</Label>
                  <Input
                    id="public_slug"
                    required
                    maxLength={SLUG_MAX}
                    className="mt-2 min-h-11"
                    aria-describedby="public_slug-help"
                    value={form.public_slug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      set({ public_slug: e.target.value.toLowerCase() });
                    }}
                  />
                  <p id="public_slug-help" className="mt-2 text-xs text-muted-foreground">
                    2–64 lowercase letters, numbers and hyphens. Reserved for a future Cartel
                    Network address such as{" "}
                    <span className="text-foreground">
                      /network/project/{form.public_slug || "your-slug"}
                    </span>
                    . No public page exists yet.
                  </p>
                  {form.public_slug && !slugValid ? (
                    <p className="mt-1 text-xs text-signal">
                      Use 2–64 lowercase letters, numbers and single hyphens.
                    </p>
                  ) : null}
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    rows={4}
                    maxLength={DESCRIPTION_MAX}
                    className="mt-2"
                    value={form.description}
                    onChange={(e) => set({ description: e.target.value })}
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    {form.description.length} / {DESCRIPTION_MAX} characters
                  </p>
                </div>
              </div>
            </Section>

            <Section
              variant="surface"
              title="Official links"
              description="Only add links the project actually controls."
            >
              <div className="grid gap-4 md:grid-cols-3 [&>*]:min-w-0">
                <div>
                  <Label htmlFor="website_url">Official website</Label>
                  <Input
                    id="website_url"
                    type="url"
                    className="mt-2 min-h-11"
                    value={form.website_url}
                    onChange={(e) => set({ website_url: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="telegram_url">Official Telegram</Label>
                  <Input
                    id="telegram_url"
                    type="url"
                    className="mt-2 min-h-11"
                    value={form.telegram_url}
                    onChange={(e) => set({ telegram_url: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="x_url">Official X</Label>
                  <Input
                    id="x_url"
                    type="url"
                    className="mt-2 min-h-11"
                    value={form.x_url}
                    onChange={(e) => set({ x_url: e.target.value })}
                  />
                </div>
              </div>
            </Section>

            <Section
              variant="surface"
              title="Project logo"
              description="Choose from logo assets already stored in this workspace."
            >
              {logos.length === 0 ? (
                <EmptyState
                  compact
                  icon={IdCard}
                  title="No logo assets yet"
                  description="Upload a logo through Brand Kit or Assets, then return here to select it."
                />
              ) : (
                <div className="max-w-sm">
                  <Label htmlFor="logo_asset_id">Logo</Label>
                  <Select
                    value={form.logo_asset_id || NO_LOGO}
                    onValueChange={(value) =>
                      set({ logo_asset_id: value === NO_LOGO ? "" : value })
                    }
                  >
                    <SelectTrigger id="logo_asset_id" className="mt-2 min-h-11">
                      <SelectValue placeholder="Select a logo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_LOGO}>No logo</SelectItem>
                      {logos.map((asset, index) => (
                        <SelectItem key={asset.id} value={asset.id}>
                          Logo {index + 1} · {asset.width ?? "?"}×{asset.height ?? "?"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </Section>

            <Section
              variant="surface"
              title="Discovery status"
              description="These records stay behind authenticated workspace access. Cartel Network public pages are not live in this phase."
            >
              <div className="max-w-sm">
                <Label htmlFor="discovery_status">Status</Label>
                <Select
                  value={form.discovery_status}
                  onValueChange={(value) => set({ discovery_status: value as DiscoveryStatus })}
                >
                  <SelectTrigger id="discovery_status" className="mt-2 min-h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DISCOVERY_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {DISCOVERY_STATUS_LABELS[status]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {DISCOVERY_STATUS_HELP[form.discovery_status]}
                </p>
              </div>
            </Section>

            <div className="hidden items-center gap-3 lg:flex">
              {saveButton}
              {profileQuery.isLoading ? (
                <span className="text-xs text-muted-foreground">Loading…</span>
              ) : null}
            </div>
          </form>

          <aside className="min-w-0">
            <Section
              variant="primary"
              title="Network profile preview"
              description="How this identity reads today, from the current unsaved form state."
              className="xl:sticky xl:top-6"
              contentClassName="space-y-4"
            >
              <div className="flex items-start gap-3">
                <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-background/40">
                  {selectedLogo && urls[selectedLogo.storage_path] ? (
                    <img
                      src={urls[selectedLogo.storage_path]}
                      alt="Selected project logo"
                      className="max-h-full max-w-full object-contain"
                      loading="lazy"
                    />
                  ) : (
                    <IdCard className="size-5 text-muted-foreground" aria-hidden="true" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-lg uppercase text-foreground">
                    {form.project_name.trim() || "Unnamed project"}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {form.ticker.trim() ? (
                      <StatusBadge tone="gold">
                        <span>{form.ticker.trim()}</span>
                      </StatusBadge>
                    ) : null}
                    {form.primary_chain.trim() ? (
                      <StatusBadge tone="muted">
                        <span>{form.primary_chain.trim()}</span>
                      </StatusBadge>
                    ) : null}
                    <StatusBadge tone={STATUS_TONE[form.discovery_status]}>
                      <span>{DISCOVERY_STATUS_LABELS[form.discovery_status]}</span>
                    </StatusBadge>
                  </div>
                </div>
              </div>

              {form.description.trim() ? (
                <p className="text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                  {form.description.trim()}
                </p>
              ) : null}

              {form.website_url.trim() || form.telegram_url.trim() || form.x_url.trim() ? (
                <div className="flex flex-wrap gap-2">
                  {form.website_url.trim() ? (
                    <span className="rounded-md border border-border bg-surface-raised px-2 py-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                      Website
                    </span>
                  ) : null}
                  {form.telegram_url.trim() ? (
                    <span className="rounded-md border border-border bg-surface-raised px-2 py-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                      Telegram
                    </span>
                  ) : null}
                  {form.x_url.trim() ? (
                    <span className="rounded-md border border-border bg-surface-raised px-2 py-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                      X
                    </span>
                  ) : null}
                </div>
              ) : null}

              <p className="border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
                Private preview. Cartel Network public pages arrive in a later phase.
              </p>
            </Section>
          </aside>
        </div>
      )}

      {workspaceId ? (
        <StickyActionBar
          desktop="hidden"
          end={saveButton}
          start={
            <span className="truncate text-xs text-muted-foreground">
              {profileQuery.isLoading
                ? "Loading…"
                : profile
                  ? DISCOVERY_STATUS_LABELS[profile.discovery_status]
                  : "Not created yet"}
            </span>
          }
        />
      ) : null}
    </div>
  );
}
