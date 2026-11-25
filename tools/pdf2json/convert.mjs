#!/usr/bin/env node
/* PDF 문제 자료 → Study Master 업로드용 JSON 일괄 변환기
 *
 * 사용법:  node convert.mjs <PDF 파일 또는 폴더>... [옵션]
 * 이 프로그램은 PDF를 내 PC에서만 읽습니다. 네트워크를 쓰지 않으며 결과는 로컬 폴더에 저장됩니다.
 * 변환 결과(기출·교재 문제)는 공개 저장소에 올리지 마세요(.gitignore가 converted/ 를 제외합니다).
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HELP = `PDF 문제 자료를 JSON으로 변환합니다.

  node convert.mjs <PDF|폴더>... [옵션]

옵션
  --out <폴더>            결과 저장 폴더 (기본 ./converted)
  --year <연도>           출제 연도 (기본: 파일 이름에서 20xx 를 찾음)
  --round <회차>          회차 (기본: 파일 이름의 "n회" 또는 연도 뒤 숫자)
  --kind <구분>           기출 | 기출복원 | "자체 제작 예상문제" (기본 기출복원)
  --source <출처>         출처 문구 (기본 "PDF: 파일이름"). 이용 허락 조건을 적어 두세요
  --subject-ranges <값>   문항 번호 → 과목 (예: 1-30:1,31-60:2,61-100:3)
                          기본: 최대 번호가 100이면 30/30/40, 80이면 25/25/30
  --columns <1|2>         2단 편집 PDF면 2 (기본 1)
  --scope-nums <번호들>   2022년 이전 문제 중 2027 출제기준에 해당하는 문항 번호 (예: 1-5,12,40-45)
                          지정한 번호에만 scope2027:true 가 붙습니다
  --csv                   JSON과 함께 CSV도 저장
  -h, --help              도움말

인식하는 형식
  - 문제 번호:  "1." "1)" 로 시작하는 줄 (번호는 1부터 차례로 증가해야 함)
  - 보기:       ① ② ③ ④ (❶~❹ 도 가능)
  - 정답:       문제 바로 뒤의 "정답 ③" / "[정답] ③" / "답: ③"  또는  끝부분 "정답표" 의 "1. ③ 2. ① ..."
  - 해설:       문제 뒤의 "해설: ..." (없으면 정답만 있는 문제로 저장)
  그림·표·수식이 이미지인 문제, 스캔본 PDF(텍스트 없음)는 변환되지 않습니다(*.problems.json 에 기록).
  변환 후 반드시 결과를 원본과 대조해 확인하세요.
`;

const CIRC = { '①': 1, '②': 2, '③': 3, '④': 4, '❶': 1, '❷': 2, '❸': 3, '❹': 4 };
const CIRC_RE = /[①②③④❶❷❸❹]/g;

/* ───── 인자 ───── */
function parseArgs(argv) {
  const o = { inputs: [], out: 'converted', kind: '기출복원', columns: 1, csv: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], val = () => { if (i + 1 >= argv.length) fail(a + ' 값이 없습니다'); return argv[++i]; };
    if (a === '-h' || a === '--help') { console.log(HELP); process.exit(0); }
    else if (a === '--out') o.out = val();
    else if (a === '--year') o.year = Number(val());
    else if (a === '--round') o.round = Number(val());
    else if (a === '--kind') o.kind = val();
    else if (a === '--source') o.source = val();
    else if (a === '--subject-ranges') o.ranges = parseRanges(val());
    else if (a === '--columns') o.columns = Number(val());
    else if (a === '--scope-nums') o.scope = parseNums(val());
    else if (a === '--csv') o.csv = true;
    else if (a.startsWith('--')) fail('알 수 없는 옵션: ' + a);
    else o.inputs.push(a);
  }
  if (!o.inputs.length) { console.log(HELP); process.exit(1); }
  if (!['기출', '기출복원', '자체 제작 예상문제'].includes(o.kind)) fail('--kind 는 기출 | 기출복원 | "자체 제작 예상문제" 중 하나여야 합니다');
  if (![1, 2].includes(o.columns)) fail('--columns 는 1 또는 2');
  return o;
}
function fail(m) { console.error('오류: ' + m); process.exit(1); }
function parseNums(s) {
  const set = new Set();
  s.split(',').forEach(p => { const m = p.trim().match(/^(\d+)(?:-(\d+))?$/); if (!m) fail('번호 형식 오류: ' + p); for (let n = +m[1]; n <= +(m[2] || m[1]); n++) set.add(n); });
  return set;
}
function parseRanges(s) {
  return s.split(',').map(p => { const m = p.trim().match(/^(\d+)-(\d+):([123])$/); if (!m) fail('--subject-ranges 형식 오류: ' + p); return { from: +m[1], to: +m[2], subject: +m[3] }; });
}
function defaultRanges(max) {
  if (max === 100) return [{ from: 1, to: 30, subject: 1 }, { from: 31, to: 60, subject: 2 }, { from: 61, to: 100, subject: 3 }];
  if (max === 80) return [{ from: 1, to: 25, subject: 1 }, { from: 26, to: 50, subject: 2 }, { from: 51, to: 80, subject: 3 }];
  return null;
}
function listPdfs(inputs) {
  const out = [];
  const walk = p => {
    if (!fs.existsSync(p)) fail('없는 경로: ' + p);
    const st = fs.statSync(p);
    if (st.isDirectory()) fs.readdirSync(p).sort().forEach(f => walk(path.join(p, f)));
    else if (/\.pdf$/i.test(p)) out.push(p);
  };
  inputs.forEach(walk);
  return out;
}

/* ───── PDF 텍스트 추출 ───── */
let pdfjs = null;
async function loadPdfjs() {
  if (!pdfjs) pdfjs = await import(pathToFileURL(path.join(import.meta.dirname, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href);
  return pdfjs;
}
function linesFromItems(items) {
  const rows = [];
  items.forEach(it => {
    if (!it.str || !it.str.trim()) return;
    const y = it.transform[5], x = it.transform[4];
    let r = rows.find(r => Math.abs(r.y - y) < 3);
    if (!r) rows.push(r = { y, cells: [] });
    r.cells.push({ x, w: it.width || 0, s: it.str });
  });
  rows.sort((a, b) => b.y - a.y);
  return rows.map(r => {
    r.cells.sort((a, b) => a.x - b.x);
    let s = '', end = null;
    r.cells.forEach(c => { if (end !== null && c.x - end > 1.5 && !s.endsWith(' ')) s += ' '; s += c.s; end = c.x + c.w; });
    return s.replace(/\s+/g, ' ').trim();
  }).filter(Boolean);
}
async function extractLines(file, columns) {
  const { getDocument } = await loadPdfjs();
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await getDocument({ data, useSystemFonts: true, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p), vp = page.getViewport({ scale: 1 }), tc = await page.getTextContent();
    if (columns === 2) {
      const mid = vp.width / 2;
      lines.push(...linesFromItems(tc.items.filter(i => i.transform[4] < mid)), ...linesFromItems(tc.items.filter(i => i.transform[4] >= mid)));
    } else lines.push(...linesFromItems(tc.items));
  }
  return { lines, pages: doc.numPages };
}

/* ───── 문제 파싱 ───── */
const KEY_HEAD = /^(정답표|정답\s*및\s*해설|최종\s*정답|가답안|정답지|답안지?|정답)\s*$/;
function answerOf(s) {
  const m = s.match(/[①②③④❶❷❸❹]|(?<![\d])[1-4](?![\d])/);
  return m ? (CIRC[m[0]] || +m[0]) : null;
}
function parseKey(lines) {
  // 끝부분의 정답표 영역을 찾는다
  let idx = -1;
  lines.forEach((l, i) => { if (KEY_HEAD.test(l)) idx = i; });
  if (idx < 0) return { key: {}, cutAt: lines.length };
  const text = lines.slice(idx + 1).join(' '), key = {};
  for (const m of text.matchAll(/(\d{1,3})\s*[.):\-]?\s*([①②③④❶❷❸❹])/g)) key[+m[1]] = CIRC[m[2]];
  if (!Object.keys(key).length) for (const m of text.matchAll(/(\d{1,3})\s*[.):\-]\s*([1-4])(?!\d)/g)) key[+m[1]] = +m[2];
  return { key, cutAt: Object.keys(key).length ? idx : lines.length };
}
function splitBlocks(lines) {
  const blocks = []; let expect = null, cur = null;
  lines.forEach(l => {
    const m = l.match(/^(\d{1,3})\s*[.)]\s*(.*)$/);
    if (m && (expect === null ? +m[1] === 1 || !blocks.length : +m[1] === expect)) {
      cur = { n: +m[1], text: m[2] }; blocks.push(cur); expect = cur.n + 1; return;
    }
    if (cur) cur.text += '\n' + l;
  });
  return blocks;
}
function parseBlock(b, key) {
  const t = b.text;
  const marks = [...t.matchAll(CIRC_RE)].map(m => ({ i: m.index, d: CIRC[m[0]] }));
  // ①②③④ 가 차례로 나오는 첫 묶음을 찾는다
  let start = -1;
  for (let k = 0; k + 3 < marks.length; k++) if (marks[k].d === 1 && marks[k + 1].d === 2 && marks[k + 2].d === 3 && marks[k + 3].d === 4) { start = k; break; }
  if (start < 0) return { err: '보기 ①~④를 찾지 못했습니다(그림·표 문제이거나 보기 형식이 다름)' };
  const m4 = marks.slice(start, start + 4), clean = s => s.replace(/\s+/g, ' ').trim();
  const question = clean(t.slice(0, m4[0].i));
  let tail = t.slice(m4[3].i + 1), expl = '', ans = null;
  const opts = [clean(t.slice(m4[0].i + 1, m4[1].i)), clean(t.slice(m4[1].i + 1, m4[2].i)), clean(t.slice(m4[2].i + 1, m4[3].i)), null];
  // 마지막 보기 뒤의 정답·해설 분리
  const am = tail.match(/(?:\[?\s*정답\s*\]?|답)\s*[:：]?\s*([①②③④❶❷❸❹]|[1-4])/);
  const hm = tail.match(/(?:\[?\s*해설\s*\]?)\s*[:：]?\s*/);
  let cutAt = tail.length;
  if (am) { ans = answerOf(am[1]); cutAt = Math.min(cutAt, am.index); }
  if (hm) { expl = clean(tail.slice(hm.index + hm[0].length)); cutAt = Math.min(cutAt, hm.index); }
  if (am && hm && am.index > hm.index) expl = clean(tail.slice(hm.index + hm[0].length, am.index));
  opts[3] = clean(tail.slice(0, cutAt));
  if (ans === null && key[b.n]) ans = key[b.n];
  if (!question) return { err: '문제 문장이 비어 있습니다' };
  if (opts.some(o => !o)) return { err: '비어 있는 보기가 있습니다' };
  if (!ans) return { err: '정답을 찾지 못했습니다' };
  return { question, options: opts, answer: ans, explanation: expl };
}

function metaFromName(name) {
  const base = path.basename(name, path.extname(name)), y = base.match(/(20\d{2})/);
  let r = base.match(/(\d)\s*[회차]/);
  if (!r && y) r = base.slice(y.index + 4).match(/[^\d](\d)(?!\d)/);
  return { year: y ? +y[1] : undefined, round: r ? +r[1] : undefined };
}
function csvCell(v) { v = v === undefined || v === null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }

async function convertOne(file, o) {
  const res = { file, ok: [], bad: [], notes: [] };
  const { lines, pages } = await extractLines(file, o.columns);
  if (!lines.join('').replace(/\s/g, '').length) { res.notes.push(pages + '쪽 모두 텍스트가 없습니다. 스캔본이면 OCR 후 다시 시도하세요.'); return res; }
  const { key, cutAt } = parseKey(lines);
  const blocks = splitBlocks(lines.slice(0, cutAt));
  if (!blocks.length) { res.notes.push('문제 번호(1. 2. …)를 찾지 못했습니다.'); return res; }
  const max = Math.max(...blocks.map(b => b.n)), ranges = o.ranges || defaultRanges(max);
  if (!ranges) { res.notes.push('문항이 ' + max + '개라 과목을 나눌 수 없습니다. --subject-ranges 를 지정하세요. (예: 1-30:1,31-60:2,61-100:3)'); return res; }
  const nm = metaFromName(file), year = o.year || nm.year, round = o.round || nm.round;
  if (o.kind !== '자체 제작 예상문제' && !year) { res.notes.push('연도를 알 수 없습니다. --year 를 지정하세요.'); return res; }
  const source = o.source || 'PDF: ' + path.basename(file);
  blocks.forEach(b => {
    const rg = ranges.find(r => b.n >= r.from && b.n <= r.to);
    if (!rg) { res.bad.push({ n: b.n, reason: '과목 범위에 없는 번호', raw: b.text }); return; }
    const p = parseBlock(b, key);
    if (p.err) { res.bad.push({ n: b.n, subject: rg.subject, reason: p.err, raw: b.text }); return; }
    const q = { subject: rg.subject, num: b.n, question: p.question, options: p.options, answer: p.answer,
      explanation: p.explanation || '(원본 자료에 해설이 없습니다. 정답: ' + '①②③④'[p.answer - 1] + '번)', concept: '', kind: o.kind };
    if (year) q.year = year;
    if (round) q.round = round;
    q.source = source;
    if (year && year <= 2022 && o.kind !== '자체 제작 예상문제') q.scope2027 = !!(o.scope && o.scope.has(b.n));
    res.ok.push(q);
  });
  const missing = []; for (let n = 1; n <= max; n++) if (!blocks.some(b => b.n === n)) missing.push(n);
  if (missing.length) res.notes.push('번호가 빠졌습니다: ' + missing.join(', '));
  const noKey = res.ok.filter(q => !q.explanation).length; void noKey;
  return res;
}

async function main() {
  const o = parseArgs(process.argv.slice(2)), files = listPdfs(o.inputs);
  if (!files.length) fail('PDF 파일이 없습니다.');
  fs.mkdirSync(o.out, { recursive: true });
  const report = ['PDF → JSON 변환 보고 (' + new Date().toLocaleString('ko-KR') + ')', ''];
  let total = 0, totalBad = 0;
  for (const f of files) {
    let r;
    try { r = await convertOne(f, o); } catch (e) { r = { file: f, ok: [], bad: [], notes: ['읽기 실패: ' + e.message] }; }
    const base = path.join(o.out, path.basename(f, path.extname(f)));
    if (r.ok.length) {
      fs.writeFileSync(base + '.json', JSON.stringify(r.ok, null, 2), 'utf8');
      if (o.csv) {
        const cols = ['subject', 'num', 'question', 'option1', 'option2', 'option3', 'option4', 'answer', 'explanation', 'concept', 'kind', 'year', 'round', 'source', 'scope2027'];
        const rows = r.ok.map(q => cols.map(c => c.startsWith('option') ? q.options[+c.slice(6) - 1] : q[c]).map(csvCell).join(','));
        fs.writeFileSync(base + '.csv', '﻿' + cols.join(',') + '\n' + rows.join('\n') + '\n', 'utf8');
      }
    }
    if (r.bad.length) fs.writeFileSync(base + '.problems.json', JSON.stringify(r.bad, null, 2), 'utf8');
    total += r.ok.length; totalBad += r.bad.length;
    const line = path.basename(f) + ': 변환 ' + r.ok.length + '문제, 확인 필요 ' + r.bad.length + '문제';
    console.log(line); report.push(line);
    r.notes.forEach(n => { console.log('  - ' + n); report.push('  - ' + n); });
    r.bad.slice(0, 10).forEach(b => { const s = '  - ' + b.n + '번: ' + b.reason; console.log(s); report.push(s); });
    if (r.bad.length > 10) { const s = '  - …외 ' + (r.bad.length - 10) + '건 (*.problems.json 참고)'; console.log(s); report.push(s); }
    if (r.ok.some(q => q.scope2027 === false)) { const s = '  - 2022년 이전 문제입니다. 2027 출제기준에 해당하는 문항은 --scope-nums 로 지정하거나, 앱의 "출제기준 선별 대기"에서 고르세요.'; console.log(s); report.push(s); }
  }
  report.push('', '합계: 변환 ' + total + ' / 확인 필요 ' + totalBad);
  fs.writeFileSync(path.join(o.out, 'convert-report.txt'), report.join('\n'), 'utf8');
  console.log('\n합계: 변환 ' + total + ', 확인 필요 ' + totalBad + ' → ' + path.resolve(o.out));
  console.log('결과 JSON을 원본과 대조한 뒤, 사이트 설정 화면에서 업로드하세요. (공개 저장소에 올리지 마세요)');
}
main().catch(e => { console.error(e); process.exit(1); });
