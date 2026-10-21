#!/usr/bin/env node
// Memory Kit CLI — 零依赖。
// 用法：node memory-kit/bin/memory.mjs <command> [options]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadMemoryUnits,
  validateUnit,
  parseUnitFile,
  digestUnit,
  renderIndex,
  KIT_VERSION,
  SUPPORTED_CONTRACTS,
  MemoryError,
} from '../lib/memory.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const kitRoot = path.resolve(here, '..');

const USAGE = `Memory Kit

用法：
  memory.mjs done --unit <id> --task "完成了什么" [--result 完成] [--evidence E3] [--artifact 产物]
  memory.mjs version                        # 工具版本与支持的契约版本
  memory.mjs new <id> --title "标题" [--kind practice] [--config memory/memory.config.json] [--force]
  memory.mjs check [--config <file>] [--unit <id>] [--json] [--require-vars]
  memory.mjs digest [--config <file>] [--unit <id>] [--out <file>]
  memory.mjs index [--config <file>] [--out memory/index.md] [--full]   # 刷新"当前状态"文件
  memory.mjs render [--config <file>] [--unit <id>] [--chapter N]
  memory.mjs vars [--config <file>] [--unit <id>]

约定：
  清单默认 memory/memory.config.json；单元路径相对于清单所在目录。
  机器相关变量写在单元目录的 vars.local.json 中，正文用 {{NAME}} 引用。
  证据等级、章节类型和写入纪律见 memory-kit/SPEC.md。
`;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) { positional.push(token); continue; }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) flags[key] = true;
    else { flags[key] = next; index += 1; }
  }
  return { positional, flags };
}

const cwd = process.cwd();
const resolve = (value, fallback) => path.resolve(cwd, typeof value === 'string' ? value : fallback);
const color = (code) => (process.stdout.isTTY ? (text) => `\u001b[${code}m${text}\u001b[0m` : (text) => text);
const red = color('31');
const yellow = color('33');
const green = color('32');
const dim = color('2');

function fail(error) {
  if (error instanceof MemoryError) {
    console.error(red(`✗ ${error.message}`));
    for (const detail of error.details || []) console.error(`  ${detail}`);
  } else {
    console.error(red(`✗ ${error?.stack || error}`));
  }
  process.exit(1);
}

function loadUnits(flags) {
  const configFile = resolve(flags.config, 'memory/memory.config.json');
  const mode = flags.public ? 'public' : 'local';
  const units = loadMemoryUnits(configFile, { mode });
  const filtered = flags.unit ? units.filter((item) => item.entry.id === flags.unit) : units;
  if (!filtered.length) throw new MemoryError(`清单里没有单元：${flags.unit}`);
  return { units: filtered, configFile };
}

const commands = {
  check(positional, flags) {
    const { units, configFile } = loadUnits(flags);
    const requireVars = flags['require-vars'] === true;
    const results = units.map(({ entry, unit }) => ({ entry, unit, ...validateUnit(unit, { requireVars, expectedId: entry.id }) }));
    if (flags.json) {
      console.log(JSON.stringify({ kit: { version: KIT_VERSION, contracts: SUPPORTED_CONTRACTS }, config: configFile, units: results }, null, 2));
    } else {
      console.log(dim(`memory-kit ${KIT_VERSION} · 支持契约 ${SUPPORTED_CONTRACTS.map((v) => `v${v}`).join(' / ')}`));
      console.log(dim(configFile));
      console.log('');
      for (const result of results) {
        const { stats } = result;
        const head = `${result.errors.length ? red('✗') : green('✓')} ${result.entry.id} — ${result.unit.meta.title}`;
        console.log(head);
        console.log(dim(`  章节 ${stats.chapters} · 小节 ${stats.sections} · 表格 ${stats.tables} · 代码块 ${stats.codeBlocks} · 链接 ${stats.links} · 距今 ${stats.ageDays ?? '?'} 天`));
        console.log(dim(`  类型分布 ${Object.entries(stats.byKind).map(([kind, count]) => `${kind}×${count}`).join(' / ')}`));
        for (const error of result.errors) console.log(`  ${red('错误')} ${error}`);
        for (const warning of result.warnings) console.log(`  ${yellow('警告')} ${warning}`);
      }
    }
    const errors = results.reduce((sum, result) => sum + result.errors.length, 0);
    const warnings = results.reduce((sum, result) => sum + result.warnings.length, 0);
    if (!flags.json) console.log(`\n${errors ? red(`${errors} 个错误`) : green('0 个错误')} · ${warnings ? yellow(`${warnings} 条警告`) : '0 条警告'}`);
    if (errors) process.exit(1);
  },

  digest(positional, flags) {
    const { units } = loadUnits(flags);
    if (units.length !== 1) throw new MemoryError('digest 需要 --unit 指定单个单元。');
    const text = digestUnit(units[0].unit);
    if (flags.out) {
      const out = resolve(flags.out);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, `${text}\n`);
      console.log(`已写入 ${out}`);
    } else {
      console.log(text);
    }
  },

  index(positional, flags) {
    // 索引是提交进仓库的"当前状态"文件，一律用遮蔽模式生成，避免带出本机信息。
    const configFile = resolve(flags.config, 'memory/memory.config.json');
    const units = loadMemoryUnits(configFile, { mode: 'public' });
    const out = resolve(flags.out, 'memory/index.md');
    const text = renderIndex(units, { configFile: path.relative(cwd, configFile) || configFile, full: flags.full === true });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, text);
    console.log(`已写入 ${out}（${units.length} 个单元）`);
  },

  render(positional, flags) {
    const { units } = loadUnits(flags);
    if (units.length !== 1) throw new MemoryError('render 需要 --unit 指定单个单元。');
    const { unit } = units[0];
    const selected = flags.chapter === undefined ? unit.chapters : unit.chapters.filter((chapter) => String(chapter.number) === String(flags.chapter));
    if (!selected.length) throw new MemoryError(`没有第 ${flags.chapter} 章。`);
    for (const chapter of selected) console.log(chapter.html.join('\n'));
  },

  done(positional, flags) {
    const { units } = loadUnits(flags);
    if (units.length !== 1) throw new MemoryError('done 需要 --unit 指定单个单元。');
    const { unit } = units[0];
    const task = typeof flags.task === 'string' ? flags.task : '';
    if (!task) {
      throw new MemoryError('用法：memory.mjs done --unit <id> --task "完成了什么" [--result 完成] [--evidence E3] [--artifact 产物] [--date YYYY-MM-DD]');
    }
    const chapter = unit.chapters.find((item) => item.memoryKind === 'tasks');
    if (!chapter) throw new MemoryError(`单元 ${unit.meta.id} 没有 tasks 章节：先加一章 "## N. 任务日志" 并在 chapterTypes 里声明 "tasks"。`);

    const date = typeof flags.date === 'string' ? flags.date : new Date().toISOString().slice(0, 10);
    const values = {
      日期: date,
      任务: task,
      结果: typeof flags.result === 'string' ? flags.result : '完成',
      证据: typeof flags.evidence === 'string' ? flags.evidence : 'E0',
      产物: typeof flags.artifact === 'string' ? flags.artifact : '—',
    };

    const file = unit.file;
    let text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n');
    const start = lines.findIndex((line) => line.startsWith(`## ${chapter.number}. `));
    if (start < 0) throw new MemoryError(`在 ${path.relative(cwd, file)} 里找不到第 ${chapter.number} 章。`);
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
      if (/^## \d+\./.test(lines[index])) { end = index; break; }
    }
    const cellsOf = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
    let header = null;
    let lastTable = -1;
    for (let index = start + 1; index < end; index += 1) {
      if (/^\|/.test(lines[index])) {
        if (!header) header = cellsOf(lines[index]);
        lastTable = index;
      }
    }
    if (!header || lastTable < 0) throw new MemoryError(`第 ${chapter.number} 章没有任务表。`);
    const row = header.map((cell) => {
      const key = Object.keys(values).find((name) => cell.includes(name));
      return key ? values[key] : '—';
    });
    lines.splice(lastTable + 1, 0, `| ${row.join(' | ')} |`);
    text = lines.join('\n').replace(/("updated":\s*")\d{4}-\d{2}-\d{2}(")/, `$1${date}$2`);
    fs.writeFileSync(file, text);

    const refreshed = parseUnitFile(file, { mode: 'local' });
    const result = validateUnit(refreshed, { expectedId: refreshed.meta.id });
    console.log(green(`✓ 已记录：${date} · ${task}`));
    console.log(dim(`  ${path.relative(cwd, file)} 第 ${chapter.number} 章 · 证据 ${values['证据']} · 产物 ${values['产物']}`));
    if (result.errors.length) {
      for (const error of result.errors) console.error(red(`  错误 ${error}`));
      process.exit(1);
    }
  },

  vars(positional, flags) {
    const { units } = loadUnits(flags);
    for (const { entry, unit } of units) {
      console.log(`${entry.id}`);
      if (!unit.vars.used.length) { console.log(dim('  没有使用变量。')); continue; }
      for (const name of unit.vars.used) {
        const value = unit.vars.resolved.includes(name) ? '已解析' : yellow('未解析');
        console.log(`  {{${name}}}  ${value}`);
      }
    }
  },

  new(positional, flags) {
    const id = positional[0];
    if (!id) throw new MemoryError('用法：memory.mjs new <id> --title "标题"');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new MemoryError(`id 必须是 kebab-case：${id}`);
    const configFile = resolve(flags.config, 'memory/memory.config.json');
    const baseDir = path.dirname(configFile);
    const dir = path.join(baseDir, id);
    const unitFile = path.join(dir, 'unit.md');
    if (fs.existsSync(unitFile) && flags.force !== true) throw new MemoryError(`已存在：${unitFile}（加 --force 覆盖）`);

    const template = fs.readFileSync(path.join(kitRoot, 'templates/unit.md'), 'utf8');
    const today = new Date().toISOString().slice(0, 10);
    const text = template
      .replaceAll('%%ID%%', id)
      .replaceAll('%%TITLE%%', String(flags.title || id))
      .replaceAll('%%KIND%%', String(flags.kind || 'practice'))
      .replaceAll('%%DATE%%', today);

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(unitFile, text);
    const varsFile = path.join(dir, 'vars.local.json');
    if (!fs.existsSync(varsFile)) fs.writeFileSync(varsFile, '{}\n');
    console.log(green(`✓ 已创建 ${unitFile}`));
    console.log(dim(`  下一步：填写正文 → 在 ${path.relative(cwd, configFile)} 里注册单元 → npm run memory:check`));
  },
};

const { positional, flags } = parseArgs(process.argv.slice(2));
const command = positional.shift();
if (flags.version === true || command === 'version') {
  console.log(`memory-kit ${KIT_VERSION}`);
  console.log(`支持的契约：${SUPPORTED_CONTRACTS.map((v) => `v${v}`).join(' / ')}`);
  console.log(`Node ${process.version}`);
  process.exit(0);
}
if (!command || command === 'help' || flags.help) {
  console.log(USAGE);
  process.exit(0);
}
if (!commands[command]) fail(new MemoryError(`未知命令：${command}\n\n${USAGE}`));
try {
  commands[command](positional, flags);
} catch (error) {
  fail(error);
}
