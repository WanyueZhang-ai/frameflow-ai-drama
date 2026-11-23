# 公开网页与源码仓库

## 当前公开演示

<https://wanyuezhang-ai.github.io/frameflow-ai-drama/>

原展示站继续保留：<https://frameflow-drama-studio.poisedbead8.chatgpt.site>。

这是无需登录的架构首页与创作工作台。访问者项目保存在自己的浏览器。演示不调用模型；网页直连由访客填写自己的 API，Key 仅在标签页内存中使用，直接发送给对应服务。网站不提供公共模型额度。

## GitHub 仓库

公开源码仓库：[WanyueZhang-ai/frameflow-ai-drama](https://github.com/WanyueZhang-ai/frameflow-ai-drama)。

开源目录排除了原有 Sites 的 `.openai/hosting.json`、Git 历史、`.env` 与运行数据；它与托管源项目独立，避免 Fork 后误用发布者的部署身份。

## GitHub Pages 自动发布

仓库包含两个工作流：

- `Project checks`：提交和 Pull Request 时检查源码与运行测试。
- `Publish public demo`：`main` 的 `dist/` 更新后发布静态工作台，也支持手动触发。

本仓库已选择 **GitHub Actions** 作为 Pages 来源，并于 2026-11-23 完成首次公开部署。后续更新 `main` 的 `dist/` 会自动检查并发布。Fork 后首次发布，需要在自己的仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**，然后在 **Actions → Publish public demo → Run workflow** 启动一次。

公开地址为 `https://wanyuezhang-ai.github.io/frameflow-ai-drama/`，已通过未登录 HTTP 访问检查。原展示站保持独立，不随 GitHub 提交自动更新。

工作流只上传 `dist/`；模型适配服务端、环境配置与运行数据不会部署到 GitHub Pages。访客可直接使用 `studio.html#connect` 配置自己的 API，接口需支持 CORS 和项目协议；也可按 `docs/PROVIDERS.md` 运行个人服务端。

官方参考：[GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。
