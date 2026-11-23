import {sleep} from './engine.mjs';
import {generateLLM} from './model.mjs';
import {composeInBrowser,prepareMedia,mediaSupported} from './browser-media.mjs';

export const CONFIG_FIELDS=['LLM_BASE_URL','LLM_MODEL','LLM_API_KEY','VIDEO_API_URL','VIDEO_API_KEY','TTS_BASE_URL','TTS_MODEL','TTS_VOICE','TTS_API_KEY'];
const SECRET_FIELDS=new Set(['LLM_API_KEY','VIDEO_API_KEY','TTS_API_KEY']);
export const DEFAULT_BROWSER_CONFIG={LLM_BASE_URL:'https://api.openai.com/v1',LLM_MODEL:'',LLM_API_KEY:'',VIDEO_API_URL:'',VIDEO_API_KEY:'',TTS_BASE_URL:'https://api.openai.com/v1',TTS_MODEL:'',TTS_VOICE:'alloy',TTS_API_KEY:''};
export function publicConfig(config){return Object.fromEntries(CONFIG_FIELDS.filter(k=>!SECRET_FIELDS.has(k)).map(k=>[k,String(config[k]||'')]));}
export function endpointURL(value){
  let u;try{u=new URL(value);}catch{throw new Error('请输入完整的 API 地址');}
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw new Error('API 地址需使用 HTTPS，且不能包含账号、密码、查询参数或锚点');
  return u.href.replace(/\/$/,'');
}
export function mediaURL(value){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)throw new Error('视频文件需要使用 HTTPS 地址');return u.href;}
export function validateBrowserConfig(config){
  const clean=Object.fromEntries(CONFIG_FIELDS.map(k=>[k,String(config[k]||'').trim()]));
  for(const key of ['LLM_BASE_URL','VIDEO_API_URL','TTS_BASE_URL'])clean[key]=endpointURL(clean[key]);
  for(const key of ['LLM_MODEL','LLM_API_KEY','TTS_MODEL','TTS_VOICE','TTS_API_KEY'])if(!clean[key])throw new Error(`请填写 ${key}`);
  return clean;
}
export async function browserRequest(url,init={},signal,{binary=false}={}){
  const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(90000)]):AbortSignal.timeout(90000);
  let res;try{res=await fetch(url,{...init,signal:combined,redirect:'error',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});}catch(e){
    if(signal?.aborted)throw e;
    const error=new Error('请求未完成：请检查 API 地址、网络，以及服务是否允许此网页的跨域请求（CORS）');error.retryable=e.name==='TimeoutError';throw error;
  }
  if(!res.ok){const error=new Error(`API 返回 HTTP ${res.status}${res.status===401||res.status===403?'，请检查对应服务的 API Key 与权限':''}`);error.retryable=[408,429,500,502,503,504].includes(res.status);throw error;}
  if(!binary)return res.json();
  const reader=res.body.getReader(),parts=[];let bytes=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>100*1024*1024)throw new Error('单个媒体文件超过 100 MB 限制');parts.push(value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  return new Blob(parts,{type:res.headers.get('content-type')||'application/octet-stream'});
}
export function createBrowserTools(config,{request=browserRequest,compose=composeInBrowser,saveBlob=blob=>URL.createObjectURL(blob),pollMs=3000}={}){
  const env=validateBrowserConfig(config);
  const videoHeaders={'Content-Type':'application/json',...(env.VIDEO_API_KEY?{Authorization:`Bearer ${env.VIDEO_API_KEY}`}:{})};
  return {
    ...Object.fromEntries(['plan','script','review','storyboard'].map(stage=>[stage,ctx=>generateLLM(stage,ctx,env,request)])),
    video:async({run,signal,log,checkpoint})=>{
      const jobs={...run.nodes.video.checkpoint?.jobs},clips=[];
      for(const shot of run.artifacts.storyboard.shots){
        signal.throwIfAborted();let job=jobs[shot.id];
        if(!job){log(`向自定义视频服务提交镜头 ${shot.id}`);job=await request(`${env.VIDEO_API_URL}/jobs`,{method:'POST',headers:{...videoHeaders,'Idempotency-Key':`${run.id}-${shot.id}`},body:JSON.stringify({prompt:shot.prompt,duration:shot.duration,aspect_ratio:run.brief.ratio,reference_image:run.brief.reference||undefined})},signal);if(!job?.id)throw new Error('视频服务没有返回任务 ID，请确认符合项目适配协议');jobs[shot.id]=job;checkpoint({jobs});}
        const start=Date.now();
        while(!['succeeded','failed','cancelled'].includes(job.status)){
          if(Date.now()-start>600000)throw new Error('视频任务超时，任务 ID 已保留，可继续查询');
          await sleep(pollMs,signal);job=await request(`${env.VIDEO_API_URL}/jobs/${encodeURIComponent(job.id)}`,{headers:videoHeaders},signal);jobs[shot.id]=job;checkpoint({jobs});
        }
        if(job.status!=='succeeded'){delete jobs[shot.id];checkpoint({jobs});throw new Error(`镜头 ${shot.id} 生成失败，继续时将重新提交`);}
        const url=mediaURL(job.url);clips.push({shotId:shot.id,url,duration:shot.duration,providerJobId:job.id});log(`镜头 ${shot.id} 已生成`);
      }
      return {clips,summary:`${clips.length} 个 API 生成的视频片段`};
    },
    voice:async({run,signal,log})=>{
      const segments=[];
      for(const shot of run.artifacts.storyboard.shots){
        log(`生成镜头 ${shot.id} 的真实配音`);
        const audio=await request(`${env.TTS_BASE_URL}/audio/speech`,{method:'POST',headers:{Authorization:`Bearer ${env.TTS_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`${run.id}-voice-${shot.id}`},body:JSON.stringify({model:env.TTS_MODEL,voice:env.TTS_VOICE,input:shot.narration,response_format:'mp3'})},signal,{binary:true});
        if(!audio.type.startsWith('audio/'))throw new Error('配音服务未返回音频文件，请确认使用 Speech-compatible 接口');
        segments.push({shotId:shot.id,url:saveBlob(audio),duration:shot.duration});
      }
      return {url:segments[0].url,segments,transcript:run.artifacts.storyboard.shots.map(s=>s.narration).join('。'),summary:'浏览器直连 TTS；音轨仅保存在当前标签页内存'};
    },
    compose:ctx=>compose(ctx,{request,saveBlob})
  };
}
export {prepareMedia,mediaSupported};
