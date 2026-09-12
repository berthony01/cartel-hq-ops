/**
 * PP2-V2-1E — rich About + Links activation regression.
 *
 * Static, deterministic assertions over the Profile Studio route, the public
 * Project Hub and the shared network primitives. No network, no Supabase.
 */
import { readFileSync } from "node:fs";

const STUDIO = readFileSync("src/routes/_authenticated/project-profile.tsx", "utf8");
const HUB = readFileSync("src/components/cartel-network/PublicProjectHub.tsx", "utf8");
const PIECES = readFileSync("src/components/cartel-network/NetworkPieces.tsx", "utf8");

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

const RICH = ["tagline", "about_long", "highlights", "docs_url", "github_url"] as const;

// 1 — Form + EMPTY_FORM
const formType = between(STUDIO, "type Form = {", "};");
const emptyForm = between(STUDIO, "const EMPTY_FORM: Form = {", "};");
for (const field of RICH) {
  check(`E-1:${field} — declared on the Form type`, formType.includes(`${field}:`));
  check(`E-1:${field} — initialised in EMPTY_FORM`, emptyForm.includes(`${field}:`));
}
check("E-1b — highlights typed as a string array", formType.includes("highlights: string[]"));
check("E-1c — EMPTY_FORM highlights start empty", emptyForm.includes("highlights: []"));

// 2 — saved profile hydration
const hydrate = between(STUDIO, "if (!profile) return;", "setSlugTouched(true);");
check("E-2 — tagline hydrated null-safe", hydrate.includes('tagline: profile.tagline ?? ""'));
check("E-2 — about_long hydrated null-safe", hydrate.includes('about_long: profile.about_long ?? ""'));
check("E-2 — highlights hydrated null-safe", hydrate.includes("highlights: profile.highlights ?? []"));
check("E-2 — docs_url hydrated null-safe", hydrate.includes('docs_url: profile.docs_url ?? ""'));
check("E-2 — github_url hydrated null-safe", hydrate.includes('github_url: profile.github_url ?? ""'));

// 3 — single save payload carries old + new fields exactly once
check("E-3 — exactly one saveProjectProfile call", count(STUDIO, "saveProjectProfile(") === 1);
const payload = between(STUDIO, "return saveProjectProfile(workspaceId, profile?.id ?? null, {", "});");
for (const field of RICH) {
  check(`E-3:${field} — present exactly once in the save payload`, count(payload, `${field}: form.${field},`) === 1);
}
for (const field of [
  "project_name",
  "public_slug",
  "ticker",
  "primary_chain",
  "description",
  "website_url",
  "telegram_url",
  "x_url",
  "discovery_status",
]) {
  check(`E-3:${field} — prior field preserved in the save payload`, payload.includes(`${field}:`));
}
check("E-3b — no autosave introduced", !/autosave/i.test(STUDIO));

// 4/5 — authoritative limits, no duplicated magic numbers
const imports = between(STUDIO, 'import {', '} from "@/lib/project-profile";');
for (const constant of [
  "TAGLINE_MAX",
  "ABOUT_LONG_MAX",
  "HIGHLIGHT_MAX",
  "HIGHLIGHT_MAX_COUNT",
  "PROFILE_RESOURCE_URL_MAX",
]) {
  check(`E-4:${constant} — imported from the data layer`, imports.includes(constant));
}
check("E-4b — tagline input uses TAGLINE_MAX", /id="tagline"[\s\S]{0,200}maxLength=\{TAGLINE_MAX\}/.test(STUDIO));
check("E-4c — full about uses ABOUT_LONG_MAX", /id="about_long"[\s\S]{0,200}maxLength=\{ABOUT_LONG_MAX\}/.test(STUDIO));
check("E-4d — no duplicated literal limits", !/maxLength=\{(140|6000|120|500)\}/.test(STUDIO));
check(
  "E-5 — highlight rows use HIGHLIGHT_MAX",
  /aria-label=\{`Highlight \$\{index \+ 1\}`\}[\s\S]{0,160}maxLength=\{HIGHLIGHT_MAX\}/.test(STUDIO),
);
check(
  "E-5b — Add highlight disabled at HIGHLIGHT_MAX_COUNT",
  STUDIO.includes("disabled={form.highlights.length >= HIGHLIGHT_MAX_COUNT}"),
);
check("E-5c — explicit remove control exists", /Remove highlight \$\{index \+ 1\}/.test(STUDIO));

// 5d — resource limit applies only to new docs/github, not legacy website/Telegram/X
check(
  "E-5d — website_url input has no PROFILE_RESOURCE_URL_MAX cap",
  !/id="website_url"[\s\S]{0,120}maxLength=\{PROFILE_RESOURCE_URL_MAX\}/.test(STUDIO),
);
check(
  "E-5e — telegram_url input has no PROFILE_RESOURCE_URL_MAX cap",
  !/id="telegram_url"[\s\S]{0,120}maxLength=\{PROFILE_RESOURCE_URL_MAX\}/.test(STUDIO),
);
check(
  "E-5f — x_url input has no PROFILE_RESOURCE_URL_MAX cap",
  !/id="x_url"[\s\S]{0,120}maxLength=\{PROFILE_RESOURCE_URL_MAX\}/.test(STUDIO),
);
check(
  "E-5g — docs_url input uses PROFILE_RESOURCE_URL_MAX",
  /id="docs_url"[\s\S]{0,120}maxLength=\{PROFILE_RESOURCE_URL_MAX\}/.test(STUDIO),
);
check(
  "E-5h — github_url input uses PROFILE_RESOURCE_URL_MAX",
  /id="github_url"[\s\S]{0,120}maxLength=\{PROFILE_RESOURCE_URL_MAX\}/.test(STUDIO),
);

// 6 — media activated in PP2-V2-1F through the shared helpers only
check(
  "E-6 — studio media uses the shared video helpers, never direct table access",
  STUDIO.includes("listProjectProfileVideos") && !/project_profile_videos/.test(STUDIO),
);


// 7 — hero tagline is conditional with no fabricated fallback
check(
  "E-7 — hero renders the real tagline only when present",
  /project\.tagline\?\.trim\(\) \? \([\s\S]{0,400}\{project\.tagline\.trim\(\)\}/.test(HUB) &&
    !/tagline[\s\S]{0,80}\?\?\s*"/.test(HUB),
);

// 8 — about_long first with description fallback, never both
check(
  "E-8 — about body prefers about_long then falls back to description",
  HUB.includes("project.about_long?.trim() || project.description?.trim() || null"),
);
check("E-8b — a single about body is rendered", count(HUB, "{aboutBody}") === 1);
check("E-8c — description is not rendered as a second body", !HUB.includes("{project.description}"));

// 9 — conditional highlights section
check(
  "E-9 — highlights section renders only when real items exist",
  HUB.includes("highlights.length > 0 ? (") && HUB.includes("Project highlights"),
);

// 10/11 — centralized official links
check(
  "E-10 — hub passes docs and github through ExternalLinks",
  /<ExternalLinks[\s\S]{0,320}docs=\{project\.docs_url\}[\s\S]{0,80}github=\{project\.github_url\}/.test(HUB),
);
check("E-10b — exactly one ExternalLinks usage in the hub", count(HUB, "<ExternalLinks") === 1);
const linksProps = between(PIECES, "export function ExternalLinks({", "].filter");
check(
  "E-11 — docs and github props are optional and nullable",
  linksProps.includes("docs?: string | null;") && linksProps.includes("github?: string | null;"),
);
check(
  "E-11b — website/telegram/x callers remain valid",
  linksProps.includes("website?: string | null;") &&
    linksProps.includes("telegram?: string | null;") &&
    linksProps.includes("x?: string | null;"),
);
check(
  "E-11c — existing ProjectCard caller unchanged (no docs/github passed)",
  /<ExternalLinks\s+website=\{project\.website_url\}\s+telegram=\{project\.telegram_url\}\s+x=\{project\.x_url\}\s+\/>/.test(
    PIECES,
  ),
);

// 12/13 — scope boundaries
check("E-12 — no public Media tab yet", !/"media"|Media/.test(HUB));
check(
  "E-13 — no new Supabase RPC, direct table read or service role introduced",
  !/supabase|\.rpc\(|service_role|supabaseAdmin/.test(HUB) &&
    !/\.rpc\(|service_role|supabaseAdmin/.test(PIECES) &&
    !/\.rpc\(|service_role|supabaseAdmin/.test(STUDIO),
);
check(
  "E-13b — platform review reset stays explanatory, with no client-side mutation",
  STUDIO.includes("clears") &&
    count(STUDIO, "useMutation(") === 2 &&
    !/verification_status:\s/.test(STUDIO),
);

console.log(failed === 0 ? "\nALL CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
