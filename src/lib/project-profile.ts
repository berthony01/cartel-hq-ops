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
};

export const PROJECT_NAME_MAX = 120;
export const TICKER_MAX = 20;
export const PRIMARY_CHAIN_MAX = 64;
export const DESCRIPTION_MAX = 1500;
export const SLUG_MIN = 2;
export const SLUG_MAX = 64;

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
