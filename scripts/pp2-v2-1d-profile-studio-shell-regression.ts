/**
 * PP2-V2-1D — Profile Studio shell structural regression.
 *
 * Static, deterministic assertions over the authenticated Project Profile
 * route source. No network, no Supabase, no DB access.
 */
import { readFileSync } from "node:fs";

const SRC = readFileSync("src/routes/_authenticated/project-profile.tsx", "utf8");

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}

const SECTIONS = [
  ["pp-identity", "Identity"],
  ["pp-about", "About"],
  ["pp-links", "Links"],
  ["pp-media", "Media"],
  ["pp-trust", "Trust"],
  ["pp-launch", "Launch"],
  ["pp-visibility", "Visibility"],
] as const;

const count = (needle: string) => SRC.split(needle).length - 1;

// D-1 nav reuses the shared controlled SectionNav primitive
check(
  "D-1 — controlled SectionNav imported from the shared component",
  SRC.includes('from "@/components/cartel/SectionNav"') &&
    /<SectionNav[\s\S]{0,240}activeId=\{activeSection\}[\s\S]{0,120}onChange=\{setActiveSection\}/.test(SRC),
);
check("D-2 — exactly one SectionNav is rendered", count("<SectionNav") === 1);
check("D-3 — studio nav is labelled Project Profile Studio", SRC.includes('label="Project Profile Studio"'));

// D-4 each section id/label declared exactly once in the nav list
for (const [id, label] of SECTIONS) {
  check(
    `D-4:${id} — nav item declared exactly once`,
    count(`{ id: "${id}", label: "${label}" }`) === 1,
  );
}

// D-5 every section is a mounted working view toggled only by visibility
for (const [id] of SECTIONS) {
  check(
    `D-5:${id} — mounted working view controlled by activeSection`,
    SRC.includes(`<WorkingView id="${id}" active={activeSection === "${id}"}>`),
  );
}
check(
  "D-6 — inactive views hidden with markup semantics only (no unmount)",
  /hidden=\{!active\}/.test(SRC) && /aria-hidden=\{active \? undefined : true\}/.test(SRC),
);
check("D-7 — default active section is Identity", SRC.includes('useState<string>("pp-identity")'));

// D-8 field placement
const between = (start: string, end: string) => {
  const a = SRC.indexOf(start);
  const b = SRC.indexOf(end, a);
  return a >= 0 && b > a ? SRC.slice(a, b) : "";
};
const identity = between('<WorkingView id="pp-identity"', '<WorkingView id="pp-about"');
const about = between('<WorkingView id="pp-about"', '<WorkingView id="pp-links"');
const links = between('<WorkingView id="pp-links"', '<WorkingView id="pp-visibility"');
const visibility = between('<WorkingView id="pp-visibility"', "</form>");
const media = between('<WorkingView id="pp-media"', '<WorkingView id="pp-trust"');
const trust = between('<WorkingView id="pp-trust"', '<WorkingView id="pp-launch"');
const launch = between('<WorkingView id="pp-launch"', "</WorkingView>\n          </div>");

check(
  "D-8 — Identity holds name, ticker, chain, slug and logo",
  ['id="project_name"', 'id="ticker"', 'id="primary_chain"', 'id="public_slug"', "<AssetUploader"].every((f) =>
    identity.includes(f),
  ),
);
// D-9/D-10 updated in PP2-V2-1E: rich About + Links fields are now editable.
check(
  "D-9 — About holds description plus the activated rich content fields",
  ['id="description"', 'id="tagline"', 'id="about_long"', 'id={`highlight-${index}`}'].every((f) =>
    about.includes(f),
  ),
);
check(
  "D-10 — Links holds website, Telegram, X, Docs and GitHub",
  ['id="website_url"', 'id="telegram_url"', 'id="x_url"', 'id="docs_url"', 'id="github_url"'].every(
    (f) => links.includes(f),
  ),
);
check("D-11 — Visibility holds discovery status", visibility.includes('id="discovery_status"'));
check(
  "D-12 — Trust holds the existing platform review behaviour",
  trust.includes("Project Authenticated") &&
    trust.includes("Platform Reviewed") &&
    trust.includes("requestVerification.mutate()"),
);
check(
  "D-13 — Media has no CRUD, API or fake controls",
  media.length > 0 &&
    !/supabase|useMutation|useQuery|youtube|Upload|<Input|<Select/i.test(media),
);
check(
  "D-14 — Launch only navigates to Launch Control",
  launch.includes('<Link to="/launch-control">') &&
    !/useQuery|useMutation|supabase|launch_at|launchQuery/i.test(launch),
);

// D-15 save flow invariants
check("D-15 — exactly one editor form remains", count('id="project-profile-form"') === 1);
check(
  "D-16 — one save payload still carries every editable field (rich fields added in V2-1E)",
  /saveProjectProfile\(workspaceId, profile\?\.id \?\? null, \{[\s\S]*?discovery_status: form\.discovery_status,\s*\}\)/.test(
    SRC,
  ) && count("saveProjectProfile(") === 1,
);
check("D-17 — no video CRUD is called from the route", !/ProfileVideo|project_profile_videos/.test(SRC));
check("D-18 — sticky mobile save bar preserved", SRC.includes("<StickyActionBar"));
check("D-19 — network profile preview preserved", SRC.includes("Network profile preview"));
check("D-20 — setup guide preserved", SRC.includes("<LaunchReadinessCallout"));

console.log(failed === 0 ? "\nALL CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
