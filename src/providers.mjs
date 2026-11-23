import {writeFile,mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {validateArtifact,sleep} from '../dist/lib/engine.mjs';

const schemas={
  plan:'{"summary":"规划摘要","tasks":["按顺序列出具体创作任务"]}',
  script:'{"title":"片名","logline":"故事梗概","summary":"创作摘要","characters":[{"name":"角色名","description":"年龄、外观、服装与道具的固定设定","voice":"声线描述"}],"scenes":[{"id":"scene-1","location":"内外景/地点/时间","beat":"本场行动与情节","dialogue":[{"speaker":"必须与角色名一致","text":"台词"}]}]}',
  review:'{"passed":true,"findings":["逐条审查意见"],"summary":"审稿摘要"}',
  storyboard:'{"summary":"分镜摘要","shots":[{"id":"shot-1","sceneId":"已存在的场景ID","duration":10,"camera":"景别与运镜","visual":"画面描述","prompt":"包含角色外观、场景、动作、运镜、光线和连续性约束的完整视频生成提示词","narration":"该镜头的旁白或台词，不要附加角色名"}]}'
};
function required(env,key){if(!env[key])throw new Error(`服务端尚未配置 ${key}`);return env[key];}
function externalURL(value){const u=new URL(value);if(u.protocol!=='https:')throw new Error('媒体地址必须使用 HTTPS');const h=u.hostname.toLowerCase();if(h==='localhost'||h==='::1'||h==='[::1]'||h.endsWith('.local')||h.startsWith('127.')||h.startsWith('10.')||h.startsWith('192.168.')||/^172\.(1[6-9]|2\d|3[01])\./.test(h)||h.startsWith('169.254.')||h==='0.0.0.0')throw new Error('拒绝私有网络媒体地址');return u.href;}
export async function request(url,init,signal,{binary=false}={}) {
  const timeout=AbortSignal.timeout(90000);const combined=signal?AbortSignal.any([signal,timeout]):timeout;
  let res;try{res=await fetch(url,{...init,signal:combined,redirect:'error'});}catch(e){if(signal?.aborted)throw e;const error=new Error('外部工具连接失败或超时');error.retryable=true;throw error;}
  if(!res.ok){const error=new Error(`外部工具返回 HTTP ${res.status}`);error.retryable=[408,429,500,502,503,504].includes(res.status);throw error;}
  if(binary){const parts=[];let bytes=0;for await(const part of res.body){bytes+=part.length;if(bytes>100*1024*1024)throw new Error('单个媒体文件超过 100 MB 限制');parts.push(part);}return Buffer.concat(parts);}
  return res.json();
}
export async function llm(stage,ctx,env){
  const {run,signal,log}=ctx;const key=required(env,'LLM_API_KEY'),model=required(env,'LLM_MODEL');
  const system=`你是专业短剧创作团队的${{plan:'制片人',script:'编剧',review:'独立审稿人',storyboard:'分镜导演'}[stage]}。严格遵循创作简报，输出中文，仅返回合法 JSON，不要 Markdown。JSON 结构必须是：${schemas[stage]}。保持角色、服装、道具、地点和事实一致。${stage==='review'?'检查故事逻辑、角色引用、情节连续性。发现严重矛盾时 passed=false；不要为了通过而隐瞒问题。':''}${stage==='storyboard'?`镜头数在 3 到 12 之间，每个镜头 1–30 秒，所有镜头 duration 之和必须等于 ${run.brief.duration} 秒。sceneId 必须引用已有场景。每个镜头必须有 narration，单段中文长度不超过 duration*3 个汉字，以便配音。`:''}`;
  const context={brief:{...run.brief,reference:run.brief.reference?'[附图]':''},memory:run.memory,artifacts:Object.fromEntries(Object.entries(run.artifacts).filter(([k])=>['plan','script','review'].includes(k)))};
  let content=[{type:'text',text:JSON.stringify(context)}];
  if(stage==='storyboard'&&run.brief.reference)content.push({type:'image_url',image_url:{url:run.brief.reference}});
  else content=JSON.stringify(context);
  log(stage==='storyboard'&&run.brief.reference?'调用视觉模型读取参考图与角色记忆':'调用语言模型生成结构化 JSON');
  let correction='';
  for(let i=0;i<2;i++){
    const result=await request(`${(env.LLM_BASE_URL||'https://api.openai.com/v1').replace(/\/$/,'')}/chat/completions`,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model,messages:[{role:'system',content:system+correction},{role:'user',content}],response_format:{type:'json_object'}})},signal);
    try{const text=result.choices?.[0]?.message?.content;if(typeof text!=='string')throw new Error('模型返回空内容');const artifact=validateArtifact(stage,JSON.parse(text));if(stage==='storyboard'){
      const ids=new Set(run.artifacts.script.scenes.map(s=>s.id));if(artifact.shots.some(s=>!ids.has(s.sceneId)))throw new Error('sceneId 无效');
      if(Math.abs(artifact.shots.reduce((sum,s)=>sum+s.duration,0)-Number(run.brief.duration))>1)throw new Error('分镜总时长不等于目标时长');
    }return artifact;}catch(e){if(i)throw new Error(`结构化输出校验失败：${e.message}`);log('结构化输出不满足约束，执行一次定向修复');correction=`\n上一次输出的校验错误是：${e.message}。重新生成完整有效 JSON 并修正此错误。`;}
  }
}
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
