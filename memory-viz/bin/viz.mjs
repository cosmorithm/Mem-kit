#!/usr/bin/env node
// memory-viz：把记忆单元渲染成一个自包含的进度页。零依赖、无外链、可直接打印。
// 依赖同级目录的 memory-kit（读取单元的方式必须和校验器完全一致）。
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import {
  loadMemoryUnits,
  collectOpenItems,
  collectFactTables,
  collectTasks,
  KIT_VERSION,
} from '../../memory-kit/lib/memory.mjs';

const argv = process.argv.slice(2);
const valueOf = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const next = argv[index + 1];
  return next && !next.startsWith('--') ? next : true;
};
const has = (name) => argv.includes(`--${name}`);

const configFile = path.resolve(String(valueOf('config', 'memory/memory.config.json')));
const outFile = path.resolve(String(valueOf('out', path.join(path.dirname(configFile), 'progress.html'))));
const mode = has('local') ? 'local' : 'public';

const esc = (text = '') =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const days = (date) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
  return Math.max(0, Math.round((Date.now() - new Date(`${date}T00:00:00Z`).getTime()) / 86400000));
};

const units = loadMemoryUnits(configFile, { mode });
const evidence = { E0: 0, E1: 0, E2: 0, E3: 0, E4: 0 };
const allTasks = [];

for (const { unit } of units) {
  for (const table of collectFactTables(unit)) {
    for (const row of table.rows) {
      const hit = row.find((cell) => /E[0-4]/.test(cell));
      const match = hit && /E([0-4])/.exec(hit);
      if (match) evidence[`E${match[1]}`] += 1;
    }
  }
  for (const task of collectTasks(unit)) {
    const match = /E([0-4])/.exec(task.evidence || '');
    if (match) evidence[`E${match[1]}`] += 1;
    allTasks.push({ ...task, unit: unit.meta.title, unitId: unit.meta.id });
  }
}

const byDate = new Map();
for (const task of allTasks) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(task.date)) continue;
  byDate.set(task.date, (byDate.get(task.date) || 0) + 1);
}
const dates = [...byDate.keys()].sort();
const series = [];
if (dates.length) {
  const start = new Date(`${dates[0]}T00:00:00Z`);
  const end = new Date(`${dates[dates.length - 1]}T00:00:00Z`);
  for (const day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    const key = day.toISOString().slice(0, 10);
    series.push({ date: key, count: byDate.get(key) || 0 });
  }
}
const cumulative = series.reduce((list, point) => {
  list.push((list[list.length - 1] || 0) + point.count);
  return list;
}, []);
const doneCount = allTasks.length;
const maxDaily = Math.max(1, ...series.map((point) => point.count));
const weekly = allTasks.filter((task) => {
  const when = new Date(`${task.date}T00:00:00Z`).getTime();
  return Number.isFinite(when) && Date.now() - when <= 7 * 86400000;
}).length;

const cards = units.map(({ entry, unit, validation }) => {
  const tasks = collectTasks(unit).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const open = collectOpenItems(unit);
  const total = tasks.length + open.length;
  const ratio = total ? Math.round((tasks.length / total) * 100) : 0;
  const age = days(unit.meta.verified || unit.meta.updated);
  const state = validation.errors.length ? 'err' : validation.warnings.length ? 'warn' : 'ok';
  return { entry, unit, validation, tasks, open, ratio, age, state };
});

const doneTotal = cards.reduce((sum, card) => sum + card.tasks.length, 0);
const openTotal = cards.reduce((sum, card) => sum + card.open.length, 0);
const errTotal = cards.reduce((sum, card) => sum + card.validation.errors.length, 0);
const evidenceMax = Math.max(1, ...Object.values(evidence));

function renderChart(points, totals, peak, sum) {
  const W = 960, H = 230, L = 60, R = 34, T = 34, B = 34;
  const innerH = H - T - B;
  const count = points.length;
  const barW = count > 1 ? 14 : 18;
  const plotL = L + barW / 2;
  const plotR = W - R - barW / 2;
  const innerW = plotR - plotL;
  const xAt = (index) => plotL + (count > 1 ? (index * innerW) / (count - 1) : innerW / 2);
  const yBar = (value) => T + innerH - (value / peak) * innerH;
  const yLine = (value) => T + innerH - (value / Math.max(1, sum)) * innerH;
  const bars = points.map((point, index) => (point.count
    ? `<rect x="${(xAt(index) - barW / 2).toFixed(1)}" y="${yBar(point.count).toFixed(1)}" width="${barW}" height="${(T + innerH - yBar(point.count)).toFixed(1)}" rx="2" fill="#b8c4d4"><title>${esc(point.date)} · ${point.count} 项</title></rect>`
    : '')).join('');
  // 从 0 起笔：第一天的增量画成一段竖线，否则累计曲线会像一条平线
  const path = [
    `M${xAt(0).toFixed(1)},${yLine(0).toFixed(1)}`,
    `L${xAt(0).toFixed(1)},${yLine(totals[0]).toFixed(1)}`,
    ...totals.slice(1).map((value, index) => `L${xAt(index + 1).toFixed(1)},${yLine(value).toFixed(1)}`),
  ].join(' ');
  const dots = points.map((point, index) => (point.count
    ? `<circle cx="${xAt(index).toFixed(1)}" cy="${yLine(totals[index]).toFixed(1)}" r="2.8" fill="#0f766e"><title>${esc(point.date)} · 累计 ${totals[index]}</title></circle>`
    : '')).join('');
  const grid = [0, 0.5, 1].map((ratio) => `<line x1="${L}" y1="${(T + innerH * ratio).toFixed(1)}" x2="${W - R}" y2="${(T + innerH * ratio).toFixed(1)}" stroke="#ececea" stroke-width="1"/>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="任务积累曲线">
    ${grid}
    ${bars}
    <path d="${path}" fill="none" stroke="#0f766e" stroke-width="2" stroke-linejoin="round"/>
    ${dots}
    <text x="${L}" y="${T - 14}" font-size="11" fill="#94a3b8">柱=当日完成 · 峰值 ${peak} 项</text>
    <text x="${W - R}" y="${T - 14}" font-size="11" fill="#0f766e" text-anchor="end">线=累计 ${sum} 项</text>
    <text x="${L}" y="${H - 10}" font-size="11" fill="#6b6f76">${esc(points[0].date)}</text>
    <text x="${W - R}" y="${H - 10}" font-size="11" fill="#6b6f76" text-anchor="end">${esc(points[count - 1].date)}</text>
  </svg>`;
}

const unitCard = (card) => {
  const { entry, unit, tasks, open, ratio, age, state, validation } = card;
  const taskRows = tasks.slice(0, 6).map((task) => `
        <li><time>${esc(task.date)}</time><span class="t">${esc(task.task)}</span>${task.evidence ? `<em class="ev">${esc(task.evidence)}</em>` : ''}</li>`).join('');
  const todo = open.filter((item) => item.source !== 'facts');
  const check = open.filter((item) => item.source === 'facts');
  const openRows = [...todo.slice(0, 5), ...check.slice(0, 4)].map((item) => `
        <li><span class="t">${esc(item.text)}</span><em class="where">${item.source === 'facts' ? '待核对' : '待办'} · ${esc(item.where)}</em></li>`).join('');
  return `
    <article class="unit ${state}">
      <header>
        <h2>${esc(unit.meta.title)}</h2>
        <span class="kind">${esc(unit.meta.kind)}</span>
        <span class="age">核对 ${esc(unit.meta.verified || unit.meta.updated)}${age === null ? '' : ` · ${age} 天前`}</span>
      </header>
      <div class="bar" title="完成 ${tasks.length} · 未完成 ${open.length}"><span style="width:${ratio}%"></span></div>
      <p class="counts"><strong>${tasks.length}</strong> 完成 · <strong>${open.length}</strong> 未完成 · ${validation.errors.length} 错误 · ${validation.warnings.length} 警告</p>
      ${tasks.length ? `<div class="col"><h3>最近完成</h3><ul>${taskRows}</ul></div>` : ''}
      ${open.length ? `<div class="col"><h3>未完成</h3><ul>${openRows}</ul></div>` : ''}
    </article>`;
};

const timeline = allTasks
  .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  .slice(0, 40)
  .map((task) => `<li><time>${esc(task.date)}</time><span class="u">${esc(task.unit)}</span><span class="t">${esc(task.task)}</span>${task.evidence ? `<em class="ev">${esc(task.evidence)}</em>` : ''}</li>`)
  .join('');

const evidenceBars = Object.entries(evidence).map(([level, count]) => `
      <div class="evrow"><b>${level}</b><span class="evbar"><i style="width:${Math.round((count / evidenceMax) * 100)}%"></i></span><em>${count}</em></div>`).join('');

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>记忆进度</title>
<style>
  :root{--bg:#f7f7f5;--card:#fff;--ink:#1c1d20;--dim:#6b6f76;--line:#e3e3df;--accent:#0f766e;--warn:#b45309;--err:#b91c1c}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
  .wrap{max-width:1080px;margin:0 auto;padding:40px 22px 60px}
  h1{font-size:30px;margin:0 0 6px;letter-spacing:-.02em}
  .meta{color:var(--dim);margin:0 0 28px;font-size:13px}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:28px}
  .stat{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
  .stat b{display:block;font-size:26px;line-height:1.2}
  .stat span{color:var(--dim);font-size:12px}
  section{margin-bottom:34px}
  h2{font-size:15px;text-transform:uppercase;letter-spacing:.08em;color:var(--dim);margin:0 0 12px;font-weight:600}
  .unit{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin-bottom:14px;border-left:4px solid var(--accent)}
  .unit.warn{border-left-color:var(--warn)}.unit.err{border-left-color:var(--err)}
  .unit header{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
  .unit h2{all:unset;font-size:18px;font-weight:650}
  .kind{font-size:11px;color:var(--dim);border:1px solid var(--line);border-radius:99px;padding:1px 8px}
  .age{margin-left:auto;font-size:12px;color:var(--dim)}
  .bar{height:7px;background:#ececea;border-radius:99px;margin:14px 0 8px;overflow:hidden}
  .bar span{display:block;height:100%;background:linear-gradient(90deg,#0f766e,#14b8a6);border-radius:99px}
  .counts{margin:0 0 12px;font-size:12.5px;color:var(--dim)}
  .col{margin-top:12px}
  .col h3{font-size:12px;color:var(--dim);margin:0 0 6px;font-weight:600}
  ul{list-style:none;margin:0;padding:0}
  li{display:flex;gap:10px;align-items:baseline;padding:4px 0;border-bottom:1px dashed #efefec}
  li:last-child{border-bottom:0}
  time{font-variant-numeric:tabular-nums;color:var(--dim);font-size:12px;min-width:78px}
  .t{flex:1}
  .u{font-size:12px;color:var(--dim);min-width:120px}
  .where{font-size:11px;color:var(--dim);font-style:normal}
  .ev{font-style:normal;font-size:11px;color:var(--accent);border:1px solid #cfe9e5;border-radius:4px;padding:0 5px}
  .evrow{display:flex;align-items:center;gap:10px;margin:6px 0;font-size:12px}
  .evrow b{min-width:26px;color:var(--dim);font-weight:600}
  .evbar{flex:1;height:8px;background:#ececea;border-radius:99px;overflow:hidden}
  .evbar i{display:block;height:100%;background:#64748b}
  .evrow em{font-style:normal;min-width:28px;text-align:right;color:var(--dim)}
  footer{color:var(--dim);font-size:12px;border-top:1px solid var(--line);padding-top:14px}
  @media print{body{background:#fff}.unit{break-inside:avoid}}
</style>
</head>
<body>
<div class="wrap">
  <h1>记忆进度</h1>
  <p class="meta">生成于 ${new Date().toISOString().slice(0, 10)} · memory-kit ${esc(KIT_VERSION)} · 模式 ${mode} · 来源 ${esc(path.basename(configFile))}</p>

  <div class="stats">
    <div class="stat"><b>${cards.length}</b><span>记忆单元</span></div>
    <div class="stat"><b>${doneTotal}</b><span>已完成任务</span></div>
    <div class="stat"><b>${openTotal}</b><span>未完成项</span></div>
    <div class="stat"><b>${weekly}</b><span>近 7 天完成</span></div>
    <div class="stat"><b>${errTotal}</b><span>契约错误</span></div>
  </div>

  <section><h2>单元</h2>${cards.map(unitCard).join('')}</section>

  ${series.length ? `<section><h2>任务积累</h2><div class="unit">${renderChart(series, cumulative, maxDaily, doneCount)}<p class="counts">共 ${doneCount} 项 · 跨越 ${series.length} 天 · 日均 ${(doneCount / series.length).toFixed(2)} 项 · 近 7 天 ${weekly} 项</p></div></section>` : ''}

  ${timeline ? `<section><h2>任务时间线</h2><div class="unit"><ul>${timeline}</ul></div></section>` : ''}

  <section><h2>证据分布</h2><div class="unit">${evidenceBars}</div></section>

  <footer>由 memory-viz 生成 · 数据来自 ${cards.length} 个单元的 unit.md · 不修改任何文件</footer>
</div>
</body>
</html>
`;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, html);
console.log(`✓ 已生成 ${path.relative(process.cwd(), outFile)}（${cards.length} 个单元 · ${doneTotal} 完成 · ${openTotal} 未完成 · ${(html.length / 1024).toFixed(1)} KB）`);
if (has('open')) execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [outFile]);
