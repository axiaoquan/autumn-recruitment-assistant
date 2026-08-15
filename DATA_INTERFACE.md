# 秋招记录数据接口

项目的数据交换版本为 `schemaVersion: 1`。日常使用不需要命令行；双击 `index.html` 后，在“数据”页完成导入和导出即可。

## 1. 保存位置与备份

- HTML 是程序本体，不会在新增记录后被重写。
- 记录优先保存在当前浏览器的 IndexedDB；浏览器不支持时回退到 `localStorage`。
- 清理浏览器网站数据、换浏览器或换电脑前，必须导出“全量 JSON”。
- JSON 是唯一保证完整恢复公司、投递、状态历史和面试的格式。
- CSV 用于批量新增或编辑投递；Markdown 用于阅读归档和从旧文档补充公司、岗位。

## 2. JSON 顶层结构

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-08-15T12:00:00.000Z",
  "settings": { "currentBatch": "2027-autumn" },
  "metadata": { "lastExportAt": null },
  "companies": [],
  "applications": [],
  "statusEvents": [],
  "interviews": []
}
```

完整字段约束见 [`ledger.schema.json`](./ledger.schema.json)。应用和命令行脚本还会额外校验：

- 所有实体 ID 在整个文件内唯一；
- `application.companyId` 必须引用已有公司；
- 状态历史必须引用已有投递；面试可以关联投递，也可以使用 `companyName` 和 `positionName` 独立保存；
- 投递状态必须属于固定状态集合。

## 3. 导入语义

### 合并 `merge`

- 公司优先按 ID 匹配，其次按标准化公司名匹配。
- 投递优先按 ID 匹配；无 ID 命中时，按“公司 + 标准化岗位名 + 招聘批次 + 投递日期”匹配。
- 已存在记录会更新；新记录会追加。
- 仅导入文件中出现的内容，不会删除现有记录。
- 每次导入前，页面会在本地保留一个恢复点。

### 覆盖 `replace`

- 只接受包含四个实体数组的完整 JSON。
- 当前数据会被整体替换，但仍保留一个“导入前数据”恢复点。
- CSV 和 Markdown 不允许覆盖模式。

## 4. CSV 接口

CSV 每行表示一条投递。至少需要“公司”和“岗位”两列；也接受下列英文列名。

| 中文列 | 英文列 | 必填 | 说明 |
|---|---|---:|---|
| 记录ID | `id` | 否 | 留空时生成新 ID |
| 公司 | `company` | 是* | 与 `companyId` 二选一 |
| 公司ID | `companyId` | 是* | 与公司名二选一 |
| 岗位 | `title` | 是 | 岗位名称 |
| 城市 | `city` | 否 | 自由文本 |
| 方向 | `direction` | 否 | 自由文本 |
| 状态 | `status` | 否 | 默认“已投递” |
| 招聘批次 | `recruitmentBatch` / `batch` | 否 | 默认使用当前批次 |
| 投递日期 | `appliedAt` | 否 | 建议 `YYYY-MM-DD` |
| 岗位链接 | `jobUrl` | 否 | HTTP/HTTPS 链接 |
| 备注 | `notes` | 否 | 支持换行和引号 |
| 下一步行动 | `nextAction` | 否 | 自由文本 |
| 行动时间 | `nextActionAt` | 否 | 建议 ISO 8601 |

示例：

```csv
公司,岗位,城市,方向,状态,招聘批次,投递日期,下一步行动
示例科技,算法工程师,深圳,机器学习,已投递,2027-autumn,2026-08-15,准备笔试
```

## 5. Markdown 接口

三级标题识别为公司，四级标题识别为岗位：

```markdown
### 示例科技

#### 算法工程师

- 状态：已投递
- 招聘批次：2027-autumn
- 城市：深圳
- 方向：机器学习
```

Markdown 只有公司标题时，只会补充公司清单，不会猜测岗位或状态。Markdown 导出会包含独立面经供阅读，但 Markdown 导入只解析公司和投递；完整往返恢复仍应使用 JSON。

## 6. 浏览器 JavaScript 接口

页面加载后会暴露只读入口对象 `window.AutumnLedger`。所有写操作均返回 Promise，并在写入前校验数据。

```js
await AutumnLedger.ready

const snapshot = await AutumnLedger.getSnapshot()
const json = await AutumnLedger.exportData('json')
const csv = await AutumnLedger.exportData('csv')
const markdown = await AutumnLedger.exportData('markdown')

await AutumnLedger.importData(jsonText, {
  format: 'json',       // json | csv | markdown
  mode: 'merge'         // merge | replace
})

const company = await AutumnLedger.upsertCompany({
  name: '示例科技',
  notes: ''
})

const application = await AutumnLedger.upsertApplication({
  companyName: '示例科技', // 也可传 companyId；新公司会自动加入清单
  title: '算法工程师',
  status: '已投递',
  recruitmentBatch: '2027-autumn'
})

await AutumnLedger.updateStatus(application.id, '面试中', '一面已约')

await AutumnLedger.upsertInterview({
  applicationId: null,
  companyName: '示例科技',
  positionName: '算法工程师',
  round: '一面',
  questions: '面试问题…'
})
```

可用方法：

- `getSnapshot()`
- `validate(snapshot)`
- `importData(input, options)`
- `exportData(format)`
- `upsertCompany(data)`
- `upsertApplication(data)`
- `updateStatus(applicationId, status, note)`
- `upsertInterview(data)`
- `deleteApplication(id)`
- `deleteInterview(id)`
- `resetToInitial()`

写入完成后，页面会触发 `autumn-ledger:change` DOM 事件。

## 7. 命令行脚本

脚本需要 Node.js 18 或更高版本，不需要 `npm install`。它总是把合并结果写入新的输出文件，不原地覆盖基准备份。

macOS / Linux：

```bash
./scripts/ledger validate backup.json
./scripts/ledger merge base.json incoming.json merged.json
./scripts/ledger import-csv base.json new-applications.csv merged.json
./scripts/ledger import-md base.json notes.md merged.json
./scripts/ledger extract-html index.html initial.json
./scripts/ledger export-csv backup.json applications.csv
./scripts/ledger export-md backup.json applications.md
```

Windows：

```bat
scripts\ledger.cmd validate backup.json
scripts\ledger.cmd merge base.json incoming.json merged.json
scripts\ledger.cmd import-csv base.json new-applications.csv merged.json
scripts\ledger.cmd import-md base.json notes.md merged.json
scripts\ledger.cmd extract-html index.html initial.json
scripts\ledger.cmd export-csv backup.json applications.csv
scripts\ledger.cmd export-md backup.json applications.md
```

脚本生成的 JSON 可在页面“数据 → 导入新信息”中使用覆盖或合并模式重新导入。
