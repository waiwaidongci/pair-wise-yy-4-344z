/*
 * 页面操作（放行台 UI）
 * - 页签切换：沉船标记 / 气量放行台
 * - 潜后登记 → 按规则现算状态：耗气异常或休息不足转待复核
 * - 安全员复核补录余量后放行；上一潜读数更正后计划立即重排，旧记录留档展示
 */
(function () {
  "use strict";

  var G = window.GasRules;
  var Store = window.ReviewLog;

  var tabMarks = document.querySelector("#tabMarks");
  var tabStation = document.querySelector("#tabStation");
  var marksApp = document.querySelector("#marksApp");
  var stationApp = document.querySelector("#stationApp");
  var exportBtn = document.querySelector("#exportBtn");
  var subtitle = document.querySelector("#subtitle");

  var clockEl = document.querySelector("#clock");
  var legendEl = document.querySelector("#restLegend");
  var planBoard = document.querySelector("#planBoard");
  var reviewBoard = document.querySelector("#reviewBoard");
  var archiveBoard = document.querySelector("#archiveBoard");

  var logForm = document.querySelector("#logForm");
  var logMsg = document.querySelector("#logMsg");
  var reviewForm = document.querySelector("#reviewForm");
  var reviewMsg = document.querySelector("#reviewMsg");
  var correctForm = document.querySelector("#correctForm");
  var correctMsg = document.querySelector("#correctMsg");

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function pad(n) { return String(n).padStart(2, "0"); }

  function fmtDateTime(iso) {
    var d = new Date(iso);
    return (d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function toLocalInput(iso) {
    var d = new Date(iso);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }

  function setMsg(el, text, ok) {
    el.textContent = text || "";
    el.className = "form-msg " + (text ? (ok ? "ok" : "err") : "");
  }

  /* ---------------- 页签 ---------------- */

  function showStation() {
    marksApp.hidden = true;
    stationApp.hidden = false;
    tabMarks.classList.remove("active");
    tabStation.classList.add("active");
    exportBtn.hidden = true;
    subtitle.textContent = "登记气瓶消耗与水面间隔，安全员复核后放行下一潜。";
    render();
  }

  function showMarks() {
    marksApp.hidden = false;
    stationApp.hidden = true;
    tabMarks.classList.add("active");
    tabStation.classList.remove("active");
    exportBtn.hidden = false;
    subtitle.textContent = "点击沉船平面图添加标记，筛选、编辑并导出JSON。";
  }

  tabStation.onclick = showStation;
  tabMarks.onclick = showMarks;

  /* ---------------- 潜后登记 ---------------- */

  function defaultExitAt() {
    return toLocalInput(new Date().toISOString());
  }
  logForm.elements.exitAt.value = defaultExitAt();

  function readNumeric(form) {
    var d = Object.fromEntries(new FormData(form).entries());
    return {
      diver: d.diver,
      tankVolume: Number(d.tankVolume),
      pStart: Number(d.pStart),
      pEnd: Number(d.pEnd),
      maxDepth: Number(d.maxDepth),
      bottomTime: Number(d.bottomTime),
      exitAt: d.exitAt
    };
  }

  logForm.onsubmit = function (event) {
    event.preventDefault();
    var d = readNumeric(logForm);
    if (!d.diver || !d.diver.trim()) return setMsg(logMsg, "请填写队员姓名。", false);
    if (d.pEnd > d.pStart) return setMsg(logMsg, "出水压力不能高于起始压力。", false);
    if (!d.exitAt) return setMsg(logMsg, "请填写出水时刻。", false);
    var log = Store.registerLog(d);
    var verdict = G.evaluate(log, Store.currentLogs());
    var state = G.restState(log, Date.now());
    var tip;
    if (verdict.needsReview) tip = "已登记：耗气或休息未达标，已转待复核。";
    else if (!state.rested) tip = "已登记：耗气正常，休息满 " + state.required + " 分钟后可入水。";
    else tip = "已登记：耗气与休息均达标，可安排下一潜。";
    setMsg(logMsg, tip, true);
    logForm.reset();
    logForm.elements.exitAt.value = defaultExitAt();
    render();
  };

  /* ---------------- 安全员复核 ---------------- */

  function openReview(logId) {
    var log = Store.getLog(logId);
    if (!log) return;
    correctForm.hidden = true;
    reviewForm.hidden = false;
    reviewForm.elements.logId.value = logId;
    reviewForm.elements.reserveBar.value = log.pEnd;
    reviewForm.elements.note.value = "";
    document.querySelector("#reviewTarget").textContent =
      log.diver + " · " + log.maxDepth + "m · 出水压力 " + log.pEnd + "bar";
    setMsg(reviewMsg, "", true);
  }

  document.querySelector("#reviewCancel").onclick = function () {
    reviewForm.hidden = true;
  };

  reviewForm.onsubmit = function (event) {
    event.preventDefault();
    var data = Object.fromEntries(new FormData(reviewForm).entries());
    var logId = data.logId;
    var decision = event.submitter ? event.submitter.value : "held";
    if (!data.reviewer.trim()) return setMsg(reviewMsg, "请填写复核人。", false);
    Store.addReview({
      logId: logId,
      diver: Store.getLog(logId).diver,
      reviewer: data.reviewer,
      reserveBar: data.reserveBar,
      note: data.note,
      decision: decision
    });
    setMsg(reviewMsg, decision === "released" ? "已补录余量并放行下一潜。" : "已记录意见，维持待复核。", true);
    reviewForm.hidden = true;
    render();
  };

  /* ---------------- 读数更正 ---------------- */

  function openCorrect(logId) {
    var log = Store.getLog(logId);
    if (!log) return;
    if (!Store.isLatest(logId)) {
      setMsg(correctMsg, "仅本人最新一潜可在此更正；更早记录请联系安全员留档处理。", false);
      return;
    }
    reviewForm.hidden = true;
    correctForm.hidden = false;
    var f = correctForm.elements;
    f.logId.value = log.id;
    f.tankVolume.value = log.tankVolume;
    f.pStart.value = log.pStart;
    f.pEnd.value = log.pEnd;
    f.maxDepth.value = log.maxDepth;
    f.bottomTime.value = log.bottomTime;
    f.exitAt.value = toLocalInput(log.exitAt);
    f.reason.value = "";
    document.querySelector("#correctTarget").textContent =
      log.diver + " · 更正后该潜回到待复核，下一潜计划立即重排，旧读数留档。";
    setMsg(correctMsg, "", true);
  }

  document.querySelector("#correctCancel").onclick = function () {
    correctForm.hidden = true;
  };

  correctForm.onsubmit = function (event) {
    event.preventDefault();
    var d = readNumeric(correctForm);
    var logId = correctForm.elements.logId.value;
    var reason = correctForm.elements.reason.value;
    if (d.pEnd > d.pStart) return setMsg(correctMsg, "出水压力不能高于起始压力。", false);
    if (!reason.trim()) return setMsg(correctMsg, "请填写更正原因，旧记录将随原因留档。", false);
    Store.correctLog(logId, d, reason);
    setMsg(correctMsg, "读数已更正留档，后续计划已重排。", true);
    correctForm.hidden = true;
    render();
  };

  /* ---------------- 放行台渲染 ---------------- */

  function diverNumber(log) {
    return Store.diverSeries(log.diver).findIndex(function (l) { return l.id === log.id; }) + 1;
  }

  function flagLines(log, evalResult) {
    var lines = [];
    var e = evalResult;
    if (e.baseline == null) {
      lines.push('<div class="muted">耗气率 ' + e.sac + ' L/min（本人不足' + G.BASELINE_SIZE +
        '潜，暂无中位数基准）</div>');
    } else if (e.highRate) {
      lines.push('<div class="flag-hold">耗气率 ' + e.sac + ' L/min，较本人近三次中位数 ' +
        e.baseline + ' 高出 ' + e.jumpPct + '%（放行上限 ' + e.rateLimit +
        '，＞+20%）→ 待复核</div>');
    } else {
      lines.push('<div class="flag-ok">耗气率 ' + e.sac + ' L/min，近三次中位数 ' + e.baseline +
        '（+' + (e.jumpPct == null ? 0 : e.jumpPct) + '%，未超 +20%）</div>');
    }
    if (e.prev) {
      if (e.restShort) {
        lines.push('<div class="flag-hold">与上一潜（' + e.prev.maxDepth + 'm）水面间隔 ' +
          e.surfaceIntervalMin + ' 分钟，少于门槛 ' + e.requiredRestMin + ' 分钟 → 待复核</div>');
      } else {
        lines.push('<div class="flag-ok">与上一潜间隔 ' + e.surfaceIntervalMin +
          ' 分钟，满足门槛 ' + e.requiredRestMin + ' 分钟</div>');
      }
    }
    if (Number(log.pEnd) < G.MIN_RESERVE_BAR) {
      lines.push('<div class="low-reserve">出水压力 ' + log.pEnd + 'bar 低于 ' +
        G.MIN_RESERVE_BAR + 'bar 提醒线，复核余量请关注</div>');
    }
    return lines.join("");
  }

  function cardState(log, e, now) {
    var review = Store.latestReview(log.id);
    if (review && review.decision === "released") {
      return { key: "released", text: "已放行", cls: "released", review: review };
    }
    if (review && review.decision === "held") {
      return { key: "held", text: "维持待复核", cls: "held", review: review };
    }
    if (e.needsReview) return { key: "review", text: "待复核", cls: "review" };
    var state = G.restState(log, now);
    if (!state.rested) {
      return { key: "rest", text: "休息中 · 还差 " + state.remaining + " 分钟", cls: "rest" };
    }
    return { key: "ready", text: "可入水", cls: "ready" };
  }

  function renderCard(log, now) {
    var logs = Store.currentLogs();
    var e = G.evaluate(log, logs);
    var st = cardState(log, e, now);
    var latest = Store.isLatest(log.id);
    var reviewNote = st.review
      ? '<div class="muted">复核人 ' + esc(st.review.reviewer) +
        (st.review.reserveBar != null ? ' · 复核余量 ' + st.review.reserveBar + 'bar' : '') +
        ' · ' + esc(st.review.note || "（无备注）") + '</div>'
      : '';
    var reviewBtn = st.key === "released"
      ? '<button type="button" data-act="review" class="secondary">再次复核</button>'
      : '<button type="button" data-act="review">复核放行</button>';
    var actions = '<div class="card-actions">' + reviewBtn +
      '<button type="button" data-act="correct" class="secondary" ' +
      (latest ? '' : 'disabled title="仅最新一潜可更正"') + '>更正读数</button></div>';
    return '<div class="dive-card ' + st.cls + '" data-id="' + log.id + '">' +
      '<div class="top"><b>' + esc(log.diver) + '（第' + diverNumber(log) + '潜）</b>' +
      '<span class="chip ' + st.cls + '">' + st.text + '</span></div>' +
      '<div class="metrics">' +
      '<span>瓶容 ' + log.tankVolume + 'L</span>' +
      '<span>压力 ' + log.pStart + '→' + log.pEnd + 'bar</span>' +
      '<span>用气 ' + e.gasUsed + 'L</span>' +
      '<span>深度 ' + log.maxDepth + 'm</span>' +
      '<span>底部 ' + log.bottomTime + 'min</span>' +
      '<span>出水 ' + fmtDateTime(log.exitAt) + '</span></div>' +
      '<div class="flags">' + flagLines(log, e) + '</div>' +
      reviewNote +
      (latest ? actions : '<div class="muted">非本人最新潜次，仅留档。</div>') +
      '</div>';
  }

  function bindCards(container) {
    container.querySelectorAll("[data-act]").forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.closest(".dive-card").dataset.id;
        if (btn.dataset.act === "review") openReview(id);
        if (btn.dataset.act === "correct") openCorrect(id);
      };
    });
  }

  function renderArchive() {
    var entries = Store.archiveEntries();
    if (!entries.length) {
      archiveBoard.innerHTML = '<div class="empty-note">暂无更正留档。</div>';
      return;
    }
    var reviewsById = {};
    Store.allReviews().forEach(function (r) { (reviewsById[r.id] = r); });
    archiveBoard.innerHTML = entries.map(function (en) {
      var d = en.data;
      var oldReviews = en.supersededReviewIds.map(function (rid) {
        var r = reviewsById[rid];
        return r ? '<div class="old-tag">旧复核意见（随旧读数作废）：' + esc(r.reviewer) +
          ' · ' + (r.decision === "released" ? "已放行" : "维持待复核") +
          (r.reserveBar != null ? ' · 余量' + r.reserveBar + 'bar' : '') +
          ' · ' + esc(r.note || "") + '</div>' : '';
      }).join("");
      return '<div class="dive-card old-card">' +
        '<div class="top"><b>' + esc(en.diver) + ' 旧读数</b>' +
        '<span class="old-tag">' + fmtDateTime(en.correctedAt) + ' 更正留档</span></div>' +
        '<div class="metrics">' +
        '<span>瓶容 ' + d.tankVolume + 'L</span><span>压力 ' + d.pStart + '→' + d.pEnd + 'bar</span>' +
        '<span>深度 ' + d.maxDepth + 'm</span><span>底部 ' + d.bottomTime + 'min</span>' +
        '<span>出水 ' + fmtDateTime(d.exitAt) + '</span></div>' +
        '<div class="old-tag">更正原因：' + esc(en.reason || "（未填）") + '</div>' +
        oldReviews + '</div>';
    }).join("");
  }

  function renderLegend() {
    legendEl.textContent = "休息门槛按上一潜最大深度：≤12m 30分 / ≤18m 45分 / ≤24m 60分 / ≤30m 90分 / 更深120分；" +
      "耗气率(SAC)高于本人最近三次中位数两成，或水面间隔不足，即转待复核。";
  }

  function render() {
    if (stationApp.hidden) return;
    var now = Date.now();
    clockEl.textContent = "当前 " + fmtDateTime(new Date(now).toISOString());

    var latest = Store.latestPerDiver()
      .sort(function (a, b) { return G.nextEligible(a) - G.nextEligible(b); });
    planBoard.innerHTML = latest.map(function (log) { return renderCard(log, now); }).join("") ||
      '<div class="empty-note">尚无登记。</div>';
    bindCards(planBoard);

    var pending = Store.currentLogs().filter(function (log) {
      var e = G.evaluate(log, Store.currentLogs());
      var review = Store.latestReview(log.id);
      var released = review && review.decision === "released";
      return e.needsReview && !released;
    }).sort(function (a, b) {
      var ra = Store.latestReview(a.id);
      var rb = Store.latestReview(b.id);
      var ha = ra && ra.decision === "held" ? 0 : 1;
      var hb = rb && rb.decision === "held" ? 0 : 1;
      if (ha !== hb) return ha - hb;
      return Date.parse(a.exitAt) - Date.parse(b.exitAt);
    });
    reviewBoard.innerHTML = pending.map(function (log) { return renderCard(log, now); }).join("") ||
      '<div class="empty-note">没有待复核潜次。</div>';
    bindCards(reviewBoard);

    renderArchive();

    var divers = Store.currentLogs().map(function (l) { return l.diver; })
      .filter(function (v, i, arr) { return arr.indexOf(v) === i; });
    document.querySelector("#diverList").innerHTML =
      divers.map(function (n) { return '<option value="' + esc(n) + '">'; }).join("");
  }

  // 休息倒计时每分钟级变化，30 秒刷一次
  setInterval(render, 30000);
  renderLegend();
})();
