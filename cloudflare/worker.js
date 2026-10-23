/**
 * Cloudflare Worker：把网页上的「同步更新」按钮转成一次 GitHub Actions 运行。
 *
 * 路由
 *   POST /api/update   触发 workflow_dispatch，立即返回 { async: true }
 *   GET  /api/health   健康检查
 *
 * 定时
 *   cron trigger 也会触发一次（作为 GitHub 定时任务的兜底）
 *
 * 环境变量（在 Cloudflare 后台或 wrangler secret 里设置）
 *   GITHUB_TOKEN    必填，细粒度 PAT，权限只需 Actions: Read and write + Contents: Read
 *   GITHUB_REPO     必填，形如 "your-name/law"
 *   GITHUB_WORKFLOW 选填，默认 "sync.yml"
 *   GITHUB_REF      选填，默认 "main"
 *   ALLOW_ORIGIN    选填，允许的站点来源，默认 "*"
 *   SYNC_KEY        选填，设置后请求必须带 x-sync-key 头
 */

const json = (data, status = 200, origin = "*") =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": origin,
      "access-control-allow-headers": "content-type, x-sync-key",
      "access-control-allow-methods": "POST, GET, OPTIONS",
      "cache-control": "no-store",
    },
  });

async function dispatch(env) {
  const repo = env.GITHUB_REPO;
  const workflow = env.GITHUB_WORKFLOW || "sync.yml";
  const ref = env.GITHUB_REF || "main";
  const token = env.GITHUB_TOKEN;

  if (!repo || !token) {
    return { ok: false, error: "Worker 未配置 GITHUB_REPO / GITHUB_TOKEN" };
  }

  const res = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "law-catalog-worker",
        "content-type": "application/json",
      },
      body: JSON.stringify({ ref }),
    }
  );

  if (res.status === 204) {
    return { ok: true, runUrl: `https://github.com/${repo}/actions/workflows/${workflow}` };
  }
  const text = await res.text();
  return { ok: false, error: `GitHub ${res.status}: ${text.slice(0, 200)}` };
}

export default {
  async fetch(request, env) {
    const origin = env.ALLOW_ORIGIN || "*";
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": origin,
          "access-control-allow-headers": "content-type, x-sync-key",
          "access-control-allow-methods": "POST, GET, OPTIONS",
          "access-control-max-age": "86400",
        },
      });
    }

    if (url.pathname === "/api/health") {
      return json({ ok: true, repo: env.GITHUB_REPO || null }, 200, origin);
    }

    if (url.pathname === "/api/update") {
      if (request.method !== "POST") {
        return json({ ok: false, error: "请使用 POST" }, 405, origin);
      }
      if (env.SYNC_KEY && request.headers.get("x-sync-key") !== env.SYNC_KEY) {
        return json({ ok: false, error: "无效的同步密钥" }, 401, origin);
      }
      const result = await dispatch(env);
      if (!result.ok) return json(result, 502, origin);
      return json(
        {
          ok: true,
          async: true,
          message: "已触发后台同步，约 1–2 分钟后生效",
          runUrl: result.runUrl,
        },
        200,
        origin
      );
    }

    return json({ ok: false, error: "未知接口" }, 404, origin);
  },

  // GitHub 的定时任务万一被延迟/暂停，这里按同样的节奏兜底触发一次
  async scheduled(event, env, ctx) {
    ctx.waitUntil(dispatch(env));
  },
};
