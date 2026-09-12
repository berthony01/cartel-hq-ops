/**
 * PP2-V2-1F — YouTube media editor + public Media tab.
 *
 * Static, deterministic assertions over the Profile Studio route, the public
 * project route and the shared Project Hub. No network, no Supabase.
 */
import { readFileSync } from "node:fs";

const STUDIO = readFileSync("src/routes/_authenticated/project-profile.tsx", "utf8");
const ROUTE = readFileSync("src/routes/network.project.$projectSlug.tsx", "utf8");
const HUB = readFileSync("src/components/cartel-network/PublicProjectHub.tsx", "utf8");

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}
const count = (src: string, needle: string) => src.split(needle).length - 1;
const between = (src: string, start: string, end: string) => {
  const a = src.indexOf(start);
  const b = src.indexOf(end, a);
  return a >= 0 && b > a ? src.slice(a, b) : "";
};

// 1 — reuse of the existing data layer, no new direct table access
for (const symbol of [
  "PROJECT_PROFILE_VIDEO_MAX_COUNT",
  "PROJECT_PROFILE_VIDEO_TITLE_MAX",
  "extractYouTubeVideoId",
  "listProjectProfileVideos",
  "addProjectProfileVideo",
  "updateProjectProfileVideo",
  "deleteProjectProfileVideo",
]) {
  check(`F-1:${symbol} — imported from @/lib/project-profile`, STUDIO.includes(`  ${symbol},`));
}
check(
  "F-1b — no direct project_profile_videos table access from the studio route",
  !STUDIO.includes("project_profile_videos"),
);
check(
  "F-1c — no new YouTube ID parser in the studio route",
  !/\{11\}|youtu\.be|watch\?v=[^"]*\$\{/.test(STUDIO),
);

// 2 — query is scoped to an existing saved profile
check(
  "F-2 — video query keyed on the saved profile id and enabled only for it",
  /queryKey: \["project-profile-videos", profile\?\.id\],\s*enabled: !!profile\?\.id,\s*queryFn: \(\) => listProjectProfileVideos\(profile!\.id\),/.test(
    STUDIO,
  ),
);
check(
  "F-2b — no-profile Media state explains the profile must be created first",
  STUDIO.includes("Create the project profile first"),
);

// 3 — add flow
const addMutation = between(STUDIO, "const addVideo = useMutation({", "const updateVideoTitle");
check("F-3 — add parses with extractYouTubeVideoId", addMutation.includes("extractYouTubeVideoId(videoInput)"));
check("F-3b — add writes through addProjectProfileVideo", addMutation.includes("addProjectProfileVideo(profile.id, {"));
check(
  "F-3c — max count derived from PROJECT_PROFILE_VIDEO_MAX_COUNT",
  STUDIO.includes("videos.length >= PROJECT_PROFILE_VIDEO_MAX_COUNT") &&
    STUDIO.includes("disabled={videoLimitReached}"),
);
check(
  "F-3d — title inputs capped by PROJECT_PROFILE_VIDEO_TITLE_MAX",
  count(STUDIO, "maxLength={PROJECT_PROFILE_VIDEO_TITLE_MAX}") === 2,
);

// 4 — collision-safe position
const position = between(STUDIO, "const nextFreeVideoPosition", "};");
check(
  "F-4 — position picked from unused 0..PROJECT_PROFILE_VIDEO_MAX_COUNT-1 slots",
  position.includes("new Set(videos.map((v) => v.position))") &&
    position.includes("position < PROJECT_PROFILE_VIDEO_MAX_COUNT") &&
    position.includes("if (!used.has(position)) return position;"),
);
check("F-4b — add submits the computed free position", addMutation.includes("position: nextFreeVideoPosition(),"));

// 4c/4d — execute the real source of nextFreeVideoPosition against fixed inputs.
// The body is lifted verbatim from the route; no behaviour is re-implemented here.
const positionBody = position.slice(position.indexOf("{") + 1);
const runNextFreePosition = (positions: number[]): number | "throw" => {
  const fn = new Function(
    "videos",
    "PROJECT_PROFILE_VIDEO_MAX_COUNT",
    positionBody,
  ) as (v: { position: number }[], max: number) => number;
  try {
    return fn(positions.map((p) => ({ position: p })), 6);
  } catch {
    return "throw";
  }
};
check("F-4c — empty profile appends at 0", runNextFreePosition([]) === 0);
check("F-4d — sparse [0,2] appends after max instead of filling gap 1", runNextFreePosition([0, 2]) === 3);
check("F-4e — sparse [1,4] appends after max", runNextFreePosition([1, 4]) === 5);
check("F-4f — dense [0,1,2] appends at 3", runNextFreePosition([0, 1, 2]) === 3);
check("F-4g — max already 5 falls back to the first unused gap", runNextFreePosition([0, 2, 5]) === 1);
check("F-4h — max 5 with only a late gap returns that gap", runNextFreePosition([0, 1, 2, 3, 5]) === 4);
check("F-4i — full 0..5 throws instead of returning a position", runNextFreePosition([0, 1, 2, 3, 4, 5]) === "throw");
const occupiedSafe = ([[], [0, 2], [1, 4], [0, 1, 2], [0, 2, 5], [0, 1, 2, 3, 5]] as number[][]).every((set) => {
  const result = runNextFreePosition(set);
  return typeof result === "number" && result >= 0 && result < 6 && !set.includes(result);
});
check("F-4j — never returns an occupied or out-of-range position", occupiedSafe);


// 5 — duplicate guard before insert
check(
  "F-5 — duplicate YouTube ID blocked before the mutation",
  addMutation.includes("videos.some((v) => v.youtube_video_id === parsed)") &&
    addMutation.includes("That video is already on this profile."),
);

// 6 — title-only update, no position mutation
const update = between(STUDIO, "const updateVideoTitle = useMutation({", "const removeVideo");
check("F-6 — update uses updateProjectProfileVideo with title only", update.includes("updateProjectProfileVideo(id, { title })"));
check("F-6b — no position mutation or reorder UI in this phase", !/position:\s*(index|\d)|Move up|Move down|reorder/i.test(STUDIO));

// 7 — delete
check("F-7 — delete uses deleteProjectProfileVideo", STUDIO.includes("deleteProjectProfileVideo(id)"));
check("F-7b — removal requires an explicit confirmation step", STUDIO.includes("confirmRemoveId === video.id") && STUDIO.includes("Confirm remove"));

// 8 — authenticated embeds
check(
  "F-8 — studio embeds only youtube-nocookie with the stored id",
  /src=\{`https:\/\/www\.youtube-nocookie\.com\/embed\/\$\{video\.youtube_video_id\}`\}/.test(STUDIO),
);
check("F-8b — studio iframe lazy loaded with a title", /loading="lazy"[\s\S]{0,80}allowFullScreen/.test(STUDIO));
check("F-8c — no arbitrary iframe src from raw user input", !/src=\{videoInput/.test(STUDIO));

// 9 — public route data path
check("F-9 — route imports fetchNetworkProjectVideos", ROUTE.includes("fetchNetworkProjectVideos"));
check("F-9b — route uses networkKeys.projectVideos", ROUTE.includes("networkKeys.projectVideos(params.projectSlug)") && ROUTE.includes("networkKeys.projectVideos(projectSlug)"));
check("F-9c — no direct table read or service role on the public route", !/\.from\(|service_role|supabaseAdmin/.test(ROUTE));

// 10 — search validation
check(
  "F-10 — validated search accepts media",
  ROUTE.includes('tab === "launch" || tab === "media" || tab === "trust" ? { tab } : {}'),
);
check(
  "F-10b — media tab with no videos falls back to Overview",
  ROUTE.includes('(requestedTab === "media" && videos.length === 0)'),
);

// 11 — hub shows Media only with real videos
check("F-11 — PublicProjectHubTab includes media", HUB.includes('"overview" | "launch" | "media" | "trust"'));
check(
  "F-11b — media tab only listed when videos exist",
  HUB.includes('...(videos.length > 0 ? (["media"] as const) : [])'),
);
check(
  "F-11c — media panel rendered only for the media tab with videos",
  HUB.includes('activeTab === "media" && videos.length > 0'),
);

// 12 — public media panel
const panel = between(HUB, "function MediaPanel(", "export type");
const mediaPanel = panel || between(HUB, "function MediaPanel(", "function FactRow");
check(
  "F-12 — public embed uses youtube-nocookie with the stored id",
  /src=\{`https:\/\/www\.youtube-nocookie\.com\/embed\/\$\{video\.youtube_video_id\}`\}/.test(mediaPanel),
);
check("F-12b — RPC order preserved (no client sorting)", !/\.sort\(/.test(mediaPanel));
check("F-12c — lazy iframes and no autoplay", mediaPanel.includes('loading="lazy"') && !/autoplay/i.test(mediaPanel));
check(
  "F-12d — honest fallback title, no fabricated metadata",
  mediaPanel.includes("video.title ?? `${project.project_name} video ${index + 1}`") &&
    !/views|likes|channel|thumbnail/i.test(mediaPanel),
);

// 13 — no new backend surface
check(
  "F-13 — no YouTube/Google API, key, metadata fetch, RPC or service role introduced",
  !/googleapis|YOUTUBE_API|api_key|apiKey/i.test(STUDIO + ROUTE + HUB) &&
    !/\.rpc\(|service_role|supabaseAdmin/.test(STUDIO + ROUTE + HUB),
);

// 14 — existing tabs intact
for (const tab of ["overview", "launch", "trust"]) {
  check(`F-14:${tab} — tab label preserved`, HUB.includes(`id={\`project-tab-\${tab}\`}`) && HUB.includes(`"${tab}"`));
}
check(
  "F-14b — conditional launch tab behaviour intact",
  HUB.includes('...(launches.length > 0 ? (["launch"] as const) : [])') &&
    HUB.includes('activeTab === "launch" && launches.length > 0'),
);
check("F-14c — Overview and Trust panels still rendered", HUB.includes("<OverviewPanel project={project} />") && HUB.includes("<VerificationSignals"));

// 15 — media failure does not take the project down
check(
  "F-15 — loader tolerates a media RPC failure",
  ROUTE.includes(".catch(() => [])"),
);
check(
  "F-15b — compact retry surfaced without hiding the hub",
  ROUTE.includes("Retry videos") && ROUTE.includes("videosQuery.isError"),
);

console.log(failed === 0 ? "\nALL CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
