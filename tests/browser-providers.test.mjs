import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine,createRun} from '../dist/lib/engine.mjs';
import {DEFAULT_BRIEF,completedDemo} from '../dist/lib/demo.mjs';
import {publicConfig,validateBrowserConfig,createBrowserTools,browserRequest} from '../dist/lib/browser-providers.mjs';

const config={LLM_BASE_URL:'https://language.example/v1',LLM_MODEL:'user-selected-model',LLM_API_KEY:'language-test-only',VIDEO_API_URL:'https://video.example',VIDEO_API_KEY:'video-test-only',TTS_BASE_URL:'https://speech.example/v1',TTS_MODEL:'user-selected-speech',TTS_VOICE:'user-voice',TTS_API_KEY:'speech-test-only'};
const ctx=run=>({run,signal:new AbortController().signal,log:()=>{},checkpoint:()=>{}});
test('browser config keeps secrets out of saved settings and rejects credential-bearing endpoints',()=>{
  const saved=publicConfig({...config,unexpected:'ignored'});assert.ok(!JSON.stringify(saved).includes('test-only'));assert.ok(!('unexpected'in saved));assert.equal(saved.LLM_MODEL,config.LLM_MODEL);
  for(const url of ['http://api.example','https://user:password@api.example','https://api.example?key=secret','https://api.example/#secret'])assert.throws(()=>validateBrowserConfig({...config,LLM_BASE_URL:url}));
  assert.throws(()=>validateBrowserConfig({...config,TTS_API_KEY:''}),/TTS_API_KEY/);
});
test('browser workflow routes each key only to its service and joins real media branches without exposing keys',async()=>{
  const fixture=completedDemo().artifacts,run=createRun({...DEFAULT_BRIEF,manualReview:false},'browser');let modelCalls=0,videoCalls=0,voiceCalls=0;
  const tools=createBrowserTools(config,{saveBlob:()=>`blob:https://local.example/${voiceCalls}`,request:async(url,init,signal,options)=>{
    assert.ok(!JSON.stringify(init.body).includes('test-only'));
    if(url.startsWith(config.LLM_BASE_URL)){
      assert.equal(init.headers.Authorization,'Bearer language-test-only');const stage=['plan','script','review','storyboard'][modelCalls++];
      const artifact=stage==='plan'?{summary:'plan',tasks:['write','generate']}:stage==='review'?{passed:true,findings:[],summary:'review'}:fixture[stage];return {choices:[{message:{content:JSON.stringify(artifact)}}]};
    }
    if(url.startsWith(config.VIDEO_API_URL)){assert.equal(init.headers.Authorization,'Bearer video-test-only');videoCalls++;return {id:`job-${videoCalls}`,status:'succeeded',url:`https://cdn.example/video-${videoCalls}.mp4?signature=valid`};}
    if(url.startsWith(config.TTS_BASE_URL)){assert.equal(init.headers.Authorization,'Bearer speech-test-only');assert.ok(options.binary);voiceCalls++;return new Blob(['real-protocol-fixture'],{type:'audio/mpeg'});}
    assert.fail(`Unexpected request ${url}`);
  },compose:async({run})=>{assert.equal(run.artifacts.video.clips.length,6);assert.equal(run.artifacts.voice.segments.length,6);assert.equal(run.artifacts.video.clips[0].shotId,run.artifacts.voice.segments[0].shotId);return {url:'blob:https://local.example/final',format:'WebM'};}});
  const result=await new Engine(run,tools).start();assert.equal(result.status,'completed');assert.equal(modelCalls,4);assert.equal(videoCalls,6);assert.equal(voiceCalls,6);assert.ok(!JSON.stringify(result).includes('test-only'));assert.match(result.artifacts.video.clips[0].url,/signature=valid/);
});
test('browser video resumes saved jobs and does not resubmit a generation request',async()=>{
  const run=createRun(DEFAULT_BRIEF,'browser');run.artifacts.storyboard={shots:completedDemo().artifacts.storyboard.shots.slice(0,1)};run.nodes.video.checkpoint={jobs:{'shot-1':{id:'already-created',status:'pending'}}};let polls=0;
  const tools=createBrowserTools(config,{pollMs:1,request:async(url,init)=>{assert.notEqual(init.method,'POST');assert.match(url,/jobs\/already-created$/);polls++;return {id:'already-created',status:'succeeded',url:'https://cdn.example/clip.mp4?token=signed-media'};}});
  assert.equal((await tools.video(ctx(run))).clips.length,1);assert.equal(polls,1);
});
test('browser requests omit cookies and referrers, reject redirects, and classify API failures',async()=>{
  const original=globalThis.fetch;
  try{
    globalThis.fetch=async(url,init)=>{assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');assert.equal(init.referrerPolicy,'no-referrer');return new Response('audio',{headers:{'content-type':'audio/mpeg'}});};
    const blob=await browserRequest('https://speech.example',{},undefined,{binary:true});assert.equal(blob.type,'audio/mpeg');assert.equal(await blob.text(),'audio');
    for(const status of [401,429]){globalThis.fetch=async()=>new Response('',{status});await assert.rejects(browserRequest('https://api.example'),e=>e.retryable===(status===429));}
    globalThis.fetch=async()=>{throw new TypeError('Failed to fetch');};await assert.rejects(browserRequest('https://api.example'),e=>/CORS/.test(e.message)&&e.retryable===false);
  }finally{globalThis.fetch=original;}
});
