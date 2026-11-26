import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine,createRun} from '../dist/lib/engine.mjs';
import {DEFAULT_BRIEF,demoScript,demoTools} from '../dist/lib/demo.mjs';
import {ensureMemory,syncScriptMemory,applyPreset,commitScene,compileStoryboard,compileSceneConstraints,memoryContext,videoInput,requestFingerprint,restartWithMemory,importMemory} from '../dist/lib/memory.mjs';
import {generateLLM} from '../dist/lib/model.mjs';
import {createLiveTools} from '../src/providers.mjs';
import {createBrowserTools} from '../dist/lib/browser-providers.mjs';
const context=run=>({run,signal:new AbortController().signal,log:()=>{},checkpoint:()=>{}});
function configured(){const run=createRun(DEFAULT_BRIEF);run.artifacts.script=demoScript(DEFAULT_BRIEF);syncScriptMemory(run,run.artifacts.script);commitScene(run,applyPreset(run.memory.scenes[0],'store'));return run;}
test('legacy projects migrate without losing facts, artifacts or adding invented scenery',()=>{
  const r=createRun(DEFAULT_BRIEF);r.memory.facts=['原有事实'];r.artifacts.script=demoScript(DEFAULT_BRIEF);
  const m=ensureMemory(r);assert.equal(m.schemaVersion,2);assert.deepEqual(m.facts,['原有事实']);assert.equal(m.scenes.length,3);assert.equal(m.scenes[0].elements.length,0);assert.equal(m.scenes[0].mode,'strict');
});
test('unapplied preset drafts do not change memory; committing tracks scene revision and provenance',()=>{
  const r=configured(),before=structuredClone(r.memory.scenes[0]),draft=applyPreset(before,'office');
  assert.deepEqual(r.memory.scenes[0],before);draft.elements.find(e=>e.id==='cabinet').enabled=false;
  const saved=commitScene(r,draft);assert.equal(saved.source,'user');assert.equal(saved.revision,before.revision+1);assert.equal(r.memory.history.at(-1).sceneId,saved.id);
  const prompt=compileSceneConstraints(r,saved.id);assert.match(prompt,/办公桌/);assert.doesNotMatch(prompt,/固定背景：文件柜/);assert.doesNotMatch(prompt,/货架/);
});
test('script regeneration retains edited characters, allocates unique stable IDs and prunes removed scenes',()=>{
  const r=configured();r.memory.characters[1].description='用户固定外观';r.memory.characters[1].source='user';const oldId=r.memory.characters[1].id;
  const script=structuredClone(r.artifacts.script);script.characters=[{name:'新角色',description:'新外观'},script.characters[1]];script.scenes=script.scenes.slice(0,1);
  syncScriptMemory(r,script);assert.equal(r.memory.characters[1].description,'用户固定外观');assert.equal(r.memory.characters[1].id,oldId);assert.equal(new Set(r.memory.characters.map(c=>c.id)).size,2);assert.equal(r.memory.scenes.length,1);assert.equal(r.memory.scenes[0].preset,'store');
});
test('scene compiler replaces old constraints and attaches the correct per-scene shot specification',()=>{
  const r=configured();const board={shots:[{id:'shot-1',sceneId:'scene-1',prompt:'女孩推门',duration:10}]};
  const first=compileStoryboard(r,board);assert.match(first.shots[0].prompt,/固定背景：货架/);assert.deepEqual(first.shots[0].shotSpec.requiredElements,['umbrella']);
  const d=applyPreset(r.memory.scenes[0],'office');commitScene(r,d);const second=compileStoryboard(r,first);
  assert.doesNotMatch(second.shots[0].prompt,/固定背景：货架/);assert.match(second.shots[0].prompt,/固定背景：办公桌/);assert.equal(second.shots[0].prompt.split('【FrameFlow 场景约束】').length,2);assert.equal(second.shots[0].shotSpec.verification,'unverified');
});
test('scene references stay out of text memory and route only to their own video shot',()=>{
  const r=configured();r.brief.reference='data:image/png;base64,Z2xvYmFs';r.memory.scenes[0].reference='data:image/png;base64,c2NlbmU=';
  const a={sceneId:'scene-1',prompt:'A',duration:10},b={sceneId:'scene-2',prompt:'B',duration:10};
  assert.equal(videoInput(r,a).reference_image,r.memory.scenes[0].reference);assert.equal(videoInput(r,b).reference_image,r.brief.reference);assert.doesNotMatch(JSON.stringify(memoryContext(r)),/base64/);
});
test('reverse shots can select their own camera without moving the set or changing its baseline',()=>{
  const r=configured(),before=structuredClone(r.memory.scenes[0].elements);
  const result=compileStoryboard(r,{shots:[{id:'shot-1',sceneId:'scene-1',prompt:'反打镜头',duration:10,cameraPosition:'north'}]});
  assert.equal(result.shots[0].shotSpec.camera,'north');assert.match(result.shots[0].prompt,/本镜头摄像机北侧向南拍摄/);assert.equal(r.memory.scenes[0].camera,'south');assert.deepEqual(r.memory.scenes[0].elements,before);
});
test('scene-specific reference images reach multimodal planning with scene ID bindings',async()=>{
  const r=configured();r.memory.scenes[0].reference='data:image/png;base64,c2NlbmU=';
  await generateLLM('storyboard',context(r),{LLM_API_KEY:'test',LLM_MODEL:'vision'},async(url,init)=>{
    const content=JSON.parse(init.body).messages[1].content;assert.ok(content.some(x=>x.type==='text'&&x.text.includes('scene-1')));assert.ok(content.some(x=>x.type==='image_url'&&x.image_url.url===r.memory.scenes[0].reference));
    return {choices:[{message:{content:JSON.stringify({shots:[{id:'shot-1',sceneId:'scene-1',duration:30,camera:'固定',visual:'测试',prompt:'测试',narration:'测试'},{id:'shot-2',sceneId:'scene-1',duration:30,camera:'固定',visual:'测试',prompt:'测试',narration:'测试'}]})}}]};
  });
});
test('memory survives a full rerun, JSON persistence and server import',async()=>{
  const previous=configured();previous.memory.style='复古胶片';const saved=JSON.parse(JSON.stringify(previous));
  const next=restartWithMemory(saved,createRun(DEFAULT_BRIEF));const result=await new Engine(next,demoTools({delay:0})).start();
  assert.equal(result.status,'awaiting_review');assert.match(result.artifacts.storyboard.shots[0].prompt,/复古胶片/);assert.match(result.artifacts.storyboard.shots[0].prompt,/固定背景：货架/);
  const server=createRun(DEFAULT_BRIEF,'live');server.artifacts.script=result.artifacts.script;importMemory(server,result.memory);assert.equal(server.memory.scenes[0].preset,'store');assert.equal(server.memory.style,'复古胶片');
});
test('memory imports clamp coordinates and reject unsupported image schemes',()=>{
  const r=createRun(DEFAULT_BRIEF);importMemory(r,{scenes:[{id:'scene-1',reference:'javascript:alert(1)',elements:[{id:'x',label:'道具',x:-100,y:200}]}]});
  assert.equal(r.memory.scenes[0].reference,'');assert.equal(r.memory.scenes[0].elements[0].x,8);assert.equal(r.memory.scenes[0].elements[0].y,92);
});
for(const mode of ['server','browser'])test(`${mode} video requests include saved scenery and regenerate when its request identity changes`,async()=>{
  const r=configured();r.artifacts.storyboard={shots:[{id:'shot-1',sceneId:'scene-1',prompt:'推门进入',duration:10}]};const keys=[],inputs=[];
  const request=async(url,init)=>{assert.equal(init.method,'POST');keys.push(init.headers['Idempotency-Key']);inputs.push(JSON.parse(init.body));return {id:`job-${keys.length}`,status:'succeeded',url:'https://media.example/clip.mp4'};};
  const tools=mode==='server'?createLiveTools({env:{VIDEO_API_URL:'https://video.example'},fetchRequest:request}):createBrowserTools({LLM_BASE_URL:'https://llm.example',LLM_API_KEY:'test',LLM_MODEL:'test',TTS_BASE_URL:'https://tts.example',TTS_MODEL:'test',TTS_VOICE:'test',TTS_API_KEY:'test',VIDEO_API_URL:'https://video.example'},{request});
  const ctx={...context(r),checkpoint:c=>r.nodes.video.checkpoint=c};await tools.video(ctx);await tools.video(ctx);assert.equal(keys.length,1);
  commitScene(r,applyPreset(r.memory.scenes[0],'office'));await tools.video(ctx);assert.equal(keys.length,2);assert.notEqual(keys[0],keys[1]);assert.match(inputs[1].prompt,/办公桌/);assert.doesNotMatch(inputs[1].prompt,/固定背景：货架/);
});
test('failed video retries use a new idempotency attempt; reference changes alter fingerprint',async()=>{
  const r=configured();r.artifacts.storyboard={shots:[{id:'shot-1',sceneId:'scene-1',prompt:'测试',duration:10}]};const keys=[];
  const tools=createLiveTools({env:{VIDEO_API_URL:'https://video.example'},fetchRequest:async(url,init)=>{keys.push(init.headers['Idempotency-Key']);return {id:'job',status:keys.length===1?'failed':'succeeded',url:'https://media.example/clip.mp4'};}});
  const ctx={...context(r),checkpoint:c=>r.nodes.video.checkpoint=c};await assert.rejects(tools.video(ctx));await tools.video(ctx);assert.notEqual(keys[0],keys[1]);
  const a=videoInput(r,r.artifacts.storyboard.shots[0]);r.memory.scenes[0].reference='data:image/png;base64,bmV3';const b=videoInput(r,r.artifacts.storyboard.shots[0]);assert.notEqual(requestFingerprint(a),requestFingerprint(b));
});
