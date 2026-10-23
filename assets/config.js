/* 站点配置 —— 部署时只改这一个文件 */

window.LAW_CONFIG = {
  /**
   * 同步接口地址。
   *   留空                    → 同源 POST /api/update（本地 server.py 提供）
   *   部署在 Cloudflare Pages → 填 Worker 地址，如
   *                             "https://law-sync.xxx.workers.dev/api/update"
   *   其中 law-sync 是 Worker 名字（wrangler.toml 的 name），
   *   xxx 是你 Cloudflare 账号的 workers.dev 子域（不是 GitHub 用户名）。
   */
  syncEndpoint: "",

  /**
   * true  = 触发式同步（Worker 转发 GitHub Actions），按钮只负责触发，
   *         页面轮询等待数据更新后再刷新。
   * false = 同步接口直接返回结果（本地 server.py）。
   */
  asyncSync: false,

  /** 触发式同步的最长等待时间（毫秒），超时后提示稍后刷新 */
  asyncTimeoutMs: 300000,

  /** 源站接口，用于页面加载时比对版本号（CORS 已开放） */
  versionApi: "https://online-web-api-cdn.zhumavip.com/api/office/laws/lawVersion",

  /** 点条号时打开的 AI 站点（留空则只复制不跳转） */
  aiSite: "https://chat.deepseek.com/",

  /**
   * 若目标站点支持 URL 预填，填带 {q} 的模板，例如：
   *   "https://www.perplexity.ai/search?q={q}"
   * 留空表示只打开站点首页，靠用户粘贴。
   */
  aiSiteQuery: "",

  /** 提问模板，占位符：{law} {chapter} {article} {text} */
  aiPromptTemplate:
    "我在学习《{law}》{chapter}。\n" +
    "请用大白话解释下面这条法条，拆出适用要件，并举一个生活中的例子：\n\n" +
    "{article} {text}",
};
