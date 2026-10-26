/* ==========================================================================
   法律法规汇编 — 前端交互
   数据来源: data/catalog.js (window.LAW_CATALOG) 或 data/catalog.json
   ========================================================================== */

(function () {
  "use strict";

  var STORAGE_KEY = "law-compilation:expanded";

  var CONFIG = window.LAW_CONFIG || {};

  var state = {
    catalog: null,
    subjectById: Object.create(null),
    lawById: Object.create(null),
    expanded: new Set(),
    query: "",
    route: { type: "home" },
    sidebarOpen: false,
    contentCache: Object.create(null),
  };

  var el = {};

  /* ---------------- 工具 ---------------- */

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function highlight(title, query) {
    var safe = escapeHtml(title);
    if (!query) return safe;
    var re = new RegExp("(" + escapeRegExp(escapeHtml(query)) + ")", "gi");
    return safe.replace(re, '<mark class="hl">$1</mark>');
  }

  function isDesktopLayout() {
    // 手机即使开了「桌面版网页」也不会被当成桌面端（触屏指针为 coarse）
    return window.matchMedia("(min-width: 861px) and (pointer: fine)").matches;
  }

  function loadExpanded() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return new Set(JSON.parse(raw));
    } catch (e) {
      /* 忽略: 隐私模式等 */
    }
    return null;
  }

  function saveExpanded() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(state.expanded)));
    } catch (e) {
      /* 忽略 */
    }
  }

  /* ---------------- 数据装载 ---------------- */

  function loadCatalog() {
    if (window.LAW_CATALOG) return Promise.resolve(window.LAW_CATALOG);
    return fetch("data/catalog.json", { cache: "no-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .catch(function () {
        return null;
      });
  }

  function indexCatalog(catalog) {
    state.subjectById = Object.create(null);
    state.lawById = Object.create(null);
    catalog.subjects.forEach(function (subject) {
      state.subjectById[subject.id] = subject;
      subject.laws.forEach(function (law) {
        law.subjectId = subject.id;
        state.lawById[law.id] = law;
      });
    });
  }

  /* ---------------- 时间与提示 ---------------- */

  function formatTime(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    function p(n) { return n < 10 ? "0" + n : String(n); }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
      " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function renderFooter() {
    var meta = state.catalog && state.catalog.meta;
    if (!meta) return;
    el.sidebarFoot.innerHTML =
      '<span class="foot-line">数据版本 ' + escapeHtml(meta.upstreamVersion || "—") + "</span>" +
      '<span class="foot-line">更新于 ' + formatTime(meta.generatedAt) +
      " · " + meta.subjectCount + " 学科 / " + meta.lawCount + " 部</span>";
    el.sidebarFoot.title =
      "「更新于」是数据内容的版本时间，不是检查时间。\n" +
      "源站每天 06:00 自动检查一次，没有新版本就不改动数据。";
  }

  function toast(opts) {
    var node = document.createElement("div");
    node.className = "toast" + (opts.type ? " toast--" + opts.type : "");
    node.innerHTML =
      '<div class="toast-head"><strong>' + escapeHtml(opts.title) + "</strong>" +
      '<button class="toast-close" type="button" aria-label="关闭">&times;</button></div>' +
      (opts.body ? '<div class="toast-body">' + opts.body + "</div>" : "") +
      (opts.details ? "<details><summary>" + escapeHtml(opts.detailsSummary) +
        "</summary><ul>" + opts.details + "</ul></details>" : "");

    el.toasts.appendChild(node);

    var timer = setTimeout(function () { node.remove(); }, opts.timeout || 7000);
    node.addEventListener("mouseenter", function () { clearTimeout(timer); });
    node.addEventListener("mouseleave", function () {
      timer = setTimeout(function () { node.remove(); }, 4000);
    });
    node.querySelector(".toast-close").addEventListener("click", function () { node.remove(); });
    return node;
  }

  /* ---------------- 目录渲染 ---------------- */

  function lawItemHtml(law, query) {
    var active = state.route.type === "law" && state.route.lawId === law.id;
    return (
      '<button class="law-item' + (active ? " is-active" : "") + '"' +
      ' role="treeitem" data-law="' + law.id + '"' +
      ' aria-current="' + (active ? "true" : "false") + '">' +
      '<span class="leaf-dot" aria-hidden="true"></span>' +
      '<span class="law-name">' + highlight(law.title, query) + "</span>" +
      "</button>"
    );
  }

  function renderNav() {
    // 法律页的搜索只作用于正文，左侧目录保持完整
    var query = state.route.type === "law" ? "" : state.query.trim();
    var catalog = state.catalog;

    if (!catalog) {
      el.nav.innerHTML = '<p class="nav-empty">目录数据加载失败。</p>';
      return;
    }

    var html = "";
    var total = 0;

    catalog.subjects.forEach(function (subject, sIdx) {
      var laws = subject.laws;
      if (query) {
        laws = laws.filter(function (l) {
          return l.title.toLowerCase().indexOf(query.toLowerCase()) !== -1;
        });
        if (!laws.length) return;
      }

      total += laws.length;
      var open = query ? true : state.expanded.has(subject.id);

      html += '<section class="subject' + (open ? " open" : "") + '" data-subject="' + subject.id + '">';
      html +=
        '<button class="subject-head" type="button" aria-expanded="' + (open ? "true" : "false") + '"' +
        ' data-toggle="' + subject.id + '">' +
        '<span class="chev" aria-hidden="true"></span>' +
        '<span class="subject-title">' + escapeHtml(subject.title) + "</span>" +
        '<span class="subject-count">' + laws.length + "</span>" +
        "</button>";
      html += '<div class="law-list" role="group">';
      laws.forEach(function (law) {
        html += lawItemHtml(law, query);
      });
      html += "</div></section>";
    });

    if (!html) {
      html = '<p class="nav-empty">没有匹配「' + escapeHtml(query) + "」的法律法规<br />试试更短的关键词</p>";
    }

    el.nav.innerHTML = html;
    el.nav.classList.toggle("is-searching", !!query);
    el.collapseAll.hidden = !!query;

    // 顶栏统计
    if (query) {
      el.topStat.textContent = "找到 " + total + " 部法律法规";
    } else {
      el.topStat.textContent =
        catalog.meta.subjectCount + " 个学科 · " + catalog.meta.lawCount + " 部法律法规";
    }
  }

  /* ---------------- 右侧：首页 ---------------- */

  function renderHome() {
    var catalog = state.catalog;
    if (!catalog) return;

    el.tocBtn.hidden = true;
    closeToc();
    if (el.searchInput) el.searchInput.placeholder = "搜索法律法规名称，按 / 聚焦";

    var chapterTotal = 0;
    catalog.subjects.forEach(function (s) {
      s.laws.forEach(function (l) {
        chapterTotal += l.leafCount || 0;
      });
    });

    var cards = catalog.subjects
      .map(function (s, i) {
        var sample = s.laws
          .slice(0, 2)
          .map(function (l) {
            return escapeHtml(l.title);
          })
          .join("、");
        return (
          '<button class="subject-card" type="button" data-goto-subject="' + s.id + '">' +
          '<span class="idx">' + String(i + 1).padStart(2, "0") + "</span>" +
          "<h3>" + escapeHtml(s.title) + "</h3>" +
          '<span class="sub"><em>' + s.laws.length + "</em> 部 · " + sample +
          (s.laws.length > 2 ? " 等" : "") + "</span>" +
          "</button>"
        );
      })
      .join("");

    el.content.innerHTML =
      '<div class="hero">' +
      '<div class="hero-eyebrow">LAWS &amp; REGULATIONS COMPILATION</div>' +
      "<h1>法律法规汇编</h1>" +
      '<p class="lead">按学科分类整理的法律法规原文，覆盖法考常考规范。从左侧目录选择法律即可阅读全文，' +
      "章节可跳转；法规有更新时页面顶部会提示。</p>" +
      '<div class="stat-row">' +
      '<div class="stat"><b>' + catalog.meta.subjectCount + "</b><span>学科</span></div>" +
      '<div class="stat"><b>' + catalog.meta.lawCount + "</b><span>法律法规</span></div>" +
      '<div class="stat"><b>' + chapterTotal + "</b><span>章节条目</span></div>" +
      "</div>" +
      '<div class="subject-grid">' + cards + "</div>" +
      "</div>";

    document.title = "法律法规汇编";
  }

  /* ---------------- 右侧：正文阅读器 ---------------- */

  var RE_HEADING = /^第[一二三四五六七八九十百千零〇两\d]+(分编|编|章|节)[\s　]/;
  var RE_ARTICLE = /^(第[一二三四五六七八九十百千零〇两\d]+条(?:之[一二三四五六七八九十]+)?)[\s　]*/;

  function headingTag(line) {
    if (/^第[一二三四五六七八九十百千零〇两\d]+分编[\s　]/.test(line)) return "h5";
    if (/^第[一二三四五六七八九十百千零〇两\d]+编[\s　]/.test(line)) return "h3";
    if (/^第[一二三四五六七八九十百千零〇两\d]+章[\s　]/.test(line)) return "h4";
    if (/^第[一二三四五六七八九十百千零〇两\d]+节[\s　]/.test(line)) return "h5";
    return null;
  }

  function loadingHtml() {
    return (
      '<div class="law-loading"><span class="loader-dot"></span><span class="loader-dot"></span>' +
      '<span class="loader-dot"></span><p>正文加载中…</p></div>'
    );
  }

  function pendingHtml() {
    return (
      '<div class="blank-panel">' +
      '<div class="blank-icon" aria-hidden="true">律</div>' +
      "<h3>该法正文尚未同步</h3>" +
      "<p>源站新增或修订的内容，会在下一次同步时抓取。<br>" +
      "可以点右上角「同步更新」立即抓取。</p>" +
      "</div>"
    );
  }

  function renderLines(text) {
    var lines = String(text || "").split("\n");
    var out = [];
    var openArticle = false;
    var currentJie = "";

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      var tag = headingTag(line);
      if (tag) {
        if (openArticle) { out.push("</div>"); openArticle = false; }
        if (/^第[一二三四五六七八九十百千零〇两\d]+节[\s　]/.test(line)) currentJie = line;
        out.push("<" + tag + ' class="law-h ' + tag + '">' + escapeHtml(line) + "</" + tag + ">");
        continue;
      }

      var m = RE_ARTICLE.exec(line);
      if (m) {
        if (openArticle) out.push("</div>");
        out.push('<div class="art" data-jie="' + escapeHtml(currentJie) + '">');
        out.push(
          '<p class="art-line"><span class="art-no" title="点击复制这一条（含出处）">' +
          escapeHtml(m[1]) + "</span>" +
          escapeHtml(line.slice(m[0].length)) + "</p>"
        );
        openArticle = true;
        continue;
      }

      if (openArticle) out.push('<p class="art-sub">' + escapeHtml(line) + "</p>");
      else out.push('<p class="law-p">' + escapeHtml(line) + "</p>");
    }
    if (openArticle) out.push("</div>");
    return out.join("");
  }

  function chapterBtn(node) {
    return (
      '<button type="button" class="toc-item" data-chapter="' + node.id + '" title="' +
      escapeHtml(node.title) + '">' + escapeHtml(node.title) + "</button>"
    );
  }

  /** 一章一级的平铺网格，遇到分编时插入小标题 */
  function tocGroupBody(nodes) {
    var direct = [];
    var subs = [];
    nodes.forEach(function (n) {
      if (n.children && n.children.length) subs.push(n);
      else direct.push(n);
    });

    var html = "";
    if (direct.length) {
      html += '<div class="toc-links">' + direct.map(chapterBtn).join("") + "</div>";
    }
    subs.forEach(function (s) {
      html += '<div class="toc-sub">' + escapeHtml(s.title) + "</div>" + tocGroupBody(s.children);
    });
    return html;
  }

  /** 按「编 / 分编 / 章」组织目录；没有编层级时退回平铺 */
  function tocBodyHtml(sections) {
    var hasGroups = sections.some(function (n) { return n.children && n.children.length; });
    if (!hasGroups) {
      return '<div class="toc-links">' + sections.map(chapterBtn).join("") + "</div>";
    }
    return sections.map(function (n) {
      if (n.children && n.children.length) {
        return (
          '<section class="toc-group"><h4 class="toc-group-title">' +
          escapeHtml(n.title) + "</h4>" + tocGroupBody(n.children) + "</section>"
        );
      }
      return '<section class="toc-group">' + chapterBtn(n) + "</section>";
    }).join("");
  }

  /** 把目录塞进右侧抽屉；只有一章的法律不显示按钮 */
  function setupToc(law, chapters) {
    var sections = law.sections || [];
    if (!chapters || chapters.length <= 1 || !sections.length) {
      el.tocBtn.hidden = true;
      el.tocBody.innerHTML = "";
      closeToc();
      return;
    }

    var groups = sections.filter(function (n) { return n.children && n.children.length; }).length;
    el.tocMeta.textContent = (groups ? groups + " 编 · " : "") + chapters.length + " 章";
    el.tocBody.innerHTML = tocBodyHtml(sections);
    el.tocBtn.hidden = false;

    // 电脑端默认展开，手机端保持收起
    if (isDesktopLayout()) openToc();
  }

  /** 章 id → 所属「编 · 分编」路径 */
  function chapterTrail(sections, chapterId) {
    var found = null;
    (function walk(nodes, trail) {
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n.id === chapterId) { found = trail; return; }
        if (n.children && n.children.length) {
          walk(n.children, trail.concat(n.title));
          if (found) return;
        }
      }
    })(sections || [], []);
    return found || [];
  }

  function renderContent(law, doc, view, chapterId) {
    var chapters = doc.chapters || [];
    var html = "";

    html += '<div class="law-body">';
    chapters.forEach(function (ch) {
      var trail = chapterTrail(law.sections, ch.id);
      html += '<section class="law-chapter" id="ch-' + ch.id +
        '" data-title="' + escapeHtml(ch.title) +
        '" data-path="' + escapeHtml(trail.join(" · ")) + '">';
      html += renderLines(ch.content);
      html += "</section>";
    });
    html += "</div>";

    view.innerHTML = html;
    setupToc(law, chapters);

    var meta = document.getElementById("docMeta");
    if (meta && doc.chars) {
      var size = doc.chars >= 10000
        ? (doc.chars / 10000).toFixed(1) + " 万字"
        : doc.chars + " 字";
      meta.insertAdjacentHTML("beforeend", '<span class="chip">全文 · <b>' + size + "</b></span>");
    }

    if (chapterId) scrollToChapter(chapterId, false);
    else if (state.query && state.route.type === "law") runFind(state.query);
  }

  function scrollToChapter(chapterId, smooth) {
    var target = document.getElementById("ch-" + chapterId);
    if (!target) return;
    var top = target.getBoundingClientRect().top + window.pageYOffset - 76;
    window.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
  }

  function renderLaw(lawId, chapterId) {
    var law = state.lawById[lawId];
    if (!law) {
      location.replace("#/");
      return;
    }
    el.tocBtn.hidden = true;      // 正文加载完再决定是否显示
    closeToc();
    if (el.searchInput) el.searchInput.placeholder = "在《" + law.title + "》中搜索条文";
    var subject = state.subjectById[law.subjectId];

    var metaChips = '<span class="chip">学科 · <b>' + escapeHtml(subject.title) + "</b></span>";
    if (law.structured && law.leafCount) {
      metaChips += '<span class="chip">章节 · <b>' + law.leafCount + "</b></span>";
    }
    var groups = (law.sections || []).filter(function (n) {
      return n.children && n.children.length;
    }).length;
    if (groups) {
      metaChips += '<span class="chip">编 · <b>' + groups + "</b></span>";
    }
    metaChips += '<span class="chip">编号 · <b>' + law.id + "</b></span>";

    el.content.innerHTML =
      '<article class="doc doc--reading">' +
      '<div class="crumb">' + escapeHtml(subject.title) + "</div>" +
      '<h2 class="doc-title">' + escapeHtml(law.title) + "</h2>" +
      '<div class="doc-meta" id="docMeta">' + metaChips + "</div>" +
      '<div class="rule"></div>' +
      '<div id="lawView" class="law-view">' + loadingHtml() + "</div>" +
      "</article>";

    document.title = law.title + " · 法律法规汇编";
    el.content.scrollTop = 0;
    window.scrollTo({ top: 0, behavior: "auto" });

    var view = document.getElementById("lawView");
    var cached = state.contentCache[law.id];
    if (cached) {
      renderContent(law, cached, view, chapterId);
      return;
    }

    var wanted = law.id;
    fetch("data/laws/" + law.id + ".json", { cache: "no-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (doc) {
        state.contentCache[wanted] = doc;
        if (state.route.type !== "law" || state.route.lawId !== wanted) return;
        renderContent(law, doc, view, chapterId);
      })
      .catch(function () {
        if (state.route.type !== "law" || state.route.lawId !== wanted) return;
        view.innerHTML = pendingHtml();
      });
  }

  /* ---------------- 同步更新 ---------------- */

  function apiFetch(path, options, timeout) {
    var opts = Object.assign(
      { cache: "no-store", headers: { Accept: "application/json" } },
      options || {}
    );
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    if (ctrl) opts.signal = ctrl.signal;
    var timer = setTimeout(function () {
      if (ctrl) ctrl.abort();
    }, timeout || 20000);
    return fetch(path, opts).finally(function () {
      clearTimeout(timer);
    });
  }

  function setSyncing(on) {
    state.syncing = on;
    el.updateBtn.disabled = on;
    el.updateBtn.classList.toggle("is-syncing", on);
    el.updateBtn.setAttribute("aria-busy", on ? "true" : "false");
    el.updateBtn.querySelector(".sync-label").textContent = on ? "同步中…" : "同步更新";
  }

  function checkStatus() {
    var localVersion = (state.catalog && state.catalog.meta && state.catalog.meta.upstreamVersion) || null;

    function apply(upstreamVersion) {
      if (!upstreamVersion) return;
      state.stale = localVersion !== upstreamVersion;
      el.syncDot.hidden = !state.stale;
      el.updateBtn.title = state.stale
        ? "源站有更新（" + upstreamVersion + "），点击同步"
        : "已是最新（源站版本 " + upstreamVersion + "）";
    }

    function viaServer() {
      apiFetch("api/status", null, 6000)
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
        .then(function (res) {
          if (!res || !res.ok) throw new Error("bad response");
          state.serverAvailable = true;
          apply(res.upstream && res.upstream.version);
        })
        .catch(function () {
          state.serverAvailable = false;
          el.updateBtn.title = CONFIG.syncEndpoint
            ? "从源站同步最新内容"
            : "未配置同步接口（见 assets/config.js）";
        });
    }

    // 直接问源站版本号（CORS 已开放），静态托管下也能用
    if (CONFIG.versionApi) {
      fetch(CONFIG.versionApi, { cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (o) { apply(o && o.data); })
        .catch(viaServer);
    } else {
      viaServer();
    }
  }

  function diffToastPayload(diff, meta, info) {
    diff = diff || {};
    var added = diff.lawsAdded || [];
    var removed = diff.lawsRemoved || [];
    var renamed = diff.lawsRenamed || [];
    var moved = diff.lawsMoved || [];
    var subjAdded = diff.subjectsAdded || [];

    var parts = [];
    if (subjAdded.length) parts.push("新增学科 " + subjAdded.length);
    if (added.length) parts.push("新增 " + added.length + " 部");
    if (removed.length) parts.push("下架 " + removed.length + " 部");
    if (renamed.length) parts.push("改名 " + renamed.length + " 部");
    if (moved.length) parts.push("调整学科 " + moved.length + " 部");

    var unchanged = parts.length === 0;
    var seconds = ((info && info.durationMs) || 0) / 1000;

    var body =
      "<b>" + meta.subjectCount + "</b> 学科 · <b>" + meta.lawCount + "</b> 部" +
      (seconds ? " · 用时 " + seconds.toFixed(1) + "s" : "") +
      (meta.upstreamVersion ? "<br>源站版本 <b>" + escapeHtml(meta.upstreamVersion) + "</b>" : "");

    var details = "";
    var lines = [];
    if (subjAdded.length) {
      lines.push("<li><b>新增学科</b></li>");
      subjAdded.forEach(function (t) { lines.push("<li>· " + escapeHtml(t) + "</li>"); });
    }
    if (added.length) {
      lines.push("<li><b>新增法规（" + added.length + "）</b></li>");
      added.slice(0, 10).forEach(function (l) {
        lines.push("<li>· " + escapeHtml(l.title) + "　<span style='color:#8a8378'>" + escapeHtml(l.subject) + "</span></li>");
      });
      if (added.length > 10) lines.push("<li>… 另有 " + (added.length - 10) + " 部</li>");
    }
    if (removed.length) {
      lines.push("<li><b>下架法规（" + removed.length + "）</b></li>");
      removed.slice(0, 10).forEach(function (l) {
        lines.push("<li>· " + escapeHtml(l.title) + "</li>");
      });
      if (removed.length > 10) lines.push("<li>… 另有 " + (removed.length - 10) + " 部</li>");
    }
    if (renamed.length) {
      lines.push("<li><b>改名（" + renamed.length + "）</b></li>");
      renamed.slice(0, 6).forEach(function (l) {
        lines.push("<li>· " + escapeHtml(l.from) + " → " + escapeHtml(l.to) + "</li>");
      });
    }
    if (moved.length) {
      lines.push("<li><b>调整学科（" + moved.length + "）</b></li>");
      moved.slice(0, 6).forEach(function (l) {
        lines.push("<li>· " + escapeHtml(l.title) + "：" + escapeHtml(l.from) + " → " + escapeHtml(l.to) + "</li>");
      });
    }
    if (lines.length) {
      details = lines.join("");
    }

    return {
      unchanged: unchanged,
      parts: parts,
      body: body,
      details: details,
      detailsSummary: "查看变更（" + parts.join(" · ") + "）",
    };
  }

  function applySyncedCatalog(catalog, res) {
    state.catalog = catalog;
    indexCatalog(catalog);
    state.contentCache = Object.create(null);   // 正文可能变了，清掉缓存

    // 去掉已经不存在的学科展开状态
    state.expanded = new Set(
      Array.from(state.expanded).filter(function (id) {
        return !!state.subjectById[id];
      })
    );
    if (!state.expanded.size) state.expanded.add(catalog.subjects[0].id);

    state.stale = false;
    el.syncDot.hidden = true;

    renderFooter();
    applyRoute();
    setSyncing(false);

    var payload = diffToastPayload(res.diff, catalog.meta, res.info);
    toast({
      type: payload.unchanged ? "info" : "ok",
      title: payload.unchanged ? "已是最新版本" : "同步完成",
      body: payload.body,
      details: payload.details,
      detailsSummary: payload.unchanged ? "" : payload.detailsSummary,
      timeout: payload.unchanged ? 6000 : 15000,
    });
  }

  function handleUpdate() {
    if (state.syncing) return;
    setSyncing(true);

    apiFetch(CONFIG.syncEndpoint || "api/update", { method: "POST" }, 90000)
      .then(function (r) {
        var ct = r.headers.get("content-type") || "";
        if (ct.indexOf("json") === -1) {
          var noBackend = new Error("NO_BACKEND");
          noBackend.noBackend = true;
          throw noBackend;
        }
        return r.json().then(function (body) {
          if (!r.ok || !body.ok) {
            throw new Error((body && body.error) || "HTTP " + r.status);
          }
          return body;
        });
      })
      .then(function (res) {
        if (res.async) {           // 触发式（Worker -> GitHub Actions）
          waitForDeploy(res);
          return;
        }
        // 服务端已写回文件, 这里重新读取以保证页面与文件一致
        return fetch("data/catalog.json?_=" + Date.now(), { cache: "no-store" })
          .then(function (r) { return r.json(); })
          .then(function (catalog) { applySyncedCatalog(catalog, res); });
      })
      .catch(function (err) {
        setSyncing(false);
        var backendMissing = err && (
          err.noBackend || state.serverAvailable === false || location.protocol === "file:"
        );
        if (backendMissing) {
          toast({
            type: "error",
            title: "无法连接同步服务",
            body: "本地请用 <b>python server.py</b> 启动后在它给出的地址访问；" +
              "线上部署请在 <b>assets/config.js</b> 里配置 <b>syncEndpoint</b>（见 DEPLOY.md）。",
            timeout: 16000,
          });
        } else if (err && err.name === "AbortError") {
          toast({ type: "error", title: "同步超时", body: "源站响应较慢，请稍后重试。本地数据未改动。" });
        } else {
          toast({
            type: "error",
            title: "同步失败",
            body: escapeHtml((err && err.message) || "未知错误") + "<br>本地数据未改动。",
            timeout: 14000,
          });
        }
      });
  }

  /** 触发式同步：轮询 catalog 的生成时间，变化即刷新页面数据 */
  function waitForDeploy(res) {
    var before = (state.catalog && state.catalog.meta && state.catalog.meta.generatedAt) || "";
    var started = Date.now();

    toast({
      type: "info",
      title: "已触发同步",
      body: "正在后台抓取，通常 1–2 分钟。完成后本页会自动刷新。",
      timeout: 10000,
    });

    (function poll() {
      if (Date.now() - started > (CONFIG.asyncTimeoutMs || 300000)) {
        setSyncing(false);
        toast({ type: "info", title: "同步仍在进行", body: "稍后刷新页面查看最新数据。", timeout: 9000 });
        return;
      }
      setTimeout(function () {
        fetch("data/catalog.json?_=" + Date.now(), { cache: "no-store" })
          .then(function (r) { return r.json(); })
          .then(function (catalog) {
            var at = (catalog.meta && catalog.meta.generatedAt) || "";
            if (at && at !== before) applySyncedCatalog(catalog, res);
            else poll();
          })
          .catch(poll);
      }, 10000);
    })();
  }

  /* ---------------- 点条号 → 复制条文并打开 AI ---------------- */

  function syncCopy(text) {
    var ok = false;
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    try {
      ok = document.execCommand("copy");
    } catch (e) {
      ok = false;
    }
    ta.remove();
    return ok;
  }

  /** 同步复制优先（不打断手势），失败再走异步剪贴板 API */
  function copyToClipboard(text) {
    return new Promise(function (resolve) {
      if (syncCopy(text)) return resolve(true);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { resolve(true); },
          function () { resolve(false); }
        );
      } else {
        resolve(false);
      }
    });
  }

  function buildPrompt(law, location, articleNo, text) {
    var tpl = CONFIG.aiPromptTemplate ||
      "《{law}》{location}\n{article}\n{text}\n\n请解释一下这条法条是什么意思。";
    return tpl
      .replace(/\{law\}/g, law ? law.title : "")
      .replace(/\{location\}/g, location || "")
      .replace(/\{article\}/g, articleNo)
      .replace(/\{text\}/g, text);
  }

  function askAI(articleNo, artEl, section) {
    var law = state.route.type === "law" ? state.lawById[state.route.lawId] : null;
    var chapter = section ? section.getAttribute("data-title") || "" : "";
    var path = section ? section.getAttribute("data-path") || "" : "";
    var jie = artEl ? artEl.getAttribute("data-jie") || "" : "";
    var location = [path, chapter, jie].filter(Boolean).join(" · ");

    var raw = (artEl.innerText || "").trim();
    var text = raw.indexOf(articleNo) === 0 ? raw.slice(articleNo.length).trim() : raw;

    var prompt = buildPrompt(law, location, articleNo, text);

    copyToClipboard(prompt).then(function (copied) {
      if (copied) {
        toast({
          type: "info",
          title: "已复制条文",
          body: "《" + escapeHtml(law ? law.title : "") + "》" + escapeHtml(articleNo) +
            "（含编 / 章 / 节）已复制，粘贴到任意 AI 对话框即可提问。",
          timeout: 6000,
        });
      } else {
        toast({
          type: "error",
          title: "复制失败",
          body: "浏览器拒绝了剪贴板操作，请手动选中条文复制。",
          timeout: 9000,
        });
      }
    });
  }

  /* ---------------- 正文搜索 ---------------- */

  var finder = { marks: [], index: -1 };
  var FIND_CAP = 400;

  var CN_DIGITS = { "零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4,
    "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
  var CN_UNITS = { "十": 10, "百": 100, "千": 1000 };

  function cnToNumber(text) {
    var section = 0;
    var num = 0;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (Object.prototype.hasOwnProperty.call(CN_DIGITS, ch)) {
        num = CN_DIGITS[ch];
      } else if (Object.prototype.hasOwnProperty.call(CN_UNITS, ch)) {
        if (num === 0) num = 1;
        section += num * CN_UNITS[ch];
        num = 0;
      } else {
        return NaN;
      }
    }
    return section + num;
  }

  function articleNumber(node) {
    var t = (node && node.textContent ? node.textContent : "").trim();
    var m = /^第(.+?)条/.exec(t);
    return m ? cnToNumber(m[1]) : NaN;
  }

  function showFindBar(html) {
    el.findStatus.innerHTML = html;
    el.findBar.hidden = false;
    document.body.classList.add("has-findbar");
  }

  function hideFindBar() {
    el.findBar.hidden = true;
    document.body.classList.remove("has-findbar");
  }

  function clearFindHighlights() {
    var body = el.content.querySelector(".law-body");
    if (body) {
      body.querySelectorAll("mark.hit").forEach(function (m) {
        m.replaceWith(document.createTextNode(m.textContent));
      });
      body.normalize();
    }
    finder.marks = [];
    finder.index = -1;
  }

  function clearFind() {
    clearFindHighlights();
    el.content.querySelectorAll(".art-no.is-jump").forEach(function (n) {
      n.classList.remove("is-jump");
    });
    hideFindBar();
  }

  function gotoMark(i, instant) {
    if (!finder.marks.length) return;
    finder.index = ((i % finder.marks.length) + finder.marks.length) % finder.marks.length;
    finder.marks.forEach(function (m) { m.classList.remove("current"); });
    var cur = finder.marks[finder.index];
    cur.classList.add("current");
    cur.scrollIntoView({ block: "center", behavior: instant ? "auto" : "smooth" });

    var suffix = finder.marks.length >= FIND_CAP ? "（仅显示前 " + FIND_CAP + " 处）" : "";
    showFindBar("第 <b>" + (finder.index + 1) + "</b> / " + finder.marks.length + " 处" + suffix);
  }

  function highlightMatches(re) {
    var body = el.content.querySelector(".law-body");
    if (!body) return;

    var walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.nodeValue || !node.nodeValue.replace(/\s/g, "")) return NodeFilter.FILTER_REJECT;
        if (node.parentElement && node.parentElement.closest("mark.hit")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    nodes.forEach(function (node) {
      if (finder.marks.length >= FIND_CAP) return;
      var text = node.nodeValue;
      re.lastIndex = 0;
      var m = re.exec(text);
      if (!m) return;

      var frag = document.createDocumentFragment();
      var last = 0;
      while (m && finder.marks.length < FIND_CAP) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        var mark = document.createElement("mark");
        mark.className = "hit";
        mark.textContent = m[0];
        frag.appendChild(mark);
        finder.marks.push(mark);
        last = m.index + m[0].length;
        m = re.exec(text);
        if (m && m[0].length === 0) break;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
  }

  function runFind(rawQuery) {
    clearFindHighlights();
    var q = (rawQuery || "").trim();

    if (!q || state.route.type !== "law") {
      hideFindBar();
      return;
    }

    // 纯数字 → 直接定位条号
    var numeric = /^(\d{1,4})\s*条?$/.exec(q);
    if (numeric) {
      var n = Number(numeric[1]);
      var target = null;
      el.content.querySelectorAll(".art").forEach(function (a) {
        if (target) return;
        if (articleNumber(a.querySelector(".art-no")) === n) target = a;
      });
      if (target) {
        var no = target.querySelector(".art-no");
        no.classList.add("is-jump");
        setTimeout(function () { no.classList.remove("is-jump"); }, 1800);
        target.scrollIntoView({ block: "center", behavior: "smooth" });
        el.findPrev.disabled = true;
        el.findNext.disabled = true;
        showFindBar("已定位 <b>" + escapeHtml(no.textContent) + "</b>");
        return;
      }
    }

    var re;
    try {
      re = new RegExp(escapeRegExp(q), "gi");
    } catch (e) {
      return;
    }

    highlightMatches(re);

    if (!finder.marks.length) {
      el.findPrev.disabled = true;
      el.findNext.disabled = true;
      showFindBar("未找到「" + escapeHtml(q) + "」");
      return;
    }

    el.findPrev.disabled = finder.marks.length < 2;
    el.findNext.disabled = finder.marks.length < 2;
    gotoMark(0, true);
  }

  /* ---------------- 路由 ---------------- */

  function parseHash() {
    var h = (location.hash || "").replace(/^#\/?/, "");
    var m = /^law\/(\d+)(?:\/ch\/(\d+))?/.exec(h);
    if (m && state.lawById[Number(m[1])]) {
      return {
        type: "law",
        lawId: Number(m[1]),
        chapterId: m[2] ? Number(m[2]) : null,
      };
    }
    return { type: "home" };
  }

  function applyRoute() {
    state.route = parseHash();

    // 切换页面（首页 ↔ 法律、法律 ↔ 法律）时清空搜索，避免残留高亮
    var key = state.route.type === "law" ? "law:" + state.route.lawId : "home";
    if (state.lastRouteKey !== undefined && state.lastRouteKey !== key) {
      clearFind();
      state.query = "";
      if (el.searchInput) el.searchInput.value = "";
      if (el.clearBtn) el.clearBtn.hidden = true;
    }
    state.lastRouteKey = key;

    if (state.route.type === "law") {
      var law = state.lawById[state.route.lawId];
      state.expanded.add(law.subjectId);
      saveExpanded();
      renderLaw(law.id, state.route.chapterId);
    } else {
      renderHome();
    }
    renderNav();
    scrollActiveIntoView();
  }

  function scrollActiveIntoView() {
    var active = el.nav.querySelector(".law-item.is-active");
    if (!active) return;

    // 已经完整可见就不动，保持用户点击时的位置
    var box = el.nav.getBoundingClientRect();
    var item = active.getBoundingClientRect();
    if (item.top >= box.top && item.bottom <= box.bottom) return;

    // 只有当前项跑出可见区时才补一点，而且只滚侧栏，不带动整页
    if (item.top < box.top) {
      el.nav.scrollTop += item.top - box.top - 8;
    } else {
      el.nav.scrollTop += item.bottom - box.bottom + 8;
    }
  }

  function selectLaw(lawId) {
    if (location.hash === "#/law/" + lawId) {
      applyRoute();
    } else {
      location.hash = "#/law/" + lawId;
    }
    closeSidebar();
  }

  /* ---------------- 侧边栏开合（移动端） ---------------- */

  /* ---------------- 右侧目录抽屉 ---------------- */

  function openToc() {
    if (!el.tocBtn || el.tocBtn.hidden) return;
    var desktop = isDesktopLayout();
    el.tocDrawer.hidden = false;
    el.tocScrim.hidden = desktop;
    el.tocBtn.setAttribute("aria-expanded", "true");
    document.body.classList.toggle("toc-docked", desktop);
    markActiveChapter();
  }

  function closeToc() {
    if (!el.tocDrawer) return;
    el.tocDrawer.hidden = true;
    el.tocScrim.hidden = true;
    if (el.tocBtn) el.tocBtn.setAttribute("aria-expanded", "false");
    document.body.classList.remove("toc-docked");
  }

  function toggleToc() {
    if (el.tocDrawer.hidden) openToc();
    else closeToc();
  }

  /** 打开抽屉时高亮当前阅读到的那一章 */
  function markActiveChapter() {
    var sections = document.querySelectorAll(".law-chapter");
    var items = el.tocBody.querySelectorAll("[data-chapter]");
    if (!sections.length || !items.length) return;

    var probe = window.scrollY + window.innerHeight * 0.3;
    var currentId = null;
    for (var i = 0; i < sections.length; i++) {
      var top = sections[i].getBoundingClientRect().top + window.scrollY;
      if (top <= probe) currentId = sections[i].id.replace(/^ch-/, "");
      else break;
    }
    if (!currentId) currentId = sections[0].id.replace(/^ch-/, "");

    var active = null;
    items.forEach(function (btn) {
      var on = btn.getAttribute("data-chapter") === currentId;
      btn.classList.toggle("is-active", on);
      if (on) active = btn;
    });
    if (active) active.scrollIntoView({ block: "center" });
  }

  function openSidebar() {
    state.sidebarOpen = true;
    el.sidebar.classList.add("open");
    el.scrim.hidden = false;
    el.menuBtn.setAttribute("aria-expanded", "true");
  }

  function closeSidebar() {
    state.sidebarOpen = false;
    el.sidebar.classList.remove("open");
    el.scrim.hidden = true;
    el.menuBtn.setAttribute("aria-expanded", "false");
  }

  function toggleSidebar() {
    state.sidebarOpen ? closeSidebar() : openSidebar();
  }

  /* ---------------- 事件 ---------------- */

  function bindEvents() {
    el.menuBtn.addEventListener("click", toggleSidebar);
    el.scrim.addEventListener("click", closeSidebar);
    el.updateBtn.addEventListener("click", handleUpdate);

    el.topBtn.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    window.addEventListener("scroll", function () {
      el.topBtn.hidden = window.scrollY < 600;
    }, { passive: true });

    el.nav.addEventListener("click", function (ev) {
      var toggle = ev.target.closest("[data-toggle]");
      if (toggle) {
        if (state.query) return; // 搜索态下分组固定展开
        var id = Number(toggle.getAttribute("data-toggle"));
        if (state.expanded.has(id)) state.expanded.delete(id);
        else state.expanded.add(id);
        saveExpanded();
        renderNav();
        return;
      }
      var item = ev.target.closest("[data-law]");
      if (item) selectLaw(Number(item.getAttribute("data-law")));
    });

    el.content.addEventListener("click", function (ev) {
      var noEl = ev.target.closest(".art-no");
      if (noEl) {
        var artEl = noEl.closest(".art");
        if (artEl) askAI(noEl.textContent.trim(), artEl, noEl.closest(".law-chapter"));
        return;
      }

      var card = ev.target.closest("[data-goto-subject]");
      if (!card) return;
      var id = Number(card.getAttribute("data-goto-subject"));
      state.expanded.add(id);
      saveExpanded();
      renderNav();
      var node = el.nav.querySelector('[data-subject="' + id + '"]');
      if (node) node.scrollIntoView({ block: "nearest", behavior: "smooth" });
      if (window.matchMedia("(max-width: 860px)").matches) openSidebar();
    });

    /* ---- 右侧目录抽屉 ---- */
    el.tocBtn.addEventListener("click", toggleToc);
    el.tocClose.addEventListener("click", closeToc);
    el.tocScrim.addEventListener("click", closeToc);

    el.tocBody.addEventListener("click", function (ev) {
      var btn = ev.target.closest("[data-chapter]");
      if (!btn || state.route.type !== "law") return;
      var cid = btn.getAttribute("data-chapter");
      scrollToChapter(cid, true);
      history.replaceState(null, "", "#/law/" + state.route.lawId + "/ch/" + cid);
      el.tocBody.querySelectorAll(".toc-item.is-active").forEach(function (n) {
        n.classList.remove("is-active");
      });
      btn.classList.add("is-active");
      if (!isDesktopLayout()) closeToc();
    });

    document.addEventListener("click", function (ev) {
      if (el.tocDrawer.hidden) return;
      if (isDesktopLayout()) return;   // 桌面端常驻，只由 × 关闭
      if (ev.target.closest("#tocDrawer") || ev.target.closest("#tocBtn")) return;
      closeToc();
    });

    el.searchInput.addEventListener("focus", function () {
      document.body.classList.add("searching");
    });

    el.searchInput.addEventListener("blur", function () {
      // 有内容时保持展开，方便看/search 结果；空了就收回去
      if (!el.searchInput.value) document.body.classList.remove("searching");
    });

    var searchTimer = null;
    el.searchInput.addEventListener("input", function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        state.query = el.searchInput.value;
        el.clearBtn.hidden = !state.query;
        if (state.route.type === "law") {
          runFind(state.query);          // 法律页：搜正文
        } else {
          renderNav();                   // 首页：过滤目录
        }
      }, 180);
    });

    el.searchInput.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && state.route.type === "law") {
        ev.preventDefault();
        if (!finder.marks.length) return;
        gotoMark(finder.index + (ev.shiftKey ? -1 : 1));
      }
    });

    el.findPrev.addEventListener("click", function () { gotoMark(finder.index - 1); });
    el.findNext.addEventListener("click", function () { gotoMark(finder.index + 1); });
    el.findClose.addEventListener("click", function () {
      el.searchInput.value = "";
      state.query = "";
      el.clearBtn.hidden = true;
      clearFind();
      el.searchInput.blur();
    });

    el.clearBtn.addEventListener("click", function () {
      el.searchInput.value = "";
      state.query = "";
      el.clearBtn.hidden = true;
      if (state.route.type === "law") clearFind();
      else renderNav();
      el.searchInput.focus();
    });

    el.collapseAll.addEventListener("click", function () {
      if (state.expanded.size) {
        state.expanded.clear();
        el.collapseAll.textContent = "全部展开";
      } else {
        state.catalog.subjects.forEach(function (s) {
          state.expanded.add(s.id);
        });
        el.collapseAll.textContent = "全部收起";
      }
      saveExpanded();
      renderNav();
    });

    window.addEventListener("hashchange", function () {
      if (!state.catalog) return;
      applyRoute();
      closeSidebar();
    });

    // 窗口尺寸变化：桌面端让正文让位，移动端回到遮罩模式
    var resizeTimer = null;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        var desktop = isDesktopLayout();
        if (el.tocDrawer.hidden) {
          document.body.classList.remove("toc-docked");
        } else {
          el.tocScrim.hidden = desktop;
          document.body.classList.toggle("toc-docked", desktop);
        }
      }, 150);
    });

    document.addEventListener("keydown", function (ev) {
      if (ev.key === "/" && document.activeElement !== el.searchInput) {
        ev.preventDefault();
        el.searchInput.focus();
      } else if (ev.key === "Escape") {
        if (state.query) {
          el.searchInput.value = "";
          state.query = "";
          el.clearBtn.hidden = true;
          if (state.route.type === "law") clearFind();
          else renderNav();
        }
        closeSidebar();
        closeToc();
      }
    });
  }

  /* ---------------- 启动 ---------------- */

  function init() {
    el.nav = document.getElementById("nav");
    el.content = document.getElementById("content");
    el.searchInput = document.getElementById("searchInput");
    el.clearBtn = document.getElementById("clearBtn");
    el.collapseAll = document.getElementById("collapseAll");
    el.menuBtn = document.getElementById("menuBtn");
    el.sidebar = document.getElementById("sidebar");
    el.scrim = document.getElementById("scrim");
    el.topStat = document.getElementById("topStat");
    el.sidebarFoot = document.getElementById("sidebarFoot");
    el.updateBtn = document.getElementById("updateBtn");
    el.syncDot = document.getElementById("syncDot");
    el.toasts = document.getElementById("toasts");
    el.findBar = document.getElementById("findBar");
    el.findStatus = document.getElementById("findStatus");
    el.findPrev = document.getElementById("findPrev");
    el.findNext = document.getElementById("findNext");
    el.findClose = document.getElementById("findClose");
    el.tocBtn = document.getElementById("tocBtn");
    el.tocDrawer = document.getElementById("tocDrawer");
    el.tocScrim = document.getElementById("tocScrim");
    el.tocClose = document.getElementById("tocClose");
    el.tocBody = document.getElementById("tocBody");
    el.tocMeta = document.getElementById("tocMeta");
    el.topBtn = document.getElementById("topBtn");

    loadCatalog().then(function (catalog) {
      if (!catalog) {
        el.nav.innerHTML = '<p class="nav-empty">目录数据加载失败，请通过本地服务器打开本页。</p>';
        return;
      }
      state.catalog = catalog;
      indexCatalog(catalog);

      var saved = loadExpanded();
      if (saved) {
        state.expanded = saved;
      } else {
        // 首次访问: 展开第一个学科, 让用户立刻看到结构
        state.expanded.add(catalog.subjects[0].id);
      }
      el.collapseAll.textContent = state.expanded.size ? "全部收起" : "全部展开";

      renderFooter();

      bindEvents();

      // 支持 ?q=民法典 直接带搜索词打开
      var seeded = new URLSearchParams(location.search).get("q");
      if (seeded) {
        el.searchInput.value = seeded;
        state.query = seeded;
        el.clearBtn.hidden = false;
        document.body.classList.add("searching");
        if (window.matchMedia("(max-width: 860px)").matches) openSidebar();
      }

      applyRoute();
      checkStatus();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
