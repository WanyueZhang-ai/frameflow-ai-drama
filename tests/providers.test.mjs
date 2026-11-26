import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {createLiveTools,request,llm} from '../src/providers.mjs';
import {createRun} from '../dist/lib/engine.mjs';
import {DEFAULT_BRIEF,completedDemo} from '../dist/lib/demo.mjs';
import {requestFingerprint,videoInput} from '../dist/lib/memory.mjs';

const context=run=>({run,signal:new AbortController().signal,log:()=>{},checkpoint:()=>{}});
test('video protocol preserves idempotency and resumes persisted jobs without resubmission',async()=>{
  const run=createRun(DEFAULT_BRIEF,'live');run.artifacts.storyboard={shots:completedDemo().artifacts.storyboard.shots.slice(0,1)};
  run.nodes.video.checkpoint={jobs:{'shot-1':{id:'existing-job',status:'pending'}}};let posts=0,gets=0,checkpoint;
  const tools=createLiveTools({env:{VIDEO_API_URL:'https://video.example',VIDEO_POLL_MS:'1'},fetchRequest:async(url,init)=>{if(init.method==='POST')posts++;else gets++;return {id:'existing-job',status:'succeeded',url:'https://media.example/video.mp4'};}});
  const result=await tools.video({...context(run),checkpoint:x=>checkpoint=x});
  assert.equal(posts,0);assert.equal(gets,1);assert.equal(result.clips[0].providerJobId,'existing-job');assert.equal(checkpoint.jobs['shot-1'].status,'succeeded');
  run.nodes.video.checkpoint=undefined;
  const newTools=createLiveTools({env:{VIDEO_API_URL:'https://video.example'},fetchRequest:async(url,init)=>{assert.equal(init.headers['Idempotency-Key'],`${run.id}-shot-1-${requestFingerprint(videoInput(run,run.artifacts.storyboard.shots[0]))}-0`);return {id:'new-job',status:'succeeded',url:'https://media.example/video.mp4'};}});
  assert.equal((await newTools.video(context(run))).clips.length,1);
});
test('voice creates one real audio segment per shot and composer aligns corresponding segments',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'frameflow-test-'));try{
    const run=createRun(DEFAULT_BRIEF,'live');run.artifacts.storyboard={shots:completedDemo().artifacts.storyboard.shots.slice(0,2)};
    let speechCalls=0;const commands=[];
    const tools=createLiveTools({env:{LLM_API_KEY:'test-only',TTS_MODEL:'configured-by-user'},mediaRoot:dir,fetchRequest:async(url,init,signal,options)=>{assert.ok(options.binary);if(url.endsWith('/audio/speech')){speechCalls++;const b=JSON.parse(init.body);assert.equal(b.model,'configured-by-user');assert.ok(b.input);}return Buffer.from('test-media-bytes');},exec:async(command,args)=>commands.push({command,args})});
    run.artifacts.voice=await tools.voice(context(run));assert.equal(speechCalls,2);assert.equal(run.artifacts.voice.segments.length,2);
    run.artifacts.video={clips:run.artifacts.storyboard.shots.map(s=>({shotId:s.id,url:'https://media.example/video.mp4',duration:s.duration}))};
    const out=await tools.compose(context(run));assert.equal(out.format,'MP4 · H.264 / AAC');assert.equal(commands.length,3);
    assert.ok(commands[0].args.includes('10'));assert.ok(commands[0].args.includes('-filter_complex'));
    const manifest=await readFile(path.join(dir,run.id,'concat.txt'),'utf8');assert.ok(manifest.includes('aligned-0.mp4'));assert.ok(manifest.includes('aligned-1.mp4'));
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('HTTP errors classify transient vs permanent, and multimodal requests include reference image',async()=>{
  const original=globalThis.fetch;try{
    globalThis.fetch=async()=>new Response('{}',{status:429});await assert.rejects(request('https://test.example',{},new AbortController().signal),e=>e.retryable===true);
    globalThis.fetch=async()=>new Response('{}',{status:401});await assert.rejects(request('https://test.example',{},new AbortController().signal),e=>e.retryable===false);
    const run=createRun({...DEFAULT_BRIEF,reference:'data:image/png;base64,aGVsbG8='},'live');run.artifacts.script=completedDemo().artifacts.script;
    globalThis.fetch=async(url,init)=>{const b=JSON.parse(init.body);assert.equal(b.messages[1].content[1].type,'image_url');return Response.json({choices:[{message:{content:JSON.stringify(completedDemo().artifacts.storyboard)}}]});};
    const board=await llm('storyboard',context(run),{LLM_API_KEY:'test-only',LLM_MODEL:'test-vision'});assert.equal(board.shots.length,6);
  }finally{globalThis.fetch=original;}
});
test('video rejects unsafe media URLs',async()=>{
  const run=createRun(DEFAULT_BRIEF);run.artifacts.storyboard={shots:completedDemo().artifacts.storyboard.shots.slice(0,1)};
  const tools=createLiveTools({env:{VIDEO_API_URL:'https://video.example'},fetchRequest:async()=>({id:'j',status:'succeeded',url:'http://127.0.0.1/private'})});
  await assert.rejects(tools.video(context(run)),/HTTPS/);
});
