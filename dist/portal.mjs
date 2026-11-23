const details={
plan:['制片 Agent','把故事创意整理成可执行的创作计划。','故事创意、类型、时长、画幅与风格。','plan.create · LLM 结构化输出','任务清单与规划摘要，提供给编剧。','规划摘要写入项目记忆。'],
script:['编剧 Agent','将创作计划变成有角色、有场景、有对白的剧本。','创作简报、任务计划和项目记忆。','llm.generate_script · LLM','故事梗概、角色表、场景与对白 JSON。','角色外观、声音设定与故事事实写入记忆。'],
review:['审稿 Agent','以独立模型调用检查剧本，决定是否进入下游。','结构化剧本、创作简报与角色事实。','script.review · 独立 LLM 调用','是否通过、问题清单和审稿摘要。未通过则停止。','审稿摘要随下游上下文传递。'],
storyboard:['导演 Agent','把剧情转成可以交给视频工具的镜头序列。','已通过审稿的剧本、角色记忆与可选参考图。','mllm.storyboard · LLM / 视觉模型','镜头时长、景别、画面、提示词与旁白；总时长需校验。','复用服装、道具、角色与视觉风格，减少提示词漂移。'],
video:['影像 Agent','按镜头提交视频生成任务，与配音并行执行。','镜头提示词、时长、画幅与可选参考图。','video.generate · 异步视频适配器','视频片段地址、镜头关联与供应商任务 ID。','保存任务 ID 与轮询检查点，恢复时复用已有任务。'],
voice:['声音 Agent','读取每个镜头的旁白，生成可用于对齐的声音片段。','逐镜头旁白与用户配置的模型、音色。','tts.synthesize · Speech-compatible API','每个镜头对应的音轨、文本与时间信息。','当前使用统一配置音色；角色声线是记忆扩展字段。'],
compose:['剪辑 Agent','等待视频和配音都完成，再按分镜时间轴组合。','视频镜头、对应配音与分镜时长。','media.compose · 浏览器媒体工具 / 本地 FFmpeg','可预览、下载的视频；字幕可单独导出 SRT。','记录合成完成状态；修改镜头会使下游产物失效。']
};
const esc=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
document.querySelectorAll('[data-agent]').forEach(button=>button.addEventListener('click',()=>{
 const [name,description,...values]=details[button.dataset.agent];document.querySelectorAll('[data-agent]').forEach(b=>{const selected=b===button;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));});
 document.querySelector('#agent-detail').innerHTML=`<span class="tiny-label">AGENT PROFILE</span><h3>${esc(name)}</h3><p>${esc(description)}</p><dl>${values.map((value,i)=>`<dt>${['输入','工具','交付','记忆'][i]}</dt><dd>${esc(value)}</dd>`).join('')}</dl><a class="text-link" href="https://github.com/WanyueZhang-ai/frameflow-ai-drama/blob/main/dist/lib/engine.mjs" target="_blank" rel="noopener noreferrer">查看编排引擎源码</a>`;
}));
