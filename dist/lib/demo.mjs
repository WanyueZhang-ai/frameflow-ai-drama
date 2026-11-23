import {sleep} from './engine.mjs';
export const DEFAULT_BRIEF = {title:'雨夜便利店', idea:'凌晨两点，一位失去记忆的女孩走进一家只在雨夜营业的便利店。店主递给她一把旧伞，伞柄上刻着她的名字。每件被遗忘的物品，都藏着一段等待被找回的人生。结尾要有温柔的反转。', genre:'都市奇幻', style:'电影写实', duration:60, ratio:'16:9', manualReview:true, reference:''};
const camera=['全景 · 缓慢推近','中景 · 平视固定','特写 · 浅景深','近景 · 侧面跟拍','特写 · 缓慢拉焦','全景 · 缓慢拉远'];
export function demoScript(brief) {
  const rain=/雨|便利|记忆/.test(brief.idea);
  const title=brief.title||'未命名的故事';
  const beats=rain?['凌晨两点，林雨推开雨夜便利店的门。货架上的旧物像在等待她。','店主递来一把旧伞，伞柄上刻着“林雨”。她听见记忆中的声音。','林雨想起，店主是年轻时的父亲。她撑开伞走入黎明，店里只剩一张合照。']:[`故事从“${brief.idea.slice(0,55)}”展开。主角在熟悉的地方发现了一个意外线索。`,'主角与守候者发生对话，对线索的误解带来一次选择。','主角重新理解最初的相遇，带着答案离开，留下一处呼应开场的细节。'];
  const dialogue=rain?[[['林雨','这里……我是不是来过？'],['店主','你只是忘了回家的路。']],[['林雨','为什么伞上有我的名字？'],['店主','因为一直有人，等你回家。']],[['林雨','爸，下次别等到这么晚了。'],['店主','好。天快亮了。']]]:[[['林雨','我一直在找的，就是这个吗？'],['店主','也许答案，要由你自己决定。']],[['林雨','如果当初我没有离开呢？'],['店主','你依然有机会，重新选择。']],[['林雨','这一次，我知道该去哪了。'],['店主','去吧，故事还没有结束。']]];
  return {title,logline:rain?'一把刻着名字的旧伞，让失忆女孩在雨夜便利店找回了父亲最后的守候。':brief.idea,
    summary:'三幕结构、双角色、首尾呼应；演示模板生成',characters:[{name:'林雨',description:'26 岁，黑色短发，深青色风衣，手持透明伞',voice:'轻柔女声，略带迟疑'},{name:'店主',description:'45 岁，灰色针织衫，沉静温和，站在暖色灯下',voice:'沉稳男声，温柔克制'}],
    scenes:beats.map((beat,i)=>({id:`scene-${i+1}`,location:['外景 / 便利店门口 / 雨夜','内景 / 便利店柜台 / 雨夜','外景 / 便利店门口 / 黎明'][i],beat,dialogue:dialogue[i].map(([speaker,text])=>({speaker,text}))}))};
}
export function demoBoard(run) {
  const script=run.artifacts.script;
  const visuals=['雨水沿着玻璃滑落，暖光从便利店透出，林雨停在门前。','林雨推门进入，暖色光落在青色风衣上，店主抬起头。','一把旧伞放在柜台上，磨损的木柄刻着林雨的名字。','林雨抬眼看向店主，记忆中的身影与眼前人渐渐重合。','店主微笑，指尖轻轻抚过柜台上的旧合照。','林雨撑伞走入微亮的街道，便利店的灯缓缓熄灭。'];
  return {summary:'6 个镜头；角色外观与场景设定继承项目记忆',shots:Array.from({length:6},(_,i)=>{const scene=script.scenes[Math.min(Math.floor(i/2),script.scenes.length-1)];return {id:`shot-${i+1}`,sceneId:scene.id,duration:Number(run.brief.duration)/6,camera:camera[i],visual:/雨|便利|记忆/.test(run.brief.idea)?visuals[i]:scene.beat,prompt:`${run.brief.style}, ${run.brief.ratio}, ${camera[i]}, ${scene.beat}；角色：${run.memory.characters.map(c=>c.description).join('；')}；保持角色身份与服装一致，无文字与水印。`,narration:scene.dialogue[i%scene.dialogue.length].text};})};
}
export function demoTools({delay=850}={}) {
  const wrap=(id,fn)=>async ctx=>{ctx.log({plan:'读取创作简报，拆解任务依赖',script:'从模板构建剧本，写入角色记忆',review:'检查角色引用、对白与场景',storyboard:'读取角色记忆，生成镜头和提示词',video:'加载预制动态分镜，不调用视频模型',voice:'准备浏览器朗读文本，不调用 TTS 服务',compose:'组装动态分镜播放器与字幕'}[id]);await sleep(delay,ctx.signal);return fn(ctx.run);};
  return {
    plan:wrap('plan',r=>({summary:`将 ${r.brief.duration} 秒创意拆解为剧本、分镜、影像与声音任务`,tasks:['剧本三幕结构','角色与情节审查','分镜与视觉提示词','视频与配音并行生成','音画合成导出']})),
    script:wrap('script',r=>demoScript(r.brief)),
    review:wrap('review',()=>({passed:true,findings:['角色名称引用一致','三幕叙事结构完整','演示审查为规则检查，不代表真实模型评估'],summary:'规则审查通过'})),
    storyboard:wrap('storyboard',r=>demoBoard(r)),
    video:wrap('video',r=>({clips:r.artifacts.storyboard.shots.map((s,i)=>({shotId:s.id,url:`demo://shot/${i+1}`,duration:s.duration})),summary:'动态分镜演示；非生成视频'})),
    voice:wrap('voice',r=>({url:'demo://browser-speech',transcript:r.artifacts.storyboard.shots.map(s=>s.narration).join('。'),summary:'浏览器语音演示，非生成音频文件'})),
    compose:wrap('compose',()=>({url:'demo://preview',format:'动态分镜预览',summary:'可播放演示与字幕导出；非真实视频模型输出'}))
  };
}
export function completedDemo() {const run={brief:DEFAULT_BRIEF,artifacts:{},memory:{}};run.artifacts.script=demoScript(DEFAULT_BRIEF);run.memory.characters=run.artifacts.script.characters;run.artifacts.storyboard=demoBoard(run);return run;}
