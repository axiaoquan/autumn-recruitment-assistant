#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

function fail(message) {
  process.stderr.write(`错误：${message}\n`);
  process.exitCode = 1;
}

const [sourceArg, outputArg] = process.argv.slice(2);
if (!sourceArg || !outputArg) {
  fail('用法：node scripts/sanitize-release.mjs <私用 HTML> <公开版 HTML>');
} else {
  const sourcePath = path.resolve(sourceArg);
  const outputPath = path.resolve(outputArg);
  if (sourcePath === outputPath) {
    fail('输入和输出不能是同一个文件');
  } else {
    let html = fs.readFileSync(sourcePath, 'utf8');
    const initialData = {
      schemaVersion: 1,
      exportedAt: null,
      settings: { currentBatch: '2027-autumn' },
      metadata: { distribution: 'public-template', lastExportAt: null },
      companies: [],
      applications: [],
      statusEvents: [],
      interviews: []
    };

    const initialDataPattern = /<script\s+id=["']initialData["']\s+type=["']application\/json["']>[\s\S]*?<\/script>/i;
    if (!initialDataPattern.test(html)) {
      throw new Error('没有找到 initialData 数据块');
    }
    html = html.replace(
      initialDataPattern,
      `<script id="initialData" type="application/json">\n${JSON.stringify(initialData, null, 2)}\n  </script>`
    );

    html = html
      .replace('<title>秋招记录</title>', '<title>秋招助手</title>')
      .replace('<h1>秋招记录</h1>', '<h1>秋招助手</h1>')
      .replace("const DB_NAME = 'autumn-ledger-offline-v1';", "const DB_NAME = 'autumn-ledger-public-v1';")
      .replace("const STORAGE_KEY = 'autumn-ledger-snapshot-v1';", "const STORAGE_KEY = 'autumn-ledger-public-snapshot-v1';")
      .replace("const PREVIOUS_KEY = 'autumn-ledger-previous-v1';", "const PREVIOUS_KEY = 'autumn-ledger-public-previous-v1';")
      .replace(/^\s*const CLEAR_APPLICATIONS_MIGRATION_KEY.*\n/m, '')
      .replace(/^\s*const COMPLETE_INTERVIEWS_MIGRATION_KEY.*\n/m, '')
      .replace(
        '按面试时间倒序展示，越新的越靠上；未记录具体日期的暑期面经按原文先后排序。',
        '按面试时间倒序展示，越新的越靠上；未填写时间时按创建时间排序。'
      );

    const initializePattern = /    async function initialize\(\) \{[\s\S]*?\n    \}\n\n    const ready = initialize\(\);/;
    const publicInitialize = `    async function initialize() {
      await detectStorage();
      try {
        const stored = await storageGet(STORAGE_KEY);
        state = stored ? normalizeSnapshot(stored) : clone(INITIAL_SNAPSHOT);
        if (storageKind !== 'memory') {
          if (!stored) await storageSet(STORAGE_KEY, state);
          previousAvailable = Boolean(await storageGet(PREVIOUS_KEY));
        }
        validateSnapshot(state);
      } catch (error) {
        console.error(error); storageKind = 'memory'; state = clone(INITIAL_SNAPSHOT); toast(\`本地数据读取失败，已使用内置数据：\${error.message}\`, true);
      }
      bindEvents(); renderAll(); updateStorageBadge();
      return true;
    }

    const ready = initialize();`;
    if (!initializePattern.test(html)) {
      throw new Error('没有找到初始化逻辑');
    }
    html = html.replace(initializePattern, publicInitialize);

    const temporaryPath = `${outputPath}.tmp-${process.pid}`;
    fs.writeFileSync(temporaryPath, html, 'utf8');
    fs.renameSync(temporaryPath, outputPath);
    process.stdout.write(`已生成公开版：${outputPath}\n`);
  }
}
