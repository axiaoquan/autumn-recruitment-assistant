# Autumn Recruitment Assistant · 秋招助手

一个完全离线、无需安装即可使用的校招投递与面试记录工具。项目只有一个公开运行文件 `index.html`，适用于 macOS 和 Windows。

## 特点

- 投递记录：公司、岗位、城市、方向、批次、投递时间和下一步行动；
- 状态管理：已投递、简历筛选中、笔试中、等待约面中、面试中、录用评估中、已 Offer、已拒绝、已撤回、岗位关闭；
- 状态筛选与快捷更新，并保留完整状态历史；
- 面试记录：轮次、时间、问题、回答、追问、反馈、结果和复盘；
- 可视化总览：公司数、岗位数、活跃流程、Offer 数、状态分布、方向和城市分布；
- JSON 完整备份与恢复，CSV / Markdown 导入导出；
- 所有数据只保存在当前浏览器本地，不连接服务器、不请求外部网站。

## 开始使用

### macOS

1. 下载项目 ZIP 并解压，或使用 Git 克隆项目；
2. 双击 `index.html`；
3. 如果系统询问打开方式，选择 Safari、Chrome、Edge 或 Firefox。

### Windows

1. 下载项目 ZIP 并解压，或使用 Git 克隆项目；
2. 双击 `index.html`；
3. 选择 Edge、Chrome 或 Firefox 打开。

页面本身不需要 Node.js、Python、数据库或本地服务器。建议固定使用同一个浏览器和同一个文件位置，因为不同浏览器的本地存储彼此独立。

## 数据与隐私

公开仓库中的 `index.html` 是空白模板，不包含任何用户、投递或面试数据。你在页面中填写的数据优先保存在浏览器 IndexedDB 中，不会写回 HTML，也不会自动进入 Git。

请注意：

- 清理浏览器数据、换浏览器、移动到另一台电脑前，先在“数据”页导出完整 JSON；
- 导出的 JSON、CSV 和 Markdown 可能包含个人信息，不要提交到公开仓库；
- 默认 `.gitignore` 已排除常见导出文件、`data/`、`exports/`、`private/` 和备份目录；
- 发布前运行 `node scripts/check.mjs`，确认公开模板为空并检查敏感路径。

更完整的边界说明见 [PRIVACY.md](./PRIVACY.md)。

## 导入与导出

页面“数据”页支持：

- JSON：完整备份、合并和覆盖恢复；
- CSV：批量导入或导出投递记录；
- Markdown：导入公司/岗位信息，或导出便于阅读的投递和面试记录。

只有 JSON 能完整往返恢复公司、投递、状态历史和面试。字段说明见 [DATA_INTERFACE.md](./DATA_INTERFACE.md)，数据契约见 [ledger.schema.json](./ledger.schema.json)。

## 可选命令行工具

命令行工具仅用于批量处理数据，页面日常使用不依赖它。需要 Node.js 18 或更高版本，不需要安装 npm 依赖。

macOS / Linux：

```bash
./scripts/ledger help
./scripts/ledger validate backup.json
./scripts/ledger import-csv backup.json new-applications.csv merged.json
```

Windows：

```bat
scripts\ledger.cmd help
scripts\ledger.cmd validate backup.json
scripts\ledger.cmd import-csv backup.json new-applications.csv merged.json
```

所有系统也可以直接使用：

```bash
node scripts/ledger-cli.mjs help
```

## 项目结构

```text
.
├── index.html                    # 可公开的空白离线应用
├── ledger.schema.json            # JSON Schema
├── DATA_INTERFACE.md             # 导入、导出与 JavaScript 接口
├── PRIVACY.md                    # 隐私边界和发布检查
├── scripts/
│   ├── ledger                    # macOS / Linux 命令入口
│   ├── ledger.cmd                # Windows 命令入口
│   ├── ledger-cli.mjs            # 跨平台数据脚本
│   ├── check.mjs                 # 完整质量检查
│   ├── privacy-check.mjs         # 隐私检查
│   └── sanitize-release.mjs      # 从私用页面生成空白公开版
└── .github/workflows/quality.yml # GitHub Actions 检查
```

## 本地开发与检查

项目没有构建步骤。修改 `index.html` 后直接刷新浏览器即可。

```bash
node scripts/check.mjs
```

检查内容包括：

- 公开版四类初始数据均为空；
- HTML 内嵌 JSON 和主脚本语法正确；
- 页面不依赖外部脚本、网络请求或 CDN；
- 私用页面和备份目录已被 `.gitignore` 排除；
- 公开版不包含本机用户路径、私有来源字段或历史面经迁移标记。

推送和 Pull Request 会通过 GitHub Actions 自动重复这些检查。

## 从私用版本生成公开版本

如果维护者在私用页面上继续开发，可重新生成公开模板：

```bash
node scripts/sanitize-release.mjs private-ledger.html index.html
node scripts/check.mjs
```

生成脚本会清空公司、投递、状态历史和面试，并为公开版使用独立的浏览器存储键。不要只依赖自动清理；提交前仍应查看 `git diff --cached`。

## 浏览器 JavaScript 接口

页面加载后提供 `window.AutumnLedger`，可用于自动化导入、导出和状态更新。示例和方法列表见 [DATA_INTERFACE.md](./DATA_INTERFACE.md)。

## 发布前检查

```bash
node scripts/check.mjs
git status --short --ignored
git diff --cached
```

确认 `秋招记录.html`、`backups/`、个人导出文件和其他私有资料均显示为忽略状态，且暂存区只包含公开框架文件。
