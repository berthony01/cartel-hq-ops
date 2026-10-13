/** Synthetic-only bounded backfill plan tests; no credential/network/files. */
import {
  planLegacyStickerThumbnailBackfill,
  summarizeStickerBackfillPlan,
  type ExistingStickerAsset,
} from "../src/lib/sticker-s2-backfill-plan";
import { expectedStickerThumbnailPath } from "../src/lib/sticker-thumbnails";

let passed = 0, failed = 0;
function check(name: string, condition: boolean) {
  if (condition) passed++; else { failed++; console.error("FAIL:", name); }
}
function rejects(name: string, execute: () => unknown) {
  try { execute(); check(name, false); } catch { check(name, true); }
}
const workspace = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const fixtures: ExistingStickerAsset[] = Array.from({ length: 12 }, (_, index) => {
  const id = `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`;
  return {
    id, workspace_id: workspace, asset_type: "generated_sticker",
    storage_path: `${workspace}/generated_sticker/${id}.png`,
    mime_type: "image/png", file_size_bytes: 1_200_000 + index,
    metadata: { source: "synthetic" },
  };
});
const options = { workspaceId: workspace, expectedCount: 12, maxCount: 12 };
const copy = () => fixtures.map(x => ({ ...x, metadata: { source: "synthetic" } }));
const p = planLegacyStickerThumbnailBackfill(fixtures, options);
check("exact inventory of 12", p.inventoryCount === 12);
check("all 12 initially require conversion", p.toCreateCount === 12);
check("no existing conversions", p.previouslyCompleted === 0);
check("paths are workspace-scoped", p.planned.every(x => x.targetPath.startsWith(workspace + "/")));
check("paths are derived from originals", p.planned.every(x => x.targetPath === expectedStickerThumbnailPath(x.sourcePath)));
check("aggregate bytes accurate", p.originalTotalBytes === fixtures.reduce((a,x) => a + (x.file_size_bytes ?? 0),0));
check("private paths excluded from summary", !JSON.stringify(summarizeStickerBackfillPlan(p)).includes("storage_path"));
check("asset IDs excluded from summary", !JSON.stringify(summarizeStickerBackfillPlan(p)).includes("11111111-"));
const complete = copy();
complete[0].metadata = {
  thumbnail: { version: 1, path: expectedStickerThumbnailPath(complete[0].storage_path),
    source_path: complete[0].storage_path, mime_type: "image/webp",
    width: 256, height: 256, file_size_bytes: 15_000 },
};
const p2 = planLegacyStickerThumbnailBackfill(complete, options);
check("partial rerun skips verified existing", p2.previouslyCompleted === 1 && p2.toCreateCount === 11);
check("planned excludes already converted asset", !p2.planned.some(x => x.assetId === complete[0].id));
rejects("wrong workspace scope", () => planLegacyStickerThumbnailBackfill(fixtures,{...options,workspaceId:other}));
rejects("missing entry fails closed", () => planLegacyStickerThumbnailBackfill(fixtures.slice(1),options));
rejects("duplicate entry fails closed", () => planLegacyStickerThumbnailBackfill([...fixtures.slice(0,11), fixtures[0]],options));
rejects("duplicate path fails closed", () => { const x=copy();x[1].storage_path=x[0].storage_path;return planLegacyStickerThumbnailBackfill(x,options);});
rejects("foreign asset row fails closed", () => { const x=copy();x[0].workspace_id=other;return planLegacyStickerThumbnailBackfill(x,options);});
rejects("wrong media type fails closed", () => { const x=copy();x[0].asset_type="reference_image";return planLegacyStickerThumbnailBackfill(x,options);});
rejects("wrong mime fails closed", () => { const x=copy();x[0].mime_type="image/jpeg";return planLegacyStickerThumbnailBackfill(x,options);});
rejects("zero byte original rejected", () => { const x=copy();x[0].file_size_bytes=0;return planLegacyStickerThumbnailBackfill(x,options);});
rejects("too large original rejected", () => { const x=copy();x[0].file_size_bytes=26_000_000;return planLegacyStickerThumbnailBackfill(x,options);});
rejects("wrong root folder rejected", () => { const x=copy();x[0].storage_path=`${workspace}/reference/z.png`;return planLegacyStickerThumbnailBackfill(x,options);});
rejects("invalid thumb pointer not overwritten", () => {
  const x=copy();x[0].metadata={thumbnail:{path:`${other}/generated_sticker_thumbnails/evil.webp`}};
  return planLegacyStickerThumbnailBackfill(x,options);
});
rejects("no maxCount above 12", () => planLegacyStickerThumbnailBackfill(fixtures,{...options,maxCount:13}));
rejects("no target count zero", () => planLegacyStickerThumbnailBackfill(fixtures,{...options,expectedCount:0}));
rejects("no target count above max", () => planLegacyStickerThumbnailBackfill(fixtures,{...options,expectedCount:13}));
rejects("invalid workspace UUID", () => planLegacyStickerThumbnailBackfill(fixtures,{...options,workspaceId:"../../etc"}));
check("planner does not modify caller records", fixtures[0].metadata !== complete[0].metadata && (fixtures[0].metadata as Record<string,unknown>)["source"] === "synthetic");
console.log(`S2 legacy backfill planner: ${passed} PASS, ${failed} FAIL (synthetic only, NO actual Storage/DB writes)`);
if (failed) process.exitCode = 1;
