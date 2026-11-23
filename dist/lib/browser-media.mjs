import {sleep} from './engine.mjs';
let audioContext;
export function recordingType(){return ['video/mp4;codecs=avc1.424028,mp4a.40.2','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(type=>globalThis.MediaRecorder?.isTypeSupported(type))||'';}
export function mediaSupported(){return typeof document!=='undefined'&&!!globalThis.AudioContext&&typeof HTMLCanvasElement.prototype.captureStream==='function'&&!!recordingType();}
export async function prepareMedia(){if(!mediaSupported())throw new Error('当前浏览器不支持网页音画合成，请使用新版 Chrome 或本地服务端模式');audioContext??=new AudioContext();if(audioContext.state==='suspended')await audioContext.resume();}
function loaded(video,signal){return new Promise((resolve,reject)=>{
  const cleanup=()=>{video.removeEventListener('loadeddata',done);video.removeEventListener('error',fail);signal.removeEventListener('abort',abort);clearTimeout(timer);};
  const done=()=>{cleanup();resolve();},fail=()=>{cleanup();reject(new Error('浏览器无法解码视频片段，请使用浏览器支持的视频编码'));},abort=()=>{cleanup();reject(signal.reason);};
  const timer=setTimeout(fail,30000);video.addEventListener('loadeddata',done,{once:true});video.addEventListener('error',fail,{once:true});signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();else video.load();
});}
export async function composeInBrowser({run,signal,log},{request,saveBlob}){
  await prepareMedia();signal.throwIfAborted();
  const canvas=document.createElement('canvas');[canvas.width,canvas.height]=run.brief.ratio==='9:16'?[720,1280]:[1280,720];
  const context=canvas.getContext('2d'),destination=audioContext.createMediaStreamDestination(),stream=canvas.captureStream(24);
  for(const track of destination.stream.getAudioTracks())stream.addTrack(track);
  const mimeType=recordingType(),recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:4000000}),chunks=[],temporary=[];
  let video,source,animation=0,recordingError;
  const finished=new Promise(resolve=>{recorder.addEventListener('dataavailable',e=>{if(e.data.size)chunks.push(e.data);});recorder.addEventListener('error',()=>{recordingError=new Error('浏览器录制失败，请重试或使用本地合成');resolve();},{once:true});recorder.addEventListener('stop',resolve,{once:true});});
  try{
    // Download and decode before recording, so network waits do not become blank footage.
    const prepared=[];
    for(const shot of run.artifacts.storyboard.shots){
      const clip=run.artifacts.video.clips.find(c=>c.shotId===shot.id),voice=run.artifacts.voice.segments.find(c=>c.shotId===shot.id);
      if(!clip||!voice)throw new Error('镜头或配音产物缺失');log(`读取镜头 ${shot.id} 的合成素材`);
      const blob=await request(clip.url,{},signal,{binary:true});const url=URL.createObjectURL(blob);temporary.push(url);
      const v=document.createElement('video');v.muted=true;v.playsInline=true;v.preload='auto';v.src=url;
      await loaded(v,signal);
      const audio=await fetch(voice.url,{signal}).then(r=>r.arrayBuffer());const buffer=await audioContext.decodeAudioData(audio);
      prepared.push({shot,video:v,audio:buffer});
    }
    log('正在浏览器内实时合成，请保持此标签页在前台');
    context.fillStyle='#000';context.fillRect(0,0,canvas.width,canvas.height);recorder.start(250);
    for(const item of prepared){
      signal.throwIfAborted();video=item.video;video.currentTime=0;await video.play();
      const draw=()=>{const scale=Math.max(canvas.width/video.videoWidth,canvas.height/video.videoHeight),w=video.videoWidth*scale,h=video.videoHeight*scale;context.drawImage(video,(canvas.width-w)/2,(canvas.height-h)/2,w,h);animation=requestAnimationFrame(draw);};draw();
      source=audioContext.createBufferSource();source.buffer=item.audio;source.connect(destination);source.start();
      log(`合成镜头 ${item.shot.id} · ${item.shot.duration} 秒`);
      await sleep(item.shot.duration*1000,signal);source.stop();source.disconnect();source=null;video.pause();cancelAnimationFrame(animation);
      if(recordingError)throw recordingError;
    }
    recorder.stop();await finished;signal.throwIfAborted();if(recordingError)throw recordingError;
    const blob=new Blob(chunks,{type:mimeType.split(';')[0]});if(!blob.size)throw new Error('没有生成可下载的视频数据');
    return {url:saveBlob(blob),format:blob.type==='video/mp4'?'MP4 · 浏览器合成':'WebM · 浏览器合成',summary:'真实视频与 TTS 配音按分镜时长实时合成；字幕单独导出'};
  }finally{
    cancelAnimationFrame(animation);video?.pause();try{source?.stop();}catch{}source?.disconnect();
    if(recorder.state!=='inactive'){recorder.stop();await finished;}
    for(const track of stream.getTracks())track.stop();destination.disconnect();for(const url of temporary)URL.revokeObjectURL(url);
  }
}
