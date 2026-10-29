<div align="center">

# 🔐 CertHub · SSL 证书助手

**基于 Cloudflare Worker / EdgeOne Pages 的全自动化 SSL 证书申请与下发平台**

[![License](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![EdgeOne](https://img.shields.io/badge/Tencent-EdgeOne-00A4FF?logo=tencentqq&logoColor=white)](https://edgeone.ai/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![Hono](https://img.shields.io/badge/Built%20with-Hono-E36002)](https://hono.dev/)

[English](#english) · [快速部署](#-一键部署) · [在线演示](#-在线演示) · [使用文档](#-配置说明) · [常见问题](#-常见问题)
</div>


---

## 📖 项目介绍

**CertHub（SSL 证书助手）** 是一个 **免费、开源、全自动化** 的 SSL 证书申请与下发平台，依托 Cloudflare Workers / Tencent EdgeOne Pages 等 Serverless 平台运行，**无需服务器即可部署**。

通过自动化的 CNAME 与 DNS 操作，平台可以全自动完成域名验证、申请证书并将其同步下发到任意服务器或客户端。

### ✨ 核心优势

- 🚀 **无服务器部署**：依托 Cloudflare Worker / EdgeOne Pages，**完全免费**，亦支持私有化部署
- 🔁 **一次配置，永久使用**：支持 DCV 代理与自动验证，**只需设置一次 CNAME 记录**即可永久续期
- 🏢 **多服务器同步**：相比 `acme.sh` 单机使用，更适合 **多服务器、内网共享** 同一证书的场景
- 🌐 **多 CA 支持**：内置 `Let's Encrypt`、`ZeroSSL`、`Google Trust Service`、`SSL.com` 四大主流 CA
- 🎨 **现代化管理后台**：终端风格 UI，支持证书全生命周期管理（申请 / 续期 / 吊销 / 下载 PFX / ZIP）
- 🔌 **完整 API**：提供完整 RESTful API，方便接入到 1Panel / 宝塔 / 自建系统

---

## 🖼️ 项目截图

### 管理控制台

> 终端风格的实时仪表盘，一目了然查看证书总览、订单状态与最新动态。
<p align="center">
  <img src="images/QQ20250506-153642.png" alt="CertHub 证书详情页" width="900" />
</p>



### 证书订单详情

> 支持查看完整签发流程进度，并提供 **下载证书 / 下载密钥 / ZIP / PFX / 续期 / 吊销** 等一站式操作。

<p align="center">
  <img src="images/QQ20250506-153705.png" alt="CertHub 管理控制台" width="900" />
</p>

---

## 🌍 在线演示

- 演示站点：<https://newssl.524228.xyz/>

> ⚠️ 演示平台 **不会主动泄漏您的密钥数据**，但出于安全考虑，建议在生产环境使用自己的 Cloudflare 账号私有化部署。

---

## 🚀 一键部署

| Cloudflare Workers (全球) | EdgeOne Pages (国际) | EdgeOne Pages (中国) |
| :---: | :---: | :---: |
| [<img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare Workers" width="220" />](https://deploy.workers.cloudflare.com/?url=https://github.com/PIKACHUIM/CFWorkerACMEs) | [<img src="https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg" alt="使用 EdgeOne Pages 部署" width="220" />](https://edgeone.ai/pages/new?project-name=oplist-api&repository-url=https://github.com/PIKACHUIM/CFWorkerACME&build-command=npm%20run%20build-eo&install-command=npm%20install&output-directory=public&root-directory=./) | [<img src="https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg" alt="使用 EdgeOne Pages 部署" width="220" />](https://console.cloud.tencent.com/edgeone/pages/new?project-name=oplist-api&repository-url=https://github.com/PIKACHUIM/CFWorkerACME&build-command=npm%20run%20build-eo&install-command=npm%20install&output-directory=public&root-directory=./) |

由于腾讯云EdgeOne Pages目前尚且不支持D1数据库，如果使用腾讯云EdgeOne Pages部署，需要使用外部数据库，参考变量部分

---

## 🛠️ 技术栈

| 层级 | 技术 |
| :--- | :--- |
| **运行时** | Cloudflare Workers · EdgeOne Pages Functions · Node.js (Docker) |
| **后端** | [Hono](https://hono.dev/) · [acme-client](https://github.com/publishlab/node-acme-client) · `node-forge` · `crypto-js` |
| **前端** | React · Vite · TypeScript |
| **存储** | Cloudflare D1 (SQLite) |
| **邮件** | [Resend](https://resend.com/) |

---

## 📦 本地开发与部署

### Worker 证书工作流

当前 Cloudflare Worker 配置支持在申请时选择 DNS 账户和多个部署目标。所有访问、验证和下发逻辑都在 Worker 中执行，不需要客户端守护进程、代理或额外后端。D1 继续使用现有 `DB_CF` 绑定和 Confs/Apply/Users 表。

- CA 选项由 `/capabilities` 和 `/api/v1/capabilities` 返回实际配置状态；两套创建入口均在保存订单前校验。Google Public CA、ZeroSSL 和 SSL.com 复用现有全局账户私钥，并按目录与私钥指纹保存已注册账户 URL。
- Let's Encrypt 无需 EAB；Google Public CA 和 ZeroSSL 需要相应账户配置。SSL.com 免费 DV 的限制为单个 FQDN，不支持通配、多域名或 IP；其他产品的费用取决于账户产品，不能据此视为免费。未使用真实 CA 账户进行产品或费用验证。
- “DNS 验证账号”管理 DNS 凭据；“部署目标”管理 SSH / SFTP（可选仅上传文件、Nginx、Traefik，以及群晖 NAS）、HTTP / HTTPS、EdgeOne 和 ESA。私有 DNS 账号按实际申请名称逐级查找最具体的可访问区域，支持 `*.zetx.pp.ua` 等多级名称，不假设区域只有最后两段。部署目标默认只给资源拥有者下发其选中的证书，不需要预先填写域名；需要共享时才在高级设置里改为限制指定域名。ESA 上传至站点，EdgeOne 可仅上传或同时绑定域名。共享目标仍须限制域名，且不因管理员身份默认获得他人的资源使用权。
- 取消申请只停止后台处理并保留记录；永久删除是独立操作，需要完整订单 ID 确认，只删除本站资料而不调用 CA 吊销。需要吊销的证书应先吊销，再删除本站记录。部署/签发执行中会阻止不安全的删除。本站删除不会替你删除已经部署到云平台或服务器的副本。

### 后台签发与申请修改

提交申请表示服务器已受理，不表示证书已经签发。网页和开放 API 在保存成功后返回 `202 Accepted`，后续创建订单、配置 DNS、等待解析、验证和签发由后台持续推进。离开页面或关闭浏览器不会中断处理。

- DNS 账户自动验证不需要点击“立即处理”或“验证全部”。页面分别显示配置记录、等待生效、查询暂不可用、签发机构验证和已验证状态；详情页与证书列表会自动更新。
- 手动 TXT、HTTP 文件验证以及首次 CNAME 委派仍会明确提示需要配置的记录，完成配置后再检查。
- 修改申请会预填原参数，保留申请编号和创建时间。编辑期间暂停下一步处理；取消或离开编辑页后恢复。浏览器异常关闭时，编辑暂停会在十分钟后自动解除。
- 取消申请保留记录，不等于吊销已签发证书。续期失败或停止续期时保留匹配的原证书、私钥和到期时间。
- 证书签发、部署和验证记录清理分别跟踪。部署或清理失败不会把已签发证书标成失败；后台会有限重试，需要人工处理时显示具体原因。

Cloudflare 部署使用同一 Worker 内的 SQLite Durable Object 持久调度，任务和记录仍保存在现有数据库中，无需独立服务器。请使用项目的标准发布脚本，以保留后台绑定、迁移和 DNS 分片服务。

### 签发机构账户（EAB）

账户绑定凭据（EAB）只在**首次注册** ACME 账户时使用；注册完成后，账户由账户私钥标识并长期有效，后续签发和续期都不再需要 EAB。系统会把注册结果持久化，因此在已注册后即使 EAB 字段留空，该签发机构仍然可用。

各家的差异：

| 签发机构 | EAB | 说明 |
| --- | --- | --- |
| Let's Encrypt | 不需要 | 账户随用户私钥创建，长期有效 |
| Google Public CA | 需要，一次性 | EAB 只能使用一次，且必须在创建后 7 天内完成注册；**注册出的账户无有效期限制** |
| ZeroSSL | 需要，可复用 | 同一份 EAB 可重复使用，有每日次数上限 |
| SSL.com | 需要，可复用 | 账户创建后只需保留账户私钥 |

账户私钥（`*_KeyTS`）可以留空：系统会在首次需要时自动生成并保存。**不要随意更换账户私钥**，更换等于新账户，需要重新准备一份 EAB。若首次注册失败（例如 Google 的 EAB 已过期或已被使用），系统会直接说明原因并提示重新生成 EAB。

### DCV 托管

“DCV 托管”让用户只需配置一次 CNAME，后续续期由平台自动维护验证记录。它依赖一个管理员维护的专用子域名及其 DNS 编辑权限，因此在未配置时申请页会直接禁用该验证方式，后端也会在创建订单前拒绝，不会等到提交后才失败。

管理员在“系统管理”的 DCV 托管区域点击“启用 DCV 托管”，填写专用子域名（如 `dcv.example.com`）和 Cloudflare DNS API Token。Token 需包含该域名所在区域的区域读取与 DNS 编辑权限。启用时会在该子域名下临时写入并清理一条测试 TXT 记录以验证权限；成功后 Token 加密保存在服务端，不会回显。现有订单已有的委派目标保持不变。
- 管理员必须在 Worker secret 中配置 `AUTOMATION_KEY`，其值为 32 字节随机数据的 Base64 编码。资源凭据以随机 nonce 的 AES-GCM 加密，并绑定资源身份；未配置或格式不正确时禁止保存，不回退为明文。不要将密钥放入公开 vars、代码或 Confs。直接更换该密钥将使旧资源无法解密，需要重新录入凭据。
- 编辑时空白凭据表示保留原值；选择“替换全部已保存凭据”时必须重新填写所需凭据。被订单引用的资源不能直接删除。Cloudflare token 至少需要对应区域的读取和 DNS 修改权限；其他供应商凭据也应限制到所需区域和记录操作。
- 手动 TXT 仍需在每次续期更新记录。旧 CNAME 委派继续使用稳定目标；可通过管理员配置 `DCV_TARGET_PATTERN` 指定 `{hash}` / `{zone}` 模板，生成结果必须留在 `DCV_AGENT` 区域内。直接 DNS 账户不要求修改 NS 或设置 CNAME。
- 自动 TXT 使用独立记录句柄，通配与根域名的同名记录可共存。传播检查、验证状态和失败清理跨任务持久化推进，不删除整个 RRset。记录准备、验证和个人目标下发按小批次进行，剩余项由后续任务继续处理；签发状态与各目标部署状态分开记录。
- SSH 仅支持公网可达目标，端口必填；主机 SHA256 指纹可选，填写时严格校验，应从可信渠道获取。普通公网 Worker 不能访问任意私网地址。支持密码或私钥、受限超时、PEM/PFX、文件权限和非交互命令；检查命令与重载命令都允许写入多行 shell，Nginx 会暂存、备份、检查并重载，失败时尝试恢复文件及原配置。
- 群晖目标通过 DSM 管理接口导入证书，等同于登录 DSM 后在“控制面板 → 安全性 → 证书”里手工导入：使用 DSM 管理员账号（未启用两步验证，或填写当次验证码），按“证书描述”匹配已有证书并替换，描述不存在时按“同名证书不存在时新建”的开关决定新建或报错，可同时设为 DSM 默认证书。需要 DSM 地址从公网可达且使用受信任证书；不依赖 SSH，也不会改动服务器上的证书文件。
- Traefik 默认使用动态 PEM 配置。`acme.json` 模式需要明确 resolver、现有账户、持续停止外部写入方的确认、远端独占锁和替换前内容复查；保留其他 resolver 与证书，文件权限为 0600。远端锁不是 Traefik 自身遵循的跨进程锁，不能持续保证外部不写入时应选择动态 PEM。连接中断留下的锁需要先检查远端状态，不会擅自删除外部锁。
- HTTPS 目标必须使用公网 HTTPS 地址和认证头，不允许 URL 凭据、查询参数或跳转；可选 HMAC 使用 `timestamp.version.body` 签名。接收方应核对 `X-Certificate-Timestamp`、`X-Certificate-Version`、`X-Certificate-Signature` 和 `Idempotency-Key`，避免重放及重复应用。
- 订单的个人目标仅用于该订单及其续期；原管理员全局 EdgeOne/ESA 目标继续遵循原有匹配约定。失败目标可单独重试，不重新签发证书，也不重复下发未变化的成功目标。

创建接口 `/apply/` 与 `/api/v1/orders` 使用相同的选择字段，例如：

```json
{
  "domains": [{"name": "example.com", "type": "dns-api", "dnsAccountId": "saved-account-id"}],
  "globals": {"ca": "lets-encrypt", "encryption": "eccp256", "auto_renew": true},
  "targetIds": ["saved-target-id"],
  "subject": {}
}
```

资源管理接口为登录后访问的 `/resources/dns` 与 `/resources/targets`（GET/POST、`/:id` PUT/DELETE、`/:id/test` POST）。连接测试只证明当次区域读取或协议连通，不代表实际签发或部署成功。开放 API 可通过 `GET /api/v1/orders/:uuid/deployments` 查询状态，并通过 `POST /api/v1/orders/:uuid/deployments/:targetId/retry` 重试所选目标；使用原有 API 鉴权头。

Windows 本地验证使用 Node 22（测试使用进程内 SQLite），不访问远程 D1：

```powershell
& .\node_modules\.bin\tsx.cmd --test .\tests\certificate-workflow.test.ts
npm run build
& .\node_modules\.bin\wrangler.cmd deploy --dry-run
```

隔离 SSH 运行探测使用 `tests/wrangler.ssh-smoke.jsonc`，仅在本地 8793 启动。设置 `SSH_WORKER_SMOKE_URL=http://127.0.0.1:8793` 后，测试会临时启动 Windows 内存 SSH/SFTP 协议夹具；它不是应用后端或生产部署目标。设置 `WORKFLOW_UI_URL=http://127.0.0.1:5194` 后，UI 测试使用独立无头系统 Chrome 和无生产凭据的合成 API 样例，截图保存在 `_artifacts/certificate-workflow/`。未设置这些变量时，对应运行验收会明确跳过，不能视为通过。

已验证公网 GitHub SSH 主机指纹与握手，以及 workerd 对临时夹具的密码/私钥认证、SFTP、PEM/PFX、Nginx 失败恢复、Traefik 合并与权限。尚未验证真实 DNS 账户、真实 CA 签发、实际 Nginx/Traefik 服务或用户服务器部署，也未评估生产套餐下的大批量配额。完成所需生产验收前不要部署或修改实际 DNS/SSH 目标。

### 1. 克隆代码

```bash
git clone https://github.com/PIKACHUIM/CFWorkerACME.git
cd CFWorkerACME
```

### 2. 安装依赖

```bash
npm install
npm run web-install
```

### 3. 配置环境变量

参考下方示例创建并修改 `wrangler.jsonc`（仓库根目录）：

> 💡 仓库内附带的 [wrangler.encrypt.jsonc](wrangler.encrypt.jsonc) 是一份带占位符的示例，可直接复制后修改：
>
> ```bash
> cp wrangler.encrypt.jsonc wrangler.jsonc
> ```

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "cfworker-acme",
  "main": "src/cfapp.ts",
  "compatibility_date": "2025-03-10",
  "compatibility_flags": ["nodejs_compat"],
  "vars": {
    // ===== 数据库 =====
    "DB_SOURCE": "d1",                       // d1 / mysql / prisma
    // "DB_MYSQL_URL":  "",                  // DB_SOURCE=mysql 时使用，二选一
    // "DB_MYSQL_HOST": "", "DB_MYSQL_PORT": "3306",
    // "DB_MYSQL_USER": "", "DB_MYSQL_PASS": "", "DB_MYSQL_NAME": "",
    // "DATABASE_URL":  "",                  // DB_SOURCE=prisma 时使用

    // ===== 邮件通知 =====
    "MAIL_KEYS": "",                         // Resend API Key
    "MAIL_SEND": "noreply@example.com",      // 发件邮箱

    // ===== 安全 / 人机验证 =====
    "AUTH_KEYS": "",                         // Turnstile / hCaptcha / reCAPTCHA 的 Secret Key
    "SITE_KEYS": "",                         // Turnstile / hCaptcha / reCAPTCHA 的 Site Key

    // ===== DCV 自动验证代理（Cloudflare）=====
    "DCV_AGENT": "",                         // DCV 代理域名（根域名）
    "DCV_EMAIL": "account@example.com",      // CloudFlare 账号邮箱
    "DCV_TOKEN": "",                         // CloudFlare API Key / Token
    "DCV_ZONES": "",                         // CloudFlare Zone ID

    // ===== CA 厂商配置 =====
    "GTS_useIt": "",     "GTS_keyMC": "", "GTS_keyID": "", "GTS_KeyTS": "",  // Google Trust Service
    "SSL_useIt": "true", "SSL_keyMC": "", "SSL_keyID": "", "SSL_KeyTS": "",  // SSL.com
    "ZRO_useIt": "true", "ZRO_keyMC": "", "ZRO_keyID": "", "ZRO_KeyTS": ""   // ZeroSSL
  },
  "site": {
    "bucket": "./public"
  },
  "d1_databases": [
    {
      "binding": "DB_CF",
      "database_name": "workacme-db",
      "database_id": "<database-id>"
    }
  ],
  "observability": { "enabled": true, "head_sampling_rate": 1 },
  "triggers": { "crons": ["*/1 * * * *"] }
}
```

> Cloudflare 免费套餐对**每个账号**只允许 5 个 cron 触发器。若配额已被其它 Worker 占用，部署时会报
> `This account has reached the Workers Free limit of 5 cron triggers per account`。
> 此时请删除本文件的 `triggers` 字段，改用下文固定 `/cron` 入口由外部调度器驱动。

### 4. 本地调试

```bash
# Cloudflare Workers 本地调试（默认使用 wrangler.jsonc）
npm run dev-cf

# Cloudflare Workers 本地调试（使用 wrangler.encrypt.jsonc，含真实密钥时使用）
npm run dev-cf:test

# EdgeOne Pages 本地调试
npm run dev-eo

# 仅前端调试（http://localhost:5173）
npm run web-dev

# Node.js 自托管模式调试（不依赖 Workers / EdgeOne）
npm run dev-js
```

### 5. 部署到云端

#### ① 部署到 Cloudflare Workers

```bash
# 标准部署（自动构建前端 + 推送 Worker）
npm run deploy-cf

# 使用加密配置文件部署
npm run deploy-cf:test
```

> 首次部署前需先创建并绑定 D1 数据库：
>
> ```bash
> wrangler d1 create workacme-db            # 1. 创建数据库
> wrangler d1 execute workacme-db --remote --file schema.set.sql   # 2. 初始化表结构
> ```
>
> 把上一步输出的 `database_id` 填入 `wrangler.jsonc` 的 `d1_databases[0].database_id` 后再执行 `npm run deploy-cf`。

---

## ⚙️ 自动化

后台维护只有固定认证入口，不需要创建端点、勾选任务或开启开关。管理员可在 `/admin/automation` 复制调用地址并查看运行记录。

```bash
curl "https://<你的域名>/cron?token=<令牌>"
```

响应示例：

```json
{
  "ok": true,
  "status": "ok"
}
```

支持 GET/POST。外部监控也可以把令牌放在 `X-Trigger-Token` 请求头而不是 URL。旧的 `/trigger/scheduled` 仅保留迁移兼容，复用原令牌；不再提供可编辑触发器。旧任务开关不控制维护执行，数据库执行锁避免并发重复工作。

每次维护自动恢复任务、安排临近到期证书续期、重试所选部署目标和清理验证记录。单个申请仍由 Worker 内持久闹钟独立推进，不依赖页面停留，也无需用户点击“立即处理”。

### 云部署目标

云证书与本站申请的关联保存在订单目标状态中，证书签发、上传、绑定和异步更新任务分别处理。失败不会把签发结果改成失败。旧全局边缘下发不再执行；所有部署必须来自订单选择的目标。

新增云部署目标时，选择与实际账号一致的“中国站”或“国际站”，不要混用密钥与站点 ID。旧目标默认中国站；切换站点会清空表单中的站点、域名和云证书 ID，并要求填写新站点凭据，避免继续复用另一站的资源。

| 服务 | 中国站 API | 国际站 API |
| --- | --- | --- |
| 阿里云 ESA | `esa.cn-hangzhou.aliyuncs.com`（杭州） | `esa.ap-southeast-1.aliyuncs.com`（新加坡） |
| 腾讯 EdgeOne | `teo.tencentcloudapi.com` | `teo.intl.tencentcloudapi.com` |
| 腾讯 SSL | `ssl.tencentcloudapi.com` | `ssl.tencentcloudapi.com`（官方共用地址） |

部署失败或连接检查失败后，悬停、聚焦或点击错误说明可查看请求方法、实际 API 地址、动作、HTTP 状态与响应 Body。签名授权、Token、密钥和证书私钥会隐藏，过长响应会截断，HTML 响应只按文字显示。旧版本保存的错误没有完整请求记录，需要重新检查或重新部署后生成详细诊断，不能追溯补造历史 Body。

官方参考：[ESA 服务接入点](https://help.aliyun.com/zh/edge-security-acceleration/esa/api-esa-2024-09-10-endpoint)、[EdgeOne 国际站请求结构](https://intl.cloud.tencent.com/document/product/1145/50456)、[国际站 SSL 上传 API](https://edgeone.ai/document/36579)。

| 平台 | 调用链 | 所需权限 |
| --- | --- | --- |
| 腾讯云 EdgeOne | 上传至 SSL 控制台，可选绑定；续期检查旧资源关联更新结果 | `ssl:UploadCertificate`、`ssl:UpdateCertificateInstance`、`ssl:DescribeHostUpdateRecordDetail`；绑定模式额外需要 `teo:DescribeZones`、`teo:DescribeAccelerationDomains`、`teo:DescribeHostsSetting`、`teo:ModifyHostsCertificate` |
| 阿里云 ESA | `esa:SetCertificate`（`Type=upload`） | `esa:ListSites`、`esa:SetCertificate` |

- ESA：首次上传后保存云端 `Id`，后续 `SetCertificate` 带同一 `Id` 更新，不另行绑定域名。可填写已有 `certificate_id` 接管现有证书。
- EdgeOne：`UploadCertificate` 创建新 SSL 证书 ID，不保证原 ID 不变。系统保存新旧 ID，通过官方异步更新迁移 EdgeOne 资源关联，只有成功才标记完成；不会擅自删除旧云证书。仅上传模式不要求站点或加速域名。
- 绑定模式会检查证书覆盖范围，并查询每个域名已有证书：更新 RSA 保留 ECC，更新 ECC 保留 RSA，每种最多一本，不支持 SM2；无法确认原算法时拒绝覆盖。
- 私有云目标默认只处理本人选择的证书；共享仍需明确域名范围。不存在把空范围广播到所有用户申请的行为。
- 已经选用 Cloudflare `scheduled()` 的部署使用同一个固定维护流程，不再有页面开关或任务列表。

#### ② 部署到 EdgeOne Pages

```bash
# 需在末尾追加 EdgeOne Token
npm run deploy-eo -- <EDGEONE_TOKEN>
```

> Token 可在 [EdgeOne 控制台 → 个人中心 → API Token](https://console.cloud.tencent.com/edgeone/pages) 获取。EdgeOne 暂不支持 D1，需要在控制台环境变量中配置 `DB_SOURCE=mysql` 或 `prisma` 并提供对应连接串。

### 6. Node.js / Docker 自托管部署（可选）

#### ① 直接使用 Node.js 运行

```bash
cp .env.example .env       # 编辑 .env 填入环境变量
npm run build-js           # 使用 webpack 打包到 dist/bundle.js
npm run deploy-js          # 启动服务（默认监听 3000 端口）
```

#### ② Docker Compose 一键部署（推荐）

```bash
docker compose up -d
```

> 默认使用官方镜像 `pikachuim/newssl:latest`。请先编辑 [docker-compose.yml](docker-compose.yml) 填入环境变量。**注意**：Docker 镜像内部使用 `OPLIST_` 前缀注入变量（如 `OPLIST_MAIL_KEYS`、`OPLIST_DCV_TOKEN`），程序运行时会自动剥离前缀映射到对应变量。

#### ③ 自行构建镜像

项目提供两种 Dockerfile 方案：

| 文件 | 基础镜像 | 适用场景 |
| :--- | :--- | :--- |
| [Dockerfile](Dockerfile) | `node:lts` (Debian) | **完整版**：内置 D1 (本地 SQLite 模拟) + cron 定时任务，开箱即用 |
| [Dockerfile-Lite](Dockerfile-Lite) | `node:lts-alpine` | **轻量版**：体积小，需配合外部 MySQL / Prisma 与外部定时器 |

```bash
# 构建完整版
docker build -t certhub:latest -f Dockerfile .

# 构建轻量版
docker build -t certhub:lite -f Dockerfile-Lite .

# 启动（请按实际情况补全 -e 环境变量）
docker run -d --name certhub -p 3000:3000 \
  -e MAIL_KEYS="" -e MAIL_SEND="" \
  -e DCV_AGENT="" -e DCV_EMAIL="" -e DCV_TOKEN="" -e DCV_ZONES="" \
  certhub:latest
```

---

## ⚙️ 配置说明

> 所有变量均通过 `wrangler.jsonc` 的 `vars` 段（Cloudflare Workers）、EdgeOne 控制台环境变量、或 `.env` 文件（Docker / Node.js）注入。**部分变量也可在「系统管理」→「全局配置」页面运行时动态修改**，运行时配置优先级 **高于** 环境变量。

### 1️⃣ 数据库配置（DB_*）

本项目支持 **三种数据源**，通过 `DB_SOURCE` 切换：

| 变量 | 必填 | 默认值 | 说明 |
| :--- | :--: | :--- | :--- |
| `DB_SOURCE` | ✅ | `d1` | 数据源类型：`d1` / `mysql` / `prisma` |
| `DB_CF` | △ | — | **Cloudflare D1 数据库绑定**（`DB_SOURCE=d1` 时必填，在 `wrangler.jsonc` 的 `d1_databases` 中配置） |
| `DB_MYSQL_URL` | △ | — | **MySQL 完整连接串**（推荐），如 `mysql://user:pass@host:3306/db` |
| `DB_MYSQL_HOST` | △ | — | MySQL 主机（未提供 `DB_MYSQL_URL` 时必填） |
| `DB_MYSQL_PORT` | ❌ | `3306` | MySQL 端口 |
| `DB_MYSQL_USER` | △ | — | MySQL 用户名 |
| `DB_MYSQL_PASS` | △ | — | MySQL 密码 |
| `DB_MYSQL_NAME` | △ | — | MySQL 数据库名 |
| `DATABASE_URL` | △ | — | **Prisma 数据库连接串**（`DB_SOURCE=prisma` 时使用） |

> 💡 Cloudflare Workers 环境强烈建议使用 `d1`；自托管 / Docker 环境推荐 `mysql` 或 `prisma`。

### 2️⃣ 邮件通知（MAIL_*）

| 变量 | 必填 | 说明 | 示例 / 获取 |
| :--- | :--: | :--- | :--- |
| `MAIL_KEYS` | ✅ | Resend API Key（用于发送邮件通知、邮箱验证、签发提醒等） | `re_wvRR+z5AqmL...` · [获取](https://resend.com/api-keys) |
| `MAIL_SEND` | ✅ | Resend 发件邮箱（必须为 Resend 已验证域名下的邮箱） | `noreply@example.com` |

### 3️⃣ 人机验证（AUTH_KEYS / SITE_KEYS）

用于登录、注册、申请证书等敏感操作的人机验证，支持 Cloudflare Turnstile / hCaptcha / reCAPTCHA。

| 变量 | 必填 | 说明 | 获取 |
| :--- | :--: | :--- | :--- |
| `AUTH_KEYS` | ❌ | 验证码 **Secret Key**（服务端校验密钥） | [Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile) |
| `SITE_KEYS` | ❌ | 验证码 **Site Key**（前端展示密钥） | 同上 |

> 💡 **优先级**：「系统管理」页面运行时配置 > 环境变量 > 旧键 `CERT_CAPTCHA_SECRET_KEY` / `CERT_CAPTCHA_SITE_KEY`（兼容回退）。两个 Key 都为空时人机验证自动关闭。

### 4️⃣ DCV 自动验证代理（DCV_*，🌟强烈推荐）

> 配置 DCV 代理后，**只需设置一次 CNAME 记录** 即可永久自动续期，无需每次申请都手动添加 TXT 记录。

| 变量 | 必填 | 说明 | 获取 / 示例 |
| :--- | :--: | :--- | :--- |
| `DCV_AGENT` | ✅ | DCV 代理域名（**已托管在 Cloudflare 的根域名**） | `dcv.example.com` |
| `DCV_EMAIL` | ✅ | Cloudflare 账号邮箱 | `user@example.com` |
| `DCV_TOKEN` | ✅ | Cloudflare Global API Key 或具备 DNS 编辑权限的 Token | [API Tokens](https://dash.cloudflare.com/profile/api-tokens) |
| `DCV_ZONES` | ✅ | `DCV_AGENT` 域名所属的 **Cloudflare Zone ID** | [Cloudflare Dashboard](https://dash.cloudflare.com/) → 域名概览右侧 |

### 5️⃣ CA 厂商配置（XXX_*）

每个 CA 都遵循 **`XXX_useIt` / `XXX_keyMC` / `XXX_keyID` / `XXX_KeyTS`** 的命名规则：

| 前缀 | CA 厂商 | EAB 凭证获取 |
| :--- | :--- | :--- |
| `GTS_` | Google Trust Service | [Public CA Tutorial](https://cloud.google.com/certificate-manager/docs/public-ca-tutorial?hl=zh-cn) |
| `SSL_` | SSL.com ACME | [SSL.com Account](https://secure.ssl.com/account) |
| `ZRO_` | ZeroSSL ACME | [ZeroSSL Developer](https://app.zerossl.com/developer) |

| 字段后缀 | 含义 | 示例 |
| :--- | :--- | :--- |
| `XXX_useIt` | 是否启用该 CA（`true` 启用；空字符串或留空表示禁用） | `true` |
| `XXX_keyID` | EAB 账号 ID（External Account Binding Key ID） | `bfc7fb688d84` |
| `XXX_keyMC` | EAB-MAC 密钥（HMAC Key） | `2SfXncG3Akx...` |
| `XXX_KeyTS` | ACME 账号私钥（PEM 格式，需保留 `\n` 换行） | `-----BEGIN PRIVATE KEY-----\n...` |

> 💡 **Let's Encrypt** 不需要 EAB，默认始终启用。但其在 Cloudflare Workers 上会出现 SSL 525 错误，需要使用 Nginx 反向代理（见下方[备注说明](#-备注说明)）。

### 6️⃣ 完整变量速查表

<details>
<summary>📋 点击展开 / 收起 全部变量速查表</summary>

| 分类 | 变量名 | 必填 | 说明 |
| :--- | :--- | :--: | :--- |
| 数据库 | `DB_SOURCE` | ✅ | 数据源类型：`d1` / `mysql` / `prisma` |
| 数据库 | `DB_CF` | △ | Cloudflare D1 绑定（`d1` 模式必填） |
| 数据库 | `DB_MYSQL_URL` | △ | MySQL 完整连接串（`mysql` 模式二选一） |
| 数据库 | `DB_MYSQL_HOST` | △ | MySQL 主机 |
| 数据库 | `DB_MYSQL_PORT` | ❌ | MySQL 端口（默认 3306） |
| 数据库 | `DB_MYSQL_USER` | △ | MySQL 用户 |
| 数据库 | `DB_MYSQL_PASS` | △ | MySQL 密码 |
| 数据库 | `DB_MYSQL_NAME` | △ | MySQL 数据库名 |
| 数据库 | `DATABASE_URL` | △ | Prisma 连接串（`prisma` 模式使用） |
| 邮件 | `MAIL_KEYS` | ✅ | Resend API Key |
| 邮件 | `MAIL_SEND` | ✅ | Resend 发件邮箱 |
| 验证码 | `AUTH_KEYS` | ❌ | 人机验证 Secret Key |
| 验证码 | `SITE_KEYS` | ❌ | 人机验证 Site Key |
| DCV | `DCV_AGENT` | ✅ | DCV 代理根域名 |
| DCV | `DCV_EMAIL` | ✅ | Cloudflare 账号邮箱 |
| DCV | `DCV_TOKEN` | ✅ | Cloudflare API Key |
| DCV | `DCV_ZONES` | ✅ | Cloudflare Zone ID |
| 站点 | `MAIN_URLS` | ❌ | 站点主域名（Node.js / Docker 模式邮件链接拼接用） |
| CA · GTS | `GTS_useIt` / `GTS_keyMC` / `GTS_keyID` / `GTS_KeyTS` | ❌ | Google Trust Service |
| CA · SSL | `SSL_useIt` / `SSL_keyMC` / `SSL_keyID` / `SSL_KeyTS` | ❌ | SSL.com |
| CA · ZRO | `ZRO_useIt` / `ZRO_keyMC` / `ZRO_keyID` / `ZRO_KeyTS` | ❌ | ZeroSSL |

说明：✅ 必填　❌ 可选　△ 条件必填（依赖其它变量取值）

</details>

---

## 📝 备注说明

### Let's Encrypt 反向代理配置

`Let's Encrypt` 在 Cloudflare Worker 上会抛出 SSL 连接失败问题（525 错误）。本项目默认使用代理 `https://encrys.524228.xyz/directory`，你也可以使用 Nginx 自建：

```nginx
location ^~ /directory {
    proxy_pass https://acme-v02.api.letsencrypt.org/directory;
    sub_filter acme-v02.api.letsencrypt.org encrys.524228.xyz;
    sub_filter_types *;
    sub_filter_once off;
    proxy_set_header Host acme-v02.api.letsencrypt.org;
    proxy_set_header Accept-Encoding "";
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_http_version 1.1;
    add_header X-Cache $upstream_cache_status;
    add_header Cache-Control no-cache;
}

location /acme/ {
    proxy_pass https://acme-v02.api.letsencrypt.org/acme/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_http_version 1.1;
    add_header X-Cache $upstream_cache_status;
    add_header Cache-Control no-cache;
}
```

---

## DNS 供应商目录与更新

DNS 账户目录和凭据字段从锁定版本的 lego 上游源码生成，不逐家维护前端表单。当前版本为 `v5.5.2`：共收录 223 家，其中 212 家已构建到 31 个 Worker 执行分片，11 家因运行环境或清理安全问题禁用。已构建不等于已逐家通过真实账户签发测试。

执行分片没有公网入口，通过主站的 Cloudflare Service Bindings 调用。凭据仍在主站加密保存，写入记录、DNS 传播检查、ACME 验证和记录清理在同一 provider 实例生命周期中完成。普通账户不能修改执行器版本或绕过验证。

对标为“需验证账户”的供应商，先保存凭据，再使用账户测试执行写入、传播与清理检查。测试会修改所填域名的 ACME TXT 记录，请使用有权管理的域名。更换凭据、修改配置或更新执行分片后，原验证记录失效，需要重新测试。明确不兼容的供应商不可通过此流程启用。

在 Windows 原生终端、项目根目录执行：

```powershell
npm run providers:update
npm run deploy-cf
```

`providers:update` 同步锁定上游、生成凭据目录及分组、构建全部分片，并运行测试、体积与一致性门禁。`deploy-cf` 构建前端后，校验或恢复远端分片，补传变更部分，最后发布带完整服务绑定的主站。不要绕过该入口直接发布不含分片绑定的原始配置。

升级到新的上游版本时，需要更新同步脚本中的固定版本及 Go module checksum，并核对 DoH 兼容补丁的上游文件哈希。补丁上下文改变时流程会拒绝更新，不会默默应用旧补丁，也不会沿用旧版本的运行测试证据。新增、移除和变更供应商会生成差异报告。

发布过程使用现有的 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID` 环境变量，不会启用收费套餐。恢复点、构建报告和线上运行检查结果保存在 git 忽略的 `_artifacts/lego-dns/` 下。`AUTOMATION_KEY` 不会在发布时轮换。

## ❓ 常见问题

<details>
<summary><b>Q：已经有 <code>acme.sh</code> 了，为什么还需要 CertHub？</b></summary>

1. **多机共享**：`acme.sh` 是单机证书申请脚本；CertHub 解决 **多服务器 / 内网共用同一证书** 的同步下发问题，可通过网页或 API 同步证书。
2. **永久 CNAME**：`acme.sh` 申请通配符证书时需要重复设置 TXT 记录；CertHub **只需设置一次 CNAME** 即可永久续期。
3. **零门槛**：如果你熟悉 `acme.sh` 且没有上述需求，使用 `acme.sh` 也完全够用。

</details>

<details>
<summary><b>Q：和宝塔 / 1Panel 的 SSL 证书申请功能有什么区别？</b></summary>

定位类似来此加密（<https://lcjm.cc/>），把申请验证过程移到了 **服务端 / Serverless 平台**，更方便 DCV 代理与多端同步。

</details>

<details>
<summary><b>Q：演示平台安全可靠吗？</b></summary>

演示平台 **不会主动泄漏** 您的密钥数据，但无法保证您的证书密钥 100% 安全。如对安全性有较高要求，**强烈建议使用自己的 Cloudflare / EdgeOne 账号私有化部署**。本项目完全开源，可审计。

</details>

---

## 💚 项目赞助

本项目 CDN 加速及安全防护由 **Tencent EdgeOne** 赞助：EdgeOne 提供长期有效的免费套餐，包含不限量的流量和请求，覆盖中国大陆节点，且无任何超额收费。

🔗 [亚洲最佳 CDN、边缘和安全解决方案 - Tencent EdgeOne](https://edgeone.ai/zh?from=github)

<p align="center">
  <img src="https://edgeone.ai/media/34fe3a45-492d-4ea4-ae5d-ea1087ca7b4b.png" alt="EdgeOne" width="400" />
</p>

---

## 🔗 引用与致谢

- [acmesh-official/acme.sh](https://github.com/acmesh-official/acme.sh) — A pure Unix shell script implementing ACME client protocol
- [publishlab/node-acme-client](https://github.com/publishlab/node-acme-client) — Simple and unopinionated ACME client for Node.js
- [Hono](https://hono.dev/) — Ultrafast web framework for the Edges

---

## 📄 License

本项目基于 [GNU GPL v3](LICENSE) 开源，完整条款以 LICENSE 文件为准。

<div align="center">

**如果这个项目对你有帮助，请点一颗 ⭐ Star 支持一下！**

</div>