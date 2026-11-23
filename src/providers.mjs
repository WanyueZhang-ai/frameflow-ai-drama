import {generateLLM} from '../dist/lib/model.mjs';
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {sleep} from '../dist/lib/engine.mjs';

function required(env,key){if(!env[key])throw new Error(`服务端尚未配置 ${key}`);return env[key];}
function externalURL(value){const u=new URL(value);if(u.protocol!=='https:')throw new Error('媒体地址必须使用 HTTPS');const h=u.hostname.toLowerCase();if(h==='localhost'||h==='::1'||h==='[::1]'||h.endsWith('.local')||h.startsWith('127.')||h.startsWith('10.')||h.startsWith('192.168.')||/^172\.(1[6-9]|2\d|3[01])\./.test(h)||h.startsWith('169.254.')||h==='0.0.0.0')throw new Error('拒绝私有网络媒体地址');return u.href;}
export async function request(url,init,signal,{binary=false}={}) {
  const timeout=AbortSignal.timeout(90000);const combined=signal?AbortSignal.any([signal,timeout]):timeout;
  let res;try{res=await fetch(url,{...init,signal:combined,redirect:'error'});}catch(e){if(signal?.aborted)throw e;const error=new Error('外部工具连接失败或超时');error.retryable=true;throw error;}
  if(!res.ok){const error=new Error(`外部工具返回 HTTP ${res.status}`);error.retryable=[408,429,500,502,503,504].includes(res.status);throw error;}
  if(binary){const parts=[];let bytes=0;for await(const part of res.body){bytes+=part.length;if(bytes>100*1024*1024)throw new Error('单个媒体文件超过 100 MB 限制');parts.push(part);}return Buffer.concat(parts);}
  return res.json();
}
export const llm=(stage,ctx,env)=>generateLLM(stage,ctx,env,request);
export function execFile(command,args,{signal,cwd}={}){return new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd,signal,stdio:['ignore','pipe','pipe']});let output='';child.stderr.on('data',d=>{output=(output+d.toString()).slice(-3000);});child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error(`媒体合成失败 (${code})：${output.slice(-500)}`)));});}
export function createLiveTools({env=process.env,mediaRoot,fetchRequest=request,exec=execFile}={}){
  const dirFor=async run=>{const dir=path.join(mediaRoot,run.id);await mkdir(dir,{recursive:true});return dir;};
  const headers=()=>({'Content-Type':'application/json',...(env.VIDEO_API_KEY?{Authorization:`Bearer ${env.VIDEO_API_KEY}`}:{})});
  async function media(url,dir,file,signal){const dst=path.join(dir,file);if(url.startsWith('/media/')){const rel=url.slice(7);if(rel.includes('..')||rel.includes('\\'))throw new Error('无效媒体路径');const source=path.resolve(mediaRoot,rel);if(!source.startsWith(path.resolve(mediaRoot)+path.sep))throw new Error('无效媒体路径');return source;}await writeFile(dst,await fetchRequest(externalURL(url),{},signal,{binary:true}));return dst;}
  return {
    ...Object.fromEntries(['plan','script','review','storyboard'].map(stage=>[stage,ctx=>llm(stage,ctx,env)])),
    video:async({run,signal,log,checkpoint})=>{
      const base=required(env,'VIDEO_API_URL').replace(/\/$/,'');const jobs={...run.nodes.video.checkpoint?.jobs};const clips=[];
      for(const shot of run.artifacts.storyboard.shots){
        signal.throwIfAborted();let job=jobs[shot.id];
        if(!job){log(`提交镜头 ${shot.id}，附带幂等键`);job=await fetchRequest(`${base}/jobs`,{method:'POST',headers:{...headers(),'Idempotency-Key':`${run.id}-${shot.id}`},body:JSON.stringify({prompt:shot.prompt,duration:shot.duration,aspect_ratio:run.brief.ratio,reference_image:run.brief.reference||undefined})},signal);if(!job.id)throw new Error('视频适配器未返回任务 ID');jobs[shot.id]=job;checkpoint({jobs});}
        const start=Date.now();
        while(!['succeeded','failed','cancelled'].includes(job.status)){
          if(Date.now()-start>Number(env.VIDEO_TIMEOUT_MS||600000))throw new Error('视频任务超时；外部任务 ID 已保留，可继续轮询');
          await sleep(Number(env.VIDEO_POLL_MS||3000),signal);
          job=await fetchRequest(`${base}/jobs/${encodeURIComponent(job.id)}`,{headers:headers()},signal);jobs[shot.id]=job;checkpoint({jobs});
        }
        if(job.status!=='succeeded'){delete jobs[shot.id];checkpoint({jobs});throw new Error(`镜头 ${shot.id} 的视频任务失败；继续执行将重新提交`);}
        clips.push({shotId:shot.id,url:externalURL(job.url),duration:shot.duration,providerJobId:job.id});
        log(`镜头 ${shot.id} 已生成`);
      }
      return {clips,summary:`${clips.length} 个真实视频片段`};
    },
    voice:async({run,signal,log})=>{
      const key=env.TTS_API_KEY||required(env,'LLM_API_KEY'),model=required(env,'TTS_MODEL');
      const transcript=run.artifacts.storyboard.shots.map(s=>s.narration).join('。');
      const dir=await dirFor(run);const segments=[];
      for(const [i,shot] of run.artifacts.storyboard.shots.entries()){
        log(`生成镜头 ${shot.id} 的配音音轨`);
        const audio=await fetchRequest(`${(env.TTS_BASE_URL||env.LLM_BASE_URL||'https://api.openai.com/v1').replace(/\/$/,'')}/audio/speech`,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':`${run.id}-voice-${shot.id}`},body:JSON.stringify({model,voice:env.TTS_VOICE||'alloy',input:shot.narration,response_format:'mp3'})},signal,{binary:true});
        const name=`voice-${i}.mp3`;await writeFile(path.join(dir,name),audio);segments.push({shotId:shot.id,url:`/media/${run.id}/${name}`,duration:shot.duration});
      }
      return {url:segments[0].url,segments,transcript,summary:'镜头级 TTS 配音；按分镜时间轴对齐'};
    },
    compose:async({run,signal,log})=>{
      const ffmpeg=env.FFMPEG_PATH||'ffmpeg';const dir=await dirFor(run),files=[];
      const shots=run.artifacts.storyboard.shots;
      const [width,height]=run.brief.ratio==='9:16'?[720,1280]:[1280,720];
      for(const [i,shot] of shots.entries()){
        const clip=run.artifacts.video.clips.find(c=>c.shotId===shot.id);const voice=run.artifacts.voice.segments?.find(c=>c.shotId===shot.id);if(!clip||!voice)throw new Error('镜头或配音产物缺失');
        log(`对齐镜头 ${shot.id} 的画面与音轨`);
        const videoPath=await media(clip.url,dir,`input-${i}.mp4`,signal);const audioPath=await media(voice.url,dir,`audio-${i}.mp3`,signal);
        const out=`aligned-${i}.mp4`;
        await exec(ffmpeg,['-y','-i',videoPath,'-i',audioPath,'-filter_complex',`[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=24,tpad=stop_mode=clone:stop_duration=${shot.duration}[v];[1:a]apad[a]`,'-map','[v]','-map','[a]','-t',String(shot.duration),'-c:v','libx264','-preset','fast','-pix_fmt','yuv420p','-c:a','aac','-ar','44100','-ac','2',path.join(dir,out)],{signal});
        files.push(`file '${out}'`);
      }
      await writeFile(path.join(dir,'concat.txt'),files.join('\n'));
      await exec(ffmpeg,['-y','-f','concat','-safe','1','-i',path.join(dir,'concat.txt'),'-c','copy','-movflags','+faststart',path.join(dir,'final.mp4')],{signal});
      log('音画合成完成，字幕时间线可在工作台导出');
      return {url:`/media/${run.id}/final.mp4`,format:'MP4 · H.264 / AAC',summary:'逐镜头按时长合成；音轨补静音或截断，字幕单独导出'};
    }
  };
}
