import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IdCard, Loader2, Plus, Rocket, Save, Trash2, Video, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace-context";
import { listWorkspaceAssets, signedUrlMap, type MediaAsset } from "@/lib/media";
import {
  ABOUT_LONG_MAX,
  DESCRIPTION_MAX,
  DISCOVERY_STATUSES,
  DISCOVERY_STATUS_HELP,
  DISCOVERY_STATUS_LABELS,
  HIGHLIGHT_MAX,
  HIGHLIGHT_MAX_COUNT,
  PRIMARY_CHAIN_MAX,
  PROFILE_RESOURCE_URL_MAX,
  PROJECT_NAME_MAX,
  PROJECT_PROFILE_VIDEO_MAX_COUNT,
  PROJECT_PROFILE_VIDEO_TITLE_MAX,
  SLUG_MAX,
  TAGLINE_MAX,
  TICKER_MAX,
  addProjectProfileVideo,
  deleteProjectProfileVideo,
  extractYouTubeVideoId,
  getProjectProfile,
  isValidSlug,
  listProjectProfileVideos,
  saveProjectProfile,
  slugifyProjectName,
  updateProjectProfileVideo,
  type DiscoveryStatus,
} from "@/lib/project-profile";
import { PageHeader } from "@/components/cartel/PageHeader";
import { Section } from "@/components/cartel/Section";
import { SectionNav, type SectionNavItem } from "@/components/cartel/SectionNav";
import { formatDateTime } from "@/lib/cartel-network";
import {
  canRequestVerification,
  fetchProjectVerificationState,
  projectVerificationKeys,
  requestProjectVerification,
  VERIFICATION_STATUS_DESCRIPTION,
  VERIFICATION_STATUS_LABEL,
  verificationStatusOf,
} from "@/lib/project-verification";
import { EmptyState } from "@/components/cartel/EmptyState";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { LaunchReadinessCallout } from "@/components/cartel/LaunchReadiness";
import { launchReadinessQueryKey } from "@/lib/launch-readiness";
import { AssetUploader } from "@/components/cartel/AssetUploader";
import { useSession } from "@/hooks/useSession";


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
        content: "Operator configuration for the active project identity record.",
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
  tagline: string;
  about_long: string;
  highlights: string[];
  website_url: string;
  telegram_url: string;
  x_url: string;
  docs_url: string;
  github_url: string;
  logo_asset_id: string;
  discovery_status: DiscoveryStatus;
};

const EMPTY_FORM: Form = {
  project_name: "",
  ticker: "",
  primary_chain: "",
  public_slug: "",
  description: "",
  tagline: "",
  about_long: "",
  highlights: [],
  website_url: "",
  telegram_url: "",
  x_url: "",
  docs_url: "",
  github_url: "",
  logo_asset_id: "",
  discovery_status: "draft",
};

const NO_LOGO = "__none__";

const STATUS_TONE: Record<DiscoveryStatus, "gold" | "green" | "muted"> = {
  draft: "gold",
  published: "green",
  hidden: "muted",
};

/** Profile Studio working sections. Presentation-only; no data ownership. */
const STUDIO_SECTIONS: SectionNavItem[] = [
  { id: "pp-identity", label: "Identity" },
  { id: "pp-about", label: "About" },
  { id: "pp-links", label: "Links" },
  { id: "pp-media", label: "Media" },
  { id: "pp-trust", label: "Trust" },
  { id: "pp-launch", label: "Launch" },
  { id: "pp-visibility", label: "Visibility" },
];

/**
 * Every studio view stays mounted; only visibility changes, so unsaved form
 * state, queries and mutation state survive navigation.
 */
function WorkingView({
  id,
  active,
  children,
}: {
  id: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      hidden={!active}
      aria-hidden={active ? undefined : true}
      className="min-w-0 space-y-4 sm:space-y-6"
    >
      {children}
    </div>
  );
}

function ProjectProfilePage() {
  const { workspaceId, workspace, loading: workspaceLoading } = useWorkspace();
  const queryClient = useQueryClient();
  const { user } = useSession();
  const userId = user?.id ?? null;
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const prefilledFor = useRef<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [activeSection, setActiveSection] = useState<string>("pp-identity");

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

  const verificationQuery = useQuery({
    queryKey: projectVerificationKeys.state(profile?.id),
    queryFn: () => fetchProjectVerificationState(profile!.id),
    enabled: !!profile?.id,
  });
  const verification = verificationQuery.data ?? null;
  const verificationStatus = verificationStatusOf(verification?.verification_status);

  const requestVerification = useMutation({
    mutationFn: () => requestProjectVerification(profile!.id),
    onSuccess: () => {
      toast.success("Platform review requested");
      queryClient.invalidateQueries({ queryKey: ["project-verification"] });
    },
    onError: (err: unknown) => {
      toast.error(
        err instanceof Error ? err.message : "Could not request a platform review right now.",
      );
    },
  });

  // Media (project profile videos) — RLS-protected CRUD, separate from Save.
  const videosQuery = useQuery({
    queryKey: ["project-profile-videos", profile?.id],
    enabled: !!profile?.id,
    queryFn: () => listProjectProfileVideos(profile!.id),
  });
  const videos = useMemo(() => videosQuery.data ?? [], [videosQuery.data]);
  const videoLimitReached = videos.length >= PROJECT_PROFILE_VIDEO_MAX_COUNT;
  const [videoInput, setVideoInput] = useState("");
  const [videoTitle, setVideoTitle] = useState("");
  const [titleDrafts, setTitleDrafts] = useState<Record<string, string>>({});
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  const refreshVideos = () =>
    queryClient.invalidateQueries({ queryKey: ["project-profile-videos", profile?.id] });

  /** Never submits an occupied position; the live table enforces UNIQUE(profile, position). */
  const nextFreeVideoPosition = (): number => {
    const used = new Set(videos.map((v) => v.position));
    const maxPosition = videos.reduce((max, v) => (v.position > max ? v.position : max), -1);
    const appendCandidate = maxPosition + 1;
    if (appendCandidate < PROJECT_PROFILE_VIDEO_MAX_COUNT && !used.has(appendCandidate)) {
      return appendCandidate;
    }
    for (let position = 0; position < PROJECT_PROFILE_VIDEO_MAX_COUNT; position++) {
      if (!used.has(position)) return position;
    }
    throw new Error(`This profile already has ${PROJECT_PROFILE_VIDEO_MAX_COUNT} videos.`);
  };


  const addVideo = useMutation({
    mutationFn: async () => {
      if (!profile?.id) throw new Error("Create the project profile first.");
      const parsed = extractYouTubeVideoId(videoInput);
      if (!parsed) throw new Error("Enter a valid YouTube link or 11-character video ID.");
      if (videos.some((v) => v.youtube_video_id === parsed)) {
        throw new Error("That video is already on this profile.");
      }
      return addProjectProfileVideo(profile.id, {
        youtube: videoInput,
        title: videoTitle,
        position: nextFreeVideoPosition(),
      });
    },
    onSuccess: () => {
      setVideoInput("");
      setVideoTitle("");
      toast.success("Video added");
      void refreshVideos();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Could not add that video.");
    },
  });

  const updateVideoTitle = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      updateProjectProfileVideo(id, { title }),
    onSuccess: (_data, vars) => {
      setTitleDrafts((drafts) => {
        const next = { ...drafts };
        delete next[vars.id];
        return next;
      });
      toast.success("Video title saved");
      void refreshVideos();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Could not save that video title.");
    },
  });

  const removeVideo = useMutation({
    mutationFn: (id: string) => deleteProjectProfileVideo(id),
    onSuccess: () => {
      setConfirmRemoveId(null);
      toast.success("Video removed");
      void refreshVideos();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Could not remove that video.");
    },
  });


  // Saved profile is authoritative once it exists. Brand Kit never syncs over it.
  useEffect(() => {
    if (!profile) return;
    setForm({
      project_name: profile.project_name,
      ticker: profile.ticker ?? "",
      primary_chain: profile.primary_chain ?? "",
      public_slug: profile.public_slug,
      description: profile.description ?? "",
      tagline: profile.tagline ?? "",
      about_long: profile.about_long ?? "",
      highlights: profile.highlights ?? [],
      website_url: profile.website_url ?? "",
      telegram_url: profile.telegram_url ?? "",
      x_url: profile.x_url ?? "",
      docs_url: profile.docs_url ?? "",
      github_url: profile.github_url ?? "",
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
      tagline: "",
      about_long: "",
      highlights: [],
      website_url: kit?.website_url ?? "",
      telegram_url: kit?.telegram_url ?? "",
      x_url: kit?.x_url ?? "",
      docs_url: "",
      github_url: "",
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

  /**
   * Explanatory only. The database trigger owns the Platform Reviewed reset;
   * nothing here mutates review state.
   */
  const reviewResetNotice =
    verificationStatus === "verified" ? (
      <p className="mb-4 max-w-prose rounded-md border border-border-subtle bg-background/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        This project is Platform Reviewed. Saving material changes to the public profile clears
        Platform Reviewed until CARTEL HQ reviews the updated profile again.
      </p>
    ) : null;

  const save = useMutation({
    mutationFn: async () => {
      if (!workspaceId) throw new Error("No active project.");
      return saveProjectProfile(workspaceId, profile?.id ?? null, {
        project_name: form.project_name,
        public_slug: form.public_slug,
        ticker: form.ticker,
        primary_chain: form.primary_chain,
        description: form.description,
        tagline: form.tagline,
        about_long: form.about_long,
        highlights: form.highlights,
        logo_asset_id: form.logo_asset_id || null,
        website_url: form.website_url,
        telegram_url: form.telegram_url,
        x_url: form.x_url,
        docs_url: form.docs_url,
        github_url: form.github_url,
        discovery_status: form.discovery_status,
      });
    },
    onSuccess: () => {
      toast.success(profile ? "Project profile saved" : "Project profile created");
      queryClient.invalidateQueries({ queryKey: ["project-profile", workspaceId] });
      queryClient.invalidateQueries({ queryKey: launchReadinessQueryKey(workspaceId) });
      // A material identity change clears Platform Reviewed via a DB trigger.
      queryClient.invalidateQueries({ queryKey: ["project-verification"] });

    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Could not save the project profile.");
    },
  });

  const selectedLogo: MediaAsset | undefined = logos.find((a) => a.id === form.logo_asset_id);
  /**
   * Honest branded-broadcast eligibility for the selected logo, derived from
   * stored metadata using the same rules the Edge Function enforces before it
   * uploads the image to Telegram.
   */
  const selectedLogoIssue: string | null = (() => {
    if (!selectedLogo) return null;
    const mime = (selectedLogo.mime_type ?? "").toLowerCase();
    if (mime !== "image/png" && mime !== "image/jpeg") {
      return "This logo is not a PNG or JPEG, so branded community broadcasts cannot use it. Upload a PNG or JPEG version to enable branded posting.";
    }
    const size = typeof selectedLogo.file_size_bytes === "number" ? selectedLogo.file_size_bytes : null;
    if (size !== null && (size <= 0 || size > 10 * 1024 * 1024)) {
      return "This logo is larger than 10MB, so branded community broadcasts cannot use it. Upload a smaller PNG or JPEG.";
    }
    const w = typeof selectedLogo.width === "number" ? selectedLogo.width : null;
    const h = typeof selectedLogo.height === "number" ? selectedLogo.height : null;
    const dimsBad =
      (w !== null && w <= 0) ||
      (h !== null && h <= 0) ||
      (w !== null &&
        h !== null &&
        (w + h > 10000 || Math.max(w, h) / Math.max(1, Math.min(w, h)) > 20));
    if (dimsBad) {
      return "Telegram cannot post this logo's dimensions, so branded community broadcasts cannot use it. Upload a more standard PNG or JPEG logo.";
    }

    return null;
  })();
  const logoSelectionUnsaved = (form.logo_asset_id || "") !== (profile?.logo_asset_id ?? "");

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
        description="Manage the selected project's identity and its public Cartel Network profile. Publishing makes this profile discoverable on the Cartel Network."
        status={workspace ? workspace.name : "No project"}
      />

      <LaunchReadinessCallout workspaceId={workspaceId} title="Setup guide" />



      {workspaceLoading ? (
        <Section variant="surface">
          <p className="text-sm text-muted-foreground">Loading project…</p>
        </Section>
      ) : !workspaceId ? (
        <EmptyState
          icon={IdCard}
          title="No project yet"
          description="Add a project from the selector in the header before setting up a project profile."
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
        <div className="min-w-0 space-y-4 sm:space-y-6">
        <Section variant="hero" className="min-w-0" contentClassName="min-w-0">
          <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <div className="flex min-w-0 items-start gap-3 sm:gap-4">
              <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gold/30 bg-background/50 sm:size-16">
                {selectedLogo && urls[selectedLogo.storage_path] ? (
                  <img
                    src={urls[selectedLogo.storage_path]}
                    alt=""
                    className="max-h-full max-w-full object-contain"
                    loading="lazy"
                  />
                ) : (
                  <IdCard className="size-6 text-gold/70" aria-hidden="true" />
                )}
              </div>
              <div className="min-w-0">
                <p className="type-eyebrow text-gold">Profile state</p>
                <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                  <h2 className="min-w-0 font-display text-2xl uppercase leading-[0.95] text-foreground [overflow-wrap:anywhere] sm:text-3xl">
                    {profileQuery.isLoading
                      ? "Loading…"
                      : profile
                        ? profile.project_name
                        : "Project profile not created yet"}
                  </h2>
                  {profile ? (
                    <StatusBadge tone={STATUS_TONE[profile.discovery_status]}>
                      <span>{DISCOVERY_STATUS_LABELS[profile.discovery_status]}</span>
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone="muted">
                      <span>Not created</span>
                    </StatusBadge>
                  )}
                </div>
                <p className="mt-2.5 max-w-prose type-helper text-muted-foreground [overflow-wrap:anywhere]">
                  {!profile
                    ? "Fill in the identity below and create the profile. Nothing is public until you create it and set the status to Published."
                    : profile.discovery_status === "published"
                      ? "This profile is published, so it is discoverable on the public Cartel Network."
                      : "This profile is saved but not discoverable on the public Cartel Network. Set the status to Published when you are ready."}
                </p>
                {profile?.public_slug || form.public_slug ? (
                  <div className="mt-3 min-w-0 rounded-md border border-border-subtle bg-background/40 px-3 py-2">
                    <p className="type-eyebrow text-muted-foreground">
                      {profile?.public_slug ? "Network address" : "Planned network address"}
                    </p>
                    <p className="mt-1 min-w-0 type-technical text-foreground [overflow-wrap:anywhere]">
                      /network/project/{profile?.public_slug ?? form.public_slug}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap lg:justify-end">
              {saveButton}
              {profile && profile.discovery_status === "published" && profile.public_slug ? (
                <Button asChild variant="outline" className="min-h-11">
                  <Link
                    to="/network/project/$projectSlug"
                    params={{ projectSlug: profile.public_slug }}
                  >
                    View public page
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>
        </Section>



        <SectionNav
          label="Project Profile Studio"
          items={STUDIO_SECTIONS}
          activeId={activeSection}
          onChange={setActiveSection}
        />

        <div className="grid gap-4 sm:gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">

          <div className="min-w-0 space-y-4 sm:space-y-6">
          <form
            id="project-profile-form"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
            className="min-w-0 space-y-4 sm:space-y-6"
          >
            <WorkingView id="pp-identity" active={activeSection === "pp-identity"}>
            <Section
              variant="surface"
              title="Identity"
              description="The public-facing name, ticker, chain and network address of this project."
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
              {brandKitQuery.data ? (
                <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
                  Filling from Brand Kit is a one-way convenience: it copies current Brand Kit
                  values into empty fields here. It does not link the two, and later Brand Kit
                  edits will not update this profile.
                </p>
              ) : null}
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
                    2–64 lowercase letters, numbers and hyphens. This sets your Cartel
                    Network address:{" "}
                    <span className="text-foreground">
                      /network/project/{form.public_slug || "your-slug"}
                    </span>
                    . The page is live once this profile is published.
                  </p>

                  {form.public_slug && !slugValid ? (
                    <p className="mt-1 text-xs text-signal">
                      Use 2–64 lowercase letters, numbers and single hyphens.
                    </p>
                  ) : null}
                </div>
              </div>
            </Section>

            <Section
              variant="surface"
              title="Project logo"
              description="Upload a logo or choose one already stored in this project. Branded Telegram broadcasts require a PNG or JPEG logo no larger than 10MB."
            >
              <div className="space-y-4">
                <div className="max-w-sm">
                  <AssetUploader
                    workspaceId={workspaceId ?? null}
                    userId={userId}
                    assetType="logo"
                    label="Upload a project logo"
                    onUploaded={(asset) => {
                      set({ logo_asset_id: asset.id });
                      void queryClient.invalidateQueries({
                        queryKey: ["project-profile-logos", workspaceId],
                      });
                    }}
                  />
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    Uploading only selects the logo here. It is not part of your project identity,
                    and branded community broadcasts will not use it, until you save this profile.
                  </p>

                </div>
                {logos.length === 0 ? (
                  <EmptyState
                    compact
                    icon={IdCard}
                    title="No logo assets yet"
                    description="Upload a logo above, or add one through Brand Kit or Assets, then return here to select it."
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
                    {selectedLogoIssue ? (
                      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                        {selectedLogoIssue}
                      </p>
                    ) : null}
                    {logoSelectionUnsaved ? (
                      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                        This logo selection is not saved yet. Save this profile to use it for
                        branded community broadcasts.
                      </p>
                    ) : null}
                  </div>
                )}
              </div>
            </Section>
            </WorkingView>

            <WorkingView id="pp-about" active={activeSection === "pp-about"}>
            <Section
              variant="surface"
              title="About"
              description="The public story this project publishes on its Cartel Network profile."
            >
              {reviewResetNotice}
              <div className="max-w-2xl space-y-6">
                <div>
                  <Label htmlFor="tagline">Tagline</Label>
                  <Input
                    id="tagline"
                    maxLength={TAGLINE_MAX}
                    className="mt-2 min-h-11"
                    value={form.tagline}
                    onChange={(e) => set({ tagline: e.target.value })}
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    {form.tagline.length} / {TAGLINE_MAX} characters
                  </p>
                  <p className="mt-2 max-w-prose text-xs leading-relaxed text-muted-foreground">
                    A short positioning line shown in the public Project Hub hero.
                  </p>
                </div>

                <div>
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    rows={5}
                    maxLength={DESCRIPTION_MAX}
                    className="mt-2"
                    value={form.description}
                    onChange={(e) => set({ description: e.target.value })}
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    {form.description.length} / {DESCRIPTION_MAX} characters
                  </p>
                  <p className="mt-2 max-w-prose text-xs leading-relaxed text-muted-foreground">
                    The compact project summary. It is used in Cartel Network directory listings
                    and as the About fallback when no full About is written.
                  </p>
                </div>

                <div>
                  <Label htmlFor="about_long">Full About</Label>
                  <Textarea
                    id="about_long"
                    rows={10}
                    maxLength={ABOUT_LONG_MAX}
                    className="mt-2"
                    value={form.about_long}
                    onChange={(e) => set({ about_long: e.target.value })}
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    {form.about_long.length} / {ABOUT_LONG_MAX} characters
                  </p>
                  <p className="mt-2 max-w-prose text-xs leading-relaxed text-muted-foreground">
                    The longer project story: what it is, what it does and who it is for. When
                    filled in, this becomes the main About body on the public Project Hub.
                  </p>
                </div>

                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label htmlFor="highlight-0">Project highlights</Label>
                    <span className="text-xs text-muted-foreground">
                      {form.highlights.length} / {HIGHLIGHT_MAX_COUNT}
                    </span>
                  </div>
                  <p className="mt-2 max-w-prose text-xs leading-relaxed text-muted-foreground">
                    Up to {HIGHLIGHT_MAX_COUNT} short factual points, shown in order beneath About.
                    Empty rows are dropped when you save.
                  </p>
                  <div className="mt-3 space-y-2">
                    {form.highlights.map((highlight, index) => (
                      <div key={index} className="flex min-w-0 items-center gap-2">
                        <Input
                          id={`highlight-${index}`}
                          aria-label={`Highlight ${index + 1}`}
                          maxLength={HIGHLIGHT_MAX}
                          className="min-h-11"
                          value={highlight}
                          onChange={(e) =>
                            set({
                              highlights: form.highlights.map((item, i) =>
                                i === index ? e.target.value : item,
                              ),
                            })
                          }
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="size-11 shrink-0"
                          aria-label={`Remove highlight ${index + 1}`}
                          onClick={() =>
                            set({ highlights: form.highlights.filter((_, i) => i !== index) })
                          }
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3 min-h-11"
                    disabled={form.highlights.length >= HIGHLIGHT_MAX_COUNT}
                    onClick={() => set({ highlights: [...form.highlights, ""] })}
                  >
                    <Plus className="size-4" aria-hidden="true" />
                    Add highlight
                  </Button>
                  {form.highlights.length >= HIGHLIGHT_MAX_COUNT ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      You have reached the maximum of {HIGHLIGHT_MAX_COUNT} highlights. Remove one
                      to add another.
                    </p>
                  ) : null}
                </div>
              </div>
            </Section>
            </WorkingView>

            <WorkingView id="pp-links" active={activeSection === "pp-links"}>
            <Section
              variant="surface"
              title="Official links"
              description="Only add links the project actually controls."
            >
              {reviewResetNotice}
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
                <div>
                  <Label htmlFor="docs_url">Documentation</Label>
                  <Input
                    id="docs_url"
                    type="url"
                    maxLength={PROFILE_RESOURCE_URL_MAX}
                    className="mt-2 min-h-11"
                    placeholder="https://docs.example.com"
                    value={form.docs_url}
                    onChange={(e) => set({ docs_url: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="github_url">GitHub</Label>
                  <Input
                    id="github_url"
                    type="url"
                    maxLength={PROFILE_RESOURCE_URL_MAX}
                    className="mt-2 min-h-11"
                    placeholder="https://github.com/your-project"
                    value={form.github_url}
                    onChange={(e) => set({ github_url: e.target.value })}
                  />
                </div>
              </div>
              <p className="mt-4 max-w-prose text-xs leading-relaxed text-muted-foreground">
                Documentation and GitHub should point at official project-controlled resources.
                They are published alongside your other official links.
              </p>
            </Section>
            </WorkingView>


            <WorkingView id="pp-visibility" active={activeSection === "pp-visibility"}>
            <Section
              variant="surface"
              title="Visibility"
              description="Draft and hidden profiles stay behind authenticated project access. Published profiles appear on the public Cartel Network."
            >
              <div className="max-w-sm">
                <Label htmlFor="discovery_status">Discovery status</Label>
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
            </WorkingView>
          </form>

          <WorkingView id="pp-media" active={activeSection === "pp-media"}>
            <Section
              variant="surface"
              title="Media"
              description="Up to six YouTube videos shown on this project's public Cartel Network profile."
              actions={
                profile ? (
                  <span className="type-helper text-muted-foreground">
                    {videos.length} / {PROJECT_PROFILE_VIDEO_MAX_COUNT}
                  </span>
                ) : null
              }
            >
              {!profile ? (
                <EmptyState
                  compact
                  icon={Video}
                  title="Create the project profile first"
                  description="Videos are attached to a saved project profile. Fill in Identity and create this profile, then add media here."
                />
              ) : videosQuery.isError ? (
                <div>
                  <p className="max-w-prose type-helper text-muted-foreground">
                    Project videos could not be loaded right now.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3 min-h-11"
                    onClick={() => void videosQuery.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="surface-quiet min-w-0 rounded-lg p-3.5">
                    <div className="grid gap-3 md:grid-cols-2 [&>*]:min-w-0">
                      <div>
                        <Label htmlFor="video_youtube">YouTube link or video ID</Label>
                        <Input
                          id="video_youtube"
                          className="mt-2 min-h-11"
                          placeholder="https://www.youtube.com/watch?v=…"
                          value={videoInput}
                          onChange={(e) => setVideoInput(e.target.value)}
                          disabled={videoLimitReached}
                        />
                      </div>
                      <div>
                        <Label htmlFor="video_title">Title (optional)</Label>
                        <Input
                          id="video_title"
                          className="mt-2 min-h-11"
                          maxLength={PROJECT_PROFILE_VIDEO_TITLE_MAX}
                          value={videoTitle}
                          onChange={(e) => setVideoTitle(e.target.value)}
                          disabled={videoLimitReached}
                        />
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3 min-h-11"
                      disabled={
                        videoLimitReached ||
                        addVideo.isPending ||
                        videosQuery.isLoading ||
                        !videoInput.trim()
                      }
                      onClick={() => addVideo.mutate()}
                    >
                      {addVideo.isPending ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Plus className="size-4" aria-hidden="true" />
                      )}
                      Add video
                    </Button>
                    <p className="mt-2 max-w-prose type-helper text-muted-foreground">
                      {videoLimitReached
                        ? `You have reached the maximum of ${PROJECT_PROFILE_VIDEO_MAX_COUNT} videos. Remove one to add another.`
                        : "Videos are saved immediately and are separate from the profile Save action. Titles are your own text; nothing is fetched from YouTube."}
                    </p>
                  </div>

                  {videosQuery.isLoading ? (
                    <p className="type-helper text-muted-foreground">Loading videos…</p>
                  ) : videos.length === 0 ? (
                    <EmptyState
                      compact
                      icon={Video}
                      title="No videos yet"
                      description="Add a YouTube link above. Videos appear on the public profile once this profile is published."
                    />
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
                      {videos.map((video, index) => (
                        <article
                          key={video.id}
                          className="min-w-0 overflow-hidden rounded-lg border border-border-subtle bg-background/40"
                        >
                          <div className="relative w-full pt-[56.25%]">
                            <iframe
                              className="absolute inset-0 size-full"
                              src={`https://www.youtube-nocookie.com/embed/${video.youtube_video_id}`}
                              title={video.title ?? `Project video ${index + 1}`}
                              loading="lazy"
                              allowFullScreen
                            />
                          </div>
                          <div className="space-y-3 p-3.5">
                            <p className="min-w-0 type-technical text-muted-foreground [overflow-wrap:anywhere]">
                              {video.youtube_video_id}
                            </p>
                            <div>
                              <Label htmlFor={`video-title-${video.id}`}>Title</Label>
                              <Input
                                id={`video-title-${video.id}`}
                                className="mt-2 min-h-11"
                                maxLength={PROJECT_PROFILE_VIDEO_TITLE_MAX}
                                value={titleDrafts[video.id] ?? video.title ?? ""}
                                onChange={(e) =>
                                  setTitleDrafts((drafts) => ({
                                    ...drafts,
                                    [video.id]: e.target.value,
                                  }))
                                }
                              />
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="min-h-11"
                                disabled={
                                  updateVideoTitle.isPending ||
                                  (titleDrafts[video.id] ?? video.title ?? "") ===
                                    (video.title ?? "")
                                }
                                onClick={() =>
                                  updateVideoTitle.mutate({
                                    id: video.id,
                                    title: titleDrafts[video.id] ?? "",
                                  })
                                }
                              >
                                <Save className="size-4" aria-hidden="true" />
                                Save title
                              </Button>
                              {confirmRemoveId === video.id ? (
                                <>
                                  <Button
                                    type="button"
                                    variant="destructive"
                                    size="sm"
                                    className="min-h-11"
                                    disabled={removeVideo.isPending}
                                    onClick={() => removeVideo.mutate(video.id)}
                                  >
                                    Confirm remove
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="min-h-11"
                                    onClick={() => setConfirmRemoveId(null)}
                                  >
                                    Cancel
                                  </Button>
                                </>
                              ) : (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="min-h-11"
                                  aria-label={`Remove video ${index + 1}`}
                                  onClick={() => setConfirmRemoveId(video.id)}
                                >
                                  <Trash2 className="size-4" aria-hidden="true" />
                                  Remove
                                </Button>
                              )}
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Section>
          </WorkingView>


          <WorkingView id="pp-trust" active={activeSection === "pp-trust"}>
            {profile ? (
              <Section
                variant="surface"
                title="Verification"
                description="Layered trust signals for this project. Only CARTEL HQ can grant a review; the project can request one."
              >
                <div className="grid min-w-0 gap-3 lg:grid-cols-2">
                  <div className="surface-quiet min-w-0 rounded-lg p-3.5">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <StatusBadge tone="gold">
                        <span>Project Authenticated</span>
                      </StatusBadge>
                      <span className="type-helper text-muted-foreground">Active</span>
                    </div>
                    <p className="mt-2.5 max-w-prose type-helper text-muted-foreground">
                      This profile is controlled and published through an authenticated CARTEL HQ
                      project workspace. It does not verify external team identity or KYC.
                    </p>
                  </div>

                  <div className="surface-quiet min-w-0 rounded-lg p-3.5">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <StatusBadge tone={verificationStatus === "verified" ? "gold" : "muted"}>
                        <span>Platform Reviewed</span>
                      </StatusBadge>
                      <span className="min-w-0 type-helper text-muted-foreground [overflow-wrap:anywhere]">
                        {verificationQuery.isLoading
                          ? "Checking review state…"
                          : verificationQuery.isError
                            ? "Review state could not be loaded right now."
                            : verificationStatus === "verified"
                              ? `Reviewed${
                                  formatDateTime(verification?.verified_at)
                                    ? ` ${formatDateTime(verification?.verified_at)}`
                                    : ""
                                }`
                              : verificationStatus === "pending"
                                ? `Review requested${
                                    formatDateTime(verification?.requested_at)
                                      ? ` ${formatDateTime(verification?.requested_at)}`
                                      : ""
                                  }`
                                : VERIFICATION_STATUS_LABEL[verificationStatus]}
                      </span>
                    </div>
                    <p className="mt-2.5 max-w-prose type-helper text-muted-foreground">
                      {VERIFICATION_STATUS_DESCRIPTION[verificationStatus]}
                    </p>
                    <p className="mt-2 max-w-prose type-helper text-muted-foreground">
                      Platform Reviewed does not verify token safety, smart-contract code,
                      liquidity or investment quality.
                    </p>

                    {verificationQuery.isError ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-3 min-h-11"
                        onClick={() => void verificationQuery.refetch()}
                      >
                        Retry
                      </Button>
                    ) : verificationQuery.isSuccess && canRequestVerification(verificationStatus) ? (
                      <div className="mt-3 space-y-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="min-h-11"
                          disabled={requestVerification.isPending}
                          onClick={() => requestVerification.mutate()}
                        >
                          {requestVerification.isPending ? "Requesting…" : "Request Platform Review"}
                        </Button>
                        <p className="max-w-prose type-helper text-muted-foreground">
                          Requires a published profile with a name, public link name, chain and at
                          least one official link. Requesting a review never marks this project
                          reviewed.
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>
              </Section>
            ) : (
              <Section variant="quiet" title="Verification">
                <p className="max-w-prose type-helper text-muted-foreground">
                  Trust signals appear here once this project profile has been created.
                </p>
              </Section>
            )}
          </WorkingView>

          <WorkingView id="pp-launch" active={activeSection === "pp-launch"}>
            <Section
              variant="surface"
              title="Launch integration"
              description="Launch data is owned by Launch Control, not by this profile."
            >
              <p className="max-w-prose type-helper text-muted-foreground">
                Launch schedule, lifecycle status, Launch Watch, official contract registration and
                deployment all stay in Launch Control. This profile supplies the project identity
                those launches are published under.
              </p>
              <Button asChild variant="outline" className="mt-4 min-h-11">
                <Link to="/launch-control">
                  <Rocket className="size-4" aria-hidden="true" />
                  Open Launch Control
                </Link>
              </Button>
            </Section>
          </WorkingView>
          </div>


          <aside className="min-w-0">
            <Section
              variant="surface"
              title="Network profile preview"
              description="How this identity reads today, from the current unsaved form state."
              className="xl:sticky xl:top-6"
              contentClassName="space-y-4"
            >
              <div className="min-w-0 overflow-hidden rounded-lg border border-border-subtle bg-background/40">
                <div className="h-1 w-full bg-gradient-to-r from-gold/70 via-gold/25 to-transparent" />
                <div className="space-y-4 p-3.5 sm:p-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-background/60">
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
                      <p className="min-w-0 font-display text-lg uppercase leading-tight text-foreground [overflow-wrap:anywhere]">
                        {form.project_name.trim() || "Unnamed project"}
                      </p>
                      <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
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

                  {form.tagline.trim() ? (
                    <p className="type-helper text-foreground [overflow-wrap:anywhere]">
                      {form.tagline.trim()}
                    </p>
                  ) : null}

                  {form.description.trim() ? (
                    <p className="type-helper text-muted-foreground [overflow-wrap:anywhere]">
                      {form.description.trim()}
                    </p>
                  ) : null}

                  {form.website_url.trim() ||
                  form.telegram_url.trim() ||
                  form.x_url.trim() ||
                  form.docs_url.trim() ||
                  form.github_url.trim() ? (
                    <div className="flex min-w-0 flex-wrap gap-1.5">
                      {form.website_url.trim() ? (
                        <span className="rounded-md border border-border-subtle bg-surface-raised px-2 py-1 type-eyebrow text-muted-foreground">
                          Website
                        </span>
                      ) : null}
                      {form.telegram_url.trim() ? (
                        <span className="rounded-md border border-border-subtle bg-surface-raised px-2 py-1 type-eyebrow text-muted-foreground">
                          Telegram
                        </span>
                      ) : null}
                      {form.x_url.trim() ? (
                        <span className="rounded-md border border-border-subtle bg-surface-raised px-2 py-1 type-eyebrow text-muted-foreground">
                          X
                        </span>
                      ) : null}
                      {form.docs_url.trim() ? (
                        <span className="rounded-md border border-border-subtle bg-surface-raised px-2 py-1 type-eyebrow text-muted-foreground">
                          Docs
                        </span>
                      ) : null}
                      {form.github_url.trim() ? (
                        <span className="rounded-md border border-border-subtle bg-surface-raised px-2 py-1 type-eyebrow text-muted-foreground">
                          GitHub
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>

              {profile && profile.discovery_status === "published" && profile.public_slug ? (
                <div>
                  <Button asChild variant="outline" size="sm" className="min-h-11 w-full">
                    <Link
                      to="/network/project/$projectSlug"
                      params={{ projectSlug: profile.public_slug }}
                    >
                      View Network Profile
                    </Link>
                  </Button>
                  <p className="mt-2 type-helper text-muted-foreground">
                    Published profiles are discoverable on the Cartel Network.
                  </p>
                </div>
              ) : (
                <p className="type-helper text-muted-foreground">
                  Private preview. Publish this profile to make it discoverable on the Cartel
                  Network.
                </p>
              )}

            </Section>
          </aside>
        </div>
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
