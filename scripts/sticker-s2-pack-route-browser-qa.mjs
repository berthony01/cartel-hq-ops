/**
 * Real Sticker Lab PackManagerPage route Chromium QA, synthetic dependencies.
 * Uses the ACTUAL full published-pack route source, not a rewritten route.
 * Network is blocked except ephemeral 127.0.0.1. No Supabase, production data,
 * customer images, API tokens, Telegram actions, or application deployment.
 * This verifies a route with synthetic data, NOT the whole authenticated app.
 */
import {readFileSync,writeFileSync,mkdirSync,rmSync} from "node:fs";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {createServer} from "vite";
import react from "@vitejs/plugin-react";
const cwd=process.cwd(),folder=join(cwd,".s2-pack-route-qa-tmp");
const source=readFileSync("src/routes/_authenticated/sticker-lab.$packId.tsx","utf8");
const at=source.indexOf('export const Route = createFileRoute("/_authenticated/sticker-lab/$packId")');
if(at<0||!source.includes("function PackManagerPage()")||!source.includes('signedUrlMap(paths, 300)'))throw Error("STOP: route source drift");
const prelude=[
'import React,{useState,useEffect,useMemo} from "react";',
'import {createRoot} from "react-dom/client";',
'import {QueryClient,QueryClientProvider,useQuery} from "@tanstack/react-query";',
'import {Archive,ExternalLink,ImageOff,Pencil,Send} from "lucide-react";',
'import {chooseStickerPackImagePaths} from "../src/lib/sticker-thumbnails.ts";',
'const ws1="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",ws2="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";',
'const params=new URLSearchParams(location.search),scenario=params.get("scenario")||"webp",workspace=params.get("workspace")==="foreign"?ws2:ws1;',
'const packId="synthetic-pack", logs={signed:[],ttls:[],writes:0};window.__S2_ROUTE=logs;',
'const originals=Array.from({length:12},(_,i)=>ws1+"/generated_sticker/sticker-"+String(i+1).padStart(2,"0")+".png");',
'const thumbs=originals.map(p=>p.replace("/generated_sticker/","/generated_sticker_thumbnails/").replace(".png",".webp"));',
'const stickers=originals.map((_,i)=>({id:"sticker"+i,image_asset_id:"asset"+i,label:"Sticker "+(i+1),status:"ready"}));',
'const pack={id:packId,workspace_id:ws1,title:"Synthetic Test Pack",theme:"Synthetic",pack_size:12,status:"published",archived_at:null};',
'const assets=Object.fromEntries(stickers.map((s,i)=>{const p=originals[i],t=thumbs[i];let metadata={thumbnail:{version:1,path:t,source_path:p,mime_type:"image/webp",width:256,height:256,file_size_bytes:2048}};',
'if(scenario==="no-metadata")metadata=null;',
'if(scenario==="foreign-metadata")metadata={thumbnail:{...metadata.thumbnail,path:t.replace(ws1,ws2)}};',
'return [s.image_asset_id,{id:s.image_asset_id,storage_path:p,metadata,width:1024,height:1024}];}));',
'const createFileRoute=()=>config=>({useParams:()=>({packId})});',
'const Link=({to,search,children,...rest})=><a href={to||"#"} {...rest}>{children}</a>;',
'const useNavigate=()=>()=>{logs.writes++;throw Error("Navigation prohibited in QA")};',
'const useWorkspace=()=>({workspaceId:workspace});',
'const PageHeader=({eyebrow,title,description,status,actions})=><header><p>{eyebrow}</p><h1>{title}</h1><p>{description}</p><p>{status}</p>{actions}</header>;',
'const Section=({title,description,children,actions})=><section><h2>{title}</h2><p>{description}</p>{actions}{children}</section>;',
'const StatusBadge=({children})=><span>{children}</span>;',
'const EmptyState=({title,description,action})=><div><h3>{title}</h3><p>{description}</p>{action}</div>;',
'const Button=({asChild,children,...props})=>asChild?<>{children}</>:<button type="button" {...props}>{children}</button>;',
'const PackLifecycleMenu=()=> <span>Pack options (QA inactive)</span>;',
'const loadPack=async()=>pack,loadPackStickers=async()=>stickers,loadPackTelegramState=async()=>({pack:{telegram_set_url:null},stickers:{}});',
'const loadAssets=async ids=>Object.fromEntries(ids.map(id=>[id,assets[id]]));',
'const countStickerVersions=async()=>12,fetchPackGroupDistribution=async()=>({targets:[]}),fetchDropStatus=async()=>({control:{kill_switch:false},schedules:[]});',
'const scheduleState=()=>"inactive",SCHEDULE_STATE_LABEL={inactive:"Inactive"};',
'const signedUrlMap=async(paths,ttl)=>{logs.signed.push([...paths]);logs.ttls.push(ttl);return Object.fromEntries(paths.map(p=>[p,p.endsWith(".webp")?"/mock/webp/"+p.split("/").pop():"/mock/png/"+p.split("/").pop()]));};'
].join("\n");
const footer=[
'const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});',
'createRoot(document.getElementById("app")).render(<QueryClientProvider client={client}><PackManagerPage/></QueryClientProvider>);'
].join("\n");
mkdirSync(folder,{recursive:true});
writeFileSync(join(folder,"entry.tsx"),prelude+"\n"+source.slice(at)+"\n"+footer);
writeFileSync(join(folder,"index.html"),'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"></div><script type="module" src="/entry.tsx"></script></body></html>');
const check=(pass,why)=>{if(!pass)throw Error("S2 ROUTE FAIL: "+why);};
let server,browser,passed=0;
try{
server=await createServer({configFile:false,root:folder,plugins:[react()],server:{host:"127.0.0.1",port:0,fs:{allow:[cwd]}},optimizeDeps:{include:["react","react-dom/client","@tanstack/react-query","lucide-react"]}});
await server.listen();
const port=server.httpServer?.address()?.port;
check(Number.isInteger(port)&&port>0,"local browser QA server failed");
const driver=process.env.S2_PLAYWRIGHT_MODULE||"/tmp/cartel-s2-playwright/node_modules/playwright/index.mjs";
const {chromium}=await import(pathToFileURL(resolve(driver)).href);
browser=await chromium.launch({channel:"chrome",headless:true,args:["--no-sandbox"]});
for(const width of [390,1366]){
for(const scenario of ["webp","no-metadata","foreign-metadata","webp-one-missing","both-one-missing","foreign-workspace"]){
const page=await browser.newPage({viewport:{width,height:800}});
const requests=[],external=[],errors=[];
const mime=await page.evaluate(()=>{const c=document.createElement("canvas");c.width=64;c.height=64;const ctx=c.getContext("2d");ctx.fillStyle="rgba(0,150,70,0.5)";ctx.fillRect(8,8,48,48);return {png:c.toDataURL("image/png"),webp:c.toDataURL("image/webp",0.76)};});
check(mime.webp.startsWith("data:image/webp;base64,"),"Chrome WebP encoder unavailable");
const png=Buffer.from(mime.png.split(",")[1],"base64"),webp=Buffer.from(mime.webp.split(",")[1],"base64");
try{
page.on("pageerror",e=>errors.push(e.message));
await page.route("**/mock/**",async route=>{
const url=route.request().url(),isWebp=url.includes("/mock/webp/"),name=url.split("/").pop();
const bad=(name==="sticker-03.webp"&&(scenario==="webp-one-missing"||scenario==="both-one-missing"))||(name==="sticker-03.png"&&scenario==="both-one-missing");
requests.push((isWebp?"webp":"png")+":"+name);
await route.fulfill(bad?{status:404,contentType:"text/plain",body:"synthetic missing"}:{status:200,contentType:isWebp?"image/webp":"image/png",body:isWebp?webp:png});
});
await page.route("**/*",async route=>{
const url=route.request().url();
if(!(url.startsWith("http://127.0.0.1:")||url.startsWith("about:")||url.startsWith("data:"))){external.push(url.split("?")[0]);await route.abort();}
else await route.fallback();
});
const q=scenario==="foreign-workspace"?"?workspace=foreign":"?scenario="+scenario;
await page.goto("http://127.0.0.1:"+port+"/"+q,{waitUntil:"domcontentloaded"});
if(scenario==="foreign-workspace"){
await page.getByText("This pack is not available").waitFor({timeout:20000});
const state=await page.evaluate(()=>window.__S2_ROUTE);
check(state.signed.length===0&&requests.length===0,"foreign workspace must never sign or GET media");
check(await page.locator("img").count()===0,"foreign workspace image leakage");
}else{
await page.getByText("12 total").waitFor({timeout:20000});
await page.locator("img").first().waitFor({timeout:20000});
const initialRendered=await page.locator("img").count();
check(scenario==="both-one-missing" ? (initialRendered===11||initialRendered===12) : initialRendered===12,"real route must render twelve cards, allowing the failed-image placeholder to replace one");
for(let i=0;i<12;i++){
const img=page.locator("img").nth(i<3||scenario!=="both-one-missing"?i:i-1);
await img.scrollIntoViewIfNeeded();
const missing=scenario==="both-one-missing"&&i===2;
if(missing)await page.waitForFunction(()=>!document.querySelector('img[alt="Sticker 3"]'),null,{timeout:12000});
else await page.waitForFunction(n=>{const el=document.querySelector('img[alt="Sticker '+n+'"]');return el&&el.complete&&el.naturalWidth>0;},i+1,{timeout:12000});
}
const state=await page.evaluate(()=>window.__S2_ROUTE);
check(state.signed.length===1&&state.ttls.length===1&&state.ttls[0]===300,"URL signing batch / 300s TTL");
const full=["webp","webp-one-missing","both-one-missing"].includes(scenario);
check(state.signed[0].length===(full?24:12),"safe private path signing count");
check(state.writes===0,"mutation detected");
const webps=requests.filter(x=>x.startsWith("webp:")),pngs=requests.filter(x=>x.startsWith("png:"));
if(scenario==="webp")check(webps.length===12&&pngs.length===0,"valid thumbnails must eliminate PNG downloads");
if(["no-metadata","foreign-metadata"].includes(scenario))check(webps.length===0&&pngs.length===12,"missing or foreign metadata must use originals");
if(["webp-one-missing","both-one-missing"].includes(scenario))check(webps.length===12&&pngs.length===1&&pngs[0]==="png:sticker-03.png","one failed WebP should request only its PNG");
if(scenario==="both-one-missing")check(await page.locator("img").count()===11,"dual failure must render icon rather than broken image");
}
check(errors.length===0,"runtime errors "+JSON.stringify(errors));
check(external.length===0,"external request attempted "+JSON.stringify(external));
passed++;
console.log(JSON.stringify({test:"S2_REAL_PACK_ROUTE",width,scenario,status:"PASS",mediaGets:requests.length}));
}finally{await page.close();}
}
}
check(passed===12,"expected twelve full-route scenarios");
console.log(JSON.stringify({test:"S2_REAL_PACK_ROUTE",passed,failed:0,exactPackRouteSource:true,syntheticDependencies:true,authenticatedFullApp:false,productionAccess:false}));
}finally{if(browser)await browser.close();if(server)await server.close();rmSync(folder,{force:true,recursive:true});}
