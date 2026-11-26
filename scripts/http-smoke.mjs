import assert from 'node:assert/strict';
import {createRun} from '../dist/lib/engine.mjs';
import {DEFAULT_BRIEF} from '../dist/lib/demo.mjs';
import {ensureMemory,applyPreset,commitScene} from '../dist/lib/memory.mjs';
const base='http://127.0.0.1:8787';
const page=await fetch(base);assert.equal(page.status,200);assert.ok((await page.text()).includes('FrameFlow'));
const css=await fetch(base+'/style.css');assert.equal(css.status,200);
const health=await(await fetch(base+'/api/health')).json();assert.equal(health.ok,true);assert.ok(!JSON.stringify(health).includes('KEY'));
const denied=await fetch(base+'/api/health',{headers:{Origin:'https://untrusted.example'}});assert.equal(denied.status,403);
const invalid=await fetch(base+'/api/runs',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"run":{}}'});assert.equal(invalid.status,400);
const created=await fetch(base+'/api/runs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run:createRun(DEFAULT_BRIEF,'live')})});assert.equal(created.status,201);const {id}=await created.json();
const run=await(await fetch(base+`/api/runs/${id}`)).json();assert.equal(run.brief.title,DEFAULT_BRIEF.title);
const configured=createRun(DEFAULT_BRIEF,'live');ensureMemory(configured);commitScene(configured,applyPreset(configured.memory.scenes[0],'office'));
const imported=await fetch(base+'/api/runs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run:configured})});assert.equal(imported.status,201);
const importedId=(await imported.json()).id,saved=await(await fetch(base+`/api/runs/${importedId}`)).json();assert.equal(saved.memory.scenes[0].preset,'office');assert.equal(saved.memory.scenes[0].source,'user');
if(!health.llm){const started=await fetch(base+`/api/runs/${id}/start`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(started.status,400);}
console.log('HTTP smoke verified: page, assets, health, origin guard, validation, persistence, missing-provider guard.');
