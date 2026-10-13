/**
 * S2: actual published-pack THUMBNAIL COMPONENT browser QA (synthetic only).
 *
 * Extracts the existing component verbatim from the real Pack Manager route.
 * Runs it with the real metadata selector in a transient Vite test fixture.
 * No Supabase credentials, production route, network services, or customer media.
 * This is component/browser integration, not an authenticated whole-app preview.
 */
import { readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const cwd = process.cwd();
const source = readFileSync("src/routes/_authenticated/sticker-lab.$packId.tsx", "utf8");
const begin = source.indexOf("function PackStickerThumbnail(");
const end = source.indexOf("\nfunction PackManagerPage()", begin);
if (begin < 0 || end < begin) throw Error("STOP: original PackStickerThumbnail component could not be located");
const realComponent = source.slice(begin, end);
for (const fragment of ["setUseOriginal(true)", "setUnavailable(true)", 'loading="lazy"', "<ImageOff"]) {
  if (!realComponent.includes(fragment)) throw Error("STOP: gallery behavior drift, no QA fixture");
}
const directory = join(cwd, ".s2-browser-qa-tmp");
mkdirSync(directory, { recursive: true });
const alpha = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const beta = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ident = "11111111-1111-4111-8111-111111111111";
const path = alpha + "/generated_sticker/" + ident + ".png";
const thumbnail = alpha + "/generated_sticker_thumbnails/" + ident + ".webp";
const foreign = beta + "/generated_sticker_thumbnails/" + ident + ".webp";
const fixtureSource = [
  'import React, {useEffect, useState} from "react";',
  'import {createRoot} from "react-dom/client";',
  'import {ImageOff} from "lucide-react";',
  'import {chooseStickerPackImagePaths} from "../src/lib/sticker-thumbnails.ts";',
  realComponent,
  "const originalPath = " + JSON.stringify(path) + ";",
  "const thumbPath = " + JSON.stringify(thumbnail) + ";",
  "const foreignPath = " + JSON.stringify(foreign) + ";",
  'const testCase = new URLSearchParams(window.location.search).get("case") ?? "preferred";',
  'const valid = {thumbnail:{version:1,path:thumbPath,source_path:originalPath,mime_type:"image/webp",width:256,height:256,file_size_bytes:2048}};',
  'const metadata = testCase === "no-metadata" ? null : testCase === "foreign-metadata" ? {thumbnail:{...valid.thumbnail,path:foreignPath}} : valid;',
  'const choice = chooseStickerPackImagePaths(originalPath, metadata);',
  'document.body.dataset.selected = choice.usingThumbnail ? "webp" : "original";',
  'createRoot(document.getElementById("app")!).render(',
  '  <div id="sticker" style={{width:208,height:208,display:"flex",alignItems:"center",justifyContent:"center"}}>',
  '    <PackStickerThumbnail label="Synthetic Test Sticker" preferredUrl={choice.usingThumbnail ? "/mock/thumbnail.webp" : undefined} fallbackUrl="/mock/original.png" />',
  '  </div>',
  ');',
].join("\n");
writeFileSync(join(directory, "index.html"), '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"></div><script type="module" src="/entry.tsx"></script></body></html>');
writeFileSync(join(directory, "entry.tsx"), fixtureSource);
function must(ok, why) { if (!ok) throw Error("S2 BROWSER FAIL: " + why); }
let vite;
let browser;
let count = 0;
try {
  vite = await createServer({
    configFile: false,
    root: directory,
    plugins: [react()],
    server: { host: "127.0.0.1", port: 0, strictPort: false, fs: { allow: [cwd] } },
    optimizeDeps: { include: ["react", "react-dom/client", "lucide-react"] },
  });
  await vite.listen();
  const port = vite.httpServer?.address()?.port;
  must(Number.isInteger(port) && port > 0, "isolated Vite fixture did not bind locally");
  // Playwright is installed only into /tmp by this CI job, never app dependencies.
  const playwrightModule = process.env.S2_PLAYWRIGHT_MODULE || "/tmp/cartel-s2-playwright/node_modules/playwright/index.mjs";
  const { chromium } = await import(pathToFileURL(resolve(playwrightModule)).href);
  browser = await chromium.launch({channel:"chrome",headless:true,args:["--no-sandbox"]});
  for (const width of [390, 1366]) {
    for (const testCase of ["preferred", "no-metadata", "foreign-metadata", "webp-missing", "both-missing"]) {
      const page = await browser.newPage({ viewport:{width,height:844} });
      const external = [];
      const requests = [];
      try {
        // Generate both *actual* PNG and WebP media in memory using browser Canvas.
        // No model calls or file upload. Transparency is preserved.
        const media = await page.evaluate(() => {
          const c = document.createElement("canvas");
          c.width = 64; c.height = 64;
          const ctx = c.getContext("2d");
          if (!ctx) throw Error("Canvas unavailable");
          ctx.clearRect(0,0,64,64);
          ctx.fillStyle = "rgba(12,180,76,0.5)";
          ctx.fillRect(8,8,45,45);
          return {png:c.toDataURL("image/png"),webp:c.toDataURL("image/webp",0.76)};
        });
        must(media.webp.startsWith("data:image/webp;base64,"), "Chromium WebP Canvas codec unavailable");
        const png = Buffer.from(media.png.split(",")[1], "base64");
        const webp = Buffer.from(media.webp.split(",")[1], "base64");
        await page.route("**/mock/**", async route => {
          const url = route.request().url();
          requests.push(url.includes("thumbnail.webp") ? "webp" : "png");
          const isWebp = url.includes("thumbnail.webp");
          if ((isWebp && ["webp-missing", "both-missing"].includes(testCase)) ||
              (!isWebp && testCase==="both-missing")) {
            await route.fulfill({status:404,contentType:"text/plain",body:"synthetic not found"});
          } else {
            await route.fulfill({status:200,contentType:isWebp?"image/webp":"image/png",body:isWebp?webp:png});
          }
        });
        // Catch-all route is installed after mock routes; fallback invokes the
        // earlier synthetic handlers. Any non-loopback request is blocked.
        await page.route("**/*", async route => {
          const url = route.request().url();
          if (!(url.startsWith("http://127.0.0.1:") || url.startsWith("data:") || url.startsWith("about:"))) {
            external.push(url.split("?")[0]);
            await route.abort();
          } else {
            await route.fallback();
          }
        });
        await page.goto("http://127.0.0.1:" + port + "/?case=" + testCase, {waitUntil:"domcontentloaded"});
        const expectsIcon = testCase === "both-missing";
        await page.waitForFunction((icon) => {
          const root = document.getElementById("sticker");
          if (!root) return false;
          if (icon) return !root.querySelector("img") && !!root.querySelector("svg");
          const img = root.querySelector("img");
          return !!img && img.complete && img.naturalWidth > 0;
        }, expectsIcon, {timeout:15000});
        const selected = await page.locator("body").getAttribute("data-selected");
        must(external.length===0, "external request attempted: "+JSON.stringify(external));
        if (testCase==="preferred") {
          must(selected==="webp" && requests.join(",")==="webp", "valid metadata should fetch only WebP");
        } else if (testCase==="no-metadata" || testCase==="foreign-metadata") {
          must(selected==="original" && requests.join(",")==="png", "invalid/missing metadata must fetch original only");
        } else {
          must(selected==="webp" && requests.join(",")==="webp,png", "failed WebP must fetch PNG fallback exactly once");
        }
        count++;
        console.log(JSON.stringify({test:"S2_REAL_COMPONENT_BROWSER",viewport:width,scenario:testCase,result:"PASS",mockRequests:requests}));
      } finally {await page.close();}
    }
  }
  must(count===10, "expected ten synthetic browser scenarios");
  console.log(JSON.stringify({test:"S2_REAL_COMPONENT_BROWSER",passed:count,failed:0,productionAccess:false,supabaseAccess:false,customerAssets:false,realComponentSource:true}));
} finally {
  if (browser) await browser.close();
  if (vite) await vite.close();
  rmSync(directory,{force:true,recursive:true});
}
