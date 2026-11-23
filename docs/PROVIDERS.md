# 真实模式：配置与工具协议

## 本地环境

需要 Node.js 22+、FFmpeg（含 libx264 / AAC 编码），以及可调用的模型供应商账户。项目自身不安装 FFmpeg，不携带付费凭据。

```sh
cp .env.example .env
# 在本地编辑 .env，填写配置
npm start
```

打开 <http://127.0.0.1:8787>，在「模型与连接」检查服务端。四个能力都配置后选择真实接口，再运行项目。在线静态站不提供付费生成后端，建议真实模式始终在本地工作台使用；在线 HTTPS 页面连接本地 HTTP 会受浏览器策略限制。

## LLM / MLLM

`LLM_BASE_URL` 是带版本的根地址，如 `https://api.openai.com/v1`。服务端请求 `POST /chat/completions`，传入 `model`、`messages` 和 `response_format: {type:"json_object"}`。模型必须支持这些协议。平台不支持 JSON mode 时，需要修改适配器，不能仅替换模型名。

`LLM_MODEL` 由用户指定可用模型，不写死型号。导演阶段如附有参考图，消息使用 text + image_url；模型必须支持视觉。其他阶段使用文本上下文。产物结构定义在 `schemas` 与 `validateArtifact` 中。模型输出不满足结构时，会附带错误说明再生成一次；第二次仍无效则停止。

## 视频供应商适配协议

`VIDEO_API_URL` 指向你自己的适配服务根地址，不是任意供应商的原生地址。适配服务负责把以下统一请求转换为供应商接口，处理凭据和供应商原生状态差异。

`POST {VIDEO_API_URL}/jobs`

请求头：`Authorization: Bearer <VIDEO_API_KEY>`（配置时）、`Content-Type: application/json`、`Idempotency-Key: <run-id>-<shot-id>`。

```json
{
  "prompt": "含角色外观、动作、场景与运镜的完整提示词",
  "duration": 10,
  "aspect_ratio": "16:9",
  "reference_image": "data:image/png;base64,..."
}
```

`reference_image` 可选。响应必须包含稳定任务 ID 和状态：

```json
{"id":"provider-job-123","status":"pending"}
```

轮询 `GET {VIDEO_API_URL}/jobs/provider-job-123`：

```json
{"id":"provider-job-123","status":"succeeded","url":"https://your-media-host.example/clip.mp4"}
```

状态支持 `pending`、`running`、`succeeded`、`failed`、`cancelled`；成功必须带可直接下载的 HTTPS `url`。媒体下载不自动携带供应商密钥，应返回短时签名地址。单文件最多 100 MB，不接受 HTTP 地址、明显私网 IP 或重定向。供应商域名及 DNS 仍应由生产出站代理限制。

视频任务 ID 和最后响应存入检查点；网络中断后继续轮询。适配服务必须实现幂等提交，尤其应明确失败任务重试时原幂等键如何重新开始。停止工作流只停止本地等待和请求；当前没有供应商取消 API。长任务默认最多轮询 10 分钟，可调整 `VIDEO_TIMEOUT_MS`；超时后任务 ID 保留，点击继续可以接着查。

## 配音

服务端请求 `{TTS_BASE_URL}/audio/speech`，使用 `TTS_API_KEY`（为空时使用 LLM key）、`TTS_MODEL`、`TTS_VOICE`、镜头 narration，以及 `response_format: "mp3"`。响应为原始音频字节。一个镜头对应一个音频片段，当前统一使用配置音色，未实现逐角色音色切换。

此协议要求 Speech-compatible 服务。用户应按供应商当前可用性配置模型与音色；不假定某型号永久可用。参考 [Speech API 官方文档](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create)。

## 合成

`FFMPEG_PATH` 是可执行程序名或绝对路径，不是命令字符串。程序使用参数数组启动，未经过 shell 解释。

每个镜头被统一为 1280×720 或 720×1280、24 fps、H.264 / AAC，短视频以末帧延长；镜头音轨补静音或按目标时长截断，再合并为 MP4。字幕以 SRT 在前端单独导出。声音没有音素对齐，过长 narration 可能被截断；在真实使用前需要听审或扩展为时长探测/语速校正。

## 服务端 API

| 方法与路径 | 用途 |
| --- | --- |
| `GET /api/health` | 能力配置状态，不返回密钥 |
| `POST /api/runs` | 创建真实运行，可导入经校验的已完成剧本/分镜 |
| `POST /api/runs/:id/start` | 启动/恢复；`{"approve":true}` 表示分镜确认 |
| `POST /api/runs/:id/stop` | 停止执行，保留检查点 |
| `GET /api/runs/:id` | 查询状态、记忆、事件与产物 |
| `GET /media/:runId/:file` | 下载媒体，支持 Range 播放 |

本地默认仅绑定 127.0.0.1，检查请求 Origin；没有多用户账户系统。`ALLOWED_ORIGINS` 可填精确来源列表，用于自己的开发前端。不要用 `*` 开放跨站访问。原型不提供公网用户隔离与数据访问鉴权。
