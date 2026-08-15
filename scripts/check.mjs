#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateSnapshot } from './ledger-cli.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const privacy = spawnSync(process.execPath, [path.join(projectRoot, 'scripts/privacy-check.mjs')], {
  cwd: projectRoot,
  encoding: 'utf8'
});
process.stdout.write(privacy.stdout || '');
process.stderr.write(privacy.stderr || '');
if (privacy.status !== 0) process.exit(privacy.status || 1);

const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
const dataMatch = html.match(/<script\s+id=["']initialData["']\s+type=["']application\/json["']>([\s\S]*?)<\/script>/i);
if (!dataMatch) throw new Error('index.html 缺少 initialData');
const snapshot = JSON.parse(dataMatch[1]);
const validation = validateSnapshot(snapshot);

const mainScript = html.match(/<script>\s*([\s\S]*?)<\/script>/);
if (!mainScript) throw new Error('index.html 缺少主脚本');
new Function(mainScript[1]);

const externalRuntimePatterns = [
  /<script[^>]+src=/i,
  /<link[^>]+href=["']https?:/i,
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/
];
for (const pattern of externalRuntimePatterns) {
  if (pattern.test(html)) throw new Error(`index.html 不是完全离线文件：${pattern}`);
}

process.stdout.write(`应用检查通过：公司 ${validation.counts.companies}、投递 ${validation.counts.applications}、状态历史 ${validation.counts.statusEvents}、面试 ${validation.counts.interviews}。\n`);
