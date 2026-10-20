# ZheshGo v0.0.1 — 2026-10-20 已恢复基线

归档日期：2026-10-20。此版本保留证书冷却后已恢复的三语网站、App 网页和带联网搜索的千问后端。它不是 v0.1.0 正式发布。

## 保存内容
- website/：当前 WorkBuddy 原网站和 App 网页快照，含 en、ja、ko。恢复原站时只发布此目录。
- archive/v0.0.1/website-manifest.json：每个网站文件的大小、Git blob SHA 和 SHA-256。
- 根目录 server.js、start.sh、Dockerfile、package.json、public/、tests/：来自当时正在运行的后端提交 d6d192db84df356dbdd8acad3d8da42d8bfdeb21。它支持 en、ja、ko，并保留 web_search / web_extractor。
- 未包括云端 API Key、账号会话、咨询记录、证书私钥或其他运行时私密数据。代码快照不是数据库或证书备份。

## 验收边界
原站：https://zheshgo-travel.app.workbuddy.host/
API 入口：https://8-210-60-175.sslip.io
后端镜像：ghcr.io/chentowe00/zheshgo-backend:d6d192db84df356dbdd8acad3d8da42d8bfdeb21
2026-10-20：状态接口返回 qwen3.8-flash；英、日、韩各一次真实酒店问题返回来源。八个助手页面 HTTP 200。此为当时验证，不代表换实例后证书仍在，也不代表 v0.1.0 已发布。

## 找回和恢复
1. 打开 GitHub Release v0.0.1，或执行 git checkout v0.0.1。不要移动或删除 v0.0.0。
2. 恢复网站时只发布 website/。恢复后端时使用上述镜像；密钥和证书仍须从云端安全存储恢复。
3. 本快照不解决证书随容器丢失的问题。换实例前必须先有持久证书，不能靠反复重新申请。
