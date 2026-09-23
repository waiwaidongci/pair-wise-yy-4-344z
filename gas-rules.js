/*
 * 耗气规则（纯计算，不碰 DOM 与存档）
 * - 用气量 = (起始压力 - 出水压力) × 瓶容
 * - 耗气率 SAC = 用气量 / (底部时间 × (1 + 最大深度/10))，折算到水面升/分钟
 * - 本人最近三次（本潜之前）SAC 中位数为基准，高出两成转待复核
 * - 水面休息门槛按最大深度分段
 */
(function () {
  "use strict";

  // 深度门槛表：最大深度(m) → 出水后最少水面休息(分钟)
  var REST_TABLE = [
    { upTo: 12, minutes: 30 },
    { upTo: 18, minutes: 45 },
    { upTo: 24, minutes: 60 },
    { upTo: 30, minutes: 90 },
    { upTo: Infinity, minutes: 120 }
  ];
  var RATE_JUMP = 0.2;    // 较基准上浮两成
  var BASELINE_SIZE = 3;  // 本人最近三次
  var MIN_RESERVE_BAR = 50; // 安全员复核余量提醒线（仅提醒，不强制）

  function round1(n) { return Math.round(n * 10) / 10; }

  function gasUsedLiters(log) {
    return round1((Number(log.pStart) - Number(log.pEnd)) * Number(log.tankVolume));
  }

  // 深度处的压力倍数（常压=1，每 10m 增 1）
  function pressureFactor(maxDepth) { return 1 + Number(maxDepth) / 10; }

  function sacRate(log) {
    var minutes = Number(log.bottomTime) * pressureFactor(log.maxDepth);
    return minutes > 0 ? round1(gasUsedLiters(log) / minutes) : null;
  }

  // 入水时刻按 出水时刻 - 底部时间 估算
  function entryTime(log) {
    return new Date(Date.parse(log.exitAt) - Number(log.bottomTime) * 60000);
  }

  function restMinutes(maxDepth) {
    var d = Number(maxDepth);
    for (var i = 0; i < REST_TABLE.length; i++) {
      if (d <= REST_TABLE[i].upTo) return REST_TABLE[i].minutes;
    }
    return REST_TABLE[REST_TABLE.length - 1].minutes;
  }

  function median(values) {
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  // 该潜之前同队员的潜次，按出水时刻倒序
  function priorDives(allLogs, log) {
    var t = Date.parse(log.exitAt);
    return allLogs
      .filter(function (l) { return l.diver === log.diver && Date.parse(l.exitAt) < t; })
      .sort(function (a, b) { return Date.parse(b.exitAt) - Date.parse(a.exitAt); });
  }

  // 本潜放行判定：耗气异常 + 与上一潜的水面间隔是否够
  function evaluate(log, allLogs) {
    var sac = sacRate(log);
    var prior = priorDives(allLogs, log);
    var baseline = null;
    var rateLimit = null;
    var jumpPct = null;
    var highRate = false;

    if (prior.length >= BASELINE_SIZE) {
      baseline = round1(median(prior.slice(0, BASELINE_SIZE).map(sacRate)));
      rateLimit = round1(baseline * (1 + RATE_JUMP));
      jumpPct = baseline ? Math.round((sac / baseline - 1) * 100) : null;
      highRate = sac > rateLimit; // “高出”为严格大于
    }

    var prev = prior[0] || null;
    var surfaceIntervalMin = null;
    var requiredRestMin = null;
    var restShort = false;
    if (prev) {
      requiredRestMin = restMinutes(prev.maxDepth); // 门槛随上一潜深度
      surfaceIntervalMin = Math.round(
        (entryTime(log) - new Date(prev.exitAt)) / 60000
      );
      restShort = surfaceIntervalMin < requiredRestMin;
    }

    return {
      sac: sac,
      gasUsed: gasUsedLiters(log),
      priorCount: prior.length,
      baseline: baseline,
      rateLimit: rateLimit,
      jumpPct: jumpPct,
      highRate: highRate,
      prev: prev,
      surfaceIntervalMin: surfaceIntervalMin,
      requiredRestMin: requiredRestMin,
      restShort: restShort,
      needsReview: highRate || restShort
    };
  }

  // 出水后最早可再入水的时刻（用于下一潜计划排序）
  function nextEligible(log) {
    return new Date(Date.parse(log.exitAt) + restMinutes(log.maxDepth) * 60000);
  }

  // 截至某时刻（通常为现在）的休息状态
  function restState(log, now) {
    var exitMs = Date.parse(log.exitAt);
    var required = restMinutes(log.maxDepth);
    var waited = Math.max(0, Math.round((now - exitMs) / 60000));
    var remaining = Math.max(0, required - waited);
    return { required: required, waited: waited, remaining: remaining, rested: remaining === 0 };
  }

  window.GasRules = {
    REST_TABLE: REST_TABLE,
    RATE_JUMP: RATE_JUMP,
    BASELINE_SIZE: BASELINE_SIZE,
    MIN_RESERVE_BAR: MIN_RESERVE_BAR,
    gasUsedLiters: gasUsedLiters,
    sacRate: sacRate,
    entryTime: entryTime,
    restMinutes: restMinutes,
    median: median,
    priorDives: priorDives,
    evaluate: evaluate,
    nextEligible: nextEligible,
    restState: restState
  };
})();
