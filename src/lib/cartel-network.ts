import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

/**
 * Phase 6 — Public Cartel Network read layer.
 *
 * Every read here goes through the already-live public SECURITY DEFINER RPCs
 * with the normal publishable client. There are NO direct table reads and no
 * service-role usage: base tables stay private to anon. Nothing in this module
 * may surface workspace ids, user ids, subscriber identities, delivery/event
 * internals or raw storage paths — the RPCs never return them.
 */

type Fns = Database["public"]["Functions"];

export type NetworkSummary = Fns["get_cartel_network_summary"]["Returns"][number];
export type NetworkProjectCard = Fns["get_cartel_network_projects"]["Returns"][number];
export type NetworkProject = Fns["get_cartel_network_project"]["Returns"][number];
export type NetworkProjectLaunch =
  Fns["get_cartel_network_project_launches"]["Returns"][number];
export type NetworkUpcomingLaunch =
  Fns["get_cartel_network_upcoming_launches"]["Returns"][number];
export type NetworkLaunch = Fns["get_cartel_network_launch"]["Returns"][number];
export type NetworkSignal = Fns["get_cartel_network_signals"]["Returns"][number];

const SIGNAL_LABELS: Record<string, string> = {
  LAUNCH_ANNOUNCED: "Launch announced",
  WATCHLIST_OPENED: "Launch Watch opened",
  OFFICIAL_CONTRACT_REGISTERED: "Official contract registered",
  LAUNCH_LIVE: "Launch is live",
  LAUNCH_COMPLETED: "Launch completed",
};

export function signalLabel(type: string | null | undefined): string {
  return SIGNAL_LABELS[(type ?? "").toUpperCase()] ?? "Launch update";
}

export function signalTone(type: string | null | undefined): LaunchTone {
  const key = (type ?? "").toUpperCase();
  if (key === "OFFICIAL_CONTRACT_REGISTERED" || key === "LAUNCH_LIVE") return "green";
  if (key === "LAUNCH_COMPLETED") return "muted";
  return "gold";
}


export const NETWORK_PAGE_SIZE = 12;

// ---------------------------------------------------------------------------
// Formatting helpers (pure)
// ---------------------------------------------------------------------------

/** Stored tickers may or may not include `$`; never render `$$PCART`. */
export function formatTicker(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  return `$${raw.replace(/^\$+/, "")}`;
}

export type LaunchTone = "gold" | "green" | "red" | "muted";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  ANNOUNCED: "Announced",
  WATCHLIST_OPEN: "Watchlist open",
  LAUNCH_APPROACHING: "Launch approaching",
  CONTRACT_PENDING: "Contract pending",
  OFFICIAL_CONTRACT_REGISTERED: "Official contract registered",
  LIVE: "Live",
  COMPLETED: "Completed",
};

const STATUS_TONES: Record<string, LaunchTone> = {
  DRAFT: "muted",
  ANNOUNCED: "gold",
  WATCHLIST_OPEN: "gold",
  LAUNCH_APPROACHING: "gold",
  CONTRACT_PENDING: "gold",
  OFFICIAL_CONTRACT_REGISTERED: "green",
  LIVE: "green",
  COMPLETED: "muted",
};

export function launchStatusLabel(status: string | null | undefined): string {
  const key = (status ?? "").toUpperCase();
  return STATUS_LABELS[key] ?? "Status unavailable";
}

export function launchStatusTone(status: string | null | undefined): LaunchTone {
  const key = (status ?? "").toUpperCase();
  return STATUS_TONES[key] ?? "muted";
}

/** Watch messaging for launches where the RPC did not supply a join URL. */
export function watchStateMessage(status: string | null | undefined): string {
  const key = (status ?? "").toUpperCase();
  if (key === "ANNOUNCED") return "Launch Watch is not open yet.";
  if (key === "LIVE" || key === "COMPLETED") return "Launch Watch is closed to new watchers.";
  return "Launch Watch is not available for this launch.";
}

function isValidTimeZone(tz: string | null | undefined): tz is string {
  const value = (tz ?? "").trim();
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function formatDateTime(
  value: string | null | undefined,
  timezone?: string | null,
): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
    timeZoneName: "short",
  };
  if (isValidTimeZone(timezone)) options.timeZone = timezone;
  try {
    return new Intl.DateTimeFormat("en-US", options).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  }
}

export type ScheduleInput = {
  launch_at?: string | null;
  launch_window_start?: string | null;
  launch_window_end?: string | null;
  timezone?: string | null;
};

/** Exact time, otherwise window, otherwise `Launch time TBA`. */
export function formatSchedule(input: ScheduleInput): string {
  const tz = input.timezone ?? null;
  const exact = formatDateTime(input.launch_at, tz);
  if (exact) return exact;
  const start = formatDateTime(input.launch_window_start, tz);
  const end = formatDateTime(input.launch_window_end, tz);
  if (start && end) return `${start} → ${end}`;
  if (start) return `From ${start}`;
  return "Launch time TBA";
}

export function excerpt(value: string | null | undefined, max = 180): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max - 1).trimEnd()}…`;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidNetworkSlug(value: string | null | undefined): boolean {
  const raw = (value ?? "").trim().toLowerCase();
  return raw.length >= 2 && raw.length <= 64 && SLUG_PATTERN.test(raw);
}

const SUPABASE_URL = "https://ocoinbnjgstkmnwwvnhi.supabase.co";

/**
 * Public logo proxy. Only call when the RPC reported `has_logo = true`; the
 * Edge Function streams the selected published project logo and never exposes
 * the private storage path.
 */
export function publicProjectLogoUrl(slug: string): string {
  return `${SUPABASE_URL}/functions/v1/cartel-network-logo?slug=${encodeURIComponent(slug)}`;
}

// ---------------------------------------------------------------------------
// Query keys + fetchers
// ---------------------------------------------------------------------------

export type DirectoryParams = {
  search?: string | null;
  chain?: string | null;
  limit?: number;
  offset?: number;
  /** Server-side filter: only projects currently in the `verified` state. */
  verifiedOnly?: boolean;
};

function rpcArgs(params: DirectoryParams) {
  const args: { _search?: string; _chain?: string; _limit: number; _offset: number } = {
    _limit: params.limit ?? NETWORK_PAGE_SIZE,
    _offset: params.offset ?? 0,
  };
  const search = params.search?.trim();
  const chain = params.chain?.trim();
  if (search) args._search = search;
  if (chain) args._chain = chain;
  return args;
}

export const networkKeys = {
  summary: () => ["cartel-network", "summary"] as const,
  projects: (p: DirectoryParams) =>
    ["cartel-network", "projects", p.search ?? "", p.chain ?? "", p.verifiedOnly === true, p.limit ?? NETWORK_PAGE_SIZE, p.offset ?? 0] as const,

  project: (slug: string) => ["cartel-network", "project", slug] as const,
  projectLaunches: (slug: string) => ["cartel-network", "project-launches", slug] as const,
  upcoming: (p: DirectoryParams) =>
    ["cartel-network", "upcoming", p.search ?? "", p.chain ?? "", p.limit ?? NETWORK_PAGE_SIZE, p.offset ?? 0] as const,
  launch: (slug: string) => ["cartel-network", "launch", slug] as const,
  signals: (p: DirectoryParams) =>
    ["cartel-network", "signals", p.chain ?? "", p.limit ?? NETWORK_PAGE_SIZE, p.offset ?? 0] as const,

};

export async function fetchNetworkSummary(): Promise<NetworkSummary> {
  const { data, error } = await supabase.rpc("get_cartel_network_summary");
  if (error) throw error;
  return (
    data?.[0] ?? { published_projects: 0, upcoming_launches: 0, live_launches: 0 }
  );
}

export type Paged<T> = { rows: T[]; totalCount: number };

export async function fetchNetworkProjects(
  params: DirectoryParams = {},
): Promise<Paged<NetworkProjectCard>> {
  const { data, error } = await supabase.rpc("get_cartel_network_projects", {
    ...rpcArgs(params),
    _verified_only: params.verifiedOnly === true,
  });
  if (error) throw error;
  const rows = data ?? [];
  return { rows, totalCount: Number(rows[0]?.total_count ?? 0) };
}

export async function fetchNetworkProject(slug: string): Promise<NetworkProject | null> {
  if (!isValidNetworkSlug(slug)) return null;
  const { data, error } = await supabase.rpc("get_cartel_network_project", {
    _slug: slug.trim().toLowerCase(),
  });
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function fetchNetworkProjectLaunches(
  slug: string,
): Promise<NetworkProjectLaunch[]> {
  if (!isValidNetworkSlug(slug)) return [];
  const { data, error } = await supabase.rpc("get_cartel_network_project_launches", {
    _project_slug: slug.trim().toLowerCase(),
  });
  if (error) throw error;
  return data ?? [];
}

export async function fetchNetworkUpcomingLaunches(
  params: DirectoryParams = {},
): Promise<Paged<NetworkUpcomingLaunch>> {
  const { data, error } = await supabase.rpc(
    "get_cartel_network_upcoming_launches",
    rpcArgs(params),
  );
  if (error) throw error;
  const rows = data ?? [];
  return { rows, totalCount: Number(rows[0]?.total_count ?? 0) };
}

export async function fetchNetworkLaunch(slug: string): Promise<NetworkLaunch | null> {
  if (!isValidNetworkSlug(slug)) return null;
  const { data, error } = await supabase.rpc("get_cartel_network_launch", {
    _slug: slug.trim().toLowerCase(),
  });
  if (error) throw error;
  return data?.[0] ?? null;
}


export async function fetchNetworkSignals(
  params: DirectoryParams = {},
): Promise<Paged<NetworkSignal>> {
  const args: { _chain?: string; _limit: number; _offset: number } = {
    _limit: params.limit ?? NETWORK_PAGE_SIZE,
    _offset: params.offset ?? 0,
  };
  const chain = params.chain?.trim();
  if (chain) args._chain = chain;
  const { data, error } = await supabase.rpc("get_cartel_network_signals", args);
  if (error) throw error;
  const rows = data ?? [];
  return { rows, totalCount: Number(rows[0]?.total_count ?? 0) };
}

export const NETWORK_TRUST_COPY = {
  contractRegistered: "Official contract registered by the authenticated project.",
  notAnAudit:
    "This is not a safety audit, token-safety verification, rug-proof guarantee or investment endorsement. Always do your own research.",
  projectSupplied:
    "All information on this page is supplied by the project account in CARTEL HQ. CARTEL HQ does not guarantee token safety.",
  signals:
    "Cartel Signals are official project and launch lifecycle events supplied by authenticated projects. They are not trading signals, price calls or investment recommendations.",
  projectAuthenticated:
    "Published through an authenticated CARTEL HQ project workspace.",
  platformReviewed:
    "CARTEL HQ manually reviewed the current project profile and listed official links. Material profile changes clear this status until reviewed again.",
  verificationClarifier:
    "These signals do not verify token safety, smart-contract code, liquidity, team identity or KYC, rug resistance, price behaviour or investment quality.",
} as const;


