# ZheshGo v0 — 2026-10-13 上线基线

归档日期：2026-10-14。此版本用于保留已通过真实千问问答验收的首次基线。

## 保存内容
- website/：WorkBuddy 原网站和 App 网页的完整 64 文件快照，应使用此目录恢复原站。
- 根目录 server.js、start.sh、Dockerfile、package.json、data/content.json、public/：当前 SAE 后端部署源码，保持部署提交 cd4a2e2e5255e409cc8386e117a7435cf5704d79 原样。public/ 是 SAE 镜像自带的页面，与 WorkBuddy 原站 website/ 配置有区别。
- archive/v0/website-manifest.json：原站每个文件的大小、Git blob SHA 和 SHA-256，供恢复后核验。
- 未包括云端 API Key、账号会话、咨询记录或其他运行时私密数据。代码快照不是数据库备份。

## 验收与部署记录
原站：https://zheshgo-travel.app.workbuddy.host/
App 网页：https://zheshgo-travel.app.workbuddy.host/app/
API 入口：https://8-210-60-175.sslip.io
后端镜像：ghcr.io/chentowe00/zheshgo-backend:cd4a2e2e5255e409cc8386e117a7435cf5704d79
SAE：香港 zheshgo-backend，应用 c5183957-1b5a-4cc6-860d-baeedfeffaa3。
2026-10-13：网站及 App 网页未登录真实提问均收到 Qwen qwen3.8-flash 回复；本机 POST 返回 HTTP 200。北京、广州、美国、德国、日本节点 HTTPS 状态接口通过。此为当时验证，不代表永久可用或所有 VPN 已验证。

## 找回和恢复
1. GitHub Releases 中打开 v0.0.0，下载 Source code (zip)，或执行 git clone --branch v0.0.0 https://github.com/chentowe00/zheshgo-backend.git zheshgo-v0。
2. 恢复原网站时仅发布 website/ 的内容，不要发布仓库根目录、后端、数据或归档说明。若 API 入口已变更，须更新网站配置并重新验证 HTTPS 和 CORS。
3. 恢复后端时优先使用上述已部署镜像；如镜像不可用，可从原部署提交 cd4a2e2e5255e409cc8386e117a7435cf5704d79 重建。密钥须从云端安全配置恢复，绝不能写入仓库。
4. 恢复前备份当时的运行时数据；恢复后检查 health、status 并在原站实际提问，不能只以配置成功判断完成。

## 版本规则与当前限制
v0.0.0 标签用于此次固定快照；后续更新使用新提交和新版本标签，不移动或覆盖此标签。归档分支只是辅助入口，应以标签和提交 SHA 找回。
当前是早期 demo：社区、咨询等功能的上线状态不能因 AI 已接通而推定全部完成；App 网页测试不代表原生安装、离线或拍照 AI 已验收。
单实例、第三方 sslip.io 域名、证书临时存储、后续滚动部署出网 EIP 数量仍有可靠性限制。归档操作不更改线上部署。
