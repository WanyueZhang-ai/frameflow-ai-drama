// Shared by the browser, orchestration engine and server. Coordinates describe a
// top-down set, never screen-left/screen-right in a generated camera view.
const copy = value => JSON.parse(JSON.stringify(value));
const text = (value, fallback = '') => typeof value === 'string' ? value.slice(0, 4000) : fallback;
const point = value => Number.isFinite(Number(value)) ? Math.max(8, Math.min(92, Number(value))) : 50;
export const COMPLETION_MODES = [
  {id:'strict',name:'仅明确内容',description:'保留已确认设定，不主动添加新的背景物体。'},
  {id:'selected',name:'按我的选择',description:'加入勾选的场景元素，持续物体在后续镜头中保留。'},
  {id:'creative',name:'有限自由补全',description:'保留勾选元素，允许添加不影响剧情的小装饰。'}
];
export const ELEMENT_KINDS = {required:'剧情必需',persistent:'固定背景',ambient:'氛围细节'};
const item = (id,label,kind,x,y) => ({id,label,kind,x,y,enabled:true});
export const SCENE_PRESETS = [
  {id:'store',name:'雨夜便利店',description:'玻璃门、货架与冷暖交错的店内灯光',weather:'雨',lighting:'柜台暖光，冰柜冷光',elements:[item('door','玻璃门','persistent',78,79),item('shelf','货架','persistent',25,30),item('fridge','冰柜','persistent',74,21),item('counter','柜台','persistent',30,65),item('umbrella','旧伞','required',48,62),item('rain','窗外雨滴','ambient',88,48)]},
  {id:'cafe',name:'街角咖啡馆',description:'靠窗座位、吧台与轻微的生活气息',weather:'晴',lighting:'窗边柔光，室内暖光',elements:[item('window','落地窗','persistent',84,28),item('bar','咖啡吧台','persistent',27,25),item('table','圆桌','persistent',59,58),item('cup','咖啡杯','required',58,56),item('plant','绿植','ambient',17,78)]},
  {id:'office',name:'深夜办公室',description:'办公桌、文件柜与窗外城市灯光',weather:'阴',lighting:'台灯暖光，窗外城市冷光',elements:[item('desk','办公桌','persistent',47,55),item('cabinet','文件柜','persistent',20,25),item('window','玻璃窗','persistent',77,22),item('document','文件','required',49,53),item('city','窗外灯光','ambient',88,58)]},
  {id:'room',name:'日常客厅',description:'沙发、茶几与可自由调整的室内布置',weather:'无',lighting:'柔和室内光',elements:[item('sofa','沙发','persistent',47,25),item('table','茶几','persistent',49,55),item('door','房门','persistent',85,74),item('lamp','落地灯','ambient',17,24),item('photo','相框','ambient',20,77)]}
];
export function emptyScene(id='scene-1', name='待生成场景') {
  return {id,name,revision:1,source:'script',mode:'strict',preset:'',weather:'未指定',lighting:'未指定',camera:'south',elements:[],placements:[],startState:'',endState:'',notes:'',reference:''};
}
function cleanScene(scene, index=0) {
  const base=emptyScene(text(scene.id,`scene-${index+1}`),text(scene.name,'未命名场景'));
  return {...base,revision:Math.max(1,Math.min(100000,Number(scene.revision)||1)),source:['user','sample'].includes(scene.source)?scene.source:'script',
    mode:COMPLETION_MODES.some(m=>m.id===scene.mode)?scene.mode:'strict',preset:text(scene.preset),weather:text(scene.weather,'未指定'),lighting:text(scene.lighting,'未指定'),
    camera:['north','east','south','west'].includes(scene.camera)?scene.camera:'south',startState:text(scene.startState),endState:text(scene.endState),notes:text(scene.notes),
    reference:typeof scene.reference==='string'&&/^data:image\/(png|jpeg|webp);base64,/.test(scene.reference)&&scene.reference.length<750000?scene.reference:'',
    elements:(Array.isArray(scene.elements)?scene.elements:[]).slice(0,30).map((e,i)=>({id:text(e.id,`object-${i+1}`),label:text(e.label,'未命名物体').slice(0,40),kind:Object.hasOwn(ELEMENT_KINDS,e.kind)?e.kind:'persistent',x:point(e.x),y:point(e.y),enabled:e.enabled!==false})),
    placements:(Array.isArray(scene.placements)?scene.placements:[]).slice(0,20).map(p=>({characterId:text(p.characterId),x:point(p.x),y:point(p.y)}))};
}
export function ensureMemory(run) {
  const m=run.memory||={};
  m.schemaVersion=2;m.revision=Math.max(1,Number(m.revision)||1);
  m.characters=(Array.isArray(m.characters)?m.characters:[]).map((c,i)=>({...c,id:c.id||`char-${i+1}`}));
  m.style=text(m.style,run.brief?.style||'');m.facts=Array.isArray(m.facts)?m.facts:[];m.summaries=Array.isArray(m.summaries)?m.summaries:[];
  m.history=Array.isArray(m.history)?m.history.slice(-80):[];
  m.observations=Array.isArray(m.observations)?m.observations.slice(-50):[];
  const scenes=run.artifacts?.script?.scenes;
  if(!Array.isArray(m.scenes)||!m.scenes.length)m.scenes=scenes?.length?scenes.map(s=>emptyScene(s.id,s.location)):[emptyScene()];
  m.scenes=m.scenes.slice(0,30).map(cleanScene);
  return m;
}
export function syncScriptMemory(run, script) {
  const m=ensureMemory(run),old=m.characters;
  const used=new Set(old.map(c=>c.id));let serial=1;
  m.characters=script.characters.map(c=>{const previous=old.find(x=>x.name===c.name);while(used.has(`char-${serial}`))serial++;const id=previous?.id||`char-${serial++}`;used.add(id);return {...c,id,...(previous?.source==='user'?{description:previous.description,voice:previous.voice,source:'user'}:{source:'script'})};});
  m.facts=[script.logline,...script.scenes.map(s=>s.beat)];
  m.scenes=script.scenes.map(s=>({...m.scenes.find(x=>x.id===s.id)||emptyScene(s.id,s.location),name:s.location}));
  const ids=new Set(m.characters.map(c=>c.id));
  for(const s of m.scenes)s.placements=s.placements.filter(p=>ids.has(p.characterId));
  return m;
}
export function applyPreset(scene, presetId) {
  const preset=SCENE_PRESETS.find(p=>p.id===presetId);
  if(!preset)throw new Error('请选择有效场景模板');
  return {...copy(scene),preset:presetId,mode:'selected',weather:preset.weather,lighting:preset.lighting,elements:copy(preset.elements)};
}
export function commitScene(run, draft) {
  const m=ensureMemory(run),index=m.scenes.findIndex(s=>s.id===draft.id);
  if(index<0)throw new Error('该场景已不存在，请重新选择');
  const scene=cleanScene(draft);scene.revision=m.scenes[index].revision+1;scene.source='user';
  const ids=scene.elements.map(e=>e.id);if(new Set(ids).size!==ids.length)throw new Error('场景物体 ID 不能重复');
  m.scenes[index]=scene;m.revision++;
  m.history.push({time:new Date().toISOString(),sceneId:scene.id,revision:scene.revision,source:'user',summary:`保存场景设定：${scene.name} · ${scene.elements.filter(e=>e.enabled).length} 个元素`});
  m.history=m.history.slice(-80);return scene;
}
export function sceneContext(run, sceneId) {
  const m=ensureMemory(run),scene=m.scenes.find(s=>s.id===sceneId);
  if(!scene)return null;
  // Base64 assets travel as image conditions, not repeated inside text context.
  const {reference,...context}=scene;
  return {...context,hasReference:!!reference,elements:scene.elements.filter(e=>e.enabled),excludedElements:scene.elements.filter(e=>!e.enabled).map(e=>({id:e.id,label:e.label})),characters:m.characters.map(c=>({id:c.id,name:c.name,description:c.description,position:scene.placements.find(p=>p.characterId===c.id)||null}))};
}
export function memoryContext(run) {
  const m=ensureMemory(run);
  return {schemaVersion:2,revision:m.revision,style:m.style,characters:m.characters,facts:m.facts,scenes:m.scenes.map(s=>sceneContext(run,s.id)),summaries:m.summaries.slice(-8)};
}
const CAMERA={south:'南侧向北拍摄',north:'北侧向南拍摄',east:'东侧向西拍摄',west:'西侧向东拍摄'};
function region(e){return `${e.y<34?'北侧':e.y>66?'南侧':'中部'}${e.x<34?'偏西':e.x>66?'偏东':''}`;}
export function compileSceneConstraints(run, sceneId, camera) {
  const s=sceneContext(run,sceneId);if(!s)return '';
  const mode=COMPLETION_MODES.find(m=>m.id===s.mode);
  return [`场景设定 ${s.id} v${s.revision}：${s.name}。`,
    `空间以俯视图为准，北上南下，${camera?'本镜头':'场景基准机位的'}摄像机${CAMERA[camera||s.camera]}；运镜须保持世界位置关系，物体可因构图或遮挡暂时不可见。`,
    ...s.elements.map(e=>`${ELEMENT_KINDS[e.kind]}：${e.label}，位于场景${region(e)}（平面坐标 ${e.x},${e.y}）；${e.kind==='required'?'剧情需要时明确呈现':e.kind==='persistent'?'跨镜头保持同一位置和外观':'不干扰主体动作'}。`),
    ...s.characters.filter(c=>c.position).map(c=>`角色站位：${c.name}（${c.id}）位于${region(c.position)}（${c.position.x},${c.position.y}）。`),
    s.excludedElements.length&&`未勾选的补全候选：${s.excludedElements.map(e=>e.label).join('、')}。不要主动补入这些候选；若剧本明确要求其中的对象，保留剧情需要并指出冲突。`,
    `环境：天气${s.weather}；光线${s.lighting}。补全策略：${mode.description}`,
    '以下起止状态约束整场戏，应按当前镜头的剧情进展呈现，不能每个镜头重复完整事件。',
    s.startState&&`场景起始状态：${s.startState}。`,s.endState&&`场景结束状态：${s.endState}。`,s.notes&&`额外约束：${s.notes}。`,
    '禁止新增改变剧情的角色、关键道具或事件。所有设定是创作要求，尚未经过生成画面验证。'].filter(Boolean).join('\n');
}
const MARKER='\n\n【FrameFlow 场景约束】\n';
export function compileShot(run, shot) {
  ensureMemory(run);
  const base=String(shot.basePrompt??shot.prompt??'').split(MARKER)[0];
  const s=sceneContext(run,shot.sceneId),camera=Object.hasOwn(CAMERA,shot.cameraPosition)?shot.cameraPosition:s?.camera;
  const scene=compileSceneConstraints(run,shot.sceneId,camera);
  const constraints=['以下用户确认设定优先于旧描述；仅当角色在本镜头出现时使用其外观设定，不强制所有角色同框。',`全局视觉风格：${run.memory.style}。`,...run.memory.characters.map(c=>`角色 ${c.name}（${c.id}）：${c.description}。`),scene].filter(Boolean).join('\n');
  return {...shot,basePrompt:base,prompt:constraints?base+MARKER+constraints:base,shotSpec:{sceneId:shot.sceneId,sceneRevision:s?.revision||0,memoryRevision:run.memory.revision,camera,requiredElements:s?.elements.filter(e=>e.kind==='required').map(e=>e.id)||[],persistentElements:s?.elements.filter(e=>e.kind==='persistent').map(e=>e.id)||[],verification:'unverified'}};
}
export function compileStoryboard(run, artifact) {
  ensureMemory(run);return {...artifact,shots:artifact.shots.map(s=>compileShot(run,s))};
}
export function videoInput(run, shot) {
  const compiled=compileShot(run,shot),scene=run.memory.scenes.find(s=>s.id===shot.sceneId);
  return {prompt:compiled.prompt,duration:shot.duration,aspect_ratio:run.brief.ratio,reference_image:scene?.reference||run.brief.reference||undefined};
}
export function requestFingerprint(input) {
  // Stable request identity, including reference asset contents. Not a security hash.
  let hash=2166136261;for(const char of JSON.stringify(input)){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}
  return (hash>>>0).toString(16).padStart(8,'0');
}
export function restartWithMemory(previous, next) {
  next.memory=copy(ensureMemory(previous));next.memory.summaries=[];
  next.memory.observations=[];return next;
}
export function importMemory(run, input={}) {
  run.memory={schemaVersion:2,revision:Number(input.revision)||1,style:text(input.style,run.brief.style),
    characters:(Array.isArray(input.characters)?input.characters:[]).slice(0,30).map((c,i)=>({id:text(c.id,`char-${i+1}`),name:text(c.name),description:text(c.description),voice:text(c.voice),source:c.source==='user'?'user':'script'})),
    scenes:Array.isArray(input.scenes)?input.scenes:[],facts:[],summaries:[],
    history:(Array.isArray(input.history)?input.history:[]).slice(-80).map(h=>({time:text(h.time),sceneId:text(h.sceneId),revision:Math.max(1,Number(h.revision)||1),source:h.source==='user'?'user':'script',summary:text(h.summary)})),observations:[]};
  ensureMemory(run);if(run.artifacts.script)syncScriptMemory(run,run.artifacts.script);
  return run.memory;
}
