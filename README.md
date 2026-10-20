# ZheshGo v0.0.1 — 2026-10-20 已完成基线

归档完成日期：2026-10-20。此版本保留证书冷却后已恢复的三语网站、App 网页、带联网搜索的千问后端，以及从私有 OSS 取回现有证书后再启动 Caddy 的加固。它不是 v0.1.0 正式发布。

## 保存内容
- website/：当前 WorkBuddy 原网站和 App 网页快照，含 en、ja、ko。恢复原站时只发布此目录。
- archive/v0.0.1/website-manifest.json：每个网站文件的大小、Git blob SHA 和 SHA-256。
- 根目录 server.js、start.sh、Dockerfile、package.json、public/、tests/：后端来自 `d6d192d`，再叠加 OSS 证书恢复提交。它支持 en、ja、ko，保留 web_search / web_extractor，启动时必须先从私有 OSS 取回现有证书。
- 未包括云端 API Key、账号会话、咨询记录、证书私钥或其他运行时私密数据。代码快照不是数据库备份，也不包含证书文件本身。

## 验收边界
原站：https://zheshgo-travel.app.workbuddy.host/
API 入口：https://8-210-60-175.sslip.io
后端镜像：ghcr.io/chentowe00/zheshgo-backend:1327621d7ddff29b97c2af8566556097184d1848
回退镜像：ghcr.io/chentowe00/zheshgo-backend:d6d192db84df356dbdd8acad3d8da42d8bfdeb21
2026-10-20 上午：状态接口返回 qwen3.8-flash；英、日、韩各一次真实酒店问题返回来源。八个助手页面 HTTP 200。
2026-10-20 14:49 北京：部署 OSS 证书恢复镜像后，公网仍使用同一张 Let's Encrypt 证书（有效期至 2027-01-17）；状态接口与助手页 HTTP 200；一次真实英文酒店问返回 search_snippet 与来源。这确认现有证书可被取回并继续服务，不代表换实例后的长期无人值守测试已经做完，也不代表 v0.1.0 已发布。

## 找回和恢复
1. 打开 GitHub Release v0.0.1，或执行 git checkout v0.0.1。不要移动或删除 v0.0.0。
2. 恢复网站时只发布 website/。恢复后端时使用上述 OSS 恢复镜像；密钥和证书文件仍须从云端安全存储恢复，不能从本仓库取出。
3. 新实例必须配置私有 OSS 环境变量后才能启动 HTTPS。取回失败会拒绝启动 Caddy，避免再次向 Let's Encrypt 申请同一域名证书。
