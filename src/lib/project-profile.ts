import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

/**
 * Phase 2 — Project Identity foundation.
 *
 * Small reusable data layer over the authenticated `project_profiles` table.
 * RLS remains the security boundary: everything here goes through the browser
 * Supabase client as the signed-in user. No service role, no Edge Function,
 * no public/anonymous fetching in this phase.
 */

export type ProjectProfileRow = Database["public"]["Tables"]["project_profiles"]["Row"];
export type ProjectProfileInsert = Database["public"]["Tables"]["project_profiles"]["Insert"];

export type DiscoveryStatus = "draft" | "published" | "hidden";

export const DISCOVERY_STATUSES: DiscoveryStatus[] = ["draft", "published", "hidden"];

export const DISCOVERY_STATUS_LABELS: Record<DiscoveryStatus, string> = {
  draft: "Draft",
  published: "Published",
  hidden: "Hidden",
};

export const DISCOVERY_STATUS_HELP: Record<DiscoveryStatus, string> = {
  draft: "Being prepared. Nothing is exposed outside this workspace.",
  published: "Discoverable on the Cartel Network.",
  hidden: "Not intended for discovery.",
};

export type ProjectProfile = Omit<ProjectProfileRow, "discovery_status"> & {
  discovery_status: DiscoveryStatus;
};

export type ProjectProfilePayload = {
  project_name: string;
  public_slug: string;
  ticker: string | null;
  primary_chain: string | null;
  description: string | null;
  logo_asset_id: string | null;
  website_url: string | null;
  telegram_url: string | null;
  x_url: string | null;
  discovery_status: DiscoveryStatus;
  /**
   * Rich profile fields. Optional so callers that do not own these fields
   * (identity-only saves) never blank them; a present key is always written.
   */
  tagline?: string | null;
  about_long?: string | null;
  highlights?: string[] | null;
  docs_url?: string | null;
  github_url?: string | null;
};

export const PROJECT_NAME_MAX = 120;
export const TICKER_MAX = 20;
export const PRIMARY_CHAIN_MAX = 64;
export const DESCRIPTION_MAX = 1500;
export const SLUG_MIN = 2;
export const SLUG_MAX = 64;

/** Rich-profile limits — these mirror the live database contract exactly. */
export const TAGLINE_MAX = 140;
export const ABOUT_LONG_MAX = 6000;
export const HIGHLIGHT_MAX = 120;
export const HIGHLIGHT_MAX_COUNT = 6;
export const PROFILE_RESOURCE_URL_MAX = 500;
export const PROJECT_PROFILE_VIDEO_MAX_COUNT = 6;
export const PROJECT_PROFILE_VIDEO_TITLE_MAX = 120;

/** Mirrors the database check constraint on `public_slug`. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;


export function isValidSlug(value: string): boolean {
  return (
    value.length >= SLUG_MIN && value.length <= SLUG_MAX && SLUG_PATTERN.test(value)
  );
}

/** Lowercase hyphen slug that satisfies the database regex. */
export function slugifyProjectName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
}

/** Empty strings become null so nullable columns stay clean. */
export function nullableText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

// ---------------------------------------------------------------------------
// Rich profile content — pure normalization / validation helpers
// ---------------------------------------------------------------------------

/** Explicit, user-readable validation failure. Never silently truncates. */
export class ProfileContentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileContentValidationError";
  }
}

export function normalizeTagline(value: string | null | undefined): string | null {
  const text = nullableText(value);
  if (text && text.length > TAGLINE_MAX) {
    throw new ProfileContentValidationError(
      `Tagline must be ${TAGLINE_MAX} characters or fewer.`,
    );
  }
  return text;
}

export function normalizeAboutLong(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > ABOUT_LONG_MAX) {
    throw new ProfileContentValidationError(
      `About must be ${ABOUT_LONG_MAX} characters or fewer.`,
    );
  }
  return trimmed;
}

/** Trims, drops empties, preserves author order, enforces count and length. */
export function normalizeHighlights(
  values: readonly string[] | null | undefined,
): string[] | null {
  if (values == null) return null;
  const cleaned = values.map((v) => (v ?? "").trim()).filter((v) => v.length > 0);
  if (cleaned.length === 0) return null;
  if (cleaned.length > HIGHLIGHT_MAX_COUNT) {
    throw new ProfileContentValidationError(
      `You can add at most ${HIGHLIGHT_MAX_COUNT} highlights.`,
    );
  }
  for (const item of cleaned) {
    if (item.length > HIGHLIGHT_MAX) {
      throw new ProfileContentValidationError(
        `Each highlight must be ${HIGHLIGHT_MAX} characters or fewer.`,
      );
    }
  }
  return cleaned;
}

/** Optional absolute http(s) link. Rejects other schemes and over-long URLs. */
export function normalizeResourceUrl(
  value: string | null | undefined,
  label: string,
): string | null {
  const text = nullableText(value);
  if (!text) return null;
  if (text.length > PROFILE_RESOURCE_URL_MAX) {
    throw new ProfileContentValidationError(
      `${label} must be ${PROFILE_RESOURCE_URL_MAX} characters or fewer.`,
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new ProfileContentValidationError(
      `${label} must be a full link starting with https://`,
    );
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ProfileContentValidationError(
      `${label} must be a full link starting with https://`,
    );
  }
  return text;
}

// ---------------------------------------------------------------------------
// Project profile videos (authenticated, RLS-protected)
// ---------------------------------------------------------------------------

export type ProjectProfileVideoRow =
  Database["public"]["Tables"]["project_profile_videos"]["Row"];

export type ProjectProfileVideoInput = {
  /** Raw user input: full YouTube URL or a bare 11-character video id. */
  youtube: string;
  title?: string | null;
  position: number;
};

export type ProjectProfileVideoUpdate = {
  title?: string | null;
  position?: number;
};

const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_WATCH_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);

/**
 * Pure canonical parser. Accepts a bare 11-char id, youtube.com watch/shorts/embed
 * URLs and youtu.be short links on exact YouTube hosts only. No network access.
 * Returns the canonical 11-character id, or null when the input is not acceptable.
 */
export function extractYouTubeVideoId(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  if (YOUTUBE_ID_PATTERN.test(raw)) return raw;
  if (!/^https?:\/\//i.test(raw)) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();

  let candidate: string | null = null;
  const segments = url.pathname.split("/").filter(Boolean);

  if (host === "youtu.be") {
    candidate = segments.length === 1 ? segments[0] : null;
  } else if (YOUTUBE_WATCH_HOSTS.has(host)) {
    if (url.pathname === "/watch") {
      candidate = url.searchParams.get("v");
    } else if (segments.length === 2 && (segments[0] === "shorts" || segments[0] === "embed")) {
      candidate = segments[1];
    }
  } else {
    return null;
  }

  if (!candidate) return null;
  return YOUTUBE_ID_PATTERN.test(candidate) ? candidate : null;
}

export function normalizeVideoTitle(value: string | null | undefined): string | null {
  const text = nullableText(value);
  if (text && text.length > PROJECT_PROFILE_VIDEO_TITLE_MAX) {
    throw new ProfileContentValidationError(
      `Video title must be ${PROJECT_PROFILE_VIDEO_TITLE_MAX} characters or fewer.`,
    );
  }
  return text;
}

export function normalizeVideoPosition(value: number): number {
  if (
    !Number.isInteger(value) ||
    value < 0 ||
    value > PROJECT_PROFILE_VIDEO_MAX_COUNT - 1
  ) {
    throw new ProfileContentValidationError(
      `Video position must be between 0 and ${PROJECT_PROFILE_VIDEO_MAX_COUNT - 1}.`,
    );
  }
  return value;
}

/** Videos for one profile, ordered the way the public hub will render them. */
export async function listProjectProfileVideos(
  projectProfileId: string,
): Promise<ProjectProfileVideoRow[]> {
  const { data, error } = await supabase
    .from("project_profile_videos")
    .select("*")
    .eq("project_profile_id", projectProfileId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function addProjectProfileVideo(
  projectProfileId: string,
  input: ProjectProfileVideoInput,
): Promise<ProjectProfileVideoRow> {
  const videoId = extractYouTubeVideoId(input.youtube);
  if (!videoId) {
    throw new ProfileContentValidationError(
      "Enter a valid YouTube link or 11-character video ID.",
    );
  }
  const { data, error } = await supabase
    .from("project_profile_videos")
    .insert({
      project_profile_id: projectProfileId,
      youtube_video_id: videoId,
      title: normalizeVideoTitle(input.title),
      position: normalizeVideoPosition(input.position),
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/** Title and/or position only — never the profile link or the video id. */
export async function updateProjectProfileVideo(
  videoId: string,
  patch: ProjectProfileVideoUpdate,
): Promise<ProjectProfileVideoRow> {
  const changes: { title?: string | null; position?: number } = {};
  if ("title" in patch) changes.title = normalizeVideoTitle(patch.title);
  if (patch.position !== undefined) changes.position = normalizeVideoPosition(patch.position);
  const { data, error } = await supabase
    .from("project_profile_videos")
    .update(changes)
    .eq("id", videoId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteProjectProfileVideo(videoId: string): Promise<void> {
  const { error } = await supabase
    .from("project_profile_videos")
    .delete()
    .eq("id", videoId);
  if (error) throw error;
}

function toDiscoveryStatus(value: string): DiscoveryStatus {
  return (DISCOVERY_STATUSES as string[]).includes(value)
    ? (value as DiscoveryStatus)
    : "draft";
}

function toProjectProfile(row: ProjectProfileRow): ProjectProfile {
  return { ...row, discovery_status: toDiscoveryStatus(row.discovery_status) };
}

export async function getProjectProfile(workspaceId: string): Promise<ProjectProfile | null> {
  const { data, error } = await supabase
    .from("project_profiles")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  return data ? toProjectProfile(data) : null;
}

export class SlugConflictError extends Error {
  constructor() {
    super("That public slug is already in use. Try another one.");
    this.name = "SlugConflictError";
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

/**
 * Inserts when `existingId` is null, otherwise updates by id.
 * `workspace_id` is only ever written on insert and never changed afterwards.
 */
export async function saveProjectProfile(
  workspaceId: string,
  existingId: string | null,
  payload: ProjectProfilePayload,
): Promise<ProjectProfile> {
  const normalized = {
    project_name: payload.project_name.trim(),
    public_slug: payload.public_slug.trim().toLowerCase(),
    ticker: nullableText(payload.ticker),
    primary_chain: nullableText(payload.primary_chain),
    description: nullableText(payload.description),
    logo_asset_id: payload.logo_asset_id ?? null,
    website_url: nullableText(payload.website_url),
    telegram_url: nullableText(payload.telegram_url),
    x_url: nullableText(payload.x_url),
    discovery_status: payload.discovery_status,
    // Only written when the caller actually owns the field.
    ...("tagline" in payload ? { tagline: normalizeTagline(payload.tagline) } : {}),
    ...("about_long" in payload
      ? { about_long: normalizeAboutLong(payload.about_long) }
      : {}),
    ...("highlights" in payload
      ? { highlights: normalizeHighlights(payload.highlights) }
      : {}),
    ...("docs_url" in payload
      ? { docs_url: normalizeResourceUrl(payload.docs_url, "Docs link") }
      : {}),
    ...("github_url" in payload
      ? { github_url: normalizeResourceUrl(payload.github_url, "GitHub link") }
      : {}),
  };

  if (!normalized.project_name) throw new Error("Project name is required.");
  if (normalized.project_name.length > PROJECT_NAME_MAX) {
    throw new Error(`Project name must be ${PROJECT_NAME_MAX} characters or fewer.`);
  }
  if (!isValidSlug(normalized.public_slug)) {
    throw new Error(
      "Public slug must be 2–64 characters using lowercase letters, numbers and hyphens.",
    );
  }

  const query = existingId
    ? supabase.from("project_profiles").update(normalized).eq("id", existingId)
    : supabase
        .from("project_profiles")
        .insert({ ...normalized, workspace_id: workspaceId } satisfies ProjectProfileInsert);

  const { data, error } = await query.select("*").single();

  if (error) {
    if (isUniqueViolation(error)) throw new SlugConflictError();
    throw error;
  }

  return toProjectProfile(data);
}
