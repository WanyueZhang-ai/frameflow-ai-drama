export const AGENTS = [
  {id:'plan', name:'制片 Agent', role:'任务规划', tool:'plan.create', deps:[], color:'#b3a1ff'},
  {id:'script', name:'编剧 Agent', role:'故事与对白', tool:'llm.generate_script', deps:['plan'], color:'#f1b077'},
  {id:'review', name:'审稿 Agent', role:'一致性审查', tool:'script.review', deps:['script'], color:'#e3cd86'},
  {id:'storyboard', name:'导演 Agent', role:'视觉与镜头', tool:'mllm.storyboard', deps:['review'], color:'#89bbfa'},
  {id:'video', name:'影像 Agent', role:'视频生成', tool:'video.generate', deps:['storyboard'], color:'#9ad3c3'},
  {id:'voice', name:'声音 Agent', role:'配音合成', tool:'tts.synthesize', deps:['storyboard'], color:'#e6a5cb'},
  {id:'compose', name:'剪辑 Agent', role:'音画合成', tool:'media.compose', deps:['video','voice'], color:'#b3a1ff'}
];
export const clone = x => JSON.parse(JSON.stringify(x));
export const uid = () => globalThis.crypto?.randomUUID?.() || `r-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
export const sleep = (ms, signal) => new Promise((resolve,reject)=>{
  if(signal?.aborted) return reject(new DOMException('已停止','AbortError'));
  const abort=()=>{clearTimeout(t);reject(new DOMException('已停止','AbortError'));};
  const t=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
  signal?.addEventListener('abort',abort,{once:true});
});
export function createRun(brief, mode='demo') {
  if(!brief?.idea?.trim()) throw new Error('请先填写故事创意');
  return {id:uid(), mode, status:'idle', brief:clone(brief), createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), approved:false,
    nodes:Object.fromEntries(AGENTS.map(a=>[a.id,{status:'pending',attempts:0}])), artifacts:{}, events:[], memory:{characters:[],style:brief.style, facts:[],summaries:[]}};
}
export function validateArtifact(id, a) {
  const string=x=>typeof x==='string'&&x.trim().length>0;
  const array=x=>Array.isArray(x)&&x.length>0;
  if(!a||typeof a!=='object') throw new Error(`${id} 没有返回结构化产物`);
  if(id==='plan'&&(!array(a.tasks)||!string(a.summary))) throw new Error('任务计划缺少 tasks / summary');
  if(id==='script') {
    if(!string(a.title)||!string(a.logline)||!array(a.characters)||!array(a.scenes)) throw new Error('剧本结构不完整');
    if(a.characters.some(c=>!string(c.name)||!string(c.description))) throw new Error('角色字段不完整');
    const names=new Set(a.characters.map(c=>c.name));
    if(names.size!==a.characters.length) throw new Error('角色名称重复');
    if(a.scenes.some(s=>!string(s.id)||!string(s.location)||!string(s.beat)||!array(s.dialogue)||s.dialogue.some(d=>!names.has(d.speaker)||!string(d.text)))) throw new Error('场景或对白引用无效');
    if(new Set(a.scenes.map(s=>s.id)).size!==a.scenes.length) throw new Error('场景 ID 重复');
  }
  if(id==='review'&&(typeof a.passed!=='boolean'||!Array.isArray(a.findings))) throw new Error('审稿结果结构不完整');
  if(id==='storyboard') {
    if(!array(a.shots)||a.shots.length>30) throw new Error('分镜数量应为 1–30');
    if(a.shots.some(s=>!string(s.id)||!string(s.sceneId)||!Number.isFinite(s.duration)||s.duration<=0||s.duration>30||!string(s.camera)||!string(s.visual)||!string(s.prompt)||!string(s.narration))) throw new Error('分镜字段不完整或时长越界');
    if(new Set(a.shots.map(s=>s.id)).size!==a.shots.length) throw new Error('镜头 ID 重复');
  }
  if(id==='video'&&(!array(a.clips)||a.clips.some(c=>!string(c.shotId)||!string(c.url)))) throw new Error('视频产物缺少镜头地址');
  if(id==='voice'&&(!string(a.transcript)||!string(a.url))) throw new Error('配音产物缺少文本或音频地址');
  if(id==='compose'&&(!string(a.url)||!string(a.format))) throw new Error('合成产物缺少文件地址');
  return a;
}
export class Engine {
  constructor(run, tools, onChange=()=>{}, options={}) {this.run=clone(run);this.tools=tools;this.onChange=onChange;this.controller=new AbortController();this.options={retryDelay:600,...options};this.busy=false;}
  emit(type, node, message, extra={}) {
    this.run.updatedAt=new Date().toISOString();
    this.run.events.push({id:uid(),time:this.run.updatedAt,type,node,message,...extra});
    this.onChange(clone(this.run));
  }
  stop() {this.controller.abort();}
  async step(id) {
    const n=this.run.nodes[id]; if(n.status==='completed')return;
    const agent=AGENTS.find(a=>a.id===id);
    if(agent.deps.some(d=>this.run.nodes[d].status!=='completed'))throw new Error(`${id} 的前置任务未完成`);
    n.status='running';n.startedAt=Date.now();delete n.error;this.emit('start',id,`${agent.name} 开始工作`,{tool:agent.tool});
    for(let attempt=0;attempt<3;attempt++) {
      try {
        this.controller.signal.throwIfAborted();n.attempts++;
        const result=await this.tools[id]({run:clone(this.run),signal:this.controller.signal,log:message=>this.emit('tool',id,message,{tool:agent.tool}),checkpoint:data=>{n.checkpoint=clone(data);this.emit('checkpoint',id,'已保存工具执行检查点',{tool:agent.tool});}});
        this.controller.signal.throwIfAborted();
        validateArtifact(id,result);
        if(id==='review'&&!result.passed) {const e=new Error('审稿未通过：'+result.findings.join('；'));e.retryable=false;throw e;}
        if(id==='storyboard') {
          const scenes=new Set(this.run.artifacts.script.scenes.map(s=>s.id));
          if(result.shots.some(s=>!scenes.has(s.sceneId)))throw new Error('分镜引用了不存在的场景');
          const duration=result.shots.reduce((sum,s)=>sum+s.duration,0);
          if(Math.abs(duration-Number(this.run.brief.duration))>1)throw new Error('分镜总时长与创作设定不一致');
        }
        this.run.artifacts[id]=result;n.status='completed';n.elapsed=Date.now()-n.startedAt;
        if(id==='script'){this.run.memory.characters=clone(result.characters);this.run.memory.facts=[result.logline,...result.scenes.map(s=>s.beat)];}
        this.run.memory.summaries.push({node:id,summary:result.summary||`${agent.role}完成`,time:new Date().toISOString()});
        this.emit('complete',id,`${agent.role}已完成`);return;
      } catch(error) {
        if(this.controller.signal.aborted||error.name==='AbortError'){n.status='pending';throw error;}
        if(error.retryable===true&&attempt<2){this.emit('retry',id,`调用暂时失败，准备第 ${attempt+2} 次尝试`);await sleep(this.options.retryDelay*2**attempt,this.controller.signal);continue;}
        n.status='failed';n.error=error.message;this.emit('error',id,error.message);throw error;
      }
    }
  }
  async start({approve=false}={}) {
    if(this.busy)throw new Error('任务正在执行');this.busy=true;
    if(this.controller.signal.aborted)this.controller=new AbortController();
    if(approve)this.run.approved=true;
    this.run.status='running';this.emit('status',null,'工作流已启动');
    try {
      for(const id of ['plan','script','review','storyboard'])await this.step(id);
      if(this.run.brief.manualReview&&!this.run.approved){this.run.status='awaiting_review';this.emit('approval','storyboard','分镜已就绪，等待人工确认');return clone(this.run);}
      const outcomes=await Promise.allSettled([this.step('video'),this.step('voice')]);
      const failure=outcomes.find(x=>x.status==='rejected');if(failure)throw failure.reason;
      await this.step('compose');this.run.status='completed';this.emit('status',null,'所有产物已就绪');
    } catch(error) {
      this.run.status=this.controller.signal.aborted?'cancelled':'failed';
      for(const n of Object.values(this.run.nodes))if(n.status==='running')n.status='pending';
      this.emit('status',null,this.run.status==='cancelled'?'执行已停止，已完成产物保留':error.message);
    } finally {this.busy=false;}
    return clone(this.run);
  }
}
