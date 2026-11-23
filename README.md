# FrameFlow · AI 短剧 Agent 设计与编排

[![License: MIT](https://img.shields.io/badge/License-MIT-b7a6ff.svg)](LICENSE)

一套可运行的短剧创作工作台与多 Agent 工程原型。围绕「创作简报 → 剧本 → 分镜 → 视频与配音 → 音画合成」组织创作，交付界面、编排引擎、真实工具适配、自动化测试与项目展示文档。

## 立即体验

- 公开演示：<https://wanyuezhang-ai.github.io/frameflow-ai-drama/>
- 开源维护者：[WanyueZhang-ai](https://github.com/WanyueZhang-ai)。
- 本地：安装 Node.js 22+，在本目录运行 `npm start`，打开 <http://127.0.0.1:8787>。
- 无第三方运行依赖，无需安装前端包。演示模式不需要 API Key。
- 执行 `npm test` 运行编排与适配器测试；`npm run check` 检查语法和静态资产。

## 已实现的能力

| 模块 | 实现 |
| --- | --- |
| 创作工作台 | 多项目、简报编辑、类型/画幅/时长/风格、参考图、结构化剧本编辑、镜头编辑 |
| 任务编排 | 7 节点依赖图、并行分支、状态机、人工确认、停止与恢复、检查点 |
| 工具调用 | LLM / MLLM、视频适配器、TTS、FFmpeg；产物校验、限时、瞬时错误重试 |
| 协作与记忆 | 角色外观与声音设定、风格、情节事实、阶段摘要，跨 Agent 上下文传递 |
| 可观测性 | 阶段状态、实际耗时、调用/重试事件、外部视频任务 ID、JSON 导出 |
| 交付 | 动态分镜演示、系统朗读、剧本文本、分镜 JSON、SRT、真实模式 MP4 |

## 演示与真实模式

**演示模式**真实执行编排代码，创作工具为明确标注的规则模板；6 个镜头使用同一张 AI 概念图裁切与缩放。浏览器语音不是 TTS 音频文件，动态分镜不是视频模型成片。自定义故事在演示中只获得模板式结构，不保证创意遵从性。所有日志来自当前执行；初始示例明确标为预制样例，不伪造模型指标。

**真实模式**使用本地 Node 服务端，密钥仅保存在环境变量。复制 `.env.example` 为 `.env`，配置可用的 LLM、视觉模型能力、Speech TTS、视频适配器，并安装 FFmpeg。服务端在完整配置检查通过后才启动真实工作流；按所配置供应商规则计费。详见 [PROVIDERS.md](docs/PROVIDERS.md)。本次交付未使用用户付费凭据实测生成模型，因此不宣称真实成片效果已验证。

## 工程结构

```text
frameflow/
├── dist/                    在线展示与本地前端
│   ├── index.html / style.css / app.mjs
│   ├── lib/engine.mjs        浏览器与服务端共用编排引擎
│   ├── lib/demo.mjs          可运行演示工具
│   └── assets/              概念图与图标
├── src/providers.mjs        LLM、视频、TTS、合成适配
├── server.mjs               本地 HTTP API、检查点、媒体下载
├── tests/                   调度行为与工具协议测试
├── scripts/check.mjs        静态检查
├── docs/PROJECT.md          项目方案与展示讲解
├── docs/PROVIDERS.md        配置与接口协议
├── docs/ASSETS.md           视觉资产来源及提示词
├── .env.example             环境变量模板
└── data/                    运行后生成，本地状态与媒体，不入库
```

## 流程

```mermaid
flowchart TD
  B[创作简报与参考图] --> P[制片 Agent: 任务规划]
  P --> S[编剧 Agent: 结构化剧本]
  S --> R[审稿 Agent: 独立审查]
  R --> D[导演 Agent: 分镜与提示词]
  D --> H{人工确认开关}
  H --> V[影像 Agent: 视频生成]
  H --> T[声音 Agent: 配音合成]
  V --> C[剪辑 Agent: 音画合成]
  T --> C
  M[(角色 / 风格 / 事实 / 摘要记忆)] -.上下文.-> S
  S -.写入.-> M
  M -.角色连续性约束.-> D
```

## 持久化与恢复

- 演示：浏览器 `localStorage` 按项目保存简报、记忆、产物与事件；刷新后停止未完成演示，保留检查点。
- 真实：`data/runs/<id>.json` 原子替换保存；媒体位于 `data/media/<id>/`；服务重启后把未完成任务标为可恢复。
- 视频任务 ID 与完成结果持久化，重试优先继续轮询；视频适配器必须落实 `Idempotency-Key`，以降低重复提交风险。
- 编辑剧本会使审稿及其下游失效；编辑镜头使视频、配音、合成失效。已完成的无关分支可以复用。
- 审稿不通过会停止流程，用户编辑剧本后重新审稿。模型格式不合法会定向修复一次；网络、429 和部分 5xx 最多尝试三次。

## 原型边界

这是一套适合个人演示、作品集和工程扩展的单用户原型。在线站点发布静态演示；真实生成需启动本地服务，不在在线站点收集密钥。视频服务需按项目协议编写供应商适配；没有宣称兼容所有供应商原生接口。

当前配音按镜头合成，默认统一音色；人物声线是记忆与扩展字段，尚未实现逐角色音色路由。音画合成对每镜头音轨补静音或按时长截断，过长台词可能被截断；字幕单独导出，未烧录。没有音素级对齐、口型同步、向量检索或实际跨镜头身份保证。

生产化还需用户鉴权与隔离、任务队列、集中数据库/对象存储、费用限额、回调验签、完善的出站媒体网络策略、媒体时长探测与配音加速对齐、长期记忆检索和真实模型质量评估。不要直接将当前本地服务暴露到公网。

## 官方接口参考

- [Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
- [Speech](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create)
- [FFmpeg](https://ffmpeg.org/ffmpeg.html)

模型可用性由供应商决定，以服务端配置为准。


## 开源与发布

代码使用 [MIT 许可证](LICENSE)。本开源版本已移除原站点部署身份和运行数据；视觉素材来源见 [ASSETS.md](docs/ASSETS.md)。欢迎提交 Issue 或 Pull Request，开发流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。

仓库提供测试与 GitHub Pages 工作流；首次启用方法见 [PUBLISHING.md](docs/PUBLISHING.md)。GitHub Pages 只部署静态演示，不承载付费模型服务。
