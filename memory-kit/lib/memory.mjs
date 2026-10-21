// Memory Kit — 通用记忆单元内核（零依赖，Node 18+）。
// 契约见 ../SPEC.md。本文件不含任何项目特定内容：路径、课程名、样式都由配置和单元头部提供。
import fs from 'node:fs';
import path from 'node:path';

/** 本工具版本，读自 memory-kit/VERSION；拷到别处时随目录一起走。 */
export const KIT_VERSION = (() => {
  try {
    return fs.readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim();
  } catch {
    return 'unknown';
  }
})();

/** 本工具支持的契约版本。升级契约时先扩充这个列表，再改解析分支。 */
export const SUPPORTED_CONTRACTS = [1];

export const UNIT_KINDS = ['course', 'paper', 'practice', 'project', 'reference'];
export const CHAPTER_KINDS = ['guide', 'facts', 'session', 'pitfalls', 'plan', 'refs', 'tasks'];
export const VISIBILITIES = ['local', 'public'];

export const EVIDENCE = {
  E0: { label: '计划或推测', rule: '尚未执行，或只是设想' },
  E1: { label: '文档', rule: '官方文档、规范或论文的通用说明' },
  E2: { label: '源码或日志', rule: '本机版本的源码，或某一次真实运行的终端输出' },
  E3: { label: '产物或模拟', rule: '磁盘上存在的产物，或隔离运行的模拟测试' },
  E4: { label: '实机人工确认', rule: '在真实设备或真实环境中由人确认过' },
};

export class MemoryError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'MemoryError';
    this.details = details;
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VAR = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const MASK = (name) => `‹${name}›`;

const escapeHtml = (value = '') =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const stripTags = (html = '') =>
  String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const daysBetween = (from, to) => Math.max(0, Math.round((to - from) / 86400000));

/* ---------------------------------------------------------------- 头部与变量 */

/** 拆出 <!--memory {...} --> 头部，返回 { meta, body, errors }。 */
export function splitFrontMatter(text) {
  const source = String(text).replace(/^\uFEFF/, '');
  const errors = [];
  const match = /^[ \t]*\r?\n?<!--\s*memory\b([\s\S]*?)-->[ \t]*\r?\n?/.exec(source);
  if (!match) {
    return { meta: null, body: source, errors: ['缺少 <!--memory {...} --> 头部；每个单元文件都必须以契约元数据开头。'] };
  }
  let meta = null;
  try {
    meta = JSON.parse(match[1]);
  } catch (error) {
    errors.push(`单元头部不是合法 JSON：${error.message}`);
  }
  return { meta, body: source.slice(match[0].length), errors };
}

/** 变量替换：public 模式一律遮蔽，local 模式取真值。 */
export function substituteVars(text, vars = {}, { mode = 'local' } = {}) {
  const used = new Set();
  const resolved = new Map();
  const replaced = String(text).replace(VAR, (all, name) => {
    used.add(name);
    const value = vars[name];
    if (mode !== 'public' && typeof value === 'string' && value !== '') {
      resolved.set(name, value);
      return value;
    }
    return MASK(name);
  });
  return { text: replaced, used: [...used].sort(), resolved };
}

/* ---------------------------------------------------------------- 章节切分 */

/** 按 "## N. 标题" 切章；首个二级标题之前的内容并入第 0 章。 */
export function splitChapters(markdown, { requireChapterZero = true } = {}) {
  const chapters = [];
  const preface = [];
  const errors = [];
  let current = null;
  let fenced = false;
  for (const line of String(markdown).replace(/\r\n/g, '\n').split('\n')) {
    if (/^```/.test(line)) fenced = !fenced;
    const heading = !fenced && /^## (\d+)\. (.+)$/.exec(line);
    if (heading) {
      current = { number: Number(heading[1]), title: heading[2].trim(), lines: [] };
      chapters.push(current);
    } else if (current) current.lines.push(line);
    else if (!/^# /.test(line)) preface.push(line);
  }
  if (fenced) errors.push('存在未闭合的代码围栏（```）。');
  if (!chapters.length) {
    errors.push('没有任何 "## N. 标题" 章节。');
    return { chapters, errors };
  }
  if (requireChapterZero && chapters[0].number !== 0) errors.push('第一章必须是第 0 章（导航章）。');
  chapters.forEach((chapter, index) => {
    if (chapter.number !== index) errors.push(`章节编号不连续：期望 ${index}，实际 ${chapter.number}。`);
  });
  chapters[0].lines.unshift(...preface);
  return { chapters, errors };
}

/* ---------------------------------------------------------------- 渲染 */

const tableCells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
const blockStart = (line) => /^(?:```|### |#### |\||[-*] |\d+\. |> )/.test(line);

/**
 * 渲染一个章节。返回 { html, sections, errors }。
 * 只支持固定子集：代码块、###/#### 标题、表格、无序/有序列表、> 引文、段落，以及 inline 的
 * 行内代码、链接、粗体，和（可选）$...$ 数学。
 */
export function renderChapter(chapter, { prefix = 'm', math = false } = {}) {
  const lines = chapter.lines;
  const sections = [];
  const html = [];
  const errors = [];
  let index = 0;

  const inline = (text) => {
    const pattern = math
      ? /`([^`]+)`|\$([^$\n]+)\$|\[([^\]]+)\]\(([^\s)]+)\)|\*\*([^*]+)\*\*/g
      : /`([^`]+)`|\[([^\]]+)\]\(([^\s)]+)\)|\*\*([^*]+)\*\*/g;
    let out = '';
    let end = 0;
    for (const match of String(text).matchAll(pattern)) {
      out += escapeHtml(text.slice(end, match.index));
      if (math) {
        if (match[1] !== undefined) out += `<code>${escapeHtml(match[1])}</code>`;
        else if (match[2] !== undefined) out += `<span class="math-inline" data-tex="${escapeHtml(match[2].trim())}"></span>`;
        else if (match[3] !== undefined) out += link(match[3], match[4]);
        else out += `<strong>${escapeHtml(match[5])}</strong>`;
      } else if (match[1] !== undefined) out += `<code>${escapeHtml(match[1])}</code>`;
      else if (match[2] !== undefined) out += link(match[2], match[3]);
      else out += `<strong>${escapeHtml(match[4])}</strong>`;
      end = match.index + match[0].length;
    }
    return out + escapeHtml(text.slice(end));
  };

  const link = (label, href) => {
    if (!/^https?:\/\//.test(href)) {
      errors.push(`不支持的外部链接协议：${href}（只允许 http/https 或页内 #锚点）。`);
      return `<code>${escapeHtml(label)}</code>`;
    }
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
  };

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    if (/^```/.test(line)) {
      const code = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index])) code.push(lines[index++]);
      if (index === lines.length) {
        errors.push(`第 ${chapter.number} 章的代码围栏没有闭合。`);
        break;
      }
      html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      index += 1;
      continue;
    }

    const section = /^### (?:(\d+\.\d+)\s+)?(.+)$/.exec(line);
    if (section) {
      const id = `${prefix}${chapter.number}-${sections.length + 1}`;
      sections.push({ id, number: section[1] || '', title: section[2].trim() });
      html.push(`<h2 id="${id}">${inline(section[2])}</h2>`);
      index += 1;
      continue;
    }

    if (/^#### /.test(line)) {
      html.push(`<h3>${inline(line.slice(5))}</h3>`);
      index += 1;
      continue;
    }

    if (/^\|/.test(line)) {
      const rows = [];
      while (index < lines.length && /^\|/.test(lines[index])) rows.push(tableCells(lines[index++]));
      if (rows.length < 2 || !rows[1].every((cell) => /^:?-{3,}:?$/.test(cell))) {
        errors.push(`第 ${chapter.number} 章有非法表格（缺少表头分隔行）。`);
        continue;
      }
      if (rows.some((row) => row.length !== rows[0].length)) {
        errors.push(`第 ${chapter.number} 章有列数不一致的表格。`);
        continue;
      }
      const [header, , ...body] = rows;
      html.push(`<div class="table-wrap"><table><thead><tr>${header.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${body.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }

    const unordered = /^[-*] /.test(line);
    const ordered = /^\d+\. /.test(line);
    if (unordered || ordered) {
      const items = [];
      const pattern = unordered ? /^[-*] (.+)$/ : /^\d+\. (.+)$/;
      while (index < lines.length && pattern.test(lines[index])) items.push(inline(pattern.exec(lines[index++])[1]));
      const tag = unordered ? 'ul' : 'ol';
      html.push(`<${tag}>${items.map((item) => `<li>${item}</li>`).join('')}</${tag}>`);
      continue;
    }

    if (/^> /.test(line)) {
      const quote = [];
      while (index < lines.length && /^> /.test(lines[index])) quote.push(lines[index++].slice(2));
      html.push(`<aside class="study-note">${inline(quote.join(' '))}</aside>`);
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !blockStart(lines[index])) paragraph.push(lines[index++]);
    html.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }

  return { html, sections, errors };
}

/* ---------------------------------------------------------------- 解析单元 */

/** 解析单元文本（含头部、变量、章节渲染）。不抛异常，问题放进 errors。 */
export function parseUnitText(text, { file = '<memory>', mode = 'local', vars = {} } = {}) {
  const fm = splitFrontMatter(text);
  const meta = fm.meta || {};
  const errors = [...fm.errors];
  const warnings = [];

  const mergedVars = { ...(meta.vars && typeof meta.vars === 'object' ? meta.vars : {}), ...vars };
  const substituted = substituteVars(fm.body, mergedVars, { mode });
  const split = splitChapters(substituted.text, { requireChapterZero: meta.requireChapterZero !== false });
  errors.push(...split.errors);

  const prefix = typeof meta.idPrefix === 'string' && meta.idPrefix ? meta.idPrefix : String(meta.id || 'm');
  const chapters = split.chapters.map((chapter) => {
    const rendered = renderChapter(chapter, { prefix, math: meta.math === true });
    errors.push(...rendered.errors);
    return {
      number: chapter.number,
      title: chapter.title,
      lines: chapter.lines,
      sections: rendered.sections,
      html: rendered.html,
      memoryKind: chapterKind(meta, chapter.number),
    };
  });

  return {
    file,
    meta,
    chapters,
    errors,
    warnings,
    vars: { used: substituted.used, resolved: [...substituted.resolved.keys()], masked: substituted.used.filter((name) => !substituted.resolved.has(name)) },
    prefix,
    mode,
  };
}

const chapterKind = (meta, number) => {
  const types = meta.chapterTypes || {};
  return types[String(number)] || null;
};

export function parseUnitFile(file, options = {}) {
  if (!fs.existsSync(file)) throw new MemoryError(`记忆单元不存在：${file}`);
  const text = fs.readFileSync(file, 'utf8');
  const dir = path.dirname(file);
  const varsFile = options.varsFile === false ? null : path.join(dir, 'vars.local.json');
  let vars = {};
  if (varsFile && fs.existsSync(varsFile)) {
    try {
      vars = JSON.parse(fs.readFileSync(varsFile, 'utf8'));
    } catch (error) {
      throw new MemoryError(`机器变量文件不是合法 JSON：${varsFile}（${error.message}）`);
    }
  }
  const unit = parseUnitText(text, { ...options, file, vars });
  unit.varsFile = vars && Object.keys(vars).length ? varsFile : null;
  return unit;
}

/* ---------------------------------------------------------------- 校验 */

export function validateUnit(unit, { now = new Date(), requireVars = false, staleAfterDays = 30, expectedId = null } = {}) {
  const errors = [...unit.errors];
  const warnings = [...unit.warnings];
  const meta = unit.meta || {};
  const add = (list, message) => list.push(message);

  if (!meta.id) add(errors, '头部缺少 id。');
  else if (!KEBAB.test(meta.id)) add(errors, `id 必须是 kebab-case：${meta.id}`);
  else if (expectedId && meta.id !== expectedId) add(errors, `清单 id（${expectedId}）与单元头部 id（${meta.id}）不一致：索引和页面会指向两个名字。`);
  if (meta.memory === undefined) add(warnings, `头部缺少 memory 契约版本字段（应为 ${SUPPORTED_CONTRACTS[0]}）。`);
  else if (!SUPPORTED_CONTRACTS.includes(meta.memory)) add(errors, `memory-kit ${KIT_VERSION} 只支持契约 ${SUPPORTED_CONTRACTS.map((v) => `v${v}`).join(' / ')}，单元声明的是 v${meta.memory}；请先升级 memory-kit。`);
  if (!meta.title) add(errors, '头部缺少 title。');
  if (!UNIT_KINDS.includes(meta.kind)) add(errors, `kind 必须是 ${UNIT_KINDS.join(' / ')} 之一，实际 ${meta.kind}`);
  if (!VISIBILITIES.includes(meta.visibility)) add(errors, `visibility 必须是 ${VISIBILITIES.join(' / ')} 之一，实际 ${meta.visibility}`);
  for (const field of ['created', 'updated']) {
    if (!meta[field]) add(errors, `头部缺少 ${field}。`);
    else if (!ISO_DATE.test(meta[field])) add(errors, `${field} 必须是 YYYY-MM-DD：${meta[field]}`);
  }

  const types = meta.chapterTypes || {};
  if (typeof types !== 'object' || Array.isArray(types)) add(errors, 'chapterTypes 必须是对象。');
  for (const [key, value] of Object.entries(types)) {
    if (!CHAPTER_KINDS.includes(value)) add(errors, `chapterTypes.${key} 的值非法：${value}（允许 ${CHAPTER_KINDS.join(' / ')}）`);
    if (!unit.chapters.some((chapter) => String(chapter.number) === String(key))) add(errors, `chapterTypes 指向不存在的章节：${key}`);
  }
  for (const chapter of unit.chapters) {
    if (!types[String(chapter.number)]) add(warnings, `第 ${chapter.number} 章没有声明章节类型。`);
  }

  for (const chapter of unit.chapters) {
    for (const section of chapter.sections) {
      if (section.number) {
        const chapterPart = Number(section.number.split('.')[0]);
        if (chapterPart !== chapter.number) add(errors, `小节编号 ${section.number} 出现在第 ${chapter.number} 章。`);
      }
    }
    const kind = chapterKind(meta, chapter.number);
    const body = chapter.lines.join('\n');
    if (kind === 'facts') {
      const hasTable = /^\|/m.test(body);
      const hasEvidence = /证据|来源|核对|E[0-4]/m.test(body);
      if (!hasTable && !hasEvidence) add(warnings, `第 ${chapter.number} 章是 facts，但既没有表格也没有证据标记，事实难以核对。`);
      if (!hasEvidence) add(warnings, `第 ${chapter.number} 章是 facts，但没有证据标记（来源、核对日期或 E0–E4）。`);
    }
    if (kind === 'tasks') {
      const tables = extractTables(chapter);
      if (!tables.length) add(errors, `第 ${chapter.number} 章是 tasks，必须包含一张任务表。`);
      else {
        const header = tables[0].header.join(' ');
        for (const column of ['日期', '任务', '结果']) {
          if (!header.includes(column)) add(errors, `第 ${chapter.number} 章的 tasks 表缺少"${column}"列。`);
        }
        for (const row of tables[0].rows) {
          const evidence = row[tables[0].header.findIndex((h) => h.includes('证据'))];
          if (evidence && !/[Ee][0-4]/.test(evidence)) add(warnings, `第 ${chapter.number} 章的任务"${row[1] || row[0]}"证据等级不是 E0–E4：${evidence}`);
        }
      }
    }
    if (kind === 'plan' && !/^\s*(?:[-*]|\d+\.)\s/m.test(body)) add(warnings, `第 ${chapter.number} 章是 plan，但没有列表项。`);
    if (kind === 'refs' && !/\]\(https?:\/\//.test(body)) add(warnings, `第 ${chapter.number} 章是 refs，但没有外部链接。`);
  }

  if (meta.visibility === 'public') {
    const body = unit.chapters.map((chapter) => chapter.lines.join('\n')).join('\n');
    const leak = /\/Users\/[A-Za-z0-9._-]+|\/home\/[A-Za-z0-9._-]+|usbmodem[0-9A-Fa-f]+|[A-Za-z]:\\\\Users\\/.exec(body);
    if (leak) add(errors, `visibility 为 public，但正文包含本机路径或设备号：${leak[0]}`);
    if (/(?:sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})/.test(body)) add(errors, 'visibility 为 public，但正文疑似包含密钥。');
  }

  if (unit.vars.masked.length && unit.mode !== 'public') {
    const message = `以下变量没有真值：${unit.vars.masked.join('、')}（在 vars.local.json 中补齐，或确认可以遮蔽）`;
    add(requireVars ? errors : warnings, message);
  }

  let ageDays = null;
  const checked = ISO_DATE.test(meta.verified || '') ? meta.verified : meta.updated;
  if (ISO_DATE.test(checked || '')) {
    ageDays = daysBetween(new Date(`${checked}T00:00:00Z`), now);
    if (ageDays > staleAfterDays) add(warnings, `最后一次核对是 ${checked}，距今 ${ageDays} 天，超过 ${staleAfterDays} 天的核对周期。`);
  }

  const byKind = {};
  for (const chapter of unit.chapters) {
    const kind = chapterKind(meta, chapter.number) || 'untyped';
    byKind[kind] = (byKind[kind] || 0) + 1;
  }

  return {
    id: meta.id || '(unnamed)',
    errors,
    warnings,
    stats: {
      chapters: unit.chapters.length,
      sections: unit.chapters.reduce((sum, chapter) => sum + chapter.sections.length, 0),
      tables: unit.chapters.reduce((sum, chapter) => sum + (chapter.html.join('\n').match(/<table>/g) || []).length, 0),
      codeBlocks: unit.chapters.reduce((sum, chapter) => sum + (chapter.html.join('\n').match(/<pre>/g) || []).length, 0),
      links: unit.chapters.reduce((sum, chapter) => sum + (chapter.html.join('\n').match(/<a /g) || []).length, 0),
      byKind,
      ageDays,
      vars: unit.vars,
    },
  };
}

/* ---------------------------------------------------------------- 站点映射 */

export function loadMemoryConfig(configFile) {
  const absolute = path.resolve(configFile);
  if (!fs.existsSync(absolute)) throw new MemoryError(`找不到记忆清单：${absolute}`);
  let config;
  try {
    config = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  } catch (error) {
    throw new MemoryError(`记忆清单不是合法 JSON：${absolute}（${error.message}）`);
  }
  if (!Array.isArray(config.units) || !config.units.length) throw new MemoryError('记忆清单里没有 units。');
  const seen = new Set();
  for (const entry of config.units) {
    if (!entry.id) throw new MemoryError('记忆清单存在没有 id 的单元。');
    if (seen.has(entry.id)) throw new MemoryError(`记忆清单里 id 重复：${entry.id}`);
    seen.add(entry.id);
    if (!entry.file) throw new MemoryError(`单元 ${entry.id} 缺少 file。`);
  }
  return { config, file: absolute, dir: path.dirname(absolute) };
}

/** 按清单加载全部单元，并生成站点需要的 course 对象。 */
export function loadMemoryUnits(configFile, { mode = 'local' } = {}) {
  const { config, dir } = loadMemoryConfig(configFile);
  return config.units.map((entry) => {
    const file = path.resolve(dir, entry.file);
    const unit = parseUnitFile(file, { mode });
    const validation = validateUnit(unit, { expectedId: entry.id, requireVars: entry.requireVars === true, staleAfterDays: config.staleAfterDays || 30 });
    const download = entry.download?.asset ? { ...entry.download, source: file } : null;
    // 站点是可选的：没有 site 配置的单元只用于记忆本身（纯项目、无网站）。
    return { entry, unit, validation, course: entry.site ? buildCourse(entry, unit) : null, file, download };
  });
}

export function buildCourse(entry, unit) {
  const site = entry.site;
  if (!site) throw new MemoryError(`单元 ${entry.id} 缺少 site 配置，无法生成课程。`);
  for (const field of ['id', 'title', 'landingPage', 'pagePrefix']) {
    if (!site[field]) throw new MemoryError(`单元 ${entry.id} 的 site 配置缺少 ${field}。`);
  }
  const readingId = site.readingId || `${unit.prefix}-reading`;
  const chapters = unit.chapters.map((chapter) => ({
    id: chapter.number === 0 ? readingId : `${unit.prefix}-${chapter.number}`,
    number: chapter.number === 0 ? '' : String(chapter.number),
    title: chapter.title,
    description: chapter.sections.slice(0, 2).map((section) => section.title).join('、'),
    html: chapter.number === 0 ? [leadHtml(entry), ...chapter.html].join('\n') : chapter.html.join('\n'),
    sections: chapter.sections,
    memoryKind: chapter.memoryKind,
  }));
  return {
    id: site.id,
    category: site.category || 'practice',
    title: site.title,
    shortTitle: site.shortTitle || site.title,
    englishTitle: site.englishTitle || site.title,
    portalDescription: site.portalDescription || '',
    landingPage: site.landingPage,
    pagePrefix: site.pagePrefix,
    readingId,
    progress: site.progress || '',
    memoryUnit: entry.id,
    chapters,
  };
}

function leadHtml(entry) {
  const lead = entry.site.lead;
  const download = entry.download?.asset ? entry.download : null;
  const parts = [];
  if (lead) parts.push(`<p class="lead">${escapeHtml(lead)}</p>`);
  if (download) parts.push(`<p><a href="${escapeHtml(download.asset)}" download>${escapeHtml(download.label || '下载记忆源文件')}</a></p>`);
  return parts.join('');
}

/* ---------------------------------------------------------------- 视图：摘要与索引 */

const UNFINISHED = /待|尚未|未实现|未完成|未核验|须|需要|下一步|TODO|计划/;
const FACT_HEADER = /证据|核对|状态|来源|验证|边界|结果/;

/** 抽出一个章节里的表格（忽略代码围栏内的行）。 */
function extractTables(chapter) {
  const tables = [];
  let current = null;
  let fenced = false;
  for (const line of chapter.lines) {
    if (/^```/.test(line)) { fenced = !fenced; current = null; continue; }
    if (fenced) continue;
    if (!/^\|/.test(line)) { if (current) { tables.push(current); current = null; } continue; }
    const cells = tableCells(line);
    if (!current) { current = { header: cells, rows: [] }; continue; }
    if (!current.rows.length && cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
    current.rows.push(cells);
  }
  if (current) tables.push(current);
  return tables.filter((table) => table.rows.length);
}

/**
 * 事实表：表头带证据/核对/状态类列的表格优先；没有时退回到 facts 章节里的表格。
 * 这样第 0 章的状态表这类"放在导航章里的事实"也能进入摘要。
 */
export function collectFactTables(unit) {
  const all = [];
  for (const chapter of unit.chapters) {
    for (const table of extractTables(chapter)) all.push({ chapter, header: table.header, rows: table.rows });
  }
  const strong = all.filter((table) => FACT_HEADER.test(table.header.join(' ')));
  if (strong.length) return strong;
  return all.filter((table) => table.chapter.memoryKind === 'facts');
}

const COLUMN = (header, name) => header.findIndex((h) => h.includes(name));

/** 从 tasks 章节里读出任务台账。列按表头名匹配：日期 / 任务 / 结果 / 证据 / 产物。 */
export function collectTasks(unit) {
  const tasks = [];
  for (const chapter of unit.chapters.filter((item) => item.memoryKind === 'tasks')) {
    for (const table of extractTables(chapter)) {
      const date = COLUMN(table.header, '日期');
      const task = COLUMN(table.header, '任务');
      if (date < 0 || task < 0) continue;
      const result = COLUMN(table.header, '结果');
      const evidence = COLUMN(table.header, '证据');
      const artifact = COLUMN(table.header, '产物');
      for (const row of table.rows) {
        tasks.push({
          date: (row[date] || '').trim(),
          task: (row[task] || '').trim(),
          result: result >= 0 ? (row[result] || '').trim() : '',
          evidence: evidence >= 0 ? (row[evidence] || '').trim() : '',
          artifact: artifact >= 0 ? (row[artifact] || '').trim() : '',
          chapter: chapter.number,
        });
      }
    }
  }
  return tasks;
}

/** 跨单元收集"还没做完/还没核对"的条目。 */
export function collectOpenItems(unit) {
  const open = [];
  for (const chapter of unit.chapters.filter((item) => item.memoryKind === 'plan')) {
    for (const line of chapter.lines) {
      const item = /^\s*(?:[-*]|\d+\.)\s+(?:\[[ xX]\]\s*)?(.+)$/.exec(line);
      if (item && !/^\[[xX]\]/.test(line.trim().replace(/^[-*]\s+/, ''))) open.push({ where: `第 ${chapter.number} 章`, text: item[1].trim(), source: 'plan' });
    }
  }
  for (const table of collectFactTables(unit)) {
    for (const row of table.rows) {
      const text = row.slice(1).join('；');
      const clean = (value) => String(value).replace(/`/g, '').replace(/\s+/g, ' ').trim();
      if (UNFINISHED.test(text)) open.push({ where: `第 ${table.chapter.number} 章`, text: `${clean(row[0])}：${clean(text)}`, source: 'facts' });
    }
  }
  return open;
}

export function markdownTable({ header, rows }) {
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

/** 生成给人和 Agent 阅读的紧凑摘要。 */
export function digestUnit(unit, { maxFacts = 24, now = new Date() } = {}) {
  const meta = unit.meta;
  const age = ISO_DATE.test(meta.verified || meta.updated || '') ? daysBetween(new Date(`${meta.verified || meta.updated}T00:00:00Z`), now) : null;
  const lines = [];

  lines.push(`# ${meta.title} · 记忆摘要`);
  lines.push('');
  lines.push(`更新：${meta.updated || '未知'}｜核对：${meta.verified || '未知'}${age === null ? '' : `（距今 ${age} 天）`}｜类型：${meta.kind}｜章节：${unit.chapters.length}｜可见性：${meta.visibility}`);
  lines.push('');

  const open = collectOpenItems(unit);
  lines.push(`## 未完成与待核对（${open.length} 条）`);
  if (!open.length) lines.push('- （没有登记未完成项）');
  for (const item of open.slice(0, maxFacts)) lines.push(`- ${item.text}　<sub>${item.where}</sub>`);
  if (open.length > maxFacts) lines.push(`- ……另有 ${open.length - maxFacts} 条`);
  lines.push('');

  const tables = collectFactTables(unit);
  lines.push('## 当前事实');
  if (!tables.length) lines.push('- （没有登记事实表）');
  let shown = 0;
  for (const table of tables) {
    if (shown >= maxFacts) break;
    lines.push('');
    lines.push(`**${table.chapter.title}**`);
    lines.push('');
    lines.push(markdownTable(table));
    shown += table.rows.length;
  }
  lines.push('');

  const tasks = collectTasks(unit).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  if (tasks.length) {
    lines.push(`## 最近完成（共 ${tasks.length} 项）`);
    for (const task of tasks.slice(0, 8)) lines.push(`- ${task.date} · ${task.task}${task.evidence ? `　<sub>${task.evidence}</sub>` : ''}`);
    lines.push('');
  }

  const sessions = unit.chapters.filter((chapter) => chapter.memoryKind === 'session');
  if (sessions.length) {
    lines.push('## 最近记录');
    const latest = sessions[sessions.length - 1];
    lines.push(`### ${latest.title}`);
    for (const line of latest.lines.filter((item) => item.trim() && !/^#/.test(item) && !/^\s*<!--/.test(item)).slice(0, 8)) lines.push(line.replace(/^\s+/, ''));
    lines.push('');
  }

  if (unit.vars.used.length) {
    lines.push('## 本机变量');
    if (unit.vars.resolved.length) lines.push(`- 已解析：${unit.vars.resolved.join('、')}`);
    if (unit.vars.masked.length) lines.push(`- 未解析：${unit.vars.masked.join('、')}`);
    lines.push('');
  }

  return lines.join('\n');
}

const STATUS_HEADER = /状态|现状/;

/** 状态表：表头里带"状态/现状"的表格，是每个单元的现状摘要。 */
export function collectStatusTables(unit) {
  const out = [];
  for (const chapter of unit.chapters) {
    for (const table of extractTables(chapter)) {
      if (STATUS_HEADER.test(table.header.join(' '))) out.push({ chapter, header: table.header, rows: table.rows });
    }
  }
  return out;
}

/**
 * 生成 memory/index.md —— 项目的"当前状态"文件。
 * 刻意做减法：每个单元只放一张状态表和有限条未完成项，完整事实留在 unit.md。
 * 这样单元数增长时，索引仍然是可以一次读完的。
 */
export function renderIndex(units, { configFile = 'memory/memory.config.json', statusRows = 8, openItems = 4, full = false } = {}) {
  const lines = [];
  const errors = units.reduce((sum, item) => sum + item.validation.errors.length, 0);
  const warnings = units.reduce((sum, item) => sum + item.validation.warnings.length, 0);
  const varsUsed = new Set(units.flatMap(({ unit }) => unit.vars.used));
  const openTotal = units.reduce((sum, item) => sum + collectOpenItems(item.unit).length, 0);
  const doneTotal = units.reduce((sum, item) => sum + collectTasks(item.unit).length, 0);

  lines.push('# 记忆索引');
  lines.push('');
  lines.push('> 由 `memory-kit` 生成，请勿手改。刷新：`npm run memory:index`；没有 npm 时用 `node memory-kit/bin/memory.mjs index`。');
  lines.push('> 这是项目的"当前状态"文件；`BootMemory.md` 只负责启动，不装状态。');
  lines.push('> 索引只回答"现在卡在哪"；事实表在 `memory/<unit>/unit.md`，完整摘要用 `npm run memory:digest`（或加 `--full` 附状态表）。');
  lines.push('');
  lines.push(`清单：\`${configFile}\`｜单元数：${units.length}｜已完成：${doneTotal} 项｜未完成：${openTotal} 条｜契约：${errors ? `❌ ${errors} 错误` : '✅ 0 错误'} · ${warnings ? `⚠ ${warnings} 警告` : '0 警告'}`);
  lines.push('');

  lines.push('## 单元');
  lines.push('');
  lines.push('| 单元 | 标题 | 类型 | 章节 | 最后核对 | 距今 | 状态 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const { entry, unit, validation } of units) {
    const age = validation.stats.ageDays;
    const state = validation.errors.length ? '❌ 有错误' : validation.warnings.length ? '⚠ 有警告' : '✅';
    lines.push(`| \`${entry.id}\` | ${unit.meta.title} | ${unit.meta.kind} | ${unit.chapters.length} | ${unit.meta.verified || unit.meta.updated} | ${age === null ? '-' : `${age} 天`} | ${state} |`);
  }
  lines.push('');

  lines.push('## 未完成与待核对');
  lines.push('');
  for (const { entry, unit } of units) {
    const open = collectOpenItems(unit);
    lines.push(`### \`${entry.id}\` · ${unit.meta.title}（${open.length} 条）`);
    lines.push('');
    if (!open.length) lines.push('- （没有登记未完成项）');
    for (const item of open.slice(0, openItems)) lines.push(`- ${item.text}　<sub>${item.where}</sub>`);
    if (open.length > openItems) lines.push(`- ……另有 ${open.length - openItems} 条，见单元 ` + '`plan`' + ' 章');
    lines.push('');
  }

  const recent = units.flatMap(({ entry, unit }) => collectTasks(unit).map((task) => ({ ...task, unit: entry.id })))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 5);
  if (recent.length) {
    lines.push('## 最近完成');
    lines.push('');
    for (const item of recent) lines.push(`- ${item.date} · ${item.task}${item.evidence ? `　<sub>${item.unit} · ${item.evidence}</sub>` : `　<sub>${item.unit}</sub>`}`);
    lines.push('');
  }

  if (full) {
    lines.push('## 状态表');
    lines.push('');
    lines.push('> 本索引一律遮蔽本机变量真值（`‹NAME›`），实际取值在 `memory/<unit>/vars.local.json`；站点构建时才展开。');
    lines.push('');
    for (const { entry, unit } of units) {
      for (const table of collectStatusTables(unit)) {
        lines.push(`### \`${entry.id}\` · ${table.chapter.title}`);
        lines.push('');
        lines.push(markdownTable({ header: table.header, rows: table.rows.slice(0, statusRows) }));
        if (table.rows.length > statusRows) {
          lines.push('');
          lines.push(`_另有 ${table.rows.length - statusRows} 行，见单元原文。_`);
        }
        lines.push('');
      }
    }

  }

  lines.push('## 校验状态');
  lines.push('');
  lines.push(`- 契约：${errors ? `❌ ${errors} 个错误` : '✅ 0 个错误'} · ${warnings ? `⚠ ${warnings} 条警告` : '0 条警告'}`);
  for (const item of units) for (const error of item.validation.errors) lines.push(`  - ${item.entry.id}：${error}`);
  for (const item of units) for (const warning of item.validation.warnings) lines.push(`  - ${item.entry.id}：${warning}`);
  lines.push(`- 变量：${varsUsed.size} 个${varsUsed.size ? '，索引中已遮蔽' : ''}`);
  lines.push('');
  lines.push('## 章节类型怎么读');
  lines.push('');
  lines.push('- `guide` 导航、`facts` 会过期、`session` 只追加、`pitfalls` 累积、`plan` 完成即删、`refs` 只追加。');
  lines.push('- 证据等级 E0–E4 见 `memory-kit/SPEC.md`，或 `BootMemory.md` §7。');
  lines.push('');
  return lines.join('\n');
}
