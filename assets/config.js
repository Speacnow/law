/* 站点配置 —— 部署时只改这一个文件 */

window.LAW_CONFIG = {
  /**
   * 同步接口地址。
   *   留空            → 同源 POST /api/update（本地 server.py 提供）
   *   部署在 Cloudflare Pages → 填 Worker 地址，如
   *                     "https://law-sync.你的子域.workers.dev/api/update"
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
};
