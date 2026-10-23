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

  /**
   * 点条号时复制到剪贴板的内容模板。
   * 占位符：{law} 法名 · {location} 编/章/节 · {article} 条号 · {text} 条文全文
   */
  aiPromptTemplate:
    "《{law}》{location}\n" +
    "{article}\n" +
    "{text}\n\n" +
    "请解释一下这条法条是什么意思。",
};
