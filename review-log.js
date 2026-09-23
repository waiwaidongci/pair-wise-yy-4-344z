/*
 * 复核记录（数据层）
 * - logs：各潜登记读数；reviews：安全员复核/放行意见；archive：更正后旧读数留档
 * - 读数更正：旧版本整份转入 archive，当前潜次回到待复核，之后的计划随之重排
 * - 状态由 GasRules 现算，不在记录里固化，便于更正后立即重排
 */
(function () {
  "use strict";

  var STORE_KEY = "zfl30Station.v1";

  function uid() {
    return crypto.randomUUID ? crypto.randomUUID() :
      "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  function isoMinus(min) {
    return new Date(Date.now() - min * 60000).toISOString();
  }

  function seed() {
    // 演示用历史潜次（时间相对“现在”，保证水面间隔与休息状态可读）
    var logs = [
      // 陈浩：近三次稳定，最新一潜耗气正常、休息已够，已复核放行
      { id: uid(), diver: "陈浩", tankVolume: 12, pStart: 200, pEnd: 110, maxDepth: 12, bottomTime: 30, exitAt: isoMinus(300) },
      { id: uid(), diver: "陈浩", tankVolume: 12, pStart: 200, pEnd: 100, maxDepth: 11, bottomTime: 32, exitAt: isoMinus(210) },
      { id: uid(), diver: "陈浩", tankVolume: 12, pStart: 200, pEnd: 105, maxDepth: 12, bottomTime: 30, exitAt: isoMinus(100) },
      { id: uid(), diver: "陈浩", tankVolume: 12, pStart: 200, pEnd: 108, maxDepth: 12, bottomTime: 30, exitAt: isoMinus(35) },

      // 李澜：最新一潜耗气率较本人中位数高出两成以上 → 待复核；休息还差约25分钟
      { id: uid(), diver: "李澜", tankVolume: 11, pStart: 200, pEnd: 130, maxDepth: 14, bottomTime: 30, exitAt: isoMinus(300) },
      { id: uid(), diver: "李澜", tankVolume: 11, pStart: 200, pEnd: 125, maxDepth: 15, bottomTime: 32, exitAt: isoMinus(190) },
      { id: uid(), diver: "李澜", tankVolume: 11, pStart: 200, pEnd: 120, maxDepth: 14, bottomTime: 30, exitAt: isoMinus(95) },
      { id: uid(), diver: "李澜", tankVolume: 11, pStart: 200, pEnd: 80,  maxDepth: 16, bottomTime: 30, exitAt: isoMinus(20) },

      // 王屹：第三潜出水压力曾更正留档；最新一潜正常，休息已满，可入水
      { id: uid(), diver: "王屹", tankVolume: 12, pStart: 200, pEnd: 100, maxDepth: 12, bottomTime: 30, exitAt: isoMinus(320) },
      { id: uid(), diver: "王屹", tankVolume: 12, pStart: 200, pEnd: 90,  maxDepth: 13, bottomTime: 32, exitAt: isoMinus(220) },
      { id: uid(), diver: "王屹", tankVolume: 12, pStart: 200, pEnd: 90,  maxDepth: 12, bottomTime: 31, exitAt: isoMinus(95) },
      { id: uid(), diver: "王屹", tankVolume: 12, pStart: 200, pEnd: 105, maxDepth: 12, bottomTime: 30, exitAt: isoMinus(30) },

      // 赵潜：本潜仅第二次，无三次基准；与上一潜间隔仅2分钟（门槛60）→ 待复核
      { id: uid(), diver: "赵潜", tankVolume: 11, pStart: 200, pEnd: 110, maxDepth: 20, bottomTime: 30, exitAt: isoMinus(40) },
      { id: uid(), diver: "赵潜", tankVolume: 11, pStart: 200, pEnd: 120, maxDepth: 21, bottomTime: 28, exitAt: isoMinus(10) }
    ];

    // 王屹第三潜出水压力原登记 80，后更正为 90，旧读数及旧放行意见留档
    var corrected = logs[10];
    var archive = [{
      archivedId: uid(),
      logId: corrected.id,
      diver: corrected.diver,
      data: Object.assign({}, corrected, { pEnd: 80 }),
      reason: "瓶压表抄录有误",
      correctedAt: isoMinus(88),
      supersededReviewIds: []
    }];

    var reviews = [
      // 陈浩最新一潜已由安全员复核放行
      {
        id: uid(), logId: logs[3].id, diver: "陈浩", reviewer: "周安全",
        decision: "released", reserveBar: 108, note: "耗气与休息均正常，放行。",
        decidedAt: isoMinus(33)
      },
      // 王屹那次更正前曾放行；旧放行随旧读数一并作废旧标记
      {
        id: uid(), logId: logs[10].id, diver: "王屹", reviewer: "周安全",
        decision: "released", reserveBar: 80, note: "按原读数放行，后因读数更正重排。",
        decidedAt: isoMinus(92)
      }
    ];
    archive[0].supersededReviewIds.push(reviews[1].id);

    return { logs: logs, reviews: reviews, archive: archive };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* 存档损坏则重建演示数据 */ }
    var data = seed();
    save(data);
    return data;
  }

  function save(data) {
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  }

  var db = load();

  function persist() { save(db); }

  function currentLogs() { return db.logs; }
  function allReviews() { return db.reviews.slice().sort(byTimeDesc); }
  function archiveEntries() { return db.archive.slice().sort(byArchivedDesc); }

  function byTimeDesc(a, b) { return Date.parse(b.decidedAt) - Date.parse(a.decidedAt); }
  function byArchivedDesc(a, b) { return Date.parse(b.correctedAt) - Date.parse(a.correctedAt); }

  function getLog(id) { return db.logs.find(function (l) { return l.id === id; }) || null; }

  function reviewsOf(logId) {
    return db.reviews.filter(function (r) { return r.logId === logId; })
      .sort(function (a, b) { return Date.parse(b.decidedAt) - Date.parse(a.decidedAt); });
  }

  // 因读数更正而随旧读数作废的复核意见
  function supersededIds() {
    var ids = {};
    db.archive.forEach(function (en) {
      en.supersededReviewIds.forEach(function (id) { ids[id] = true; });
    });
    return ids;
  }

  // 当前有效意见（旧读数作废的放行不再作为放行依据）
  function latestReview(logId) {
    var dead = supersededIds();
    return reviewsOf(logId).filter(function (r) { return !dead[r.id]; })[0] || null;
  }

  // 潜后登记
  function registerLog(input) {
    var log = {
      id: uid(),
      diver: String(input.diver).trim(),
      tankVolume: Number(input.tankVolume),
      pStart: Number(input.pStart),
      pEnd: Number(input.pEnd),
      maxDepth: Number(input.maxDepth),
      bottomTime: Number(input.bottomTime),
      exitAt: new Date(input.exitAt).toISOString()
    };
    db.logs.push(log);
    persist();
    return log;
  }

  // 安全员复核并补录余量；released=放行下一潜，held=维持待复核
  function addReview(input) {
    var review = {
      id: uid(),
      logId: input.logId,
      diver: input.diver,
      reviewer: String(input.reviewer).trim(),
      decision: input.decision === "released" ? "released" : "held",
      reserveBar: input.reserveBar === "" || input.reserveBar == null ? null : Number(input.reserveBar),
      note: String(input.note || "").trim(),
      decidedAt: new Date().toISOString()
    };
    db.reviews.push(review);
    persist();
    return review;
  }

  /*
   * 上一潜读数更正：
   * 1) 旧读数及此前的复核意见整份留档（复核意见标记作废旧）
   * 2) 用新读数覆盖当前潜次，回到待复核，下一潜计划重排
   */
  function correctLog(logId, patch, reason) {
    var log = getLog(logId);
    if (!log) return null;
    var dead = supersededIds();
    var liveReviews = reviewsOf(logId).filter(function (r) { return !dead[r.id]; });
    db.archive.push({
      archivedId: uid(),
      logId: logId,
      diver: log.diver,
      data: Object.assign({}, log),
      reason: String(reason || "").trim(),
      correctedAt: new Date().toISOString(),
      supersededReviewIds: liveReviews.map(function (r) { return r.id; })
    });
    Object.assign(log, {
      tankVolume: patch.tankVolume != null ? Number(patch.tankVolume) : log.tankVolume,
      pStart: patch.pStart != null ? Number(patch.pStart) : log.pStart,
      pEnd: patch.pEnd != null ? Number(patch.pEnd) : log.pEnd,
      maxDepth: patch.maxDepth != null ? Number(patch.maxDepth) : log.maxDepth,
      bottomTime: patch.bottomTime != null ? Number(patch.bottomTime) : log.bottomTime,
      exitAt: patch.exitAt ? new Date(patch.exitAt).toISOString() : log.exitAt
    });
    persist();
    return log;
  }

  // 每人最新一潜（决定下一潜计划；旧读数更正后自动随新记录重排）
  function latestPerDiver() {
    var map = {};
    db.logs.forEach(function (log) {
      if (!map[log.diver] || Date.parse(log.exitAt) > Date.parse(map[log.diver].exitAt)) {
        map[log.diver] = log;
      }
    });
    return Object.keys(map).map(function (d) { return map[d]; });
  }

  function diverSeries(diver) {
    return db.logs
      .filter(function (l) { return l.diver === diver; })
      .sort(function (a, b) { return Date.parse(a.exitAt) - Date.parse(b.exitAt); });
  }

  // 该潜次是否为本人最新一潜（仅最新一潜可更正；更早的读数更正应先联系安全员）
  function isLatest(logId) {
    var log = getLog(logId);
    if (!log) return false;
    return latestPerDiver().some(function (l) { return l.id === logId; });
  }

  window.ReviewLog = {
    currentLogs: currentLogs,
    allReviews: allReviews,
    archiveEntries: archiveEntries,
    getLog: getLog,
    reviewsOf: reviewsOf,
    latestReview: latestReview,
    registerLog: registerLog,
    addReview: addReview,
    correctLog: correctLog,
    latestPerDiver: latestPerDiver,
    diverSeries: diverSeries,
    isLatest: isLatest
  };
})();
