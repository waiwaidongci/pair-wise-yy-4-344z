/*!
 * 耗气规则（纯计算层，不操作 DOM、不读写存储）
 *
 * 用气量(升)   = 瓶容(L) × (起压 - 残压)(bar)
 * 深度耗气率    = 用气量 ÷ 底部时间(min)，单位 L/min（所处深度压力下）
 * 水面耗气率SAC = 深度耗气率 ÷ (1 + 最大深度/10)，单位 L/min
 *               海水每 10m 增加约 1 个大气压，SAC 折算到水面，跨深度可比
 *
 * 待复核触发（满足任一）：
 *   1. 本次 SAC 高出本人最近三次潜次 SAC 中位数两成（> 中位数 × 1.2）；不足三次不判；
 *   2. 出水后水面休息未达到按最大深度查得的休息门槛。
 */
(function (global) {
  "use strict";

  var SEAWATER_METERS_PER_BAR = 10; // 海水每 10m 增加 1ata
  var BASELINE_DIVES = 3;           // 本人最近三次
  var RATE_LIMIT_RATIO = 1.2;       // 高出中位数两成
  var RESERVE_FLOOR_BAR = 50;       // 放行下一潜的最低保留压

  // 最大深度 → 潜后最短水面休息（分钟）
  var REST_BANDS = [
    { max: 10, minutes: 30,  label: "≤10m · 30分" },
    { max: 18, minutes: 60,  label: "10–18m · 60分" },
    { max: 24, minutes: 90,  label: "18–24m · 90分" },
    { max: 30, minutes: 120, label: "24–30m · 120分" },
    { max: Infinity, minutes: 180, label: ">30m · 180分" }
  ];

  function ata(depth) {
    return 1 + depth / SEAWATER_METERS_PER_BAR;
  }

  function gasUsed(log) {
    return log.volume * (log.startPressure - log.endPressure);
  }

  function depthRate(log) {
    if (!(log.bottomTime > 0)) return null;
    return gasUsed(log) / log.bottomTime;
  }

  function sac(log) {
    var rate = depthRate(log);
    return rate === null ? null : rate / ata(log.maxDepth);
  }

  function median(values) {
    if (!values.length) return null;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  // 目标潜次之前、同队员最近三次潜次（按出水时刻倒序）
  function baselineSamples(logs, target) {
    var at = Date.parse(target.exitAt);
    return logs
      .filter(function (l) {
        return l.id !== target.id &&
          l.diverId === target.diverId &&
          Date.parse(l.exitAt) < at;
      })
      .sort(function (a, b) { return Date.parse(b.exitAt) - Date.parse(a.exitAt); })
      .slice(0, BASELINE_DIVES);
  }

  function restBand(depth) {
    for (var i = 0; i < REST_BANDS.length; i++) {
      if (depth <= REST_BANDS[i].max) return REST_BANDS[i];
    }
    return REST_BANDS[REST_BANDS.length - 1];
  }

  // 单次潜次的完整判定；now 传入当前时刻（休息计时随时间变化）
  function evaluate(target, logs, now) {
    var used = gasUsed(target);
    var rate = depthRate(target);
    var sacNow = sac(target);

    var samples = baselineSamples(logs, target);
    var base = median(samples.map(sac));
    var hasBaseline = samples.length === BASELINE_DIVES;
    var gasAnomaly = hasBaseline && sacNow > base * RATE_LIMIT_RATIO;
    var ratioPct = base === null ? null : Math.round((sacNow / base - 1) * 100);

    var band = restBand(target.maxDepth);
    var restedMin = Math.max(0, (now - Date.parse(target.exitAt)) / 60000);
    var restRemainingMin = Math.max(0, band.minutes - restedMin);
    var restEnough = restedMin >= band.minutes;

    var reasons = [];
    if (gasAnomaly) {
      reasons.push({
        code: "GAS",
        label: "耗气率高出本人最近三次中位数两成：SAC " + sacNow.toFixed(1) +
          "，基线 " + base.toFixed(1) + "（+" + ratioPct + "%）"
      });
    }
    if (!restEnough) {
      reasons.push({
        code: "REST",
        label: "水面休息不足：已休息 " + fmtMin(restedMin) +
          "，需 " + fmtMin(band.minutes) + "，还差 " + fmtMin(restRemainingMin)
      });
    }

    return {
      used: used,
      ata: ata(target.maxDepth),
      rate: rate,
      sac: sacNow,
      baseline: base,
      sampleCount: samples.length,
      hasBaseline: hasBaseline,
      gasAnomaly: gasAnomaly,
      ratioPct: ratioPct,
      band: band,
      restedMin: restedMin,
      restRemainingMin: restRemainingMin,
      restEnough: restEnough,
      reasons: reasons,
      needsReview: gasAnomaly || !restEnough
    };
  }

  function fmtMin(min) {
    var m = Math.max(0, Math.ceil(min));
    if (m < 60) return m + "分";
    var h = Math.floor(m / 60), r = m % 60;
    return r ? h + "小时" + r + "分" : h + "小时";
  }

  global.GasRules = {
    RESERVE_FLOOR_BAR: RESERVE_FLOOR_BAR,
    RATE_LIMIT_RATIO: RATE_LIMIT_RATIO,
    BASELINE_DIVES: BASELINE_DIVES,
    REST_BANDS: REST_BANDS,
    ata: ata,
    gasUsed: gasUsed,
    depthRate: depthRate,
    sac: sac,
    median: median,
    baselineSamples: baselineSamples,
    restBand: restBand,
    evaluate: evaluate,
    fmtMin: fmtMin
  };
})(window);
