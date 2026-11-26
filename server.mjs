import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {Engine,createRun,validateArtifact,AGENTS} from './dist/lib/engine.mjs';
import {createLiveTools} from './src/providers.mjs';
import {importMemory,compileStoryboard} from './dist/lib/memory.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
try{process.loadEnvFile(path.join(root,'.env'));}catch(e){if(e.code!=='ENOENT')throw e;}
const port=Number(process.env.PORT||8787),host=process.env.HOST||'127.0.0.1';
const dataDir=path.join(root,'data'),mediaRoot=path.join(dataDir,'media'),runsRoot=path.join(dataDir,'runs');
fs.mkdirSync(mediaRoot,{recursive:true});fs.mkdirSync(runsRoot,{recursive:true});
const engines=new Map(),runs=new Map();
function persist(run){const file=path.join(runsRoot,`${run.id}.json`);fs.writeFileSync(`${file}.tmp`,JSON.stringify(run));fs.renameSync(`${file}.tmp`,file);runs.set(run.id,run);}
for(const file of fs.readdirSync(runsRoot).filter(f=>f.endsWith('.json'))){try{const run=JSON.parse(fs.readFileSync(path.join(runsRoot,file),'utf8'));if(run.status==='running'){run.status='cancelled';for(const n of Object.values(run.nodes))if(n.status==='running')n.status='pending';}runs.set(run.id,run);}catch{console.warn('忽略损坏的运行记录');}}
const ffmpeg=spawnSync(process.env.FFMPEG_PATH||'ffmpeg',['-version'],{stdio:'ignore'}).status===0;
const allowed=new Set([`http://127.0.0.1:${port}`,`http://localhost:${port}`,...(process.env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean)]);
function json(res,code,value){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
async function body(req){let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4*1024*1024)throw new Error('请求内容超过 4 MB');}return JSON.parse(raw||'{}');}
function validateRun(input){
  const b=input?.brief;if(!b||typeof b.idea!=='string'||!b.idea.trim()||b.idea.length>4000||typeof b.title!=='string'||!b.title.trim()||b.title.length>30||![30,60,90].includes(Number(b.duration))||!['16:9','9:16'].includes(b.ratio))throw new Error('创作简报无效');
  if(b.reference&&(!/^data:image\/(png|jpeg|webp);base64,/.test(b.reference)||b.reference.length>2.8*1024*1024))throw new Error('参考图格式无效或超过大小限制');
  const run=createRun({...b,duration:Number(b.duration)},'live');
  // Only import validated completed stages whose dependencies have also completed.
  for(const a of AGENTS){if(input.nodes?.[a.id]?.status==='completed'&&a.deps.every(d=>run.nodes[d].status==='completed')){validateArtifact(a.id,input.artifacts?.[a.id]);if(['video','voice','compose'].includes(a.id))continue;run.artifacts[a.id]=input.artifacts[a.id];run.nodes[a.id]={status:'completed',attempts:0};}}
  importMemory(run,input.memory);
  if(run.artifacts.storyboard){const scenes=new Set(run.artifacts.script.scenes.map(s=>s.id));if(run.artifacts.storyboard.shots.some(s=>!scenes.has(s.sceneId))||Math.abs(run.artifacts.storyboard.shots.reduce((n,s)=>n+s.duration,0)-run.brief.duration)>1)throw new Error('导入分镜的场景引用或时长无效');}
  if(run.artifacts.review&&!run.artifacts.review.passed)throw new Error('审稿尚未通过');
  if(run.artifacts.storyboard)run.artifacts.storyboard=compileStoryboard(run,run.artifacts.storyboard);
  return run;
}
const mime={'.html':'text/html; charset=utf-8','.css':'text/css','.mjs':'text/javascript','.js':'text/javascript','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.mp4':'video/mp4','.mp3':'audio/mpeg','.srt':'text/plain'};
function serve(req,res,file){if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end('Not found');return;}const stat=fs.statSync(file);const headers={'Content-Type':mime[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes','Cache-Control':file.includes('/media/')?'private, max-age=3600':'no-cache'};const range=req.headers.range;
  if(range){const match=/^bytes=(\d+)-(\d*)$/.exec(range);if(!match){res.writeHead(416);return res.end();}const start=Number(match[1]),end=match[2]?Math.min(Number(match[2]),stat.size-1):stat.size-1;if(start>end||start>=stat.size){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});return res.end();}res.writeHead(206,{...headers,'Content-Range':`bytes ${start}-${end}/${stat.size}`,'Content-Length':end-start+1});fs.createReadStream(file,{start,end}).pipe(res);}else{res.writeHead(200,{...headers,'Content-Length':stat.size});fs.createReadStream(file).pipe(res);}}
const server=http.createServer(async(req,res)=>{
  const origin=req.headers.origin;if(origin&&!allowed.has(origin))return json(res,403,{error:'该访问来源未获服务端允许'});
  if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');}
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  try{
    const url=new URL(req.url,`http://${req.headers.host}`),p=url.pathname;
    if(p==='/api/health')return json(res,200,{ok:true,llm:!!(process.env.LLM_API_KEY&&process.env.LLM_MODEL),tts:!!((process.env.TTS_API_KEY||process.env.LLM_API_KEY)&&process.env.TTS_MODEL),video:!!process.env.VIDEO_API_URL,compose:ffmpeg});
    if(p==='/api/runs'&&req.method==='POST'){const input=await body(req);const run=validateRun(input.run);persist(run);return json(res,201,{id:run.id});}
    const match=/^\/api\/runs\/([a-zA-Z0-9-]+)(?:\/(start|stop))?$/.exec(p);
    if(match){const [,id,action]=match;const run=runs.get(id);if(!run)return json(res,404,{error:'运行记录不存在'});
      if(!action&&req.method==='GET')return json(res,200,run);
      if(action==='stop'&&req.method==='POST'){engines.get(id)?.stop();return json(res,200,{ok:true});}
      if(action==='start'&&req.method==='POST'){
        const input=await body(req);if(engines.get(id)?.busy)return json(res,200,{ok:true,status:'running'});
        if(run.status==='completed')return json(res,200,{ok:true,status:'completed'});
        if(!process.env.LLM_API_KEY||!process.env.LLM_MODEL||!process.env.TTS_MODEL||!process.env.VIDEO_API_URL||!ffmpeg)return json(res,400,{error:'真实模式需要完整的 LLM、TTS、视频接口和 FFmpeg 配置，请检查 .env 与连接状态'});
        const engine=new Engine(run,createLiveTools({mediaRoot}),persist);engines.set(id,engine);
        engine.start({approve:input.approve===true}).catch(e=>console.error('工作流失败：',e.message));
        return json(res,202,{ok:true,status:'running'});
      }
    }
    if(p.startsWith('/api/'))return json(res,404,{error:'接口不存在'});
    if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'不支持该方法'});
    const base=p.startsWith('/media/')?mediaRoot:path.join(root,'dist');
    const rel=decodeURIComponent(p.startsWith('/media/')?p.slice(7):p==='/'?'index.html':p.slice(1));
    const file=path.resolve(base,rel);if(!file.startsWith(path.resolve(base)+path.sep))return json(res,403,{error:'无效路径'});
    serve(req,res,file);
  }catch(e){if(!res.headersSent)json(res,400,{error:e.message});else res.end();}
});
server.listen(port,host,()=>console.log(`FrameFlow Studio ready at http://${host}:${port}\n演示无需密钥。真实模式配置见 .env.example。`));
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{for(const e of engines.values())e.stop();server.close(()=>process.exit(0));});
