#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicHtmlPath = path.join(projectRoot, 'index.html');
const privatePaths = ['秋招记录.html', 'backups'];
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

check(fs.existsSync(publicHtmlPath), '缺少公开入口 index.html');

if (fs.existsSync(publicHtmlPath)) {
  const html = fs.readFileSync(publicHtmlPath, 'utf8');
  const dataMatch = html.match(/<script\s+id=["']initialData["']\s+type=["']application\/json["']>([\s\S]*?)<\/script>/i);
  check(Boolean(dataMatch), 'index.html 缺少 initialData');
  if (dataMatch) {
    try {
      const data = JSON.parse(dataMatch[1]);
      for (const key of ['companies', 'applications', 'statusEvents', 'interviews']) {
        check(Array.isArray(data[key]), `initialData.${key} 必须是数组`);
        check(data[key]?.length === 0, `公开版 initialData.${key} 必须为空`);
      }
      check(data.metadata?.distribution === 'public-template', '公开版缺少 public-template 标记');
    } catch (error) {
      failures.push(`initialData 不是有效 JSON：${error.message}`);
    }
  }

  const mainScript = html.match(/<script>\s*([\s\S]*?)<\/script>/);
  check(Boolean(mainScript), 'index.html 缺少主脚本');
  if (mainScript) {
    try {
      new Function(mainScript[1]);
    } catch (error) {
      failures.push(`index.html 主脚本语法错误：${error.message}`);
    }
  }

  const forbiddenPatterns = [
    [/\/Users\//, 'macOS 用户绝对路径'],
    [/[A-Za-z]:\\Users\\/, 'Windows 用户绝对路径'],
    [/sourceHash|sourceFile|sourceLine/, '私有来源追踪字段'],
    [/interview-summer-|秋招\.md/, '私有面经迁移标记'],
    [/CLEAR_APPLICATIONS_MIGRATION_KEY|COMPLETE_INTERVIEWS_MIGRATION_KEY/, '私用迁移逻辑']
  ];
  for (const [pattern, label] of forbiddenPatterns) {
    check(!pattern.test(html), `index.html 包含${label}`);
  }
}

const gitignorePath = path.join(projectRoot, '.gitignore');
check(fs.existsSync(gitignorePath), '缺少 .gitignore');
if (fs.existsSync(gitignorePath)) {
  const gitignore = fs.readFileSync(gitignorePath, 'utf8');
  for (const privatePath of privatePaths) {
    check(gitignore.includes(`/${privatePath}`), `.gitignore 未排除 /${privatePath}`);
  }
}

const gitResult = spawnSync('git', ['ls-files', '-z'], { cwd: projectRoot, encoding: 'utf8' });
if (gitResult.status === 0) {
  const tracked = gitResult.stdout.split('\0').filter(Boolean);
  const forbiddenTracked = tracked.filter(file =>
    file === '秋招记录.html' ||
    file.startsWith('backups/') ||
    file.startsWith('private/') ||
    file.startsWith('data/') ||
    file.startsWith('exports/') ||
    /\.sqlite(?:-shm|-wal)?$/i.test(file) ||
    /^秋招记录-.*\.(?:json|md)$/i.test(file) ||
    /^秋招投递-.*\.csv$/i.test(file)
  );
  check(!forbiddenTracked.length, `Git 正在跟踪私有文件：${forbiddenTracked.join('、')}`);
}

if (failures.length) {
  process.stderr.write(`隐私检查失败（${failures.length} 项）：\n- ${failures.join('\n- ')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('隐私检查通过：公开版为空白数据，私用页面和备份已排除。\n');
}
