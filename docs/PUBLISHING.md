# 公开网页与源码仓库

## 当前公开演示

<https://wanyuezhang-ai.github.io/frameflow-ai-drama/>

原展示站继续保留：<https://frameflow-drama-studio.poisedbead8.chatgpt.site>。

这是静态展示工作台。访问者项目只保存在自己的浏览器，不会读取发布者在本地创建的项目。在线演示不包含模型 API 密钥，也不提供公共付费生成后端。

## GitHub 仓库

公开源码仓库：[WanyueZhang-ai/frameflow-ai-drama](https://github.com/WanyueZhang-ai/frameflow-ai-drama)。

开源目录排除了原有 Sites 的 `.openai/hosting.json`、Git 历史、`.env` 与运行数据；它与托管源项目独立，避免 Fork 后误用发布者的部署身份。

## GitHub Pages 自动发布

仓库包含两个工作流：

- `Project checks`：提交和 Pull Request 时检查源码与运行测试。
- `Publish public demo`：`main` 的 `dist/` 更新后发布静态工作台，也支持手动触发。

本仓库已选择 **GitHub Actions** 作为 Pages 来源，并于 2026-11-23 完成首次公开部署。后续更新 `main` 的 `dist/` 会自动检查并发布。Fork 后首次发布，需要在自己的仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**，然后在 **Actions → Publish public demo → Run workflow** 启动一次。

公开地址为 `https://wanyuezhang-ai.github.io/frameflow-ai-drama/`，已通过未登录 HTTP 访问检查。原展示站保持独立，不随 GitHub 提交自动更新。

工作流只上传 `dist/`；模型适配服务端、环境配置与运行数据不会部署到 GitHub Pages。真实生成请按 `docs/PROVIDERS.md` 在本地运行服务端。

官方参考：[GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。
