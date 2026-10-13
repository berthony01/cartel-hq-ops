/**
 * S2 isolated PREVIEW BUILD PREFLIGHT, no hosting and no database operations.
 * GitHub Actions PR runner ONLY; never runs on a workstation or production.
 * Temporarily substitutes the generated client at build time, never commits it.
 * Fails closed on prod ref in compiled output and restores the source in finally.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
const PR_BRANCH="feature/sticker-pack-private-thumbnails-s2-20261013";
const PROD="ocoinbnjgstkmnwwvnhi",STAGE="llicojkxpzwylghptmkf";
const stageURL="https://"+STAGE+".supabase.co";
const key=process.env.S2_STAGING_PUBLISHABLE_KEY||"";
const ok=process.env.GITHUB_ACTIONS==="true" && process.env.GITHUB_EVENT_NAME==="pull_request" &&
 process.env.GITHUB_HEAD_REF===PR_BRANCH && process.env.CI==="true";
if(!ok)throw Error("REFUSED: this checker is CI-only on the authorized draft PR branch");
if(!/^sb_publishable_[a-zA-Z0-9_-]{15,120}$/.test(key))throw Error("REFUSED: valid staging-only PUBLIC key required");
const file=resolve("src/integrations/supabase/client.ts");
const mcpFile=resolve("src/lib/mcp/supabase.ts");
const envFile=resolve(".env");
const networkFile=resolve("src/lib/cartel-network.ts");
const configFile=resolve("supabase/config.toml");
const originals=new Map([[file,readFileSync(file,"utf8")],[mcpFile,readFileSync(mcpFile,"utf8")],[envFile,readFileSync(envFile,"utf8")],[networkFile,readFileSync(networkFile,"utf8")],[configFile,readFileSync(configFile,"utf8")]]);
const before=originals.get(file);
const urlMatch=before.match(/const SUPABASE_URL = "([^"]+)";/);
const keyMatch=before.match(/const SUPABASE_PUBLISHABLE_KEY = "([^"]+)";/);
if(urlMatch?.[1]!=="https://"+PROD+".supabase.co" ||
 !keyMatch?.[1] || !before.includes("storage: brokeredPreviewStorage(),")) {
 throw Error("REFUSED: production generated client changed unexpectedly");
}
const preview=before
 .replace(urlMatch[0],'const SUPABASE_URL = "'+stageURL+'";')
 .replace(keyMatch[0],'const SUPABASE_PUBLISHABLE_KEY = "'+key+'";')
 .replace("storage: brokeredPreviewStorage(),","storage: typeof window === 'undefined' ? undefined : window.sessionStorage,");
if(preview.includes('const SUPABASE_URL = "https://'+PROD))throw Error("REFUSED: production URL remains configured");
function *files(dir){if(!existsSync(dir))return;for(const name of readdirSync(dir)){
 const full=join(dir,name),stat=statSync(full);
 if(stat.isDirectory())yield* files(full);
 else if(/\.(?:js|mjs|cjs|html|json|css|map|txt)$/.test(name)&&stat.size<10_000_000)yield full;
}}
try{
 const oldMcp=originals.get(mcpFile), oldEnv=originals.get(envFile), oldConfig=originals.get(configFile),oldNetwork=originals.get(networkFile);
 if(!oldMcp.includes("https://"+PROD+".supabase.co") ||
    !oldEnv.includes('SUPABASE_PROJECT_ID="'+PROD+'"') ||
    !oldConfig.includes('project_id = "'+PROD+'"') ||
    !oldNetwork.includes('const SUPABASE_URL = "https://'+PROD+'.supabase.co";')) throw Error("REFUSED: backend stage substitution source drift");
 const stagedMcp=oldMcp
   .replace('const SUPABASE_URL = "https://'+PROD+'.supabase.co";','const SUPABASE_URL = "'+stageURL+'";')
   .replace(/(const SUPABASE_PUBLISHABLE_KEY =\s*)"[^"]+";/,'$1"'+key+'";');
 const stagedEnv=oldEnv.replaceAll(PROD,STAGE)
   .replace(/^(VITE_)?SUPABASE_PUBLISHABLE_KEY=.*$/gm,(_line,vite)=>((vite||"")+"SUPABASE_PUBLISHABLE_KEY=\""+key+"\""));
 const stagedConfig=oldConfig.replace('project_id = "'+PROD+'"','project_id = "'+STAGE+'"');
 const stagedNetwork=oldNetwork.replace('const SUPABASE_URL = "https://'+PROD+'.supabase.co";','const SUPABASE_URL = "'+stageURL+'";');
 if(stagedMcp.includes(PROD)||stagedEnv.includes(PROD)||stagedConfig.includes(PROD)||stagedNetwork.includes(PROD)) throw Error("REFUSED: backend ref in generated stage config");
 writeFileSync(file,preview);
 writeFileSync(mcpFile,stagedMcp);
 writeFileSync(envFile,stagedEnv);
 writeFileSync(configFile,stagedConfig);
 writeFileSync(networkFile,stagedNetwork);
 // Fail before a second costly build if any unrewired hardcoded production
 // reference remains in runtime src files. Paths only, no secrets in logs.
 const unresolved=[];
 function visit(dir){
   for(const item of readdirSync(dir)){
     const full=join(dir,item),entry=statSync(full);
     if(entry.isDirectory())visit(full);
     else if(/\.(?:ts|tsx|js|mjs|json)$/.test(item)&&entry.size<2_000_000 &&
             readFileSync(full,"utf8").includes(PROD)) unresolved.push(full);
   }
 }
 visit("src");
 if(unresolved.length)throw Error("REFUSED: staging source still contains production project ref in "+unresolved.join(", "));
 const run=spawnSync("bun",["run","build"],{stdio:"inherit",timeout:600_000,env:{...process.env}});
 if(run.error)throw run.error;
 if(run.status!==0)throw Error("STAGING PREVIEW BUILD failed status "+run.status);
 let stageFound=false,scanned=0,prodLeak=[];
 for(const root of [".output","dist","build"]){
  for(const f of files(root)){
   scanned++;
   const data=readFileSync(f,"utf8");
   if(data.includes(stageURL))stageFound=true;
   if(data.includes(PROD))prodLeak.push(f);
  }
 }
 if(!stageFound)throw Error("REFUSED: compiled app has no expected staging endpoint: cannot confirm preview target");
 if(prodLeak.length)throw Error("REFUSED: production project ref remains in compiled preview output: "+prodLeak.slice(0,20).join(", "));
 console.log(JSON.stringify({test:"S2_STAGING_PREVIEW_BUILD_PREFLIGHT",status:"PASS",stageProject:STAGE,
   originalProductionClientUnmodified:true,compiledFilesScanned:scanned,
   prodProjectStrings:0,disabledLovableSessionBrokerInTemporaryBuild:true,
   stagingDBRequests:0,productionDBRequests:0,hosting:false}));
}finally{
 for(const [originalPath,originalContent] of originals){
   writeFileSync(originalPath,originalContent);
   if(readFileSync(originalPath,"utf8")!==originalContent)throw Error("FAILED to restore temporary staging substitution");
 }
}
