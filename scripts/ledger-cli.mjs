#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const SCHEMA_VERSION = 1;
export const STATUSES = ['已投递','简历筛选中','笔试中','等待约面中','面试中','录用评估中','已 Offer','已拒绝','已撤回','岗位关闭'];

const now = () => new Date().toISOString();
const text = value => String(value ?? '').trim();
const nullable = value => text(value) || null;
const clone = value => JSON.parse(JSON.stringify(value));
const normalizeName = value => text(value).toLocaleLowerCase('zh-CN').replace(/[\s·・_.-]+/g, '');
const makeId = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2)}`;
const assert = (condition, message) => { if (!condition) throw new Error(message); };

export function validateSnapshot(input, { partial = false } = {}) {
  assert(input && typeof input === 'object' && !Array.isArray(input), '数据必须是 JSON 对象');
  if (!partial) assert(input.schemaVersion === SCHEMA_VERSION, `仅支持 schemaVersion ${SCHEMA_VERSION}`);
  if (input.schemaVersion != null) assert(input.schemaVersion === SCHEMA_VERSION, `仅支持 schemaVersion ${SCHEMA_VERSION}`);
  const keys = ['companies','applications','statusEvents','interviews'];
  if (!partial) keys.forEach(key => assert(Array.isArray(input[key]), `缺少数组字段：${key}`));
  keys.forEach(key => { if (input[key] != null) assert(Array.isArray(input[key]), `${key} 必须是数组`); });

  const companies = input.companies || [];
  const applications = input.applications || [];
  const events = input.statusEvents || [];
  const interviews = input.interviews || [];
  const ids = new Set();
  const addId = (id, label) => { assert(text(id), `${label} 缺少 id`); assert(!ids.has(id), `id 重复：${id}`); ids.add(id); };
  companies.forEach((item, i) => { addId(item.id, `companies[${i}]`); assert(text(item.name), `companies[${i}] 缺少 name`); });
  applications.forEach((item, i) => {
    addId(item.id, `applications[${i}]`);
    assert(text(item.companyId), `applications[${i}] 缺少 companyId`);
    assert(text(item.title), `applications[${i}] 缺少 title`);
    assert(STATUSES.includes(item.status), `applications[${i}] 状态无效：${item.status}`);
    assert(text(item.recruitmentBatch), `applications[${i}] 缺少 recruitmentBatch`);
  });
  events.forEach((item, i) => {
    addId(item.id, `statusEvents[${i}]`);
    assert(text(item.applicationId), `statusEvents[${i}] 缺少 applicationId`);
    assert(STATUSES.includes(item.toStatus), `statusEvents[${i}] 状态无效：${item.toStatus}`);
  });
  interviews.forEach((item, i) => {
    addId(item.id, `interviews[${i}]`);
    assert(text(item.round), `interviews[${i}] 缺少 round`);
    if (!text(item.applicationId)) {
      assert(text(item.companyName), `interviews[${i}] 未关联投递时必须填写 companyName`);
      assert(text(item.positionName), `interviews[${i}] 未关联投递时必须填写 positionName`);
    }
  });

  if (!partial) {
    const companyIds = new Set(companies.map(item => item.id));
    const applicationIds = new Set(applications.map(item => item.id));
    applications.forEach(item => assert(companyIds.has(item.companyId), `投递 ${item.id} 引用了不存在的公司 ${item.companyId}`));
    events.forEach(item => assert(applicationIds.has(item.applicationId), `状态历史 ${item.id} 引用了不存在的投递 ${item.applicationId}`));
    interviews.forEach(item => { if (item.applicationId) assert(applicationIds.has(item.applicationId), `面试 ${item.id} 引用了不存在的投递 ${item.applicationId}`); });
  }
  return { valid: true, counts: { companies: companies.length, applications: applications.length, statusEvents: events.length, interviews: interviews.length } };
}

export function normalizeSnapshot(input) {
  const snapshot = clone(input);
  snapshot.schemaVersion = SCHEMA_VERSION;
  snapshot.exportedAt = snapshot.exportedAt || now();
  snapshot.settings = { currentBatch: text(snapshot.settings?.currentBatch) || '2027-autumn' };
  snapshot.metadata = { ...(snapshot.metadata || {}), lastExportAt: snapshot.metadata?.lastExportAt || null };
  for (const key of ['companies','applications','statusEvents','interviews']) snapshot[key] = snapshot[key] || [];
  return snapshot;
}

export function mergeSnapshots(baseInput, incomingInput) {
  const base = normalizeSnapshot(baseInput);
  validateSnapshot(base);
  validateSnapshot(incomingInput, { partial: true });
  const incoming = normalizeSnapshot({ schemaVersion:1, settings:base.settings, companies:[], applications:[], statusEvents:[], interviews:[], ...incomingInput });
  const result = clone(base);
  const companyIdMap = new Map();
  const companiesById = new Map(result.companies.map(item => [item.id, item]));
  const companiesByName = new Map(result.companies.map(item => [normalizeName(item.name), item]));

  for (const raw of incoming.companies) {
    const providedFields = Array.isArray(raw.__providedFields) ? raw.__providedFields : null;
    const item = { ...raw }; delete item.__providedFields;
    const existing = companiesById.get(item.id) || companiesByName.get(normalizeName(item.name));
    if (existing) {
      companyIdMap.set(item.id, existing.id);
      const patch = providedFields ? Object.fromEntries(Object.entries(item).filter(([key]) => ['name',...providedFields].includes(key))) : item;
      Object.assign(existing, { ...patch, id:existing.id, updatedAt:now() });
    } else {
      const next = { notes:'', createdAt:now(), updatedAt:now(), ...item };
      if (companiesById.has(next.id)) next.id = makeId('company');
      result.companies.push(next);
      companiesById.set(next.id, next);
      companiesByName.set(normalizeName(next.name), next);
      companyIdMap.set(item.id, next.id);
    }
  }

  const appsById = new Map(result.applications.map(item => [item.id, item]));
  const identity = item => [item.companyId, normalizeName(item.title), item.recruitmentBatch, item.appliedAt || ''].join('|');
  const appsByIdentity = new Map(result.applications.map(item => [identity(item), item]));
  const applicationIdMap = new Map();

  for (const raw of incoming.applications) {
    const providedFields = Array.isArray(raw.__providedFields) ? raw.__providedFields : null;
    const item = { ...raw, companyId:companyIdMap.get(raw.companyId) || raw.companyId };
    delete item.__providedFields;
    assert(result.companies.some(company => company.id === item.companyId), `导入投递引用了不存在的公司：${raw.companyId}`);
    const existing = appsById.get(item.id) || appsByIdentity.get(identity(item));
    if (existing) {
      applicationIdMap.set(raw.id, existing.id);
      const oldStatus = existing.status;
      const patch = providedFields ? Object.fromEntries(Object.entries(item).filter(([key]) => ['companyId','title',...providedFields].includes(key))) : item;
      Object.assign(existing, { ...patch, id:existing.id, updatedAt:now() });
      if (oldStatus !== existing.status && !incoming.statusEvents.some(event => event.applicationId === raw.id && event.toStatus === existing.status)) {
        result.statusEvents.push({ id:makeId('status-event'), applicationId:existing.id, fromStatus:oldStatus, toStatus:existing.status, note:'由合并导入更新', createdAt:now() });
      }
    } else {
      const next = { city:null, direction:null, appliedAt:null, jobUrl:null, notes:'', nextAction:'', nextActionAt:null, createdAt:now(), updatedAt:now(), ...item };
      if (appsById.has(next.id)) next.id = makeId('application');
      result.applications.push(next);
      appsById.set(next.id, next);
      appsByIdentity.set(identity(next), next);
      applicationIdMap.set(raw.id, next.id);
      if (!incoming.statusEvents.some(event => event.applicationId === raw.id)) result.statusEvents.push({ id:makeId('status-event'), applicationId:next.id, fromStatus:null, toStatus:next.status, note:'导入新投递', createdAt:now() });
    }
  }

  for (const raw of incoming.statusEvents) {
    const applicationId = applicationIdMap.get(raw.applicationId) || raw.applicationId;
    assert(result.applications.some(item => item.id === applicationId), `导入状态历史引用了不存在的投递：${raw.applicationId}`);
    const existing = result.statusEvents.find(item => item.id === raw.id);
    if (existing) Object.assign(existing, { ...raw, applicationId, id:existing.id });
    else result.statusEvents.push({ note:null, createdAt:now(), ...raw, id:result.statusEvents.some(item => item.id === raw.id) ? makeId('status-event') : raw.id, applicationId });
  }
  for (const raw of incoming.interviews) {
    const applicationId = raw.applicationId ? (applicationIdMap.get(raw.applicationId) || raw.applicationId) : null;
    if (applicationId) assert(result.applications.some(item => item.id === applicationId), `导入面试引用了不存在的投递：${raw.applicationId}`);
    else { assert(text(raw.companyName), '独立面试缺少 companyName'); assert(text(raw.positionName), '独立面试缺少 positionName'); }
    const existing = result.interviews.find(item => item.id === raw.id);
    if (existing) Object.assign(existing, { ...raw, applicationId, id:existing.id, updatedAt:now() });
    else result.interviews.push({ applicationId:null, companyName:'', positionName:'', scheduledAt:null, format:null, team:null, questions:'', answers:'', followUps:'', feedback:'', result:null, review:'', createdAt:now(), updatedAt:now(), ...raw, id:result.interviews.some(item => item.id === raw.id) ? makeId('interview') : raw.id, applicationId });
  }

  if (incomingInput.settings?.currentBatch) result.settings.currentBatch = incomingInput.settings.currentBatch;
  result.exportedAt = now();
  validateSnapshot(result);
  return result;
}

export function parseCSV(input, currentBatch = '2027-autumn') {
  const rows = [];
  let row = [], cell = '', quoted = false;
  const source = String(input).replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell.replace(/\r$/, '')); if (row.some(value => value.trim())) rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  row.push(cell.replace(/\r$/, '')); if (row.some(value => value.trim())) rows.push(row);
  assert(rows.length >= 2, 'CSV 至少需要表头和一行数据');

  const aliases = {
    id:'id', '记录ID':'id', '记录 ID':'id', company:'company', '公司':'company', companyId:'companyId', '公司ID':'companyId',
    title:'title', '岗位':'title', '岗位名称':'title', city:'city', '城市':'city', direction:'direction', '方向':'direction',
    status:'status', '状态':'status', recruitmentBatch:'recruitmentBatch', batch:'recruitmentBatch', '批次':'recruitmentBatch', '招聘批次':'recruitmentBatch',
    appliedAt:'appliedAt', '投递日期':'appliedAt', jobUrl:'jobUrl', '岗位链接':'jobUrl', '链接':'jobUrl', notes:'notes', '备注':'notes',
    nextAction:'nextAction', '下一步':'nextAction', '下一步行动':'nextAction', nextActionAt:'nextActionAt', '行动时间':'nextActionAt', '下一步时间':'nextActionAt'
  };
  const headers = rows[0].map(value => aliases[value.trim()] || value.trim());
  assert(headers.includes('company') || headers.includes('companyId'), 'CSV 表头必须包含“公司”或 companyId');
  assert(headers.includes('title'), 'CSV 表头必须包含“岗位”或 title');

  const companies = [], applications = [], companiesByName = new Map();
  rows.slice(1).forEach((values, index) => {
    const raw = {}; headers.forEach((key, i) => raw[key] = values[i]?.trim() || '');
    assert(raw.title, `CSV 第 ${index + 2} 行缺少岗位`);
    let companyId = raw.companyId;
    if (raw.company) {
      const key = normalizeName(raw.company);
      if (!companiesByName.has(key)) {
        const company = { id:companyId || makeId('company-import'), name:raw.company, notes:'', createdAt:now(), updatedAt:now(), __providedFields:['name'] };
        companiesByName.set(key, company); companies.push(company);
      }
      companyId = companiesByName.get(key).id;
    }
    assert(companyId, `CSV 第 ${index + 2} 行缺少公司`);
    applications.push({
      id:raw.id || makeId('application-import'), companyId, title:raw.title, city:nullable(raw.city), direction:nullable(raw.direction),
      status:raw.status || '已投递', recruitmentBatch:raw.recruitmentBatch || currentBatch,
      appliedAt:nullable(raw.appliedAt), jobUrl:nullable(raw.jobUrl), notes:raw.notes || '', nextAction:raw.nextAction || '',
      nextActionAt:nullable(raw.nextActionAt), createdAt:now(), updatedAt:now(), __providedFields:headers
    });
  });
  const result = { schemaVersion:1, companies, applications, statusEvents:[], interviews:[] };
  validateSnapshot(result, { partial:true });
  return result;
}

export function parseMarkdown(input, currentBatch = '2027-autumn') {
  const companies = [], applications = [], companyByName = new Map();
  let currentCompany = null, currentApplication = null;
  const fields = { '记录 ID':'id', '记录ID':'id', '状态':'status', '批次':'recruitmentBatch', '招聘批次':'recruitmentBatch', '城市':'city', '方向':'direction', '投递日期':'appliedAt', '岗位链接':'jobUrl', '链接':'jobUrl', '下一步':'nextAction', '下一步行动':'nextAction', '行动时间':'nextActionAt', '备注':'notes' };
  for (const rawLine of String(input).split(/\r?\n/)) {
    const line = rawLine.trim();
    const companyMatch = line.match(/^###\s+(?!#)(.+)$/);
    const applicationMatch = line.match(/^####\s+(?!#)(.+)$/);
    if (companyMatch) {
      const name = companyMatch[1].replace(/^\*\*|\*\*$/g, '').trim();
      if (!name) continue;
      const key = normalizeName(name);
      if (!companyByName.has(key)) {
        const company = { id:makeId('company-import'), name, notes:'', createdAt:now(), updatedAt:now(), __providedFields:['name'] };
        companyByName.set(key, company); companies.push(company);
      }
      currentCompany = companyByName.get(key); currentApplication = null;
    } else if (applicationMatch && currentCompany) {
      currentApplication = { id:makeId('application-import'), companyId:currentCompany.id, title:applicationMatch[1].trim(), city:null, direction:null, status:'已投递', recruitmentBatch:currentBatch, appliedAt:null, jobUrl:null, notes:'', nextAction:'', nextActionAt:null, createdAt:now(), updatedAt:now(), __providedFields:['companyId','title'] };
      applications.push(currentApplication);
    } else if (currentApplication) {
      const match = line.match(/^[-*]\s*([^：:]+)[：:]\s*(.*)$/);
      if (match && fields[match[1].trim()]) {
        const key = fields[match[1].trim()], value = match[2].trim();
        const cleanValue = value === '—' ? '' : value;
        currentApplication[key] = ['city','direction','appliedAt','jobUrl','nextActionAt'].includes(key) ? nullable(cleanValue) : cleanValue;
        if (!currentApplication.__providedFields.includes(key)) currentApplication.__providedFields.push(key);
      }
    }
  }
  assert(companies.length, 'Markdown 中没有找到三级公司标题（例如：### 腾讯）');
  const result = { schemaVersion:1, companies, applications, statusEvents:[], interviews:[] };
  validateSnapshot(result, { partial:true });
  return result;
}

const csvEscape = value => {
  const string = String(value ?? '');
  return /[",\n\r]/.test(string) ? `"${string.replace(/"/g, '""')}"` : string;
};

export function exportCSV(snapshot) {
  validateSnapshot(snapshot);
  const companies = new Map(snapshot.companies.map(item => [item.id, item.name]));
  const headers = ['记录ID','公司','companyId','岗位','城市','方向','状态','招聘批次','投递日期','岗位链接','备注','下一步行动','行动时间','更新时间'];
  const rows = snapshot.applications.map(item => [item.id, companies.get(item.companyId) || '', item.companyId, item.title, item.city, item.direction, item.status, item.recruitmentBatch, item.appliedAt, item.jobUrl, item.notes, item.nextAction, item.nextActionAt, item.updatedAt]);
  return '\uFEFF' + [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\r\n');
}

export function exportMarkdown(snapshot) {
  validateSnapshot(snapshot);
  const lines = ['# 秋招投递记录', '', `> 导出时间：${now()} · schemaVersion ${SCHEMA_VERSION}`, ''];
  const appsByCompany = new Map();
  snapshot.applications.forEach(app => { if (!appsByCompany.has(app.companyId)) appsByCompany.set(app.companyId, []); appsByCompany.get(app.companyId).push(app); });
  for (const company of [...snapshot.companies].sort((a,b) => a.name.localeCompare(b.name, 'zh-CN'))) {
    lines.push(`### ${company.name}`, '');
    const applications = appsByCompany.get(company.id) || [];
    if (!applications.length) { lines.push('- 暂无投递', ''); continue; }
    for (const app of applications) {
      lines.push(`#### ${app.title}`, '', `- 记录 ID：${app.id}`, `- 状态：${app.status}`, `- 招聘批次：${app.recruitmentBatch}`, `- 城市：${app.city || '—'}`, `- 方向：${app.direction || '—'}`, `- 投递日期：${app.appliedAt || '—'}`, `- 岗位链接：${app.jobUrl || '—'}`, `- 下一步行动：${app.nextAction || '—'}`, `- 行动时间：${app.nextActionAt || '—'}`);
      if (app.notes) lines.push('', '备注：', '', app.notes);
      const events = snapshot.statusEvents.filter(item => item.applicationId === app.id).sort((a,b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      if (events.length) {
        lines.push('', '##### 状态历史', '');
        events.forEach(event => lines.push(`- ${event.createdAt || ''}：${event.fromStatus || '初始'} → ${event.toStatus}${event.note ? `（${event.note.replace(/\n/g, ' ')}）` : ''}`));
      }
      for (const interview of snapshot.interviews.filter(item => item.applicationId === app.id)) {
        lines.push('', `##### 面试：${interview.round}`, '', `- 时间：${interview.scheduledAt || '—'}`, `- 形式：${interview.format || '—'}`, `- 团队：${interview.team || '—'}`, `- 结果：${interview.result || '—'}`);
        if (interview.questions) lines.push('', '**问题**', '', interview.questions);
        if (interview.answers) lines.push('', '**回答**', '', interview.answers);
        if (interview.followUps) lines.push('', '**追问**', '', interview.followUps);
        if (interview.feedback) lines.push('', '**反馈**', '', interview.feedback);
        if (interview.review) lines.push('', '**复盘**', '', interview.review);
      }
      lines.push('');
    }
  }
  const standaloneInterviews = snapshot.interviews.filter(item => !item.applicationId);
  if (standaloneInterviews.length) {
    lines.push('## 独立面试记录', '');
    for (const interview of standaloneInterviews) {
      lines.push(`**${interview.companyName} · ${interview.positionName} · ${interview.round}**`, '', `- 时间：${interview.scheduledAt || '—'}`, `- 形式：${interview.format || '—'}`, `- 团队：${interview.team || '—'}`, `- 结果：${interview.result || '—'}`);
      if (interview.questions) lines.push('', '**问题**', '', interview.questions);
      if (interview.answers) lines.push('', '**回答**', '', interview.answers);
      if (interview.followUps) lines.push('', '**追问**', '', interview.followUps);
      if (interview.feedback) lines.push('', '**反馈**', '', interview.feedback);
      if (interview.review) lines.push('', '**复盘**', '', interview.review);
      lines.push('');
    }
  }
  return lines.join('\n');
}

function readJSON(file) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  validateSnapshot(parsed);
  return parsed;
}

function writeAtomic(file, content) {
  const target = path.resolve(file);
  const temporary = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, content, 'utf8');
  fs.renameSync(temporary, target);
}

function usage() {
  return `秋招记录离线数据脚本

用法：
  node scripts/ledger-cli.mjs validate <input.json>
  node scripts/ledger-cli.mjs merge <base.json> <incoming.json> <output.json>
  node scripts/ledger-cli.mjs import-csv <base.json> <incoming.csv> <output.json>
  node scripts/ledger-cli.mjs import-md <base.json> <incoming.md> <output.json>
  node scripts/ledger-cli.mjs extract-html <index.html> <output.json>
  node scripts/ledger-cli.mjs export-csv <input.json> <output.csv>
  node scripts/ledger-cli.mjs export-md <input.json> <output.md>

说明：merge/import-* 都写到新的 output 文件，不会原地覆盖 base。`;
}

export function run(argv) {
  const [command, ...args] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(usage() + '\n');
    return 0;
  }
  if (command === 'validate') {
    assert(args.length === 1, 'validate 需要 1 个参数');
    const result = validateSnapshot(readJSON(args[0]));
    process.stdout.write(JSON.stringify({ ok:true, ...result }, null, 2) + '\n');
    return 0;
  }
  if (command === 'merge') {
    assert(args.length === 3, 'merge 需要 3 个参数');
    const result = mergeSnapshots(readJSON(args[0]), JSON.parse(fs.readFileSync(args[1], 'utf8')));
    writeAtomic(args[2], JSON.stringify(result, null, 2) + '\n');
    process.stdout.write(JSON.stringify({ ok:true, output:path.resolve(args[2]), counts:validateSnapshot(result).counts }, null, 2) + '\n');
    return 0;
  }
  if (command === 'import-csv' || command === 'import-md') {
    assert(args.length === 3, `${command} 需要 3 个参数`);
    const base = readJSON(args[0]);
    const source = fs.readFileSync(args[1], 'utf8');
    const incoming = command === 'import-csv' ? parseCSV(source, base.settings?.currentBatch) : parseMarkdown(source, base.settings?.currentBatch);
    const result = mergeSnapshots(base, incoming);
    writeAtomic(args[2], JSON.stringify(result, null, 2) + '\n');
    process.stdout.write(JSON.stringify({ ok:true, output:path.resolve(args[2]), counts:validateSnapshot(result).counts }, null, 2) + '\n');
    return 0;
  }
  if (command === 'export-csv' || command === 'export-md') {
    assert(args.length === 2, `${command} 需要 2 个参数`);
    const snapshot = readJSON(args[0]);
    writeAtomic(args[1], command === 'export-csv' ? exportCSV(snapshot) : exportMarkdown(snapshot));
    process.stdout.write(JSON.stringify({ ok:true, output:path.resolve(args[1]) }, null, 2) + '\n');
    return 0;
  }
  if (command === 'extract-html') {
    assert(args.length === 2, 'extract-html 需要 2 个参数');
    const html = fs.readFileSync(args[0], 'utf8');
    const match = html.match(/<script\s+id=["']initialData["']\s+type=["']application\/json["']>([\s\S]*?)<\/script>/i);
    assert(match, 'HTML 中没有找到 initialData JSON');
    const snapshot = JSON.parse(match[1]);
    validateSnapshot(snapshot);
    writeAtomic(args[1], JSON.stringify(snapshot, null, 2) + '\n');
    process.stdout.write(JSON.stringify({ ok:true, output:path.resolve(args[1]), counts:validateSnapshot(snapshot).counts }, null, 2) + '\n');
    return 0;
  }
  throw new Error(`未知命令：${command}\n\n${usage()}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = run(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`错误：${error.message}\n`); process.exitCode = 1; }
}
