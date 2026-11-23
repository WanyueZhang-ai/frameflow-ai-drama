import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine,createRun,validateArtifact,sleep} from '../dist/lib/engine.mjs';
import {demoTools,DEFAULT_BRIEF} from '../dist/lib/demo.mjs';

test('full dependency graph completes and shares character memory',async()=>{
  const e=new Engine(createRun({...DEFAULT_BRIEF,manualReview:false}),demoTools({delay:0}));
  const r=await e.start();assert.equal(r.status,'completed');assert.equal(Object.values(r.nodes).filter(n=>n.status==='completed').length,7);
  assert.equal(r.memory.characters[0].name,r.artifacts.script.characters[0].name);
  assert.ok(r.artifacts.storyboard.shots[0].prompt.includes(r.memory.characters[0].description));
  assert.ok(r.events.findIndex(x=>x.node==='compose'&&x.type==='start')>r.events.findIndex(x=>x.node==='voice'&&x.type==='complete'));
});
test('manual approval blocks paid downstream tools, resume reuses completed stages',async()=>{
  const e=new Engine(createRun(DEFAULT_BRIEF),demoTools({delay:0}));let r=await e.start();
  assert.equal(r.status,'awaiting_review');assert.equal(r.nodes.video.attempts,0);assert.equal(r.nodes.voice.attempts,0);
  r=await e.start({approve:true});assert.equal(r.status,'completed');assert.equal(r.nodes.script.attempts,1);
});
test('video and voice execute concurrently, compose waits for both',async()=>{
  const tools=demoTools({delay:0});const seen=[];let videoStarted,voiceStarted;
  const waitVideo=new Promise(r=>videoStarted=r),waitVoice=new Promise(r=>voiceStarted=r);
  const v=tools.video,a=tools.voice;
  tools.video=async ctx=>{seen.push('video');videoStarted();await waitVoice;return v(ctx);};
  tools.voice=async ctx=>{seen.push('voice');voiceStarted();await waitVideo;return a(ctx);};
  const e=new Engine(createRun({...DEFAULT_BRIEF,manualReview:false}),tools);const r=await e.start();
  assert.equal(r.status,'completed');assert.deepEqual(seen,['video','voice']);
});
test('retry only transient failures, failure resume retains successful branch',async()=>{
  const tools=demoTools({delay:0});const video=tools.video;let count=0;
  tools.video=ctx=>{count++;if(count<3){const e=new Error('rate limited');e.retryable=true;throw e;}return video(ctx);};
  const e=new Engine(createRun({...DEFAULT_BRIEF,manualReview:false}),tools,()=>{},{retryDelay:1});const r=await e.start();
  assert.equal(r.status,'completed');assert.equal(r.nodes.video.attempts,3);assert.equal(r.nodes.voice.attempts,1);
  tools.video=()=>{throw new Error('configuration invalid');};
  const e2=new Engine(createRun({...DEFAULT_BRIEF,manualReview:false}),tools);let failed=await e2.start();
  assert.equal(failed.status,'failed');assert.equal(failed.nodes.video.attempts,1);assert.equal(failed.nodes.voice.status,'completed');
  const resumed=new Engine(failed,demoTools({delay:0}));failed=await resumed.start();assert.equal(failed.status,'completed');assert.equal(failed.nodes.voice.attempts,1);
});
test('cancellation stops work and checkpoint can resume after restart',async()=>{
  const e=new Engine(createRun({...DEFAULT_BRIEF,manualReview:false}),demoTools({delay:30}));
  const result=e.start();setTimeout(()=>e.stop(),5);const stopped=await result;assert.equal(stopped.status,'cancelled');assert.equal(stopped.nodes.plan.status,'pending');
  const resumed=new Engine(JSON.parse(JSON.stringify(stopped)),demoTools({delay:0}));assert.equal((await resumed.start()).status,'completed');
});
test('independent review failure prevents storyboard and media generation',async()=>{
  const tools=demoTools({delay:0});tools.review=async()=>({passed:false,findings:['角色身份冲突']});
  const r=await new Engine(createRun(DEFAULT_BRIEF),tools).start();assert.equal(r.status,'failed');assert.equal(r.nodes.storyboard.attempts,0);
});
test('schema rejects malformed artifacts, unknown roles, duplicate IDs and duration drift',async()=>{
  assert.throws(()=>validateArtifact('script',{title:'x',logline:'x',characters:[{name:'a',description:'x'}],scenes:[{id:'s',location:'x',beat:'x',dialogue:[{speaker:'unknown',text:'x'}]}]}));
  const tools=demoTools({delay:0}),board=tools.storyboard;
  tools.storyboard=async ctx=>{const a=await board(ctx);a.shots[0].duration+=10;return a;};
  const r=await new Engine(createRun(DEFAULT_BRIEF),tools).start();assert.equal(r.nodes.storyboard.status,'failed');assert.equal(r.nodes.video.attempts,0);
});
test('tool checkpoint is persisted and available to retry',async()=>{
  const tools=demoTools({delay:0}),video=tools.video;let attempt=0;
  tools.video=async ctx=>{if(attempt++===0){ctx.checkpoint({providerId:'job-42'});const e=new Error('temporary');e.retryable=true;throw e;}assert.equal(ctx.run.nodes.video.checkpoint.providerId,'job-42');return video(ctx);};
  const r=await new Engine(createRun({...DEFAULT_BRIEF,manualReview:false}),tools,()=>{},{retryDelay:1}).start();assert.equal(r.status,'completed');
});
