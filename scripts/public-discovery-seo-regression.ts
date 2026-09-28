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

const economics = ["20%", "First 12 paid monthly invoices", "30 days", "45 days", "$50 USD", "Monthly, manual"];
check("D-07 exact draft economics are present", economics.every((value) => partner.includes(value)));
check("D-08 draft economics remain inactive", partner.includes("Draft economics, not active") && partner.includes("No one earns or is owed commission"));
check("D-09 applications are not represented as open", partner.includes("Applications are not open") && !/applications are open[.!]/i.test(partner));
check("D-10 Affiliate and Service Partner rules are distinct", partner.includes("Affiliate") && partner.includes("Service Partner status alone grants zero client workspace access") && partner.includes("separately approved as an Affiliate"));
check("D-11 commission exclusions are complete", ["Taxes", "discounts", "credits", "refunds", "disputes", "setup or service fees", "high-cost usage purchases"].every((value) => partner.includes(value)));
check("D-12 public routes contain no Supabase access", !/supabase|useQuery|createServerFn/i.test(partner + docs));

check("D-13 homepage links to both public resources", home.includes('to="/docs"') && home.includes('to="/partner-program"'));
check("D-14 footer links to documentation, program, and network", footer.includes('to: "/docs"') && footer.includes('to: "/partner-program"') && footer.includes('to: "/network"') && !footer.includes('aria-label="Legal"'));
check("D-15 authenticated navigation includes public documentation", nav.includes('{ label: "Documentation", to: "/docs"') && nav.includes('label: "Partners", to: "/partners"'));
check("D-16 billing links truthfully to preparing program", billing.includes("The Partner Program is preparing to open") && billing.includes('to="/partner-program"'));
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
  "roadmap.md",
  "src/routeTree.gen.ts",
]);
const changed = execFileSync("git", ["diff", "--name-only", "529681aa1d073b70946f7b5934bf9b1fcc2b6be7...HEAD"], { encoding: "utf8" })
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