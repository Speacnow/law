# 部署与更新指南

三种部署方式，**共用同一套同步逻辑**（`tools/sync.py`），区别只是「谁在什么时候触发它」。

| 方式 | 谁提供页面 | 谁触发更新 | 手机能看 | 点击更新 | 费用 |
| --- | --- | --- | --- | --- | --- |
| [一、本机](#一本机windows推荐先用这个) | `server.py` | 服务内置定时 | 同一局域网 / 隧道 | ✅ 原生 | 0 |
| [二、GitHub](#二github--pages) | GitHub Pages | GitHub Actions | ✅ | 需配 Worker | 0 |
| [三、Cloudflare](#三cloudflare-pages--worker) | Cloudflare Pages | GitHub Actions + Worker | ✅ | ✅ | 0 |

> 建议顺序：先在本机跑通（10 分钟），确认内容和按钮都正常，再上 GitHub / Cloudflare。

---

## 0. 先理解三件事

**① 页面只读本地文件。** 打开网页时不抓数据，只读 `data/` 下的 JSON，所以快、能离线、手机流量小。

**② 更新是一次「抓取 → 写盘 → 提交」。** 由 `tools/sync.py` 完成：

```
查版本 lawVersion ── 没变 → 直接结束（1 秒）
      ↓ 变了
拉目录 listV2 → 对比出新增/下架/改名
      ↓
拉正文（8 个学科各 1 次请求，约 3 秒）
      ↓
写 data/catalog.json + data/laws/*.json
```

**③ 三个入口调用同一个脚本：**

| 入口 | 形态 | 用在哪 |
| --- | --- | --- |
| 命令行 | `python tools/sync.py --once` | 本机计划任务、GitHub Actions、任何 CI |
| HTTP | `POST /api/update` | 本机 `server.py`、Cloudflare Worker |
| 定时线程 | `server.py` 内置 | 本机常驻时自动跑 |

---

## 一、本机（Windows，推荐先用这个）

### 1.1 准备

- Windows 10/11
- Python 3.11 及以上（[下载](https://www.python.org/downloads/)，安装时勾选 **Add python.exe to PATH**）
- 项目放在 `E:\Code\law`（路径随意，后面命令按自己的改）

验证：

```bat
python --version
```

### 1.2 启动

双击项目里的 **`start.bat`**。

它会做三件事：检查 Python → 启动服务（本机 + 局域网）→ 1 秒后自动打开浏览器。

窗口里应该看到：

```
法律法规汇编已启动
本机访问: http://127.0.0.1:8123
局域网访问: http://192.168.0.101:8123  ← 手机用这个
同步接口: POST /api/update（?force=1 强制） · 版本检查: GET /api/status
后台自动同步: 启动时 + 每 24 小时检查一次版本
```

> 关闭这个黑窗口 = 停止服务，网页就打不开了。**别关它，最小化即可。**
> 同一时间只跑**一个** `server.py`：再开一个会提示「端口 8123 已经有服务在运行」。
> 只想给自己用、不暴露到局域网：`python server.py --bind 127.0.0.1`。

### 1.3 验证

1. 打开 http://127.0.0.1:8123，左侧点「民法 → 民法典」，右侧应出现正文和章节目录；
2. 点右上角 **同步更新**，几秒后右下角提示「已是最新版本」（版本没变时不会重复抓）；
3. 页脚显示「数据更新于 … · 8 个学科 · 247 部」。

### 1.4 自动更新

`server.py` 自带后台线程：**启动时补跑一次，之后每天检查一次版本号**。版本没变就直接跳过（不到 1 秒），变了自己抓。

同步带跨进程文件锁（`data/.sync.lock`）：万一你有两个实例或定时任务撞在一起，只有一个真正执行，另一个打印「另一个进程正在同步，本次跳过」；写文件走「临时文件 + 重试替换」，遇到只读或短暂占用会自动重试并兜底覆盖，不会让整次同步失败。

想改间隔（单位小时）：

```bat
python server.py --sync-interval 12
```

如果电脑不是每天开，建议再加一个 Windows 计划任务（电脑开机时补一次）：

```bat
schtasks /create /tn "LawCatalogSync" /tr "cmd /c cd /d E:\Code\law && python tools\sync.py --once" /sc daily /st 08:00
```

> 不想自动同步：`python server.py --no-auto-sync`。

### 1.5 手机访问（局域网 / 外网）

**`start.bat` 默认就监听局域网**（`--bind 0.0.0.0`），双击后会把可用的局域网地址打印出来：

```
局域网访问: http://192.168.1.5:8123
```

手机上打开这个地址即可。三个常见坑：

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 手机一直转圈/无法访问 | 服务只绑了 `127.0.0.1` | 用 `start.bat`（默认 0.0.0.0），或手动 `python server.py --bind 0.0.0.0` |
| 地址填的是 `192.168.137.1` 之类连不上 | 那是 Windows「移动热点 / 网络共享」的虚拟网卡，只有手机连这个热点时才通 | 用 `ipconfig` 里 **WLAN** 那段的 IPv4 地址（如 `192.168.1.5`） |
| 电脑能开、手机不行 | 防火墙拦截 8123 | 首次启动勾选「专用网络」允许；或管理员运行：`netsh advfirewall firewall add rule name="LawCatalog 8123" dir=in action=allow protocol=TCP localport=8123` |

另外两点：手机和电脑要连**同一个 WiFi**；部分路由器/公司网络开了「AP 隔离」，设备之间不能互访，需要关掉。

外网推荐 **Cloudflare Tunnel**（免费，不用改路由器）：

```bat
cloudflared tunnel --url http://127.0.0.1:8123
```

它会给你一个 `https://xxx.trycloudflare.com` 的临时地址，手机直接开。

---

## 二、GitHub + Pages

适合：手机随时能看、不想让电脑一直开着。**更新由 GitHub Actions 每天跑，跟你看不看网页无关。**

### 2.1 准备

- GitHub 账号
- 本机已装 Git

### 2.2 建仓库并推送

```bat
cd /d E:\Code\law
git init
git add .
git commit -m "init: 法律法规汇编"
git branch -M main
git remote add origin https://github.com/你的用户名/law.git
git push -u origin main
```

> 仓库 **公开**：Pages 免费。**私有**：Pages 需要付费套餐，建议改用第三节 Cloudflare。

### 2.3 打开 Actions 写权限

仓库 → `Settings` → `Actions` → `General` → 拉到最下面 **Workflow permissions** → 选 **Read and write permissions** → `Save`。

> 不做这一步，Actions 提交时会 `403`。

### 2.4 开启 Pages

仓库 → `Settings` → `Pages` → **Source** 选 `Deploy from a branch` → 分支 `main`、目录 `/ (root)` → `Save`。

等 1 分钟，地址是：`https://你的用户名.github.io/law/`

### 2.5 先手动跑一次同步

仓库 → `Actions` → 左侧「同步法律法规」→ 右侧 **Run workflow** → `Run workflow`。

约 1–2 分钟后：`data/` 下出现提交 `chore: 同步法律法规 …`，Pages 自动重新发布。

### 2.6 每天自动

`on.schedule` 已经写好：**每天 06:00（北京时间）**。不用再配置。

工作流里还带了一个**心跳**步骤（`tools/heartbeat.py`）：如果距上次心跳超过 25 天，就写一次 `data/heartbeat.json` 并提交。这样即使法条两个月没变化，仓库也不会「60 天无提交」，定时任务不会被 GitHub 暂停。本地想手动更新心跳：

```bat
python tools/heartbeat.py --force
```

验证方法：Actions 页面能看到定时运行记录；页脚时间会跟着变。

### 2.7 让页面上的按钮也能用（可选）

GitHub Pages 上没有后端，按钮默认会提示「未配置同步接口」。加一个免费的 Cloudflare Worker 即可（10 分钟）：

1. 按 [3.3](#33-部署-worker免费) 部署 Worker；
2. 把 `assets/config.js` 改成：

```js
// xxx = 你 Cloudflare 账号的 workers.dev 子域（部署 Worker 时打印出来的那个），不是 GitHub 用户名
syncEndpoint: "https://law-sync.xxx.workers.dev/api/update",
asyncSync: true,
```

3. 提交推送，等 Pages 重新发布。

之后点按钮 → Worker 触发 Actions → 页面每 10 秒查一次数据，1–2 分钟后自动刷新。

---

## 三、Cloudflare Pages + Worker

适合：**想要手机打开快、按钮能点、还想免费**。国内访问通常比 GitHub Pages 稳一些，但仍不如备案的国内节点。

### 3.1 准备

- Cloudflare 账号（免费注册）
- 已推到 GitHub 的仓库（私有也行，Pages 支持）
- 本地装 Node.js（仅部署 Worker 时用；用后台网页版可以跳过）

### 3.2 部署 Pages

**方式 A：网页版（推荐）**

1. 登录 Cloudflare 控制台 → `Workers & Pages` → `Create` → `Pages` → `Connect to Git`；
2. 选你的仓库 → 框架预设选 **None**；
3. Build command **留空**，Build output directory 填 `/`；
4. `Save and Deploy`。

得到地址：`https://law.pages.dev`（项目名可改）。

**方式 B：命令行**

```bat
npm i -g wrangler
wrangler login
cd /d E:\Code\law
wrangler pages deploy . --project-name law
```

> 注意：`wrangler pages deploy` 是直接上传当前目录，之后仓库更新不会自动同步，需要重新执行。想要自动更新请用方式 A。

### 3.3 部署 Worker（免费）

Worker 只做一件事：把「点按钮」转成「触发 GitHub Actions」。

1. 创建 GitHub 细粒度 Token：
   - GitHub → `Settings` → `Developer settings` → `Personal access tokens` → `Fine-grained tokens` → `Generate new token`；
   - 仓库选你的 `law` 仓库；
   - 权限：**Actions: Read and write**、**Contents: Read**；
   - 复制 token（只显示一次）。

2. 部署：

```bat
cd /d E:\Code\law\cloudflare
npm i -g wrangler
wrangler login
wrangler deploy
wrangler secret put GITHUB_TOKEN        # 粘贴上一步的 token
```

3. 修改 `wrangler.toml` 里的 `GITHUB_REPO = "你的用户名/law"`，再 `wrangler deploy` 一次。

> **`https://law-sync.xxx.workers.dev` 里的 `xxx` 是什么？**
>
> 是**你 Cloudflare 账号的 `workers.dev` 子域**，不是 GitHub 用户名，和仓库无关。
>
> - `law-sync` 是 `cloudflare/wrangler.toml` 里的 `name`（Worker 名字），可以改；
> - `xxx` 是第一次部署 Worker 时 Cloudflare 让你取的名字（或自动分配），**整个账号只有一个**；
> - `wrangler deploy` 成功后会直接打印完整地址，形如：
>
>   ```
>   Deployed law-sync triggers
>   https://law-sync.xxx.workers.dev
>   ```
>
> - 也可以在 Cloudflare 后台查：`Workers & Pages` 首页显示「Your subdomain: xxx.workers.dev」，
>   或进入该 Worker → `Settings` → `Domains & Routes`，里面有一条 `law-sync.xxx.workers.dev`。
> - 如果还没部署 Worker（只用 GitHub Pages），这个地址就不存在，`config.js` 留空即可。

4. 验证（把 `xxx` 换成你自己的子域）：

```bat
curl -X POST https://law-sync.xxx.workers.dev/api/update
```

返回 `{"ok":true,"async":true,...}` 就通了，同时 GitHub Actions 里会出现一次运行。

> Worker 的每天定时（`crons`）是兜底：GitHub 的定时万一被延迟，它也会触发一次。
> 想限制来源：把 `ALLOW_ORIGIN` 改成你的站点域名；想加密钥：`wrangler secret put SYNC_KEY`，并在 `config.js` 里填 `syncKey`。

### 3.4 让页面指向 Worker

编辑 `assets/config.js`：

```js
// xxx 换成你的 workers.dev 子域，例如 https://law-sync.speacnow.workers.dev/api/update
syncEndpoint: "https://law-sync.xxx.workers.dev/api/update",
asyncSync: true,
```

提交推送（Pages 会自动重新部署）。

### 3.5 验证

1. 手机打开 `https://law.pages.dev`，点一部法，正文能出来；
2. 点右上角「同步更新」→ 提示「已触发同步」→ 1–2 分钟后自动刷新，页脚时间变化；
3. 若提示「无法连接同步服务」，见下面第 6 节。

---

## 四、三条路径怎么切换

改动只在两处：

| 想切换成 | 改 `assets/config.js` | 谁来跑同步 |
| --- | --- | --- |
| 本机 | `syncEndpoint: ""`、`asyncSync: false` | `server.py` 内置定时 |
| GitHub（无按钮） | 留空即可 | GitHub Actions |
| GitHub + Worker | 填 Worker 地址、`asyncSync: true` | GitHub Actions（按钮触发） |
| Cloudflare Pages | 同 GitHub + Worker | 同上 |

同步逻辑一行都不用改——它始终是 `tools/sync.py`。

---

## 五、数据说明

```
data/
├─ catalog.json            目录（学科 → 法律 → 章节数）
├─ catalog.js              同上，页面 <script> 直接加载
├─ laws/<lawId>.json       单部法正文（章节 + 条文），按需加载
├─ content-manifest.json   正文清单（哈希/章节数/字数）
├─ sync-state.json         上次同步的版本号（用于跳过无变化）
├─ last-update.json        上次同步结果（页面提示用）
└─ changelog/YYYY-MM-DD.json  每次变更的记录
```

当前规模：**8 学科 / 247 部 / 1033 章 / 187 万字 / 约 5.7 MB**。
单部法最大约 330 KB（民法典），手机按需加载单部，不会一次拉全站。

数据来源：

```
GET  /api/laws/listV2                        目录树
POST /api/laws/info   {"id": 学科id}          该学科全部章节正文
GET  /api/office/laws/lawVersion             版本号
```

---

## 六、常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 点按钮提示「无法连接同步服务」 | 页面没有后端，或 `config.js` 没配 | 本机用 `server.py` 启动；线上配 `syncEndpoint` |
| 按钮转圈很久后提示「同步超时」 | 源站慢 / 网络不通 | 重试；或先跑 `python tools/sync.py --check` 看能否连上 |
| 点了按钮但数据没变 | 版本号没变（正常） | 页脚看版本；确实有新法再看 `/api/status` |
| GitHub Actions 提交 403 | 没开写权限 | 第 2.3 步 |
| Pages 打开 404 | 分支/目录选错 | `main` + `/ (root)` |
| Actions 定时不跑了 | 仓库 60 天无提交被暂停 | 已内置**心跳**（`tools/heartbeat.py`，每月自动提交一次时间戳）；万一还是停了，Actions 页面点 `Enable workflow` |
| 定时比预期晚 | GitHub cron 有 5–15 分钟延迟 | 正常，周更无所谓 |
| 正文 404 / 「该法正文尚未同步」 | 新增的法还没同步 | 点同步，或等下一次定时 |
| Windows 控制台中文乱码 | 终端编码 | 用 `start.bat`（已 `chcp 65001`） |
| 双击 `start.bat` 弹「Windows 安全中心无法打开此文件 / Internet 安全设置阻止打开一个或多个文件 …NUL」 | ① bat 若是 Linux 换行（LF），cmd 解析 `start … >nul` 会走偏（**已改成 CRLF**）② 文件带「来自网络」标记，或直接在压缩包里双击 | 先解压到本地再双击；右键文件 → 属性 → 勾选「解除锁定」；或 PowerShell 执行 `Get-ChildItem -Recurse \| Unblock-File` |
| 双击 `start.bat` 提示「端口 8123 已经有服务在运行」 | 之前开的窗口还没关（Windows 允许两个进程绑同一端口，现已加独占与启动前探测） | 关掉旧窗口再双击；或 `python server.py --port 8124` |
| 控制台 `[自动同步] 失败：[WinError 5] 拒绝访问 …tmp` | 开了两个 `server.py` 同时同步，或文件被杀软/编辑器占用 | 已内置**跨进程锁**（`data/.sync.lock`）和**写入重试 + 只读自愈**；确认只跑一个实例，占用时重试即可 |
| 控制台 `[自动同步] 另一个进程正在同步，本次跳过` | 正常现象：另一个实例/定时任务正在跑 | 无需处理，下一轮会自动补上 |
| 启动即报「无法监听 8123」 | 端口被占用（多半是之前那个窗口还在） | 关掉旧窗口，或 `netstat -ano \| findstr :8123` 找到 PID 后结束 |
| 手机打不开局域网地址 | 防火墙 / 不同网段 | 放行 8123；确认同一 WiFi |

---

## 七、AI 提问按钮（可选）

点条文编号（「第五百六十三条」这类）会自动做两件事：把「法条原文 + 提问模板」复制到剪贴板，并打开你配置的 AI 站点。**不调用任何 API、不产生费用**。

在 `assets/config.js` 里可以改三处：

```js
aiSite: "https://chat.deepseek.com/",   // 点开后跳到哪个 AI
aiSiteQuery: "",                        // 支持 ?q= 预填的站点可填模板，如 "https://www.perplexity.ai/search?q={q}"
aiPromptTemplate: "我在学习《{law}》{chapter}。…",  // 占位符：{law} {chapter} {article} {text}
```

- 留空 `aiSite` 就只复制、不跳转；
- 跳转后浏览器若拦截弹窗，会弹提示，条文已在剪贴板，手动打开 AI 粘贴即可；
- 国内常用站点（DeepSeek / 豆包 / Kimi）都要登录，且不支持 URL 预填，所以默认是"打开首页 + 粘贴"。

## 八、命令行速查

```bat
python server.py                      :: 启动（含后台自动同步）
python server.py --no-auto-sync       :: 启动但不自动同步
python server.py --bind 0.0.0.0       :: 允许局域网访问
python server.py --update-only        :: 只同步一次后退出
python server.py --update-only --force :: 忽略版本号强制重抓

python tools/sync.py --once           :: 同上（CI 里用这个）
python tools/sync.py --check          :: 只比较版本号
python tools/sync.py --once --dry-run :: 抓取但不写盘（调试用）
python tools/sync.py --once --no-content :: 只更新目录

python tools/fetch_source.py          :: 只抓原始目录树（调试用）
python tools/build_catalog.py         :: 只重建 catalog（不比对）
```



