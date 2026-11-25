/* 내장 문제은행 검사: node tools/validate-questions.js
 * data/questions*.js 를 읽어 형식·중복·정답 분포를 점검합니다. (외부 통신 없음) */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = path.join(__dirname, '..', 'data');
const ctx = { window: {} }; vm.createContext(ctx);
fs.readdirSync(dir).filter(f => /^questions.*\.js$/.test(f)).sort((a, b) => (a === 'questions.js' ? -1 : b === 'questions.js' ? 1 : a < b ? -1 : 1)).forEach(f => {
  try { vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }); }
  catch (e) { console.error('구문 오류', f, e.message); process.exit(1); }
});
const all = ctx.window.SSM_QUESTIONS || [];
const errs = [], seen = {}, qtext = {};
const KINDS = ['기출', '기출복원', '자체 제작 예상문제', '자체 제작 연습문제'];
all.forEach(q => {
  const id = q.subject + '-' + q.num, at = '[' + id + '] ';
  if (![1, 2, 3].includes(q.subject)) errs.push(at + 'subject');
  if (!Number.isInteger(q.num) || q.num < 1) errs.push(at + 'num');
  if (seen[id]) errs.push(at + '번호 중복'); seen[id] = 1;
  if (typeof q.question !== 'string' || q.question.trim().length < 8) errs.push(at + 'question');
  if (!Array.isArray(q.options) || q.options.length !== 4 || q.options.some(o => typeof o !== 'string' || !o.trim())) errs.push(at + 'options');
  else if (new Set(q.options.map(o => o.trim())).size !== 4) errs.push(at + '보기 중복');
  if (![1, 2, 3, 4].includes(q.answer)) errs.push(at + 'answer');
  if (typeof q.explanation !== 'string' || q.explanation.trim().length < 15) errs.push(at + 'explanation 너무 짧음');
  if (typeof q.concept !== 'string' || !q.concept.trim()) errs.push(at + 'concept');
  if (!KINDS.includes(q.kind)) errs.push(at + 'kind');
  if (q.kind === '기출' || q.kind === '기출복원') errs.push(at + '내장 문제에 기출을 넣으면 안 됩니다(공개 저장소)');
  const k = (q.question || '').replace(/\s+/g, '');
  if (qtext[k]) errs.push(at + '문제 문장이 ' + qtext[k] + ' 과 같음'); qtext[k] = id;
});
[1, 2, 3].forEach(s => {
  const a = all.filter(q => q.subject === s), d = [0, 0, 0, 0, 0];
  a.forEach(q => d[q.answer]++);
  const nums = a.map(q => q.num).sort((x, y) => x - y);
  console.log(s + '과목 ' + a.length + '문제 · 정답 분포 ①' + d[1] + ' ②' + d[2] + ' ③' + d[3] + ' ④' + d[4] + ' · 번호 ' + nums[0] + '~' + nums[nums.length - 1]);
});
console.log('총 ' + all.length + '문제, 오류 ' + errs.length + '건');
errs.forEach(e => console.log(' - ' + e));
process.exit(errs.length ? 1 : 0);
