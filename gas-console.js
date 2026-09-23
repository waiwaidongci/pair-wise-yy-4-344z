/*!
 * 页面操作层：表单、放行板、记录列表、复核与更正弹窗的渲染和事件
 * 规则判定全部走 GasRules；数据读写全部走 ReviewRecords
 */
(function () {
  "use strict";

  var Rules = window.GasRules;
  var Store = window.ReviewRecords;

  var board = document.getElementById("board");
  var logList = document.getElementById("logList");
  var form = document.getElementById("logForm");
  var preview = document.getElementById("preview");
  var diverSelect = document.getElementById("diverSelect");
  var diverFilter = document.getElementById("diverFilter");
  var statusFilter = document.getElementById("statusFilter");
  var archiveToggle = document.getElementById("archiveToggle");
  var clock = document.getElementById("clock");
  var floorText = document.getElementById("floorText");

  var STATUS_TEXT = { pending: "待复核", open: "待放行", released: "已放行" };

  init();

  function init() {
    floorText.textContent = Store.FLOOR;
    Store.ROSTER.forEach(function (d) {
      diverSelect.add(new Option(d.name + "（" + d.code + "）", d.id));
      diverFilter.add(new Option(d.name, d.id));
    });
    bindEvents();
    form.reset();
    form.exitAt.value = toLocalInput(new Date());
    render();
    setInterval(render, 30000);
  }

  function bindEvents() {
    form.addEventListener("submit", onSubmitForm);
    form.addEventListener("input", renderPreview);
    document.getElementById("resetBtn").addEventListener("click", function () {
      form.reset();
      form.exitAt.value = toLocalInput(new Date());
      renderPreview();
    });

    diverFilter.onchange = render;
    statusFilter.onchange = render;
    archiveToggle.onchange = render;

    // 列表内按钮：复核 / 更正 / 展开
    logList.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-act]");
      var head = e.target.closest(".log-head");
      if (btn) {
        var act = btn.dataset.act, id = btn.dataset.id;
        if (act === "review") openReview(id);
        if (act === "correct") openCorrect(id);
        return;
      }
      if (head) {
        var item = head.closest(".log-item");
        var detail = item.querySelector(".log-detail");
        detail.style.display = detail.style.display === "none" ? "" : "none";
      }
    });

    // 放行板按钮
    board.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-act]");
      if (!btn) return;
      if (btn.dataset.act === "review") openReview(btn.dataset.id);
      if (btn.dataset.act === "correct") openCorrect(btn.dataset.id);
      if (btn.dataset.act === "filterDiver") {
        diverFilter.value = btn.dataset.id;
        render();
      }
    });

    var reviewOverlay = document.getElementById("reviewOverlay");
    var reviewForm = document.getElementById("reviewForm");
    document.getElementById("reviewCancel").onclick = function () {
      reviewOverlay.classList.remove("show");
    };
    reviewForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var data = Object.fromEntries(new FormData(reviewForm).entries());
      try {
        var log = Store.release(reviewForm.dataset.id, data);
        reviewOverlay.classList.remove("show");
        reviewForm.reset();
        toast(log.code + " 已放行，" + diverName(log.diverId) + " 可安排下一潜");
        render();
      } catch (err) {
        toast(err.message, true);
      }
    });

    var correctOverlay = document.getElementById("correctOverlay");
    var correctForm = document.getElementById("correctForm");
    document.getElementById("correctCancel").onclick = function () {
      correctOverlay.classList.remove("show");
    };
    correctForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var data = Object.fromEntries(new FormData(correctForm).entries());
      var id = data.id;
      delete data.id;
      try {
        var log = Store.correct(id, data, data.actor, data.reason);
        correctOverlay.classList.remove("show");
        correctForm.reset();
        toast(log.code + " 读数已更正，旧记录留档，相关计划已重排");
        render();
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  function onSubmitForm(e) {
    e.preventDefault();
    var data = Object.fromEntries(new FormData(form).entries());
    delete data.id;
    try {
      var log = Store.addLog(data);
      var now = Date.now();
      var status = Store.effectiveStatus(log, Store.loadLogs(), now);
      toast(log.code + " 已登记：" + (status === "pending" ? "转待复核" : "判定无异常，待安全员放行"));
      form.reset();
      form.exitAt.value = toLocalInput(new Date());
      render();
    } catch (err) {
      toast(err.message, true);
    }
  }

  // ---------- 渲染 ----------
  function render() {
    var now = Date.now();
    clock.textContent = "现在 " + fmtClock(now);
    var logs = Store.refreshStatuses(Store.loadLogs(), now);
    Store.saveLogs(logs);
    renderBoard(logs, now);
    renderList(logs, now);
    renderPreview();
  }

  function renderBoard(logs, now) {
    board.innerHTML = Store.ROSTER.map(function (diver) {
      var log = Store.latestOf(logs, diver.id);
      if (!log) {
        return '<div class="diver-card empty"><div class="diver-head"><span class="diver-name">' +
          esc(diver.name) + '</span><span class="badge empty">无记录</span></div>' +
          '<div class="muted">尚未登记潜次</div></div>';
      }
      var r = Rules.evaluate(log, logs, now);
      var status = Store.effectiveStatus(log, logs, now);
      var body;
      if (status === "released") {
        var rv = log.review || {};
        body =
          okBox("已放行，可安排下一潜") +
          '<div class="tags">' +
            tag("复核余量 " + rv.reserveBar + "bar", rv.reserveBar >= Store.FLOOR ? "good" : "warn") +
            tag("复核人 " + esc(rv.officer || "-")) +
          '</div>' +
          gasLines(log, r) +
          restLine(log, r) +
          '<div class="log-actions"><button class="small secondary" data-act="correct" data-id="' + log.id + '">更正读数</button>' +
          '<button class="small secondary" data-act="filterDiver" data-id="' + diver.id + '">查看记录</button></div>';
      } else {
        var gate = status === "pending"
          ? '<button class="small" data-act="review" data-id="' + log.id + '">安全员复核…</button>'
          : '<button class="small" data-act="review" data-id="' + log.id + '">放行下一潜…</button>';
        body =
          reasonBox(r) +
          gasLines(log, r) +
          restLine(log, r) +
          reserveLine(log) +
          '<div class="log-actions">' + gate +
          '<button class="small secondary" data-act="correct" data-id="' + log.id + '">更正读数</button></div>';
      }
      if (log.replanNote) body = '<div class="replan">⟳ ' + esc(log.replanNote) + '</div>' + body;

      return '<div class="diver-card ' + status + '">' +
        '<div class="diver-head"><span class="diver-name">' + esc(diver.name) +
        ' <span class="muted">' + log.code + '</span></span>' +
        '<span class="badge ' + status + '">' + STATUS_TEXT[status] + '</span></div>' + body + '</div>';
    }).join("");
  }

  function gasLines(log, r) {
    var baseline = r.hasBaseline
      ? r.baseline.toFixed(1) + " L/min"
      : "不足三次（已" + r.sampleCount + "次，不判）";
    var sacTag = r.gasAnomaly
      ? tag("SAC " + r.sac.toFixed(1) + " 偏高 " + (r.ratioPct >= 0 ? "+" : "") + r.ratioPct + "%", "warn")
      : tag("SAC " + r.sac.toFixed(1), "good");
    return '<div class="kv">' +
      '<span class="muted">用气量</span><b>' + Math.round(r.used) + ' L</b>' +
      '<span class="muted">深度耗气率</span><b>' + r.rate.toFixed(1) + ' L/min</b>' +
      '<span class="muted">水面SAC（' + r.ata.toFixed(1) + 'ata）</span><b>' + r.sac.toFixed(1) + ' L/min</b>' +
      '<span class="muted">近三次中位SAC</span><b>' + baseline + '</b>' +
      '</div><div class="tags">' + sacTag +
      tag(log.volume + "L · " + log.maxDepth + "m · 底" + log.bottomTime + "分") +
      tag(log.startPressure + "→" + log.endPressure + "bar") + '</div>';
  }

  function restLine(log, r) {
    var pct = Math.min(100, Math.round(r.restedMin / r.band.minutes * 100));
    var text = r.restEnough
      ? "休息已满 " + Rules.fmtMin(r.restedMin) + "（门槛" + Rules.fmtMin(r.band.minutes) + "）"
      : "已休 " + Rules.fmtMin(r.restedMin) + " / 需 " + Rules.fmtMin(r.band.minutes) +
        "，还差 " + Rules.fmtMin(r.restRemainingMin);
    return '<div class="muted">水面休息 · ' + esc(r.band.label) + '</div>' +
      '<div class="restbar' + (r.restEnough ? "" : " low") + '"><i style="width:' + pct + '%"></i></div>' +
      '<div class="muted">' + text + '</div>';
  }

  function reserveLine(log) {
    var low = log.endPressure < Store.FLOOR;
    return '<div class="tags" style="margin-top:8px">' +
      tag("出水残压 " + log.endPressure + "bar" + (low ? "，低于底线" + Store.FLOOR + "bar" : ""), low ? "warn" : "") +
      tag("出水 " + fmtClock(Date.parse(log.exitAt))) +
      '</div>';
  }

  function reasonBox(r) {
    if (!r.reasons.length) return okBox("耗气与休息均无异常") +
      (r.hasBaseline ? "" : '<div class="tag" style="margin-bottom:6px">基线不足三次，耗气暂不比对</div>');
    return '<div class="reasons">' + r.reasons.map(function (x) {
      return '<div class="reason">' + (x.code === "GAS" ? "⛽ " : "⏱ ") + esc(x.label) + "</div>";
    }).join("") + "</div>";
  }

  function okBox(text) {
    return '<div class="ok-note">✓ ' + esc(text) + "</div>";
  }

  function tag(text, cls) {
    return '<span class="tag ' + (cls || "") + '">' + esc(text) + "</span>";
  }

  function renderList(logs, now) {
    var archives = Store.loadArchives();
    var filtered = logs
      .filter(function (l) { return !diverFilter.value || l.diverId === diverFilter.value; })
      .filter(function (l) { return !statusFilter.value || Store.effectiveStatus(l, logs, now) === statusFilter.value; })
      .sort(function (a, b) { return Date.parse(b.exitAt) - Date.parse(a.exitAt); });

    var html = filtered.map(function (log) {
      var status = Store.effectiveStatus(log, logs, now);
      var r = Rules.evaluate(log, logs, now);
      var logsOfDiver = archives.filter(function (a) { return a.logId === log.id; });
      var reviewLine = log.review
        ? '<div class="muted">复核：' + esc(log.review.officer) +
          ' · 余量 ' + log.review.reserveBar + 'bar' +
          (log.review.remark ? ' · ' + esc(log.review.remark) : "") +
          ' · ' + fmtClock(Date.parse(log.review.reviewedAt)) + "</div>"
        : "";
      var actions = status === "released"
        ? '<button class="small secondary" data-act="correct" data-id="' + log.id + '">更正读数</button>'
        : '<button class="small" data-act="review" data-id="' + log.id + '">复核</button>' +
          '<button class="small secondary" data-act="correct" data-id="' + log.id + '">更正读数</button>';

      return '<div class="log-item ' + status + '">' +
        '<div class="log-head"><div class="log-title">' + log.code + " · " + esc(diverName(log.diverId)) +
        ' <span class="muted">' + fmtClock(Date.parse(log.exitAt)) + '</span></div>' +
        '<div class="log-actions"><span class="badge ' + status + '">' + STATUS_TEXT[status] + "</span>" + actions +
        "</div></div>" +
        '<div class="log-detail" style="display:none">' +
          (log.replanNote ? '<div class="replan">⟳ ' + esc(log.replanNote) + "</div>" : "") +
          reasonBox(r) +
          '<div class="metric-grid">' +
            metric("瓶容", log.volume + " L") +
            metric("起/残压", log.startPressure + " / " + log.endPressure + " bar") +
            metric("最大深度", log.maxDepth + " m") +
            metric("底部时间", log.bottomTime + " 分") +
            metric("用气量", Math.round(r.used) + " L") +
            metric("深度耗气率", r.rate.toFixed(1) + " L/min") +
            metric("SAC", r.sac.toFixed(1) + " L/min") +
            metric("近三次中位SAC", r.hasBaseline ? r.baseline.toFixed(1) + " L/min" : "样本" + r.sampleCount + "次") +
            metric("休息门槛", r.band.label) +
            metric("已休息", Rules.fmtMin(r.restedMin)) +
          "</div>" +
          reviewLine +
          (logsOfDiver.length ? renderArchives(logsOfDiver) : "") +
        "</div></div>";
    }).join("");

    if (archiveToggle.checked) {
      var archHtml = archives
        .slice()
        .sort(function (a, b) { return Date.parse(b.correctedAt) - Date.parse(a.correctedAt); })
        .map(function (a) {
          return '<div class="archive"><b>' + esc(a.logCode) + " 旧读数留档</b>" +
            '<div class="muted">' + esc(a.changedBy) + " 于 " + fmtClock(Date.parse(a.correctedAt)) +
            " · " + esc(a.reason || "未填原因") + "</div>" +
            '<div class="muted">瓶容 ' + a.snapshot.volume + "L · 压力 " +
            a.snapshot.startPressure + "→" + a.snapshot.endPressure + "bar · 深度 " +
            a.snapshot.maxDepth + "m · 底时 " + a.snapshot.bottomTime + "分 · 出水 " +
            fmtClock(Date.parse(a.snapshot.exitAt)) + "</div></div>";
        }).join("");
      html += '<h2 style="margin-top:14px">留档旧记录（' + archives.length + '）</h2><div class="archive-list">' +
        (archHtml || '<div class="muted">暂无更正留档</div>') + "</div>";
    }

    logList.innerHTML = html || '<div class="muted">没有符合筛选条件的记录</div>';
  }

  function renderArchives(list) {
    return '<div class="archive-list">' + list.map(function (a) {
      var s = a.snapshot;
      return '<div class="archive">旧读数留档（' + esc(a.changedBy) + "，" + fmtClock(Date.parse(a.correctedAt)) +
        '）<br><span class="muted">' +
        s.volume + "L · " + s.startPressure + "→" + s.endPressure + "bar · " +
        s.maxDepth + "m · 底" + s.bottomTime + "分 · " + esc(a.reason || "") +
        "</span></div>";
    }).join("") + "</div>";
  }

  function metric(label, value) {
    return '<div class="metric"><span class="muted">' + label + '</span><b>' + esc(value) + "</b></div>";
  }

  // ---------- 弹窗 ----------
  function openReview(id) {
    var now = Date.now();
    var logs = Store.loadLogs();
    var log = logs.find(function (l) { return l.id === id; });
    if (!log) return;
    var r = Rules.evaluate(log, logs, now);
    var overlay = document.getElementById("reviewOverlay");
    var rf = document.getElementById("reviewForm");
    rf.dataset.id = id;
    rf.reserveBar.value = Math.max(log.endPressure, Store.FLOOR);
    rf.officer.value = log.review ? log.review.officer : "";
    document.getElementById("reviewSummary").innerHTML =
      "<b>" + log.code + " · " + esc(diverName(log.diverId)) + "</b>" +
      reasonBox(r) +
      '<div class="muted">出水残压 ' + log.endPressure + "bar；放行底线 " + Store.FLOOR +
      "bar；补录余量为复核时瓶内实际余量（含充气后）。</div>";
    overlay.classList.add("show");
  }

  function openCorrect(id) {
    var logs = Store.loadLogs();
    var log = logs.find(function (l) { return l.id === id; });
    if (!log) return;
    var cf = document.getElementById("correctForm");
    cf.dataset.id = id;
    cf.id.value = id;
    cf.volume.value = log.volume;
    cf.startPressure.value = log.startPressure;
    cf.endPressure.value = log.endPressure;
    cf.maxDepth.value = log.maxDepth;
    cf.bottomTime.value = log.bottomTime;
    cf.exitAt.value = toLocalInput(new Date(log.exitAt));
    cf.actor.value = "";
    cf.reason.value = "";
    document.getElementById("correctHint").textContent =
      log.code + "：更正后旧读数快照留档，该队员其后未放行潜次自动重排；已放行的仅标记复算。";
    document.getElementById("correctOverlay").classList.add("show");
  }

  // ---------- 登记试算预览 ----------
  function renderPreview() {
    var data = Object.fromEntries(new FormData(form).entries());
    var n = function (v) { return Number(String(v).trim()); };
    var ok = n(data.volume) > 0 && n(data.startPressure) > n(data.endPressure) &&
      n(data.endPressure) > 0 && n(data.maxDepth) > 0 && n(data.bottomTime) > 0;
    if (!ok) {
      preview.innerHTML = '<span class="muted">填齐瓶容、压力、深度、底时后显示试算结果</span>';
      return;
    }
    var candidate = {
      id: "__preview__",
      diverId: data.diverId || "__none__",
      volume: n(data.volume),
      startPressure: n(data.startPressure),
      endPressure: n(data.endPressure),
      maxDepth: n(data.maxDepth),
      bottomTime: n(data.bottomTime),
      exitAt: data.exitAt ? new Date(data.exitAt).toISOString() : new Date().toISOString()
    };
    var logs = Store.loadLogs();
    var r = Rules.evaluate(candidate, logs, Date.now());
    var band = Rules.restBand(candidate.maxDepth);
    preview.innerHTML =
      "<span>试算用气量 <b>" + Math.round(r.used) + ' L</b></span>' +
      "<span>深度耗气率 <b>" + r.rate.toFixed(1) + " L/min</b> · SAC <b>" + r.sac.toFixed(1) + " L/min</b></span>" +
      "<span>休息门槛 <b>" + esc(band.label) + "</b></span>" +
      (r.hasBaseline
        ? '<span class="' + (r.gasAnomaly ? "" : "muted") + '">近三次中位SAC <b>' + r.baseline.toFixed(1) +
          "</b>，本次" + (r.gasAnomaly ? "高出超两成，将转待复核" : "未超两成") + "</span>"
        : '<span class="muted">该队员基线不足三次，耗气暂不比对</span>');
  }

  // ---------- 工具 ----------
  function diverName(id) {
    var d = Store.ROSTER.find(function (x) { return x.id === id; });
    return d ? d.name : id;
  }

  function toLocalInput(date) {
    var p = function (n) { return String(n).padStart(2, "0"); };
    return date.getFullYear() + "-" + p(date.getMonth() + 1) + "-" + p(date.getDate()) +
      "T" + p(date.getHours()) + ":" + p(date.getMinutes());
  }

  function fmtClock(t) {
    var d = new Date(t);
    var p = function (n) { return String(n).padStart(2, "0"); };
    return (d.getMonth() + 1) + "月" + d.getDate() + "日 " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var toastTimer = null;
  function toast(text, isError) {
    var el = document.getElementById("toast");
    el.textContent = text;
    el.className = "show" + (isError ? " error" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = ""; }, 2800);
  }
})();
