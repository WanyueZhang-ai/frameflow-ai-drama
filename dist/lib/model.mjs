import {validateArtifact} from './engine.mjs';
import {memoryContext} from './memory.mjs';
const schemas={
  plan:'{"summary":"规划摘要","tasks":["按顺序列出具体创作任务"]}',
  script:'{"title":"片名","logline":"故事梗概","summary":"创作摘要","characters":[{"name":"角色名","description":"年龄、外观、服装与道具的固定设定","voice":"声线描述"}],"scenes":[{"id":"scene-1","location":"内外景/地点/时间","beat":"本场行动与情节","dialogue":[{"speaker":"必须与角色名一致","text":"台词"}]}]}',
  review:'{"passed":true,"findings":["逐条审查意见"],"summary":"审稿摘要"}',
  storyboard:'{"summary":"分镜摘要","shots":[{"id":"shot-1","sceneId":"已存在的场景ID","duration":10,"camera":"景别与运镜","cameraPosition":"inherit","visual":"画面描述","prompt":"包含角色外观、场景、动作、运镜、光线和连续性约束的完整视频生成提示词","narration":"该镜头的旁白或台词，不要附加角色名"}]}'
};
function required(env,key){if(!env[key])throw new Error(`尚未配置 ${key}`);return env[key];}
export async function generateLLM(stage,ctx,env,request){
  const {run,signal,log}=ctx;const key=required(env,'LLM_API_KEY'),model=required(env,'LLM_MODEL');
  const system=`你是专业短剧创作团队的${{plan:'制片人',script:'编剧',review:'独立审稿人',storyboard:'分镜导演'}[stage]}。严格遵循创作简报，输出中文，仅返回合法 JSON，不要 Markdown。JSON 结构必须是：${schemas[stage]}。保持角色、服装、道具、地点和事实一致。${stage==='review'?'检查故事逻辑、角色引用、情节连续性。发现严重矛盾时 passed=false；不要为了通过而隐瞒问题。':''}${stage==='storyboard'?`镜头数在 3 到 12 之间，每个镜头 1–30 秒，所有镜头 duration 之和必须等于 ${run.brief.duration} 秒。sceneId 必须引用已有场景。每个镜头必须有 narration，单段中文长度不超过 duration*3 个汉字，以便配音。`:''}`;
  const context={brief:{...run.brief,reference:run.brief.reference?'[附图]':''},memory:memoryContext(run),artifacts:Object.fromEntries(Object.entries(run.artifacts).filter(([k])=>['plan','script','review'].includes(k)))};
  let content=[{type:'text',text:JSON.stringify(context)}];
  const references=stage==='storyboard'?run.memory.scenes.filter(s=>s.reference):[];
  if(stage==='storyboard'&&run.brief.reference)content.push({type:'image_url',image_url:{url:run.brief.reference}});
  for(const scene of references)content.push({type:'text',text:`以下参考图仅用于场景 ${scene.id}：${scene.name}`},{type:'image_url',image_url:{url:scene.reference}});
  if(content.length===1)content=JSON.stringify(context);
  log(stage==='storyboard'&&(run.brief.reference||references.length)?'调用视觉模型读取场景参考图与角色记忆':'调用语言模型生成结构化 JSON');
  let correction='';
  for(let i=0;i<2;i++){
    const result=await request(`${(env.LLM_BASE_URL||'https://api.openai.com/v1').replace(/\/$/,'')}/chat/completions`,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model,messages:[{role:'system',content:system+' 用户确认的 memory 场景布局、角色设定及补全策略优先于旧产物描述。参考图中的观测不能擅自覆盖用户确认设定。镜头 cameraPosition 只能为 inherit/north/south/east/west；反打镜头可以选择不同机位。起始和结束状态约束整个场景的镜头序列，按动作进展分配，不能让每个镜头重复完整事件。'+correction},{role:'user',content}],response_format:{type:'json_object'}})},signal);
    try{const text=result.choices?.[0]?.message?.content;if(typeof text!=='string')throw new Error('模型返回空内容');const artifact=validateArtifact(stage,JSON.parse(text));if(stage==='storyboard'){
      const ids=new Set(run.artifacts.script.scenes.map(s=>s.id));if(artifact.shots.some(s=>!ids.has(s.sceneId)))throw new Error('sceneId 无效');
      if(Math.abs(artifact.shots.reduce((sum,s)=>sum+s.duration,0)-Number(run.brief.duration))>1)throw new Error('分镜总时长不等于目标时长');
    }return artifact;}catch(e){if(i)throw new Error(`结构化输出校验失败：${e.message}`);log('结构化输出不满足约束，执行一次定向修复');correction=`\n上一次输出的校验错误是：${e.message}。重新生成完整有效 JSON 并修正此错误。`;}
  }
}
