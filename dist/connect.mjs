import {DEFAULT_BROWSER_CONFIG,CONFIG_FIELDS,publicConfig,validateBrowserConfig,mediaSupported,browserRequest,endpointURL} from './lib/browser-providers.mjs';

export function connectionForm({settings,config,esc,icon,busy=false}){
  const field=(key,label,placeholder='',secret=false)=>`<div class="form-field"><label for="${key}">${label}</label><input id="${key}" name="${key}" ${secret?'type="password" autocomplete="off" spellcheck="false"':'type="text"'} placeholder="${placeholder}" value="${esc(config[key]||'')}" ${busy?'disabled':''}></div>`;
  return `<form id="settings-form" autocomplete="off"><div class="connection-intro">无需注册项目账号。演示免费；真实生成由浏览器调用你填写的服务，费用由对应 API 服务商结算。</div><div class="form-field"><label for="mode">运行方式</label><select id="mode" name="mode" ${busy?'disabled':''}><option value="demo" ${settings.mode==='demo'?'selected':''}>交互演示 · 无需 API</option><option value="browser" ${settings.mode==='browser'?'selected':''}>网页直连 · 使用自己的 API</option><option value="live" ${settings.mode==='live'?'selected':''}>个人服务端 · 本地完整版本</option></select></div><div id="browser-fields" ${settings.mode==='browser'?'':'hidden'}>
  <div class="connection-section"><h3>语言 / 视觉模型</h3><p>兼容 Chat Completions、JSON 输出；使用参考图时需支持视觉。</p>${field('LLM_BASE_URL','API 根地址','https://api.example.com/v1')}${field('LLM_MODEL','模型名称','填写服务商提供的模型 ID')}${field('LLM_API_KEY','语言模型 API Key','仅在当前标签页中使用',true)}</div>
  <div class="connection-section"><h3>视频生成服务</h3><p>填写符合 <a href="https://github.com/WanyueZhang-ai/frameflow-ai-drama/blob/main/docs/PROVIDERS.md" target="_blank" rel="noopener noreferrer">项目视频协议</a> 的服务根地址。页面会请求 <code>/jobs</code> 创建与轮询任务；不是任意视频厂商原生接口。</p>${field('VIDEO_API_URL','视频服务根地址','https://your-video-adapter.example')}${field('VIDEO_API_KEY','视频 API Key（如服务需要）','仅发送到视频服务',true)}</div>
  <div class="connection-section"><h3>配音服务</h3><p>兼容 Speech API。请明确填写配音服务的 Key，即使与语言模型使用同一账号。</p>${field('TTS_BASE_URL','配音 API 根地址','https://api.example.com/v1')}${field('TTS_MODEL','配音模型名称','填写服务商提供的模型 ID')}${field('TTS_VOICE','音色 ID','填写模型支持的音色')}${field('TTS_API_KEY','配音 API Key','仅发送到配音服务',true)}</div>
  <div class="modal-section">API Key 只在当前标签页内存中使用，不写入浏览器存储、项目导出或 GitHub。页面会把 Key 直接发送到上面对应的服务地址，请确认地址属于你信任的服务。<br><br>所有 API 与视频文件地址需要允许浏览器跨域访问。成片由浏览器实时合成，格式依浏览器为 MP4 或 WebM；请保持此标签页在前台。配音与合成文件刷新后需要重新生成，视频任务 ID 与文字产物仍会保留。</div><p class="result-note">浏览器合成能力：${mediaSupported()?'当前浏览器支持':'当前浏览器不支持，请换新版 Chrome 或使用个人服务端'}</p><button class="btn sm" type="button" id="check-api" ${busy?'disabled':''}>${icon('link')}检查语言模型连通性</button><small class="result-note">只读取 <code>/models</code>；不提交生成任务。个别兼容服务不提供此列表。</small></div>
  <div id="server-fields" ${settings.mode==='live'?'':'hidden'}><div class="form-field"><label for="endpoint">个人服务端地址</label><input id="endpoint" name="endpoint" placeholder="本地打开时可留空；远程请填写 HTTPS 地址" value="${esc(settings.endpoint)}"><small>API Key 在你的服务端环境变量中配置。GitHub Pages 不提供公共生成后端。</small></div><p class="result-note">运行仓库中的 <code>npm start</code> 后，可直接在本地打开 <code>http://127.0.0.1:8787/studio.html</code>。远程服务需允许本网页来源，跨设备部署还需自行添加访问控制。</p><button class="btn sm" type="button" data-action="connection">${icon('link')}检查个人服务端</button></div>
  <p id="connection-result" class="result-note" role="status"></p><div class="modal-actions"><button class="btn" type="button" id="clear-api" ${busy?'disabled':''}>清除本页 API Key</button><button class="btn" type="button" data-action="close">取消</button><button class="btn primary" type="submit" ${busy?'disabled':''}>应用配置</button></div></form>`;
}
export function bindConnectionForm({config,toast,onSave,onClear}){
  const form=document.querySelector('#settings-form');const readConfig=()=>Object.fromEntries(CONFIG_FIELDS.map(key=>[key,form.elements[key]?.value.trim()||'']));
  form.elements.mode.addEventListener('change',()=>{document.querySelector('#browser-fields').hidden=form.elements.mode.value!=='browser';document.querySelector('#server-fields').hidden=form.elements.mode.value!=='live';document.querySelector('#connection-result').textContent='';});
  document.querySelector('#clear-api').onclick=()=>{for(const key of ['LLM_API_KEY','VIDEO_API_KEY','TTS_API_KEY'])form.elements[key].value='';onClear();toast('当前标签页中的 API Key 已清除');};
  document.querySelector('#check-api').onclick=async e=>{
    const el=document.querySelector('#connection-result'),button=e.currentTarget;button.disabled=true;el.textContent='正在读取语言模型列表…';
    try{const data=readConfig(),base=endpointURL(data.LLM_BASE_URL);if(!data.LLM_API_KEY)throw new Error('请先填写语言模型 API Key');await browserRequest(`${base}/models`,{headers:{Authorization:`Bearer ${data.LLM_API_KEY}`}});el.textContent='语言模型已连通。视频与配音服务将在实际运行时按各自协议调用。';}catch(error){el.textContent=error.message;}finally{button.disabled=false;}
  };
  form.onsubmit=e=>{
    e.preventDefault();try{
      const mode=form.elements.mode.value;let next=readConfig(),endpoint=form.elements.endpoint.value.trim().replace(/\/$/,'');
      if(mode==='browser')next=validateBrowserConfig(next);
      if(endpoint){const u=new URL(endpoint);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw new Error('请输入有效的个人服务端地址');}
      onSave({mode,endpoint},next,publicConfig(next));
    }catch(error){toast(error.message);}
  };
}
export {DEFAULT_BROWSER_CONFIG};
