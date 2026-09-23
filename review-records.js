/*!
 * 复核记录层：数据存储、潜后登记、安全员复核放行、读数更正重排、旧记录留档
 *
 * 潜次状态：
 *   pending   待复核（耗气异常或休息不够，或已放行记录被更正后回退）
 *   open      待放行（判定无异常，等安全员按保留压放行）
 *   released  已放行下一潜
 */
(function (global) {
  "use strict";

  var LOGS_KEY = "zfl30GasLogs";
  var ARCHIVE_KEY = "zfl30GasArchives";
  var SEED_KEY = "zfl30GasSeedV1";
  var FLOOR = global.GasRules.RESERVE_FLOOR_BAR;

  // 队员花名册（人员固定，潜次记录入库）
  var ROSTER = [
    { id: "zw", code: "ZW", name: "张文" },
    { id: "lm", code: "LM", name: "李玫" },
    { id: "wy", code: "WY", name: "王屹" },
    { id: "cq", code: "CQ", name: "陈渠" }
  ];

  function uuid() {
    return global.crypto && global.crypto.randomUUID
      ? global.crypto.randomUUID()
      : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  function loadLogs() {
    ensureSeed();
    return JSON.parse(localStorage.getItem(LOGS_KEY) || "[]");
  }

  function saveLogs(logs) {
    localStorage.setItem(LOGS_KEY, JSON.stringify(logs));
  }

  function loadArchives() {
    ensureSeed();
    return JSON.parse(localStorage.getItem(ARCHIVE_KEY) || "[]");
  }

  function saveArchives(list) {
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(list));
  }

  function latestOf(logs, diverId) {
    return logs
      .filter(function (l) { return l.diverId === diverId; })
      .sort(function (a, b) { return Date.parse(b.exitAt) - Date.parse(a.exitAt); })[0] || null;
  }

  function diverSeq(logs, diverId) {
    return logs.filter(function (l) { return l.diverId === diverId; }).length + 1;
  }

  // 判定当前生效状态：已放行保持放行，其余按规则实时重算
  function effectiveStatus(log, logs, now) {
    if (log.status === "released") return "released";
    return global.GasRules.evaluate(log, logs, now).needsReview ? "pending" : "open";
  }

  function refreshStatuses(logs, now) {
    logs.forEach(function (log) {
      if (log.status !== "released") log.status = effectiveStatus(log, logs, now);
    });
    return logs;
  }

  /**
   * 潜后登记：队员提交瓶容、起止压力、最大深度、底部时间、出水时刻
   * 登记即按规则判定是否需要复核
   */
  function addLog(input) {
    validate(input);
    var now = Date.now();
    var logs = loadLogs();
    var diver = getDiver(input.diverId);
    var log = {
      id: uuid(),
      code: diver.code + "-" + String(diverSeq(logs, diver.id)).padStart(2, "0"),
      diverId: diver.id,
      volume: num(input.volume),
      startPressure: num(input.startPressure),
      endPressure: num(input.endPressure),
      maxDepth: num(input.maxDepth),
      bottomTime: num(input.bottomTime),
      exitAt: new Date(input.exitAt).toISOString(),
      status: "pending",
      review: null,
      replanNote: null,
      createdAt: new Date(now).toISOString()
    };
    logs.push(log);
    log.status = effectiveStatus(log, logs, now);
    saveLogs(logs);
    return log;
  }

  /**
   * 安全员复核：补录余量（复核时保留压）后放行下一潜
   * 余量低于安全底线不予放行
   */
  function release(id, review) {
    var now = Date.now();
    var logs = loadLogs();
    var log = logs.find(function (l) { return l.id === id; });
    if (!log) throw new Error("找不到该潜次记录");
    var reserve = num(review.reserveBar);
    if (!(reserve >= FLOOR)) {
      throw new Error("余量 " + reserve + "bar 低于放行底线 " + FLOOR + "bar，不予放行");
    }
    log.status = "released";
    log.review = {
      officer: String(review.officer || "").trim() || "安全员",
      reserveBar: reserve,
      remark: String(review.remark || "").trim(),
      reviewedAt: new Date(now).toISOString()
    };
    log.replanNote = null;
    saveLogs(logs);
    return log;
  }

  /**
   * 上一潜读数更正：
   *   1. 旧读数快照留档（含更正人、时间、原因）；
   *   2. 覆盖更正字段，原复核结论作废，状态按新读数重排；
   *   3. 该队员其后、未放行的潜次一并重排（休息与基线均可能变化）；
   *      已放行潜次不推翻，仅标记“基线已变，下一潜前复算”。
   */
  function correct(id, changes, actor, reason) {
    var now = Date.now();
    var logs = loadLogs();
    var log = logs.find(function (l) { return l.id === id; });
    if (!log) throw new Error("找不到该潜次记录");

    ["volume", "startPressure", "endPressure", "maxDepth", "bottomTime"].forEach(function (k) {
      if (changes[k] !== undefined && changes[k] !== null && String(changes[k]) !== "") {
        changes[k] = num(changes[k]);
      } else {
        delete changes[k];
      }
    });
    if (changes.exitAt) changes.exitAt = new Date(changes.exitAt).toISOString();

    var archives = loadArchives();
    archives.push({
      id: uuid(),
      logId: log.id,
      logCode: log.code,
      snapshot: JSON.parse(JSON.stringify(log)),
      changedBy: String(actor || "安全员"),
      reason: String(reason || "").trim(),
      correctedAt: new Date(now).toISOString()
    });
    saveArchives(archives);

    var wasReleased = log.status === "released";
    Object.assign(log, changes);
    if (wasReleased) {
      log.replanNote = "读数于 " + new Date(now).toLocaleString() +
        " 更正，原放行作废，需重新复核";
    }
    log.status = "pending";
    if (wasReleased) log.review = null;

    // 同队员其后潜次级联重排
    var at = Date.parse(log.exitAt);
    logs.forEach(function (other) {
      if (other.id === log.id || other.diverId !== log.diverId) return;
      if (Date.parse(other.exitAt) <= at) return;
      if (other.status === "released") {
        other.replanNote = "前潜 " + log.code + " 读数更正，基线已变，下一潜前复算";
      } else {
        other.status = effectiveStatus(other, logs, now);
        other.replanNote = "因前潜 " + log.code + " 读数更正重新排定";
      }
    });

    log.status = effectiveStatus(log, logs, now);
    saveLogs(logs);
    return log;
  }

  function validate(input) {
    function pos(name, value) {
      var n = num(value);
      if (!(n > 0)) throw new Error(name + "必须为正数");
      return n;
    }
    pos("瓶容", input.volume);
    pos("起始压力", input.startPressure);
    pos("结束压力", input.endPressure);
    pos("最大深度", input.maxDepth);
    pos("底部时间", input.bottomTime);
    if (num(input.startPressure) <= num(input.endPressure)) {
      throw new Error("结束压力应小于起始压力");
    }
    if (!input.exitAt || isNaN(Date.parse(input.exitAt))) {
      throw new Error("出水时刻格式不正确");
    }
    if (!getDiver(input.diverId)) throw new Error("请选择队员");
  }

  function num(v) {
    return typeof v === "number" ? v : Number(String(v).trim());
  }

  function getDiver(id) {
    return ROSTER.find(function (d) { return d.id === id; });
  }

  // ---------- 首次演示数据：四名队员覆盖 待复核/待放行/已放行 等场景 ----------
  function ensureSeed() {
    if (localStorage.getItem(SEED_KEY)) return;
    var now = Date.now();
    var min = 60000;
    var built = [];
    function mk(diverId, seq, agoMin, volume, startP, endP, depth, bottom) {
      var diver = getDiver(diverId);
      var exit = new Date(now - agoMin * min).toISOString();
      var l = {
        id: uuid(),
        code: diver.code + "-" + String(seq).padStart(2, "0"),
        diverId: diverId,
        volume: volume,
        startPressure: startP,
        endPressure: endP,
        maxDepth: depth,
        bottomTime: bottom,
        exitAt: exit,
        status: "pending",
        review: null,
        replanNote: null,
        createdAt: exit
      };
      built.push(l);
      return l;
    }
    // 张文：本次耗气率异常（基线13.3，本次约16.5，+24%）且出水残压35bar偏低 → 待复核
    mk("zw", 1, 60 * 24 + 30, 12, 200, 70, 16, 45);
    mk("zw", 2, 60 * 20 + 30, 12, 200, 60, 18, 45);
    mk("zw", 3, 60 * 16, 12, 200, 65, 17, 45);
    mk("zw", 4, 20, 12, 200, 35, 20, 40);
    // 李玫：耗气正常，刚出水40分，18–24m档需90分 → 待复核（休息不够）
    mk("lm", 1, 60 * 26, 11, 210, 50, 15, 40);
    mk("lm", 2, 60 * 19, 11, 200, 55, 17, 40);
    mk("lm", 3, 60 * 12, 11, 200, 45, 16, 40);
    mk("lm", 4, 40, 11, 200, 80, 20, 40);
    // 王屹：判定无异常、休息已够 → 待放行
    mk("wy", 1, 60 * 30, 12, 200, 70, 15, 40);
    mk("wy", 2, 60 * 22, 12, 200, 60, 16, 40);
    mk("wy", 3, 60 * 14, 12, 200, 65, 15, 40);
    mk("wy", 4, 100, 12, 200, 70, 16, 40);
    // 陈渠：已由安全员复核放行，可安排下一潜
    var c1 = mk("cq", 1, 60 * 28, 12, 200, 60, 15, 40);
    mk("cq", 2, 60 * 21, 12, 200, 70, 16, 40);
    mk("cq", 3, 60 * 15, 12, 200, 65, 15, 40);
    var c4 = mk("cq", 4, 150, 12, 200, 80, 16, 40);

    refreshStatuses(built, now);

    [c1, c4].forEach(function (l, i) {
      l.status = "released";
      l.review = {
        officer: "周安全",
        reserveBar: i === 0 ? 60 : 95,
        remark: "",
        reviewedAt: new Date(Date.parse(l.exitAt) + 20 * min).toISOString()
      };
    });

    localStorage.setItem(LOGS_KEY, JSON.stringify(built));
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify([]));
    localStorage.setItem(SEED_KEY, "1");
  }

  global.ReviewRecords = {
    ROSTER: ROSTER,
    FLOOR: FLOOR,
    loadLogs: loadLogs,
    loadArchives: loadArchives,
    saveLogs: saveLogs,
    getDiver: getDiver,
    latestOf: latestOf,
    effectiveStatus: effectiveStatus,
    refreshStatuses: refreshStatuses,
    addLog: addLog,
    release: release,
    correct: correct
  };
})(window);
