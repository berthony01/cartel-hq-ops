import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

let passed = 0;
let failed = 0;

function read(path: string) {
  return readFileSync(path, "utf8");
}

function check(name: string, condition: boolean) {
  if (condition) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${name}`);
  }
}

const partner = read("src/routes/partner-program.tsx");
const docs = read("src/routes/docs.tsx");
const home = read("src/routes/index.tsx");
const billing = read("src/components/cartel/BillingSection.tsx");
const footer = read("src/components/cartel/LegalFooter.tsx");
const nav = read("src/lib/nav.ts");
const root = read("src/routes/__root.tsx");
const sitemap = read("public/sitemap.xml");
const robots = read("public/robots.txt");

check("D-01 public Partner Program route exists", partner.includes('createFileRoute("/partner-program")'));
check("D-02 public documentation route exists", docs.includes('createFileRoute("/docs")'));
check("D-03 Partner Program has unique canonical and social metadata", partner.includes('https://pepecartelhq.com/partner-program') && partner.includes('property: "og:title"') && partner.includes('name: "twitter:title"'));
check("D-04 documentation has unique canonical and social metadata", docs.includes('https://pepecartelhq.com/docs') && docs.includes('property: "og:title"') && docs.includes('name: "twitter:title"'));
check("D-05 homepage has self-referencing canonical", home.includes('rel: "canonical", href: "https://pepecartelhq.com/"'));
check("D-06 root fallback describes CARTEL HQ and names the site", root.includes('property: "og:site_name", content: "CARTEL HQ"') && root.includes("launch command center"));

// Service Partner-only launch: affiliate economics must NOT be presented as active.
check("D-07 no affiliate economics on public page", !/20%|First 12 paid|45 days|\$50/.test(partner));
check("D-08 no-earnings, no-fee, no-purchase facts", partner.includes("No fee to apply") && partner.includes("No CARTEL HQ purchase is required") && partner.includes("Results and earnings are not guaranteed"));
check("D-09 status is database-backed and fails closed", partner.includes("fetchPartnerProgramStatus") && partner.includes("Applications not open yet"));
check("D-10 Affiliate card not open, service rules distinct", partner.includes("Not open · planned later") && partner.includes("Service Partner status alone grants no access to any client account or workspace"));
check("D-11 no earnings hype", !/make \$|replace your income|guaranteed side hustle|easy money/i.test(partner));
check("D-12 public routes use only the read-only status helper", !/supabase|createServerFn/i.test(partner + docs) && !/useQuery/.test(docs));

check("D-13 homepage links to both public resources", home.includes('to="/docs"') && home.includes('to="/partner-program"'));
check("D-14 footer links to documentation, program, and network", footer.includes('to: "/docs"') && footer.includes('to: "/partner-program"') && footer.includes('to: "/network"') && !footer.includes('aria-label="Legal"'));
check("D-15 authenticated navigation includes public documentation", nav.includes('{ label: "Documentation", to: "/docs"') && nav.includes('label: "Partners", to: "/partners"'));
check("D-16 billing links truthfully to Service Partner Program", billing.includes("through the Service Partner Program") && billing.includes('to="/partner-program"'));
check("D-17 X reads removed from public pricing and billing", !/X reads/i.test(home) && !/X reads/i.test(billing));
check("D-18 shipped Pro limits remain exact", [home, billing, docs].every((source) => source.includes("100 static AI stickers") && source.includes("10 motion AI stickers") && source.includes("100 X Missions")));
check("D-19 documentation marks restricted work unavailable", docs.includes("not available public product features") && docs.includes("not documented here as live"));
check("D-20 documentation states verification limits", docs.includes("not audits, safety guarantees, or endorsements"));

const sitemapUrls = ["/", "/docs", "/partner-program", "/network", "/network/projects", "/network/launches", "/network/signals", "/legal/terms", "/legal/privacy", "/legal/refunds", "/legal/partner-agreement"];
check("D-21 sitemap contains exactly the approved stable URLs", sitemapUrls.every((path) => sitemap.includes(`<loc>https://pepecartelhq.com${path}</loc>`)) && (sitemap.match(/<url>/g) ?? []).length === sitemapUrls.length);
check("D-22 robots advertises the public sitemap", robots.includes("Sitemap: https://pepecartelhq.com/sitemap.xml"));
check("D-23 public discovery uses crawlable links", !/onClick=.*(docs|partner-program)/s.test(home + footer + nav) && (home + footer + nav).includes('to="/docs"'));

const allowed = new Set([
  "src/routes/index.tsx",
  "src/routes/partner-program.tsx",
  "src/routes/docs.tsx",
  "src/routes/__root.tsx",
  "src/components/cartel/BillingSection.tsx",
  "src/components/cartel/LegalFooter.tsx",
  "src/lib/nav.ts",
  "public/robots.txt",
  "public/sitemap.xml",
  "scripts/public-discovery-seo-regression.ts",
  "scripts/partner-program-1a-regression.ts",
  "scripts/partner-program-1b-1-regression.ts",
  "roadmap.md",
  "src/routeTree.gen.ts",
  // Service Partner-only launch staging (approved follow-up scope)
  "docs/sql/SERVICE_PARTNER_track_separation.sql",
  "docs/SERVICE_PARTNER_PROGRAM_LAUNCH_RUNBOOK.md",
  "scripts/service-partner-track-regression.ts",
  "scripts/partner-program-1b-4-regression.ts",
  "src/components/cartel/PartnerAdminSection.tsx",
  "src/lib/legal-policies.ts",
  "src/lib/partners.ts",
  "src/routes/_authenticated/partners.tsx",
  "src/routes/legal.partner-agreement.tsx",
]);
// Discovery task scope (529681aa..98bb3b44) plus the Service Partner staging scope (049aae3b..HEAD).
// Intervening separately-approved tasks (MCP, favicon) are outside this check.
const gitNames = (range: string) => execFileSync("git", ["diff", "--name-only", range], { encoding: "utf8" });
const changed = (gitNames("529681aa1d073b70946f7b5934bf9b1fcc2b6be7...98bb3b44daf7e0d9588a909158096c62ec179d66") + "\n" + gitNames("049aae3b398bfe9cf49e9834a9c2706fadbd3c51"))
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);
const working = execFileSync("git", ["status", "--short"], { encoding: "utf8" })
  .split("\n")
  .map((line) => line.slice(3).trim())
  .filter(Boolean);
check("D-24 only approved files changed", [...new Set([...changed, ...working])].every((path) => allowed.has(path)));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);