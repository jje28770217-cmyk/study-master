/* 사회조사분석사 2급 Study Master — 정적 웹사이트 (서버·로그인·외부 API 없음)
 * 학습 기록은 LocalStorage, 업로드한 문제(기출·교재 등)는 IndexedDB에 이 브라우저에만 저장됩니다.
 * 문제 데이터는 어디로도 전송되지 않습니다(index.html의 CSP가 외부 통신을 막습니다). */
(function () {
  'use strict';

  /* ───────── 상수 ───────── */
  var KEY = 'ssm-v1', CKEY = 'ssm-custom-q', SKEY = 'ssm-session';
  var SUBJ = {
    1: { name: '조사방법과 설계', cls: 's1', color: 'var(--s1)', hex: '#2563eb' },
    2: { name: '조사관리와 자료처리', cls: 's2', color: 'var(--s2)', hex: '#0891b2' },
    3: { name: '통계분석과 활용', cls: 's3', color: 'var(--s3)', hex: '#7c3aed' }
  };
  var UL = ['아예 모름', '찍음', '적당히 앎', '확실히 앎'];
  var UD = ['개념을 모르거나 풀이 방법을 모름', '정확한 근거 없이 답을 선택함', '개념은 알지만 정답에 확신이 부족함', '개념과 정답의 근거를 정확히 알고 있음'];
  var UHEX = ['#dc2626', '#f97316', '#eab308', '#16a34a'];
  var MK = ['①', '②', '③', '④'];
  var DOW = '일월화수목금토';
  var $ = function (s, r) { return (r || document).querySelector(s); };

  /* ───────── 저장소 ───────── */
  var mem = {}, storageOk = true;
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { storageOk = false; return mem[k] || null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { storageOk = false; mem[k] = v; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { storageOk = false; delete mem[k]; } }

  function defaults() {
    return {
      v: 1,
      settings: { examDate: '', startDate: '', dailyMinutes: 120, minPerQ: 1.5, subjects: [1, 2, 3], total: null },
      att: [],            // 풀이 기록(계속 추가만 함): {q,t,d,c,ok,u,m}
      mocks: []
    };
  }
  function merge(p) {
    var d = defaults();
    if (p && typeof p === 'object') {
      if (p.settings && typeof p.settings === 'object') d.settings = Object.assign(d.settings, p.settings);
      if (Array.isArray(p.att)) d.att = p.att.filter(function (a) { return a && typeof a.q === 'string' && typeof a.d === 'string'; });
      if (Array.isArray(p.mocks)) d.mocks = p.mocks.filter(function (m) { return m && m.totalOk !== undefined; });
    }
    if (!Array.isArray(d.settings.subjects) || !d.settings.subjects.length) d.settings.subjects = [1, 2, 3];
    return d;
  }
  var S = (function () { try { return merge(JSON.parse(lsGet(KEY))); } catch (e) { return defaults(); } })();
  var cache = null;
  function save() { lsSet(KEY, JSON.stringify(S)); cache = null; }

  /* ───────── 문제은행 ───────── */
  var KINDS = ['기출', '기출복원', '자체 제작 예상문제', '자체 제작 연습문제'];   // 실제 기출 / 수험생 복원 / 자체 제작 (연습문제는 옛 이름, 호환용)
  var REAL = ['기출', '기출복원'];
  function isReal(q) { return REAL.indexOf(q.kind) !== -1; }
  function originText(q, custom) {
    var k = q.kind || (q.origin ? '' : (custom ? '' : '자체 제작 예상문제'));
    if (!k) return q.origin || '사용자 추가 문제 (출처 미확인)';
    var t = k;
    if (q.year) t += ' · ' + q.year + '년' + (q.round ? ' ' + q.round + '회' : '');
    if (q.source) t += ' · 출처: ' + q.source;
    if (isReal(q) && q.year <= 2022) t += ' · 2027 출제기준 해당';
    return t;
  }
  // 2022년 이전 기출은 2027 출제기준에 해당한다고 확인(scope2027:true)된 것만 문제은행에 등록한다
  function needsScope(q) { return isReal(q) && q.year <= 2022 && q.scope2027 !== true; }
  function validate(q) {
    if (!q || typeof q !== 'object') return '문제 형식이 아닙니다';
    if (![1, 2, 3].includes(q.subject)) return 'subject는 1, 2, 3 중 하나여야 합니다';
    if (!Number.isInteger(q.num) || q.num < 1) return 'num은 1 이상의 정수여야 합니다';
    if (typeof q.question !== 'string' || !q.question.trim()) return 'question이 비어 있습니다';
    if (!Array.isArray(q.options) || q.options.length !== 4 || q.options.some(function (o) { return typeof o !== 'string' || !o.trim(); })) return 'options는 비어 있지 않은 문자열 4개여야 합니다';
    if (![1, 2, 3, 4].includes(q.answer)) return 'answer는 1~4여야 합니다';
    if (typeof q.explanation !== 'string' || !q.explanation.trim()) return 'explanation이 비어 있습니다';
    if (typeof q.concept !== 'string') return 'concept는 문자열이어야 합니다';
    if (q.kind !== undefined && KINDS.indexOf(q.kind) === -1) return 'kind는 ' + KINDS.slice(0, 3).join(' / ') + ' 중 하나여야 합니다';
    if (q.id !== undefined && (typeof q.id !== 'string' || !q.id)) return 'id는 문자열이어야 합니다';
    if (q.scope2027 !== undefined && typeof q.scope2027 !== 'boolean') return 'scope2027은 true/false여야 합니다';
    if (q.kind === '기출' || q.kind === '기출복원') {
      if (!Number.isInteger(q.year) || q.year < 2000 || q.year > 2100) return '기출·기출복원 문제는 year(연도)가 필요합니다';
      if (typeof q.source !== 'string' || !q.source.trim()) return '기출·기출복원 문제는 source(출처)가 필요합니다';
    }
    return null;
  }
  // 번호 규칙: 내장 문제 "과목-번호"(1-11), 업로드 문제 "u-과목-번호", 연도가 있는 문제 "y연도r회차-과목-번호"
  function makeId(q, custom) {
    if (typeof q.id === 'string' && q.id) return q.id;
    if (q.year) return 'y' + q.year + (q.round ? 'r' + q.round : '') + '-' + q.subject + '-' + q.num;
    return (custom ? 'u-' : '') + q.subject + '-' + q.num;
  }
  function norm(q, custom) {
    return {
      id: makeId(q, custom), subject: q.subject, num: q.num, question: q.question, options: q.options,
      answer: q.answer, explanation: q.explanation, concept: q.concept || '',
      kind: q.kind || '', year: q.year || null, round: q.round || null, source: q.source || '',
      origin: originText(q, custom), custom: !!custom
    };
  }
  var BUILTIN = (window.SSM_QUESTIONS || []).filter(function (q) { return !validate(q); }).map(function (q) { return norm(q, false); });
  var CUSTOM_RAW = [];   // 업로드한 문제(IndexedDB "questions"와 같은 내용)
  var STAGE = [];        // 2022년 이전 기출 중 출제기준 해당 여부를 아직 고르지 않은 문제(IndexedDB "staging")
  var BANK = [], BYID = {};
  function rebuild() {
    BANK = []; BYID = {};
    BUILTIN.concat(CUSTOM_RAW.map(function (q) { return norm(q, true); })).forEach(function (q) {
      if (BYID[q.id]) return; BYID[q.id] = q; BANK.push(q);
    });
  }
  rebuild();
  /* IndexedDB — 업로드한 문제는 이 브라우저에만 저장된다 */
  var DB = null;
  function idbOpen() {
    return new Promise(function (res) {
      try {
        var r = indexedDB.open('ssm-db', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('questions', { keyPath: 'id' }); r.result.createObjectStore('staging', { keyPath: 'id' }); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = r.onblocked = function () { res(null); };
      } catch (e) { res(null); }
    });
  }
  function idbAll(store) {
    return new Promise(function (res) {
      if (!DB) return res([]);
      try { var g = DB.transaction(store, 'readonly').objectStore(store).getAll(); g.onsuccess = function () { res(g.result || []); }; g.onerror = function () { res([]); }; } catch (e) { res([]); }
    });
  }
  // 한 트랜잭션으로 처리: clear → delIds 삭제 → put. 성공하면 true
  function idbWrite(store, put, delIds, clear) {
    return new Promise(function (res) {
      if (!DB) return res(false);
      try {
        var tx = DB.transaction(store, 'readwrite'), st = tx.objectStore(store);
        if (clear) st.clear();
        (delIds || []).forEach(function (id) { st.delete(id); });
        (put || []).forEach(function (q) { st.put(q); });
        tx.oncomplete = function () { res(true); }; tx.onerror = tx.onabort = function () { res(false); };
      } catch (e) { res(false); }
    });
  }
  function saveCustom() { rebuild(); cache = null; }
  function persistFail() { toast('이 브라우저에서는 IndexedDB를 쓸 수 없어 문제가 이번 접속 동안만 유지됩니다. (사생활 보호 모드 등)'); }
  function stripQ(q) {
    var o = { id: q.id, subject: q.subject, num: q.num, question: q.question, options: q.options, answer: q.answer, explanation: q.explanation, concept: q.concept || '', kind: q.kind };
    ['year', 'round', 'source', 'criteria', 'origin'].forEach(function (k) { if (q[k] !== undefined && q[k] !== null && q[k] !== '') o[k] = q[k]; });
    if (q.scope2027 !== undefined) o.scope2027 = q.scope2027;
    if (o.kind === undefined) delete o.kind;
    return o;
  }
  function activeBank() { return BANK.filter(function (q) { return S.settings.subjects.indexOf(q.subject) !== -1; }); }

  /* ───────── 날짜 ───────── */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function dayNum(s) { var p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000; }
  function daysBetween(a, b) { return Math.round(dayNum(b) - dayNum(a)); }
  function addDays(s, n) { var d = new Date(dayNum(s) * 86400000 + n * 86400000); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function dateLabel(s) { var p = s.split('-'); return +p[1] + '월 ' + +p[2] + '일 (' + DOW[new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay()] + ')'; }

  /* ───────── 통계 계산 ───────── */
  function qs() {
    if (cache) return cache;
    var m = {};
    S.att.forEach(function (a) {
      var r = m[a.q] || (m[a.q] = { n: 0, w: 0, last: null, first: a, lastWrong: null });
      r.n++; if (!a.ok) { r.w++; r.lastWrong = a; } r.last = a;
    });
    cache = m; return m;
  }
  function isWeak(id) { var r = qs()[id]; return !!(r && (!r.last.ok || r.last.u === 0 || r.last.u === 1)); }
  function isRecovered(id) { var r = qs()[id]; return !!(r && r.w > 0 && r.last.ok && r.last.u !== 0 && r.last.u !== 1); }
  function todayAtt() { var t = today(); return S.att.filter(function (a) { return a.d === t; }); }
  function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }

  function plan() {
    var st = S.settings, t = today(), act = activeBank();
    var total = (st.total && st.total > 0) ? st.total : act.length;
    var m = qs();
    var solved = act.filter(function (q) { return m[q.id]; }).length;
    var firstToday = act.filter(function (q) { return m[q.id] && m[q.id].first.d === t; }).length;
    var remaining = Math.max(0, total - solved);
    var remainingStart = Math.max(0, total - (solved - firstToday));  // 오늘 시작 시점의 남은 문제 수
    var p = { total: total, solved: Math.min(solved, total), remaining: remaining, status: 'noexam', days: null, dday: null, target: 0, done: todayAtt().length };
    if (st.examDate) {
      p.dday = daysBetween(t, st.examDate);
      var from = (st.startDate && st.startDate > t) ? st.startDate : t;
      p.days = daysBetween(from, st.examDate);   // 시험 전날까지의 학습 가능 일수(오늘 포함)
      if (p.dday < 0) p.status = 'over';
      else if (p.dday === 0) p.status = 'dday';
      else if (st.startDate && st.startDate > t) p.status = 'before';
      else { p.status = 'ok'; p.target = Math.ceil(remainingStart / Math.max(1, p.days)); }
    }
    p.rate = p.target ? Math.min(100, Math.round(p.done / p.target * 100)) : (p.status === 'ok' ? 100 : 0);
    p.needMin = Math.round(p.target * (+st.minPerQ || 0));
    return p;
  }
  function subjStat(s) {
    var m = qs(), ids = BANK.filter(function (q) { return q.subject === s; }).map(function (q) { return q.id; });
    var r = { total: ids.length, solved: 0, att: 0, ok: 0, wrongQ: 0, weak: 0, u: [0, 0, 0, 0] };
    ids.forEach(function (id) {
      var x = m[id]; if (!x) return;
      r.solved++; r.att += x.n; r.ok += x.n - x.w;
      if (x.w > 0) r.wrongQ++;
      if (isWeak(id)) r.weak++;
      if (x.last.u !== null && x.last.u !== undefined) r.u[x.last.u]++;
    });
    return r;
  }
  function overall() {
    var ok = S.att.filter(function (a) { return a.ok; }).length;
    return { att: S.att.length, ok: ok, acc: pct(ok, S.att.length) };
  }
  function weakIds() { return BANK.filter(function (q) { return isWeak(q.id); }).map(function (q) { return q.id; }); }
  function wrongIds() { return BANK.filter(function (q) { var r = qs()[q.id]; return r && r.w > 0; }).map(function (q) { return q.id; }); }

  /* ───────── 유틸 ───────── */
  function esc(t) { return String(t === null || t === undefined ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function chip(s) { return '<span class="chip ' + SUBJ[s].cls + '">' + s + '과목</span>'; }
  function utag(u) { return u === null || u === undefined ? '<span class="utag none">이해도 없음</span>' : '<span class="utag u' + u + '">' + UL[u] + '</span>'; }
  function bar(p, color) { return '<div class="bar"><i style="width:' + Math.max(0, Math.min(100, p)) + '%' + (color ? ';background:' + color : '') + '"></i></div>'; }
  function toast(msg) {
    var old = $('.toast'); if (old) old.remove();
    var t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2600);
  }
  function confirmBox(msg, yes, fn) {
    var bg = document.createElement('div'); bg.className = 'modal-bg'; bg.id = 'modal';
    bg.innerHTML = '<div class="modal" role="dialog" aria-modal="true"><p>' + esc(msg) + '</p><div class="grid2"><button class="btn line" type="button" data-a="modalNo">취소</button><button class="btn" type="button" data-a="modalYes">' + esc(yes) + '</button></div></div>';
    document.body.appendChild(bg);
    bg._fn = fn;
  }
  function donut(p, color) {
    var r = 36, c = 2 * Math.PI * r, d = c * Math.max(0, Math.min(100, p)) / 100;
    return '<svg viewBox="0 0 90 90" width="92" height="92" role="img" aria-label="진행률 ' + p + '%"><circle cx="45" cy="45" r="' + r + '" fill="none" stroke="#e7ecf6" stroke-width="10"/>' +
      '<circle cx="45" cy="45" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="10" stroke-linecap="round" stroke-dasharray="' + d.toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 45 45)"/>' +
      '<text x="45" y="50" text-anchor="middle" font-size="16" font-weight="800" fill="#16213a">' + p + '%</text></svg>';
  }
  function weekChart() {
    var t = today(), days = [], max = 1;
    for (var i = 6; i >= 0; i--) {
      var d = addDays(t, -i), a = S.att.filter(function (x) { return x.d === d; });
      var ok = a.filter(function (x) { return x.ok; }).length;
      days.push({ d: d, ok: ok, bad: a.length - ok }); max = Math.max(max, a.length);
    }
    var W = 320, H = 130, bw = 28, gap = (W - bw * 7) / 8, h = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="최근 7일 학습량">';
    days.forEach(function (x, i) {
      var X = gap + i * (bw + gap), base = 100, hb = x.bad / max * 80, ho = x.ok / max * 80;
      if (x.bad) h += '<rect x="' + X + '" y="' + (base - hb - ho) + '" width="' + bw + '" height="' + hb + '" rx="3" fill="#dc2626"/>';
      if (x.ok) h += '<rect x="' + X + '" y="' + (base - ho) + '" width="' + bw + '" height="' + ho + '" rx="3" fill="#16a34a"/>';
      if (!x.ok && !x.bad) h += '<rect x="' + X + '" y="' + (base - 2) + '" width="' + bw + '" height="2" fill="#dde4f0"/>';
      if (x.ok + x.bad) h += '<text x="' + (X + bw / 2) + '" y="' + (base - hb - ho - 4) + '" text-anchor="middle" font-size="10" fill="#5c6b85">' + (x.ok + x.bad) + '</text>';
      var md = x.d.split('-'); h += '<text x="' + (X + bw / 2) + '" y="118" text-anchor="middle" font-size="10" fill="#5c6b85">' + (+md[1]) + '/' + (+md[2]) + '</text>';
    });
    return h + '</svg><div class="legend"><span><i style="background:#16a34a"></i>정답</span><span><i style="background:#dc2626"></i>오답</span></div>';
  }

  /* ───────── 풀이 세션 ───────── */
  var Q = null;      // {ids,i,label,res:[],sel,u,sub}
  var M = null;      // 모의고사 진행 상태
  var timerId = null;
  var UI = { n: 10, wrongS: 0, rv: { s: 0, u: 'any', w: 0, mode: 'weak' }, statsS: 0, src: 'all', report: null, stSel: {}, stS: 0 };
  // 문제 출처 필터(문제 풀기·모의고사): all 전체 / real 기출·기출복원 / own 자체 제작
  function srcOk(q) { return UI.src === 'all' || (UI.src === 'real' ? isReal(q) : !isReal(q)); }
  function srcBank() { return BANK.filter(srcOk); }
  function srcSeg() {
    var n = { all: BANK.length, real: BANK.filter(isReal).length };
    n.own = n.all - n.real;
    return '<div class="seg">' + [['all', '전체'], ['real', '기출·기출복원'], ['own', '자체 제작']].map(function (x) { return '<button type="button" data-a="setSrc" data-v="' + x[0] + '" class="' + (UI.src === x[0] ? 'on' : '') + '">' + x[1] + ' ' + n[x[0]] + '</button>'; }).join('') + '</div>';
  }

  function saveSession() {
    if (!Q) { lsDel(SKEY); return; }
    // 이미 제출한 문제는 다시 풀지 않도록, 제출했다면 다음 문제 번호를 저장한다
    var next = Q.sub ? Q.i + 1 : Q.i;
    if (next >= Q.ids.length) { lsDel(SKEY); return; }
    lsSet(SKEY, JSON.stringify({ ids: Q.ids, i: next, label: Q.label, res: Q.res }));
  }
  function restoreSession() {
    try {
      var s = JSON.parse(lsGet(SKEY));
      if (s && Array.isArray(s.ids) && s.ids.length && s.i < s.ids.length && s.ids.every(function (id) { return BYID[id]; })) {
        Q = { ids: s.ids, i: s.i, label: s.label || '이어 풀기', res: Array.isArray(s.res) ? s.res : [], sel: null, u: null, sub: false };
        return true;
      }
    } catch (e) {}
    return false;
  }
  function startQuiz(ids, label) {
    if (!ids.length) { toast('풀 수 있는 문제가 없습니다.'); return; }
    Q = { ids: ids, i: 0, label: label, res: [], sel: null, u: null, sub: false };
    saveSession(); go('quiz');
  }
  function lastTime(id) { var r = qs()[id]; return r ? r.last.t : ''; }
  function poolSubject(s) {
    var ids = srcBank().filter(function (q) { return q.subject === s; }).map(function (q) { return q.id; });
    var un = shuffle(ids.filter(function (id) { return !qs()[id]; }));
    var done = ids.filter(function (id) { return qs()[id]; }).sort(function (a, b) { return lastTime(a) < lastTime(b) ? -1 : 1; });
    return un.concat(done);
  }
  function poolRandom() { return shuffle(activeBank().filter(srcOk).map(function (q) { return q.id; })); }
  function sortWeak(ids) {
    return ids.slice().sort(function (a, b) {
      var wa = isWeak(a) ? 1 : 0, wb = isWeak(b) ? 1 : 0;
      if (wa !== wb) return wb - wa;
      return (qs()[b] ? qs()[b].w : 0) - (qs()[a] ? qs()[a].w : 0) || (lastTime(a) < lastTime(b) ? -1 : 1);
    });
  }
  function poolWrong() { return sortWeak(wrongIds()); }
  function poolToday(n) {
    var act = activeBank().map(function (q) { return q.id; });
    var weak = sortWeak(act.filter(isWeak));
    var un = shuffle(act.filter(function (id) { return !qs()[id]; }));
    return weak.concat(un).slice(0, n);
  }
  function submitAnswer() {
    var q = BYID[Q.ids[Q.i]];
    if (Q.sub || Q.sel === null || Q.u === null) return;
    var a = { q: q.id, t: new Date().toISOString(), d: today(), c: Q.sel, ok: Q.sel === q.answer, u: Q.u, m: false };
    S.att.push(a); save();
    Q.res.push({ id: q.id, ok: a.ok, u: Q.u, c: Q.sel });
    Q.sub = true; saveSession();
  }
  function nextQuestion() {
    if (Q.i + 1 >= Q.ids.length) { Q.done = true; lsDel(SKEY); go('result'); return; }
    Q.i++; Q.sel = null; Q.u = null; Q.sub = false; saveSession();
  }

  /* ───────── 라우터 ───────── */
  var VIEW = 'home';
  var TABS = [
    ['home', '홈', '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'],
    ['practice', '문제', '<path d="M5 4h14v16H5z"/><path d="M8 9h8M8 13h8M8 17h5"/>'],
    ['wrong', '오답노트', '<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17v.5"/>'],
    ['review', '복습', '<path d="M4 12a8 8 0 1 0 3-6.2"/><path d="M4 4v4h4"/>'],
    ['stats', '통계', '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'],
    ['mock', '모의고사', '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>']
  ];
  var ROOT = { quiz: 'practice', result: 'practice', settings: 'home', mockrun: 'mock', mockresult: 'mock' };
  function go(v) { if (location.hash === '#/' + v) render(); else location.hash = '#/' + v; }
  function curView() { var h = location.hash.replace(/^#\/?/, ''); return h || 'home'; }

  function render() {
    var v = curView();
    if (timerId && v !== 'mockrun') { clearInterval(timerId); timerId = null; }
    var views = { home: home, practice: practice, quiz: quiz, result: result, wrong: wrong, review: review, stats: stats, mock: mock, mockrun: mockrun, mockresult: mockresult, settings: settings };
    if (!views[v]) v = 'home';
    if (v === 'quiz' && !Q && !restoreSession()) v = 'practice';
    if (v === 'result' && !(Q && Q.done)) v = 'home';
    if (v === 'mockrun' && !M) v = 'mock';
    if (v === 'mockresult' && !S.mocks.length) v = 'mock';
    VIEW = v;
    var y = window.scrollY;
    $('#app').innerHTML = views[v]();
    var hide = v === 'quiz' || v === 'mockrun';
    var root = ROOT[v] || v;
    var tb = $('#tabbar'); tb.className = 'tabbar' + (hide ? ' hide' : '');
    tb.innerHTML = TABS.map(function (t) {
      return '<button type="button" data-a="go" data-v="' + t[0] + '" class="' + (root === t[0] ? 'on' : '') + '"' + (root === t[0] ? ' aria-current="page"' : '') + '><svg viewBox="0 0 24 24" aria-hidden="true">' + t[2] + '</svg>' + t[1] + '</button>';
    }).join('');
    if (v === 'mockrun') startTimer();
    window.scrollTo(0, (v === 'quiz' || v === 'mockrun') ? y : 0);
  }

  /* ───────── 홈 ───────── */
  function home() {
    var p = plan(), o = overall(), wk = weakIds().length, h = '';
    if (!storageOk) h += '<div class="warn">이 브라우저에서는 저장소를 사용할 수 없어 학습 기록이 유지되지 않을 수 있습니다. (사생활 보호 모드 등)</div>';
    // D-day
    h += '<div class="card"><div class="dday">';
    if (!S.settings.examDate) h += '<b>D-?</b><span class="sub">시험 예정일을 설정하면 D-day와 하루 권장 문제 수가 계산됩니다.</span></div><button class="btn ghost" style="margin-top:10px" type="button" data-a="go" data-v="settings">시험일 설정하기</button>';
    else {
      var dd = p.dday;
      h += '<b>' + (dd > 0 ? 'D-' + dd : dd === 0 ? 'D-DAY' : '시험 종료') + '</b><span class="sub">' + dateLabel(S.settings.examDate) + ' 시험' + (dd > 0 ? ' · 학습 가능 ' + p.days + '일' : '') + '</span></div>';
    }
    h += '</div>';
    // 오늘 목표
    h += '<h2>오늘의 학습</h2><div class="card">';
    if (p.status === 'ok') {
      h += '<div class="row"><div><div class="sub">하루 권장 문제 수</div><div class="pct">' + p.target + '<small>문제</small></div></div>' +
        '<div style="text-align:right"><div class="sub">달성률</div><div class="pct" id="rate">' + p.rate + '<small>%</small></div></div></div>' +
        '<div class="bar big" style="margin:10px 0 6px">' + '<i style="width:' + p.rate + '%"></i></div>' +
        '<div class="sub" id="todayline">오늘 ' + p.done + '문제 푼 상태 · 목표 ' + p.target + '문제</div>';
      var cap = +S.settings.dailyMinutes;
      if (cap && p.needMin > cap) h += '<div class="warn">권장 문제 수를 풀려면 약 ' + p.needMin + '분이 필요한데, 하루 공부 가능 시간(' + cap + '분)보다 깁니다. 시험일, 시간, 문제 수를 조정해 보세요.</div>';
      else if (cap) h += '<div class="sub" style="margin-top:6px">예상 소요 시간 약 ' + p.needMin + '분 / 하루 공부 가능 ' + cap + '분</div>';
      h += '<button class="btn" style="margin-top:12px" type="button" data-a="startToday">오늘 학습 시작</button>';
    } else if (p.status === 'dday') h += '<p class="sub">오늘은 시험일입니다. 오늘 푼 문제: ' + p.done + '개</p><button class="btn ghost" type="button" data-a="startToday">취약 문제 훑어보기</button>';
    else if (p.status === 'over') h += '<p class="sub">시험일이 지났습니다. 설정에서 새 시험일을 입력해 주세요.</p>';
    else if (p.status === 'before') h += '<p class="sub">학습 시작일(' + dateLabel(S.settings.startDate) + ') 전입니다. 시작일부터 하루 권장 문제 수가 계산됩니다.</p><button class="btn ghost" type="button" data-a="startToday">미리 풀어 보기</button>';
    else h += '<p class="sub">시험 예정일을 설정하면 오늘 목표가 계산됩니다. 오늘 푼 문제: ' + p.done + '개</p><button class="btn ghost" type="button" data-a="startToday">오늘 학습 시작</button>';
    h += '</div>';
    // 전체 요약
    var prog = pct(p.solved, p.total);
    h += '<h2>전체 현황</h2><div class="card"><div class="row" style="flex-wrap:nowrap"><div>' + donut(prog, '#1d5fd1') + '</div>' +
      '<div style="flex:1;min-width:0"><div class="sub">전체 학습 진행률</div><div style="font-weight:700">' + p.solved + ' / ' + p.total + '문제</div>' + bar(prog) +
      '<div class="stats2" style="margin-top:10px"><div class="stat"><b>' + (o.att ? o.acc + '%' : '-') + '</b><span>누적 정답률 (' + o.ok + '/' + o.att + ')</span></div>' +
      '<div class="stat"><b>' + wk + '</b><span>취약 문제</span></div></div></div></div>' +
      (wk ? '<button class="btn line" style="margin-top:12px" type="button" data-a="go" data-v="review">취약 문제 복습하러 가기</button>' : '') + '</div>';
    // 과목별
    h += '<h2>과목별 진행</h2>';
    [1, 2, 3].forEach(function (s) {
      var r = subjStat(s), on = S.settings.subjects.indexOf(s) !== -1;
      h += '<div class="card subj ' + SUBJ[s].cls + '"><h3>' + chip(s) + ' ' + SUBJ[s].name + (on ? '' : ' <span class="badge">학습 제외</span>') + '</h3>' +
        bar(pct(r.solved, r.total)) + '<div class="row sub" style="margin-top:6px"><span>진행 ' + r.solved + '/' + r.total + ' (' + pct(r.solved, r.total) + '%)</span><span>정답률 ' + (r.att ? pct(r.ok, r.att) + '%' : '-') + '</span></div></div>';
    });
    h += '<h2>최근 7일 학습량</h2><div class="card">' + weekChart() + '</div>';
    return h;
  }

  /* ───────── 문제 선택 ───────── */
  function practice() {
    var h = '<h2>문제 풀기</h2><div class="card"><div class="sub">한 번에 풀 문제 수</div><div class="seg">' +
      [5, 10, 20, 0].map(function (n) { return '<button type="button" data-a="setN" data-v="' + n + '" class="' + (UI.n === n ? 'on' : '') + '">' + (n || '전체') + '</button>'; }).join('') + '</div></div>';
    h += '<h2>문제 출처</h2><div class="card">' + srcSeg() + '<div class="hint">과목별 풀이·전체 랜덤에 적용됩니다. 기출·기출복원은 설정에서 파일로 업로드한 문제입니다.</div></div>';
    h += '<h2>과목별 문제 풀이</h2>';
    [1, 2, 3].forEach(function (s) {
      var r = subjStat(s), tot = srcBank().filter(function (q) { return q.subject === s; }).length;
      h += '<div class="card subj ' + SUBJ[s].cls + '"><div class="row"><div><h3>' + chip(s) + ' ' + SUBJ[s].name + '</h3><div class="sub">전체 ' + tot + '문제 · 안 푼 문제 ' + (r.total - r.solved) + '개</div></div>' +
        '<button class="btn sm" style="background:' + SUBJ[s].color + '" type="button" data-a="startSubject" data-v="' + s + '">풀기</button></div></div>';
    });
    h += '<h2>전체 랜덤 · 오답</h2><div class="stack">' +
      '<button class="btn" type="button" data-a="startRandom">전체 랜덤 문제 풀이 <span style="opacity:.85;font-weight:500">(' + activeBank().filter(srcOk).length + '문제 중)</span></button>' +
      '<button class="btn line" type="button" data-a="startWrong">오답 문제 풀이 <span style="font-weight:500">(' + wrongIds().length + '문제)</span></button></div>';
    var sess = null; try { sess = JSON.parse(lsGet(SKEY)); } catch (e) {}
    if (sess && sess.ids && sess.i < sess.ids.length) h += '<div class="card" style="margin-top:14px"><div class="row"><span>풀던 문제가 있습니다 <span class="sub">(' + esc(sess.label) + ' · ' + (sess.ids.length - sess.i) + '문제 남음)</span></span><button class="btn sm ghost" type="button" data-a="resume">이어 풀기</button></div></div>';
    return h;
  }
  function cut(ids) { return UI.n ? ids.slice(0, UI.n) : ids; }

  /* ───────── 문제 풀이 화면 ───────── */
  function quiz() {
    var q = BYID[Q.ids[Q.i]], r = qs()[q.id], h = '';
    h += '<div class="qhead">' + chip(q.subject) + '<span class="sub">' + esc(SUBJ[q.subject].name) + '</span><span class="grow"></span><span class="sub">' + (Q.i + 1) + ' / ' + Q.ids.length + '</span></div>' +
      bar((Q.i + (Q.sub ? 1 : 0)) / Q.ids.length * 100);
    h += '<div class="card"><div class="row" style="margin-bottom:4px"><span class="sub">문제 ' + esc(q.id) + ' · ' + esc(Q.label) + '</span><span class="badge">' + esc(q.origin) + '</span></div>' +
      '<p class="qtext">' + esc(q.question) + '</p>' + (q.concept ? '<div class="concept">관련 개념: ' + esc(q.concept) + '</div>' : '');
    q.options.forEach(function (o, i) {
      var n = i + 1, cls = '', tag = '';
      if (Q.sub) {
        if (n === q.answer) { cls = 'ok'; tag = Q.sel === n ? '정답 · 내 답' : '정답'; }
        else if (n === Q.sel) { cls = 'bad'; tag = '내 답 (오답)'; }
      } else if (Q.sel === n) cls = 'sel';
      h += '<button type="button" class="opt ' + cls + '" data-a="pick" data-v="' + n + '"' + (Q.sub ? ' disabled' : '') + ' aria-pressed="' + (Q.sel === n) + '"><b>' + MK[i] + '</b><span>' + esc(o) + '</span>' + (tag ? '<span class="tag">' + tag + '</span>' : '') + '</button>';
    });
    h += '</div>';
    h += '<h2>이해도 체크</h2><div class="sub">답을 확인하기 전에, 이 문제를 얼마나 알고 있었는지 솔직하게 골라 주세요.</div><div class="ugrid">' +
      UL.map(function (l, i) { return '<button type="button" class="ubtn u' + i + (Q.u === i ? ' on' : '') + '" data-a="pickU" data-v="' + i + '"' + (Q.sub ? ' disabled' : '') + ' aria-pressed="' + (Q.u === i) + '"><b>' + l + '</b><small>' + UD[i] + '</small></button>'; }).join('') + '</div>';
    if (!Q.sub) {
      h += '<button class="btn" style="margin-top:14px" type="button" data-a="submit"' + (Q.sel === null || Q.u === null ? ' disabled' : '') + '>제출하고 정답 확인</button>' +
        '<div class="hint" style="text-align:center">' + (Q.sel === null ? '답안을 선택해 주세요.' : Q.u === null ? '이해도를 선택해 주세요.' : '') + '</div>';
    } else {
      var ok = Q.sel === q.answer, rr = qs()[q.id];
      h += '<div class="result ' + (ok ? 'ok' : 'bad') + '">' + (ok ? '정답입니다!' : '오답입니다. 정답은 ' + MK[q.answer - 1] + '번입니다.') + '</div>' +
        '<div class="expl"><b>해설</b><br>' + esc(q.explanation) + '</div>' +
        '<div class="kv" style="margin-top:10px">이해도: ' + utag(Q.u) + ' · 이 문제 누적 오답 <span class="cnt">' + rr.w + '회</span>' + ((ok && (Q.u === 0 || Q.u === 1)) ? ' · <b>맞혔지만 복습 대상(취약)으로 분류됩니다</b>' : '') + '</div>' +
        '<button class="btn" style="margin-top:14px" type="button" data-a="next">' + (Q.i + 1 >= Q.ids.length ? '결과 보기' : '다음 문제') + '</button>';
    }
    h += '<button class="btn line" style="margin-top:10px" type="button" data-a="quit">그만 풀기</button>';
    return h;
  }
  function result() {
    var n = Q.res.length, ok = Q.res.filter(function (x) { return x.ok; }).length, weak = Q.res.filter(function (x) { return !x.ok || x.u === 0 || x.u === 1; }).length;
    var h = '<h2>풀이 결과</h2><div class="card"><div class="pct">' + pct(ok, n) + '<small>%</small></div><div>' + n + '문제 중 <b>' + ok + '문제</b> 정답</div>' + bar(pct(ok, n), '#16a34a') +
      '<div class="sub" style="margin-top:8px">이 중 복습이 필요한 문제(오답 또는 아예 모름·찍음): <b>' + weak + '개</b></div></div>';
    h += '<h2>문제별 결과</h2>';
    Q.res.forEach(function (x, i) {
      var q = BYID[x.id];
      h += '<div class="card"><div class="row"><span>' + (i + 1) + '. ' + chip(q.subject) + ' <span class="sub">' + esc(q.id) + '</span></span><span style="font-weight:800;color:' + (x.ok ? 'var(--ok)' : 'var(--bad)') + '">' + (x.ok ? '정답' : '오답') + '</span></div>' +
        '<div style="margin:4px 0;font-weight:600">' + esc(q.question) + '</div><div>' + utag(x.u) + '</div></div>';
    });
    h += '<div class="stack"><button class="btn" type="button" data-a="go" data-v="wrong">오답노트 보기</button><button class="btn line" type="button" data-a="go" data-v="home">홈으로</button></div>';
    return h;
  }

  /* ───────── 오답노트 ───────── */
  function filterSeg(cur, act) {
    return '<div class="seg">' + [0, 1, 2, 3].map(function (s) { return '<button type="button" data-a="' + act + '" data-v="' + s + '" class="' + (cur === s ? 'on' : '') + '">' + (s ? s + '과목' : '전체') + '</button>'; }).join('') + '</div>';
  }
  function wrong() {
    var ids = wrongIds().filter(function (id) { return !UI.wrongS || BYID[id].subject === UI.wrongS; });
    ids.sort(function (a, b) { return lastTime(b) < lastTime(a) ? -1 : 1; });
    var h = '<h2>자동 오답노트</h2><div class="sub">한 번이라도 틀린 문제가 자동으로 기록됩니다. 다시 맞혀도 이전 오답 기록은 유지됩니다.</div>' + filterSeg(UI.wrongS, 'wrongS');
    if (!ids.length) return h + '<div class="empty">아직 오답 기록이 없습니다.<br>문제를 풀면 틀린 문제가 여기에 자동으로 쌓입니다.</div>';
    h += '<button class="btn" type="button" data-a="startWrong">오답 문제 풀기 (' + wrongIds().length + '문제)</button>';
    ids.forEach(function (id) {
      var q = BYID[id], r = qs()[id], rec = isRecovered(id);
      var hist = S.att.filter(function (a) { return a.q === id; });
      h += '<details class="q"><summary><span class="t">' + esc(q.question) + '</span>' + chip(q.subject) + '<span class="badge">' + esc(q.id) + '</span><span class="cnt">오답 ' + r.w + '회</span>' + utag(r.last.u) +
        (rec ? '<span class="badge" style="color:var(--ok)">회복됨</span>' : '<span class="badge" style="color:var(--bad)">복습 필요</span>') + '</summary><div class="body">' +
        '<div class="kv"><b>내가 마지막으로 틀린 답:</b> ' + (r.lastWrong.c ? MK[r.lastWrong.c - 1] + ' ' + esc(q.options[r.lastWrong.c - 1]) : '미응답') + '</div>' +
        '<div class="kv"><b>정답:</b> ' + MK[q.answer - 1] + ' ' + esc(q.options[q.answer - 1]) + '</div>' +
        '<div class="kv"><b>보기:</b> ' + q.options.map(function (o, i) { return MK[i] + ' ' + esc(o); }).join(' &nbsp; ') + '</div>' +
        '<div class="expl"><b>해설</b><br>' + esc(q.explanation) + '</div>' +
        '<div class="kv">관련 개념: ' + esc(q.concept) + ' · <span class="badge">' + esc(q.origin) + '</span></div>' +
        '<div class="kv"><b>풀이 기록 (' + hist.length + '회)</b></div><table class="t"><tr><th>날짜</th><th>선택</th><th>결과</th><th>이해도</th></tr>' +
        hist.map(function (a) { return '<tr><td>' + esc(a.d) + (a.m ? ' (모의)' : '') + '</td><td>' + (a.c ? MK[a.c - 1] : '미응답') + '</td><td style="color:' + (a.ok ? 'var(--ok)' : 'var(--bad)') + ';font-weight:700">' + (a.ok ? '정답' : '오답') + '</td><td>' + utag(a.u) + '</td></tr>'; }).join('') +
        '</table></div></details>';
    });
    return h;
  }

  /* ───────── 맞춤형 복습 ───────── */
  function reviewIds() {
    var f = UI.rv;
    var ids = BANK.filter(function (q) {
      var r = qs()[q.id]; if (!r) return false;
      if (f.s && q.subject !== f.s) return false;
      if (f.mode === 'weak' && !isWeak(q.id)) return false;
      if (f.u !== 'any' && r.last.u !== f.u) return false;
      if (f.w && r.w < f.w) return false;
      return true;
    }).map(function (q) { return q.id; });
    return sortWeak(ids);
  }
  function review() {
    var f = UI.rv, ids = reviewIds(), h = '<h2>맞춤형 복습</h2><div class="note">취약 문제 = 최근에 틀렸거나, 맞혔더라도 이해도를 <b>아예 모름·찍음</b>으로 체크한 문제입니다. 틀린 횟수가 많고 취약한 문제부터 출제합니다.</div>';
    h += '<div class="card"><label>대상</label><div class="seg"><button type="button" data-a="rvMode" data-v="weak" class="' + (f.mode === 'weak' ? 'on' : '') + '">취약 문제만</button><button type="button" data-a="rvMode" data-v="all" class="' + (f.mode === 'all' ? 'on' : '') + '">푼 문제 전체</button></div>' +
      '<label style="margin-top:8px">과목</label>' + filterSeg(f.s, 'rvS') +
      '<div class="fgrid"><div><label for="rvU">이해도(최근 체크 기준)</label><select id="rvU" data-a="rvU"><option value="any"' + (f.u === 'any' ? ' selected' : '') + '>전체</option>' +
      UL.map(function (l, i) { return '<option value="' + i + '"' + (f.u === i ? ' selected' : '') + '>' + l + '</option>'; }).join('') + '</select></div>' +
      '<div><label for="rvW">오답 횟수</label><select id="rvW" data-a="rvW">' + [0, 1, 2, 3].map(function (n) { return '<option value="' + n + '"' + (f.w === n ? ' selected' : '') + '>' + (n ? n + '회 이상' : '전체') + '</option>'; }).join('') + '</select></div></div></div>';
    h += '<div class="card"><div class="row"><b>조건에 맞는 문제 ' + ids.length + '개</b><span class="sub">한 번에 ' + (UI.n || '전체') + '문제</span></div>' +
      '<button class="btn" style="margin-top:10px" type="button" data-a="startReview"' + (ids.length ? '' : ' disabled') + '>복습 시작</button></div>';
    if (ids.length) {
      h += '<table class="t"><tr><th>문제</th><th>오답</th><th>이해도</th></tr>' + ids.slice(0, 40).map(function (id) {
        var q = BYID[id], r = qs()[id];
        return '<tr><td>' + chip(q.subject) + ' ' + esc(q.id) + '<div class="sub">' + esc(q.concept) + '</div></td><td>' + r.w + '회</td><td>' + utag(r.last.u) + '</td></tr>';
      }).join('') + '</table>';
    } else h += '<div class="empty">조건에 맞는 문제가 없습니다.' + (f.mode === 'weak' ? '<br>문제를 풀면 취약 문제가 여기에 모입니다.' : '') + '</div>';
    return h;
  }

  /* ───────── 통계 ───────── */
  function stats() {
    var o = overall(), h = '<h2>과목별 학습 통계</h2><div class="card"><div class="stats2"><div class="stat"><b>' + o.att + '</b><span>총 풀이 횟수</span></div><div class="stat"><b>' + (o.att ? o.acc + '%' : '-') + '</b><span>누적 정답률</span></div></div></div>';
    [1, 2, 3].forEach(function (s) {
      var r = subjStat(s), tot = r.u[0] + r.u[1] + r.u[2] + r.u[3];
      h += '<div class="card subj ' + SUBJ[s].cls + '"><h3>' + chip(s) + ' ' + SUBJ[s].name + '</h3>' +
        '<div class="row sub"><span>진행률 ' + pct(r.solved, r.total) + '% (' + r.solved + '/' + r.total + ')</span><span>정답률 ' + (r.att ? pct(r.ok, r.att) + '% (' + r.ok + '/' + r.att + ')' : '-') + '</span></div>' + bar(pct(r.solved, r.total)) +
        '<div class="row sub" style="margin-top:6px"><span>오답 문제 ' + r.wrongQ + '개</span><span>취약 문제 ' + r.weak + '개</span></div>' +
        '<div class="sub" style="margin-top:8px">이해도 분포 (문제별 최근 체크)</div><div class="stack-bar">' +
        (tot ? r.u.map(function (n, i) { return n ? '<i style="width:' + n / tot * 100 + '%;background:' + UHEX[i] + '" title="' + UL[i] + ' ' + n + '"></i>' : ''; }).join('') : '') + '</div>' +
        '<div class="legend">' + UL.map(function (l, i) { return '<span><i style="background:' + UHEX[i] + '"></i>' + l + ' ' + r.u[i] + '</span>'; }).join('') + '</div></div>';
    });
    h += '<h2>개념별 정답률 (낮은 순)</h2>';
    var cm = {};
    S.att.forEach(function (a) { var q = BYID[a.q]; if (!q || !q.concept) return; var k = q.subject + '|' + q.concept, c = cm[k] || (cm[k] = { s: q.subject, name: q.concept, n: 0, ok: 0 }); c.n++; if (a.ok) c.ok++; });
    var cl = Object.keys(cm).map(function (k) { return cm[k]; }).sort(function (a, b) { return a.ok / a.n - b.ok / b.n || b.n - a.n; }).slice(0, 8);
    h += cl.length ? '<div class="card"><table class="t"><tr><th>개념</th><th>정답률</th><th>풀이</th></tr>' + cl.map(function (c) { return '<tr><td>' + chip(c.s) + ' ' + esc(c.name) + '</td><td>' + pct(c.ok, c.n) + '%</td><td>' + c.n + '회</td></tr>'; }).join('') + '</table></div>' : '<div class="empty">아직 풀이 기록이 없습니다.</div>';
    h += '<h2>최근 7일</h2><div class="card">' + weekChart() + '</div>';
    return h;
  }

  /* ───────── 설정 ───────── */
  function settings() {
    var st = S.settings, nb = BUILTIN.length, nc = CUSTOM_RAW.length;
    var h = '<h2>학습 설정</h2><div class="card"><div class="fgrid">' +
      '<div><label for="fExam">시험 예정일</label><input type="date" id="fExam" value="' + esc(st.examDate) + '"></div>' +
      '<div><label for="fStart">학습 시작일</label><input type="date" id="fStart" value="' + esc(st.startDate) + '"></div>' +
      '<div><label for="fMin">하루 공부 가능 시간 (분)</label><input type="number" id="fMin" min="1" inputmode="numeric" value="' + esc(st.dailyMinutes) + '"></div>' +
      '<div><label for="fPerQ">문제당 평균 풀이 시간 (분)</label><input type="number" id="fPerQ" min="0.1" step="0.1" inputmode="decimal" value="' + esc(st.minPerQ) + '"></div>' +
      '<div class="full"><label>학습할 과목</label><div class="checks">' + [1, 2, 3].map(function (s) { return '<label><input type="checkbox" class="fSub" value="' + s + '"' + (st.subjects.indexOf(s) !== -1 ? ' checked' : '') + '> ' + s + '과목 ' + SUBJ[s].name + '</label>'; }).join('') + '</div></div>' +
      '<div class="full"><label for="fTotal">전체 학습 문제 수 (비우면 문제은행 수로 자동 계산)</label><input type="number" id="fTotal" min="1" inputmode="numeric" placeholder="예: 600" value="' + (st.total || '') + '"><div class="hint">현재 문제은행: 선택한 과목 ' + activeBank().length + '문제. 교재·기출 전체를 기준으로 계획하려면 직접 입력하세요.</div></div>' +
      '</div><button class="btn" style="margin-top:14px" type="button" data-a="saveSettings">설정 저장</button></div>';
    h += '<h2>문제 파일 업로드</h2><div class="card"><div class="sub">내장 문제 ' + nb + '개(자체 제작 예상문제) + 업로드한 문제 ' + nc + '개. JSON·CSV 파일을 여러 개 한꺼번에 선택할 수 있습니다. 파일은 서버로 전송되지 않고 이 브라우저(IndexedDB)에만 저장됩니다.</div>' +
      '<button class="btn" style="margin-top:10px" type="button" data-a="pickQ">문제 파일 선택 (JSON · CSV, 여러 개)</button><input type="file" id="fQ" accept=".json,.csv,application/json,text/csv" multiple hidden>' +
      '<div class="hint">필수 항목: subject(1~3), num, question, option1~4(또는 options 배열), answer(1~4), explanation. 선택: concept, kind(기출/기출복원/자체 제작 예상문제), year, round, source, scope2027. 기출·기출복원은 year와 source가 필요합니다. 같은 문제(같은 연도·회차·과목·번호)는 중복 추가되지 않습니다. PDF는 <b>tools/pdf2json</b> 프로그램으로 JSON으로 바꾼 뒤 올리세요.</div>' +
      '<div class="hint"><b>2022년 이전 기출</b>은 2027~2030 출제기준에 해당하는 문제만 등록합니다. 파일에 <code>scope2027: true</code>가 없으면 아래 "출제기준 선별 대기"에 보관되고, 직접 골라 등록합니다.</div>' +
      uploadReport() + groupTable() +
      '<div class="grid2" style="margin-top:10px"><button class="btn line" type="button" data-a="tplDown">CSV 양식 받기</button><button class="btn danger" type="button" data-a="delCustom"' + (nc ? '' : ' disabled') + '>업로드한 문제 전부 삭제</button></div></div>';
    h += stagePanel();
    h += '<h2>백업 · 복원 · 초기화</h2><div class="card"><div class="sub">학습 기록은 LocalStorage, 업로드한 문제는 IndexedDB에 있습니다. 브라우저 데이터를 지우기 전에 백업해 두세요.</div><div class="stack" style="margin-top:10px">' +
      '<button class="btn ghost" type="button" data-a="export" data-v="all">전체 백업 (학습 기록 + 업로드 문제)</button>' +
      '<button class="btn ghost" type="button" data-a="export" data-v="rec">학습 기록만 백업</button>' +
      '<button class="btn ghost" type="button" data-a="importPick">백업 파일에서 복원</button><input type="file" id="fFile" accept="application/json,.json" hidden>' +
      '<div class="hint">전체 백업 파일에는 업로드한 문제 원문이 들어 있습니다. GitHub·공유 폴더·메신저에 올리지 마세요.</div>' +
      '<button class="btn danger" type="button" data-a="reset">학습 기록 전체 초기화</button></div></div>';
    h += '<p class="sub" style="margin-top:16px">과목 이름은 1과목 조사방법과 설계, 2과목 조사관리와 자료처리, 3과목 통계분석과 활용으로 설정되어 있습니다. 실제 시험 과목·문항 수·합격 기준은 큐넷(q-net.or.kr)의 최신 공고로 직접 확인하세요.</p>';
    return h;
  }
  function saveSettings() {
    var ex = $('#fExam').value, stt = $('#fStart').value, min = +$('#fMin').value, per = +$('#fPerQ').value, tot = $('#fTotal').value.trim();
    var subs = Array.prototype.map.call(document.querySelectorAll('.fSub:checked'), function (c) { return +c.value; });
    if (ex && stt && stt > ex) return toast('학습 시작일이 시험일보다 늦을 수 없습니다.');
    if (!(min > 0)) return toast('하루 공부 가능 시간을 1분 이상으로 입력해 주세요.');
    if (!(per > 0)) return toast('문제당 평균 풀이 시간을 입력해 주세요.');
    if (!subs.length) return toast('학습할 과목을 하나 이상 선택해 주세요.');
    if (tot !== '' && !(+tot >= 1 && Number.isInteger(+tot))) return toast('전체 학습 문제 수는 1 이상의 정수여야 합니다.');
    S.settings = { examDate: ex, startDate: stt, dailyMinutes: min, minPerQ: per, subjects: subs, total: tot === '' ? null : +tot };
    save(); toast('설정을 저장했습니다.'); go('home');
  }
  /* ───────── 문제 파일 업로드 (JSON · CSV) ───────── */
  var CIRC = { '①': 1, '②': 2, '③': 3, '④': 4, '❶': 1, '❷': 2, '❸': 3, '❹': 4 };
  var ALIAS = {
    subject: ['subject', '과목'], num: ['num', 'no', '번호', '문항번호'], question: ['question', '문제', '문항'],
    option1: ['option1', 'opt1', '보기1', '선택지1'], option2: ['option2', 'opt2', '보기2', '선택지2'],
    option3: ['option3', 'opt3', '보기3', '선택지3'], option4: ['option4', 'opt4', '보기4', '선택지4'],
    answer: ['answer', '정답', '답'], explanation: ['explanation', '해설'], concept: ['concept', '개념', '관련개념'],
    kind: ['kind', '구분', '종류'], year: ['year', '연도'], round: ['round', '회차'], source: ['source', '출처'],
    scope2027: ['scope2027', '출제기준해당', '2027해당'], criteria: ['criteria', '출제기준세부항목'], id: ['id']
  };
  function parseCSV(t) {
    if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);
    var rows = [], row = [], f = '', q = false, i, c;
    function endRow() { row.push(f); f = ''; if (row.some(function (x) { return x !== ''; })) rows.push(row); row = []; }
    for (i = 0; i < t.length; i++) {
      c = t[i];
      if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; endRow(); }
      else f += c;
    }
    endRow();
    if (!rows.length) return [];
    var map = {}, head = rows[0].map(function (h) { return h.trim().toLowerCase().replace(/\s+/g, ''); });
    head.forEach(function (h, ci) { Object.keys(ALIAS).forEach(function (k) { if (ALIAS[k].indexOf(h) !== -1 && map[k] === undefined) map[k] = ci; }); });
    return rows.slice(1).map(function (r) {
      var o = {}; Object.keys(map).forEach(function (k) { o[k] = (r[map[k]] || '').trim(); }); return o;
    });
  }
  function toInt(v) {
    if (typeof v !== 'string') return v;
    var s = v.trim(); if (CIRC[s]) return CIRC[s];
    return /^\d+$/.test(s) ? Number(s) : v;
  }
  function subjectOf(v) {
    if (typeof v === 'number') return v;
    var s = String(v || '').trim();
    if (/^[123]\D*$/.test(s) || /^[123]과목/.test(s)) return Number(s[0]);
    if (/조사방법/.test(s)) return 1;
    if (/조사관리|자료처리/.test(s)) return 2;
    if (/통계/.test(s)) return 3;
    return v;
  }
  function coerce(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return o;
    var r = {};
    Object.keys(o).forEach(function (k) { r[k] = typeof o[k] === 'string' ? o[k].trim() : o[k]; });
    r.subject = subjectOf(r.subject);
    ['num', 'answer', 'year', 'round'].forEach(function (k) { if (r[k] === '' || r[k] === null) delete r[k]; else if (r[k] !== undefined) r[k] = toInt(r[k]); });
    if (!Array.isArray(r.options) && r.option1 !== undefined) r.options = [r.option1, r.option2, r.option3, r.option4].map(function (x) { return x === undefined ? '' : String(x); });
    ['option1', 'option2', 'option3', 'option4'].forEach(function (k) { delete r[k]; });
    if (typeof r.scope2027 === 'string') r.scope2027 = /^(true|1|y|yes|o|예|해당)$/i.test(r.scope2027);
    ['kind', 'source', 'concept', 'criteria'].forEach(function (k) { if (r[k] === '') delete r[k]; });
    if (r.concept === undefined) r.concept = '';
    return r;
  }
  function readText(file) {
    return new Promise(function (res, rej) { var rd = new FileReader(); rd.onload = function () { res(String(rd.result)); }; rd.onerror = function () { rej(rd.error); }; rd.readAsText(file); });
  }
  function itemsOf(name, text) {
    if (/\.csv$/i.test(name)) return parseCSV(text);
    var j = JSON.parse(text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text);
    if (Array.isArray(j)) return j;
    if (j && Array.isArray(j.questions)) return j.questions;
    return [j];
  }
  function uploadFiles(files) {
    var rep = [], addBank = [], addStage = [], seen = {};
    BANK.forEach(function (q) { seen[q.id] = 1; });
    STAGE.forEach(function (q) { seen[q.id] = 1; });
    return Promise.all(files.map(function (f) { return readText(f).then(function (t) { return { name: f.name, text: t }; }, function () { return { name: f.name, text: null }; }); })).then(function (all) {
      all.forEach(function (f) {
        var r = { name: f.name, total: 0, added: 0, staged: 0, dup: 0, bad: [], fatal: '' };
        rep.push(r);
        var items;
        if (f.text === null) { r.fatal = '파일을 읽을 수 없습니다'; return; }
        try { items = itemsOf(f.name, f.text); } catch (e) { r.fatal = 'JSON 형식이 올바르지 않습니다'; return; }
        r.total = items.length;
        if (!items.length) r.fatal = '문제가 없습니다(CSV는 첫 줄이 열 이름이어야 합니다)';
        items.forEach(function (raw, i) {
          var q = coerce(raw), err = validate(q);
          if (err) { r.bad.push((i + 1) + '번째: ' + err); return; }
          var rec = stripQ(q); rec.id = makeId(q, true);
          if (seen[rec.id]) { r.dup++; return; }
          seen[rec.id] = 1;
          if (needsScope(rec)) { addStage.push(rec); r.staged++; } else { addBank.push(rec); r.added++; }
        });
      });
      return Promise.all([idbWrite('questions', addBank), idbWrite('staging', addStage)]).then(function (ok) {
        CUSTOM_RAW = CUSTOM_RAW.concat(addBank); STAGE = STAGE.concat(addStage);
        saveCustom();
        UI.report = rep;
        var a = addBank.length, s = addStage.length, b = rep.reduce(function (n, r) { return n + r.bad.length + (r.fatal ? 1 : 0); }, 0);
        toast(a + '문제 추가' + (s ? ', ' + s + '문제 선별 대기' : '') + (b ? ', ' + b + '건 오류' : '') + '.');
        if (!(ok[0] && ok[1]) && (a || s)) persistFail();
        render();
      });
    });
  }
  function uploadReport() {
    var rep = UI.report; if (!rep) return '';
    return '<div class="kv" style="margin-top:12px"><b>최근 업로드 결과</b></div><table class="t"><tr><th>파일</th><th>추가</th><th>대기</th><th>중복</th><th>오류</th></tr>' +
      rep.map(function (r) {
        var det = r.fatal ? '<div style="color:var(--bad)">' + esc(r.fatal) + '</div>' : r.bad.slice(0, 5).map(function (b) { return '<div style="color:var(--bad)">' + esc(b) + '</div>'; }).join('') + (r.bad.length > 5 ? '<div class="sub">…외 ' + (r.bad.length - 5) + '건</div>' : '');
        return '<tr><td>' + esc(r.name) + '<div class="sub">' + r.total + '문제</div>' + det + '</td><td>' + r.added + '</td><td>' + r.staged + '</td><td>' + r.dup + '</td><td>' + r.bad.length + '</td></tr>';
      }).join('') + '</table>';
  }
  function groupKey(q) { return (q.kind || '출처 미확인') + '|' + (q.year || ''); }
  function groupTable() {
    if (!CUSTOM_RAW.length) return '';
    var g = {};
    CUSTOM_RAW.forEach(function (q) { var k = groupKey(q); (g[k] || (g[k] = { kind: q.kind || '출처 미확인', year: q.year || '', n: 0 })).n++; });
    return '<div class="kv" style="margin-top:12px"><b>업로드한 문제 (' + CUSTOM_RAW.length + '문제)</b></div><table class="t"><tr><th>구분</th><th>문제 수</th><th></th></tr>' +
      Object.keys(g).sort().map(function (k) {
        var x = g[k]; return '<tr><td>' + esc(x.kind) + (x.year ? ' · ' + x.year + '년' : '') + '</td><td>' + x.n + '</td><td><button class="btn sm line" type="button" data-a="delGroup" data-v="' + esc(k) + '">삭제</button></td></tr>';
      }).join('') + '</table>';
  }
  function stagePanel() {
    if (!STAGE.length) return '';
    var list = STAGE.filter(function (q) { return !UI.stS || q.subject === UI.stS; }), shown = list.slice(0, 100);
    var nsel = STAGE.filter(function (q) { return UI.stSel[q.id]; }).length;
    return '<h2>출제기준 선별 대기 (2022년 이전 기출 ' + STAGE.length + '문제)</h2><div class="card"><div class="sub">2027~2030 출제기준에 해당하는 문제만 골라 등록하세요. 등록하지 않은 문제는 풀이·모의고사에 나오지 않습니다.</div>' +
      filterSeg(UI.stS, 'stS') +
      '<div style="margin-top:8px">' + shown.map(function (q) {
        return '<label style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-top:1px solid #e3e8f2"><input type="checkbox" class="stChk" value="' + esc(q.id) + '"' + (UI.stSel[q.id] ? ' checked' : '') + ' style="margin-top:4px"><span>' + chip(q.subject) + ' <span class="sub">' + q.year + '년' + (q.round ? ' ' + q.round + '회' : '') + ' ' + q.num + '번</span><br>' + esc(q.question.length > 90 ? q.question.slice(0, 90) + '…' : q.question) + (q.concept ? '<br><span class="sub">' + esc(q.concept) + '</span>' : '') + '</span></label>';
      }).join('') + '</div>' + (list.length > shown.length ? '<div class="hint">처음 100문제만 표시합니다. 등록·삭제하면 나머지가 이어서 표시됩니다.</div>' : '') +
      '<div class="grid2" style="margin-top:10px"><button class="btn line" type="button" data-a="stAll">현재 목록 전체 선택/해제</button><span class="sub" style="align-self:center">선택 ' + nsel + '문제</span></div>' +
      '<div class="grid2" style="margin-top:10px"><button class="btn" type="button" data-a="stAdd"' + (nsel ? '' : ' disabled') + '>선택 문제 등록</button><button class="btn danger" type="button" data-a="stDel"' + (nsel ? '' : ' disabled') + '>선택 문제 삭제</button></div></div>';
  }
  function stageMove(register) {
    var sel = STAGE.filter(function (q) { return UI.stSel[q.id]; }); if (!sel.length) return;
    var ids = sel.map(function (q) { return q.id; });
    var put = register ? sel.map(function (q) { var c = Object.assign({}, q); c.scope2027 = true; return c; }) : [];
    Promise.all([idbWrite('staging', [], ids), register ? idbWrite('questions', put) : Promise.resolve(true)]).then(function (ok) {
      STAGE = STAGE.filter(function (q) { return !UI.stSel[q.id]; });
      if (register) CUSTOM_RAW = CUSTOM_RAW.concat(put);
      UI.stSel = {}; saveCustom();
      toast(sel.length + '문제를 ' + (register ? '문제은행에 등록했습니다.' : '삭제했습니다.'));
      if (!(ok[0] && ok[1])) persistFail();
      render();
    });
  }
  function csvTemplate() {
    var t = '﻿subject,num,question,option1,option2,option3,option4,answer,explanation,concept,kind,year,round,source,scope2027\n' +
      '1,1,"문제 내용(쉼표·줄바꿈은 큰따옴표로 감쌈)",보기1,보기2,보기3,보기4,2,"해설 내용",관련 개념,기출복원,2025,1,"직접 정리한 자료",\n';
    download(new Blob([t], { type: 'text/csv;charset=utf-8' }), 'question-template.csv');
  }
  function download(blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ───────── 백업 · 복원 ───────── */
  function exportData(withQ) {
    var o = { app: 'ssm', v: 2, exported: new Date().toISOString(), state: S };
    if (withQ) { o.custom = CUSTOM_RAW; o.staging = STAGE; }
    download(new Blob([JSON.stringify(o)], { type: 'application/json' }), 'study-master-' + (withQ ? 'full' : 'records') + '-backup-' + today() + '.json');
    toast('백업 파일을 저장했습니다.' + (withQ ? ' (문제 원문 포함: 공개하지 마세요)' : ''));
  }
  function backupQuestions(arr) {
    return (Array.isArray(arr) ? arr : []).map(coerce).filter(function (q) { return !validate(q); }).map(function (q) { var r = stripQ(q); r.id = makeId(q, true); return r; });
  }
  function importData(text) {
    var o; try { o = JSON.parse(text); } catch (e) { return toast('백업 파일을 읽을 수 없습니다.'); }
    if (!o || o.app !== 'ssm' || !o.state || !Array.isArray(o.state.att)) return toast('이 사이트의 백업 파일이 아닙니다.');
    var hasQ = Array.isArray(o.custom);
    confirmBox('현재 학습 기록을 이 백업 파일의 내용으로 덮어씁니다.' + (hasQ ? ' 업로드한 문제도 백업 파일의 문제(' + o.custom.length + '개)로 바뀝니다.' : ' (이 파일에는 문제 데이터가 없어 현재 문제는 그대로 둡니다.)') + ' 계속할까요?', '복원', function () {
      S = merge(o.state); save(); Q = null; lsDel(SKEY);
      if (!hasQ) { toast('복원했습니다.'); return go('home'); }
      var qs_ = backupQuestions(o.custom), st_ = backupQuestions(o.staging);
      Promise.all([idbWrite('questions', qs_, [], true), idbWrite('staging', st_, [], true)]).then(function (ok) {
        CUSTOM_RAW = qs_; STAGE = st_; UI.stSel = {}; saveCustom();
        toast('복원했습니다.'); if (!(ok[0] && ok[1])) persistFail(); go('home');
      });
    });
  }

  /* ───────── 모의고사 ───────── */
  // 실전 규격 — 큐넷 공식 출제기준 "사회조사분석사2급 (2027.1.1~2030.12.31)"에서 확인한 값:
  //   객관식 80문제 · 시험시간 2시간 · 조사방법과 설계 25 / 조사관리와 자료처리 25 / 통계분석과 활용 30문제
  // (이전 기준 2023.1.1~2026.12.31: 100문제 · 2시간 30분 · 30/30/40문제)
  // 과락 40%(과목 득점률 40% 미만)·합격 60%(100점 환산)는 출제기준에 적혀 있지 않아 사용자가 알려 준 기준을 적용했습니다.
  var EXAM = { minutes: 120, passRatio: 0.6, cutRatio: 0.4, subjects: { 1: { n: 25, cut: 10 }, 2: { n: 25, cut: 10 }, 3: { n: 30, cut: 12 } } };
  var EXAM_TOTAL = 80;
  function poolCount(s) { return srcBank().filter(function (q) { return q.subject === s; }).length; }
  function mock() {
    var h = '<h2>실전 모의고사</h2><div class="note"><b>문항 수·시험시간</b>은 큐넷 공식 출제기준 "사회조사분석사2급(2027.1.1~2030.12.31)"에서 확인한 값입니다(80문제·2시간·25/25/30문제). <b>과락(과목 40% 미만)·합격(60점 이상)</b> 기준은 출제기준에 적혀 있지 않아 사용자가 알려 준 기준을 적용했으니 시험 공고로 한 번 더 확인하세요.</div>';
    var lack = [];
    h += '<div class="card"><div class="sub" style="margin-bottom:6px">출제할 문제의 출처</div>' + srcSeg() + '</div>';
    h += '<div class="card"><table class="t"><tr><th>과목</th><th>문항</th><th>과락 기준</th><th>보유 문제</th></tr>' +
      [1, 2, 3].map(function (s) {
        var e = EXAM.subjects[s], have = poolCount(s), ok = have >= e.n;
        if (!ok) lack.push(s + '과목 ' + (e.n - have) + '문제');
        return '<tr><td>' + chip(s) + ' ' + SUBJ[s].name + '</td><td>' + e.n + '문제</td><td>' + e.cut + '문제 미만 (' + Math.round(e.cut / e.n * 100) + '점 미만)</td><td style="font-weight:700;color:' + (ok ? 'var(--ok)' : 'var(--bad)') + '">' + have + '개</td></tr>';
      }).join('') + '</table>' +
      '<div class="kv" style="margin-top:10px">총 <b>' + EXAM_TOTAL + '문제</b> (100점 환산, 문제당 <b>' + (100 / EXAM_TOTAL) + '점</b>) · 시험시간 <b>2시간(' + EXAM.minutes + '분)</b> · 합격: <b>총점 60점 이상(' + Math.ceil(EXAM_TOTAL * EXAM.passRatio) + '문제 이상)</b>이면서 <b>과락 과목 없음</b></div></div>';
    h += '<div class="card"><h3 style="margin:0 0 6px;font-size:1rem">정식 규격 모의고사 (' + EXAM_TOTAL + '문제 · ' + EXAM.minutes + '분)</h3>' +
      (lack.length ? '<div class="warn">문제가 부족해 시작할 수 없습니다. 부족한 문제: ' + lack.join(', ') + '. 설정에서 문제를 추가해 주세요.</div>' : '<div class="sub">과목별 문제를 무작위로 뽑아 실제 규격으로 출제합니다.</div>') +
      '<button class="btn" style="margin-top:10px" type="button" data-a="startMockFull"' + (lack.length ? ' disabled' : '') + '>정식 모의고사 시작</button></div>';
    var have = [1, 2, 3].reduce(function (a, s) { return a + poolCount(s); }, 0);
    h += '<div class="card"><h3 style="margin:0 0 6px;font-size:1rem">축소 연습 모의고사 (보유 문제 ' + have + '개 전체)</h3>' +
      '<div class="sub">실제 규격이 아닙니다. 보유한 문제를 모두 출제하고, 같은 비율(과목 득점률 40% 미만 과락, 총점 60% 이상 합격)로 채점하며, 시간은 문항 수에 비례해 줄입니다(약 ' + Math.max(1, Math.round(EXAM.minutes * have / EXAM_TOTAL)) + '분).</div>' +
      '<button class="btn line" style="margin-top:10px" type="button" data-a="startMockMini"' + (have ? '' : ' disabled') + '>축소 연습 모의고사 시작</button></div>';
    if (S.mocks.length) {
      h += '<h2>모의고사 기록</h2><div class="card"><table class="t"><tr><th>날짜</th><th>유형</th><th>점수</th><th>결과</th></tr>' + S.mocks.slice(-5).reverse().map(function (m) {
        return '<tr><td>' + esc(m.d) + '</td><td>' + (m.kind === 'full' ? '정식' : '축소') + '</td><td>' + m.totalOk + ' / ' + m.total + '</td><td style="font-weight:700;color:' + (m.pass ? 'var(--ok)' : 'var(--bad)') + '">' + (m.pass ? '합격' : '불합격') + '</td></tr>';
      }).join('') + '</table><button class="btn line" style="margin-top:10px" type="button" data-a="go" data-v="mockresult">최근 결과 보기</button></div>';
    }
    return h;
  }
  function startMock(kind) {
    var per = {}, cutMap = {}, ids = [], minutes, passScore, total = 0, pool;
    [1, 2, 3].forEach(function (s) {
      pool = srcBank().filter(function (q) { return q.subject === s; });
      var n = kind === 'full' ? EXAM.subjects[s].n : pool.length;
      if (kind === 'full' && pool.length < n) return;
      if (!n) return;
      per[s] = n; cutMap[s] = kind === 'full' ? EXAM.subjects[s].cut : n * 0.4; total += n;
      ids = ids.concat(shuffle(pool).slice(0, n).map(function (q) { return q.id; }));
    });
    if (kind === 'full' && total !== EXAM_TOTAL) return toast('문제가 부족해 정식 모의고사를 시작할 수 없습니다.');
    if (!ids.length) return toast('출제할 문제가 없습니다.');
    minutes = kind === 'full' ? EXAM.minutes : Math.max(1, Math.round(EXAM.minutes * total / EXAM_TOTAL));
    passScore = total * EXAM.passRatio;
    M = { kind: kind, ids: ids, ans: {}, i: 0, endAt: Date.now() + minutes * 60000, minutes: minutes, per: per, cutMap: cutMap, passScore: passScore, total: total };
    go('mockrun');
  }
  function mockrun() {
    var q = BYID[M.ids[M.i]], h = '<div class="qhead">' + chip(q.subject) + '<span class="sub">' + esc(SUBJ[q.subject].name) + '</span><span class="grow"></span><span class="timer" id="timer">--:--</span></div>' +
      '<div class="card"><div class="row" style="margin-bottom:4px"><span class="sub">' + (M.kind === 'full' ? '정식' : '축소 연습') + ' · ' + (M.i + 1) + ' / ' + M.ids.length + '번</span><span class="badge">' + esc(q.origin) + '</span></div><p class="qtext">' + esc(q.question) + '</p>';
    q.options.forEach(function (o, i) { h += '<button type="button" class="opt ' + (M.ans[q.id] === i + 1 ? 'sel' : '') + '" data-a="mpick" data-v="' + (i + 1) + '"><b>' + MK[i] + '</b><span>' + esc(o) + '</span></button>'; });
    h += '</div><div class="grid2"><button class="btn line" type="button" data-a="mprev"' + (M.i === 0 ? ' disabled' : '') + '>이전</button><button class="btn line" type="button" data-a="mnext"' + (M.i === M.ids.length - 1 ? ' disabled' : '') + '>다음</button></div>' +
      '<div class="seg" style="margin-top:10px">' + M.ids.map(function (id, i) { return '<button type="button" data-a="mjump" data-v="' + i + '" class="' + (i === M.i ? 'on' : '') + '" style="' + (M.ans[id] && i !== M.i ? 'border-color:var(--blue);color:var(--blue)' : '') + '">' + (i + 1) + '</button>'; }).join('') + '</div>' +
      '<button class="btn" style="margin-top:12px" type="button" data-a="msubmit">제출하고 채점</button>';
    return h;
  }
  function startTimer() {
    function tick() {
      var left = Math.max(0, Math.round((M.endAt - Date.now()) / 1000)), el = $('#timer');
      if (el) { el.textContent = pad(Math.floor(left / 60)) + ':' + pad(left % 60); el.className = 'timer' + (left <= 300 ? ' low' : ''); }
      if (left <= 0) { clearInterval(timerId); timerId = null; finishMock(true); }
    }
    if (timerId) clearInterval(timerId);
    tick(); timerId = setInterval(tick, 1000);
  }
  function finishMock(auto) {
    if (!M) return;
    var t = today(), by = {}, subs = Object.keys(M.per).map(Number);
    subs.forEach(function (s) { by[s] = { n: M.per[s], ok: 0 }; });
    M.ids.forEach(function (id) {
      var q = BYID[id], c = M.ans[id] || null, ok = c === q.answer;
      if (ok) by[q.subject].ok++;
      S.att.push({ q: id, t: new Date().toISOString(), d: t, c: c, ok: ok, u: null, m: true });
    });
    var scores = subs.map(function (s) { return { s: s, n: by[s].n, ok: by[s].ok, cut: M.cutMap[s] }; });
    var totalOk = scores.reduce(function (a, x) { return a + x.ok; }, 0);
    var failSubj = scores.filter(function (x) { return x.ok < x.cut; }).map(function (x) { return x.s; });   // 기준 문제 수 미만이면 과락
    var pass = !failSubj.length && totalOk >= M.passScore;
    S.mocks.push({ d: t, kind: M.kind, totalOk: totalOk, total: M.total, pass: pass, scores: scores, failSubj: failSubj, passScore: M.passScore, minutes: M.minutes, ids: M.ids, ans: M.ans, auto: !!auto });
    save(); M = null;
    if (timerId) { clearInterval(timerId); timerId = null; }
    if (auto) toast('제한 시간이 끝나 자동 제출했습니다.');
    go('mockresult');
  }
  function mockresult() {
    var m = S.mocks[S.mocks.length - 1], full = m.kind === 'full';
    var h = '<h2>모의고사 결과</h2>' + (full ? '' : '<div class="warn">축소 연습 모의고사입니다. 실제 규격(' + EXAM_TOTAL + '문제)이 아니며, 같은 비율(과락 40%·합격 60%)로 채점했습니다.</div>') +
      '<div class="card"><div class="pct" style="color:' + (m.pass ? 'var(--ok)' : 'var(--bad)') + '">' + (m.pass ? '합격' : '불합격') + '</div>' +
      '<div>정답 <b>' + m.totalOk + ' / ' + m.total + '문제</b> · 100점 환산 <b>' + (Math.round(m.totalOk / m.total * 1000) / 10) + '점</b> (합격 기준 60점 이상 = ' + (Math.round(m.passScore * 10) / 10) + '문제 이상 · 과락 과목 없음)</div>' +
      (m.failSubj.length ? '<div style="color:var(--bad);font-weight:700;margin-top:6px">과락 과목: ' + m.failSubj.map(function (s) { return s + '과목'; }).join(', ') + (m.totalOk >= m.passScore ? ' (총점은 기준 이상이지만 과락이라 불합격)' : '') + '</div>' : '') +
      '<div class="hint">입력된 규격 기준의 판정이며 공식 합격 여부가 아닙니다.</div></div>';
    m.scores.forEach(function (x) {
      var bad = x.ok < x.cut;
      h += '<div class="card subj ' + SUBJ[x.s].cls + '"><h3>' + chip(x.s) + ' ' + SUBJ[x.s].name + '</h3><div class="row"><span>' + x.ok + ' / ' + x.n + '문제 정답 (100점 환산 ' + (Math.round(x.ok / x.n * 1000) / 10) + '점)</span><b style="color:' + (bad ? 'var(--bad)' : 'var(--ok)') + '">' + (bad ? '과락' : '통과') + '</b></div>' + bar(pct(x.ok, x.n), bad ? '#dc2626' : '') +
        '<div class="sub" style="margin-top:4px">과락 기준: ' + (Math.round(x.cut * 10) / 10) + '문제 미만 (40점 미만)</div></div>';
    });
    h += '<h2>문제별 정답 · 해설</h2>';
    m.ids.forEach(function (id, i) {
      var q = BYID[id]; if (!q) return; var c = m.ans[id] || null, ok = c === q.answer;
      h += '<details class="q"><summary><span class="t">' + (i + 1) + '. ' + esc(q.question) + '</span>' + chip(q.subject) + '<b style="color:' + (ok ? 'var(--ok)' : 'var(--bad)') + '">' + (ok ? '정답' : c ? '오답' : '미응답') + '</b></summary><div class="body">' +
        '<div class="kv"><b>내 답:</b> ' + (c ? MK[c - 1] + ' ' + esc(q.options[c - 1]) : '미응답') + '</div><div class="kv"><b>정답:</b> ' + MK[q.answer - 1] + ' ' + esc(q.options[q.answer - 1]) + '</div><div class="expl"><b>해설</b><br>' + esc(q.explanation) + '</div></div></details>';
    });
    return h + '<div class="stack"><button class="btn" type="button" data-a="go" data-v="wrong">오답노트 보기</button><button class="btn line" type="button" data-a="go" data-v="mock">모의고사 첫 화면</button></div>';
  }

  /* ───────── 이벤트 ───────── */
  var A = {
    go: function (el) { go(el.dataset.v); },
    setN: function (el) { UI.n = +el.dataset.v; render(); },
    startToday: function () {
      var p = plan(), n = p.target ? (p.done < p.target ? p.target - p.done : Math.min(10, p.target)) : (UI.n || 10);
      var ids = poolToday(Math.max(1, n));
      if (!ids.length) return toast('오늘 풀 수 있는 문제가 없습니다.');
      startQuiz(ids, '오늘의 학습');
    },
    startSubject: function (el) { var s = +el.dataset.v; startQuiz(cut(poolSubject(s)), s + '과목'); },
    startRandom: function () { startQuiz(cut(poolRandom()), '전체 랜덤'); },
    startWrong: function () { startQuiz(cut(poolWrong()), '오답 문제'); },
    startReview: function () { startQuiz(cut(reviewIds()), '맞춤형 복습'); },
    resume: function () { if (restoreSession()) go('quiz'); },
    pick: function (el) { if (Q && !Q.sub) { Q.sel = +el.dataset.v; render(); } },
    pickU: function (el) { if (Q && !Q.sub) { Q.u = +el.dataset.v; render(); } },
    submit: function () { submitAnswer(); render(); },
    next: function () { nextQuestion(); render(); },
    quit: function () { confirmBox('풀이를 그만둘까요? 이미 제출한 문제의 기록은 저장되어 있습니다.', '그만 풀기', function () { Q = null; lsDel(SKEY); go('practice'); }); },
    wrongS: function (el) { UI.wrongS = +el.dataset.v; render(); },
    rvS: function (el) { UI.rv.s = +el.dataset.v; render(); },
    rvMode: function (el) { UI.rv.mode = el.dataset.v; render(); },
    rvU: function (el) { UI.rv.u = el.value === 'any' ? 'any' : +el.value; render(); },
    rvW: function (el) { UI.rv.w = +el.value; render(); },
    saveSettings: saveSettings,
    setSrc: function (el) { UI.src = el.dataset.v; render(); },
    pickQ: function () { $('#fQ').click(); },
    tplDown: csvTemplate,
    delCustom: function () {
      confirmBox('업로드한 문제를 모두 삭제할까요? (내장 문제와 학습 기록은 그대로입니다. 삭제한 문제의 풀이 기록은 통계에서 제외됩니다)', '삭제', function () {
        idbWrite('questions', [], [], true).then(function () { CUSTOM_RAW = []; saveCustom(); toast('삭제했습니다.'); render(); });
      });
    },
    delGroup: function (el) {
      var k = el.dataset.v, del = CUSTOM_RAW.filter(function (q) { return groupKey(q) === k; }).map(function (q) { return q.id; });
      confirmBox('"' + k.replace('|', ' · ') + '" 문제 ' + del.length + '개를 삭제할까요?', '삭제', function () {
        idbWrite('questions', [], del).then(function () { CUSTOM_RAW = CUSTOM_RAW.filter(function (q) { return groupKey(q) !== k; }); saveCustom(); toast('삭제했습니다.'); render(); });
      });
    },
    stS: function (el) { UI.stS = +el.dataset.v; render(); },
    stAll: function () {
      var list = STAGE.filter(function (q) { return !UI.stS || q.subject === UI.stS; }).slice(0, 100);
      var all = list.every(function (q) { return UI.stSel[q.id]; });
      list.forEach(function (q) { if (all) delete UI.stSel[q.id]; else UI.stSel[q.id] = true; }); render();
    },
    stAdd: function () { stageMove(true); },
    stDel: function () { confirmBox('선택한 문제를 삭제할까요? (출제기준에 해당하지 않는 문제로 보고 버립니다)', '삭제', function () { stageMove(false); }); },
    export: function (el) { exportData(el.dataset.v === 'all'); },
    importPick: function () { $('#fFile').click(); },
    reset: function () {
      confirmBox('모든 학습 기록(풀이 기록, 오답노트, 이해도, 설정, 모의고사 기록)을 지웁니다. 되돌릴 수 없습니다. 계속할까요?', '전체 초기화', function () {
        lsDel(KEY); lsDel(SKEY); S = defaults(); cache = null; Q = null; M = null; toast('학습 기록을 초기화했습니다.'); go('home');
      });
    },
    startMockFull: function () { startMock('full'); },
    startMockMini: function () { startMock('mini'); },
    mpick: function (el) { var id = M.ids[M.i]; M.ans[id] = +el.dataset.v; render(); },
    mprev: function () { if (M.i > 0) { M.i--; render(); } },
    mnext: function () { if (M.i < M.ids.length - 1) { M.i++; render(); } },
    mjump: function (el) { M.i = +el.dataset.v; render(); },
    msubmit: function () {
      var un = M.ids.filter(function (id) { return !M.ans[id]; }).length;
      confirmBox((un ? '풀지 않은 문제가 ' + un + '개 있습니다. ' : '') + '제출하고 채점할까요?', '제출', function () { finishMock(false); });
    },
    modalNo: function () { var m = $('#modal'); if (m) m.remove(); },
    modalYes: function () { var m = $('#modal'); if (!m) return; var f = m._fn; m.remove(); if (f) f(); }
  };
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-a]');
    if (!el || el.tagName === 'SELECT' || el.disabled) return;
    var fn = A[el.dataset.a]; if (fn) fn(el);
  });
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el.id === 'fQ' && el.files && el.files.length) {
      var fl = Array.prototype.slice.call(el.files); el.value = ''; uploadFiles(fl); return;
    }
    if (el.classList && el.classList.contains('stChk')) { if (el.checked) UI.stSel[el.value] = true; else delete UI.stSel[el.value]; render(); return; }
    if (el.id === 'fFile' && el.files && el.files[0]) {
      var rd = new FileReader(); rd.onload = function () { importData(String(rd.result)); }; rd.readAsText(el.files[0]); el.value = ''; return;
    }
    if (el.tagName === 'SELECT' && el.dataset.a && A[el.dataset.a]) A[el.dataset.a](el);
  });
  window.addEventListener('hashchange', render);
  window.addEventListener('beforeunload', function () { if (M) { /* 모의고사는 새로고침 시 중단됩니다 */ } });
  if (!lsGet('ssm-probe')) lsSet('ssm-probe', '1');

  /* ───────── 시작: IndexedDB에서 업로드 문제를 불러온 뒤 화면을 그린다 ───────── */
  function legacyCustom() {   // 이전 버전(LocalStorage)에 저장했던 추가 문제
    try { var a = JSON.parse(lsGet(CKEY)); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function boot() {
    idbOpen().then(function (db) {
      DB = db;
      return Promise.all([idbAll('questions'), idbAll('staging')]);
    }).then(function (r) {
      CUSTOM_RAW = r[0].filter(function (q) { return !validate(q); });
      STAGE = r[1].filter(function (q) { return !validate(q); });
      var old = backupQuestions(legacyCustom()).filter(function (q) { return !CUSTOM_RAW.some(function (c) { return c.id === q.id; }); });
      old = old.filter(function (q) { return !needsScope(q); });
      if (old.length) {
        CUSTOM_RAW = CUSTOM_RAW.concat(old);
        if (DB) idbWrite('questions', old).then(function (ok) { if (ok) lsDel(CKEY); });
      } else if (DB && lsGet(CKEY)) lsDel(CKEY);
      rebuild();
      if (navigator.storage && navigator.storage.persist) { try { navigator.storage.persist(); } catch (e) {} }
      if (!location.hash) location.hash = '#/home'; else render();
    });
  }
  boot();
})();
