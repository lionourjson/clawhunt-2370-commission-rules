# #2370【S6-COMM-017】佣金规则表配置页（Commission Rules Table Configuration Page）

Member Space Platform · Workbench page `/commission/rules`：左侧规则表列表（全平台 + 单店）、版本时间线（版本号/状态/生效期间/提交人/审批人 + 任意版本复制为新草稿）、草稿版本的 12 列可编辑规则行表格（优先级拖拽排序）、编辑抽屉（条件多选、阶梯编辑器、折扣系数、上限、主/协签比例自动计算）、前端校验（阶梯递增、比例合计 100%）、后端字段路径错误定位、提交审批弹窗（生效日期禁用今天及以前）。

技术栈：Vite + React 18 + TypeScript + TDesign React + Vitest + Testing Library + MSW（mock 接口）。
One-line summary: A React+TS+TDesign configuration page for commission rule tables with version timeline, draft editing, tier validation, yuan→cent / percent→bp unit conversion, drag-and-drop priority sorting, and submit-for-approval flow. All data is fictional; monetary amounts are stored as integers in cents; rates/ratios as integer basis points (bp).

## 快速复跑（陌生人一条命令序列即可复现）

```bash
npm ci
npm test          # 10 个测试文件 56 条用例全部通过
npm run build     # tsc + vite build，构建成功
npm run shots     # 需先 npm run build；9 张截图 + 1 段录屏
```

截图输出到 `docs/screenshots/`，录屏输出到 `docs/recordings/`。截图脚本用 playwright-core 驱动本机 Chrome/Edge（自动探测路径），每次截图前先等到能证明该状态的文字/元素出现，等不到直接报错退出；9 张截图 md5 各不相同（脚本内置去重断言）。录屏功能需要 playwright 的 ffmpeg 组件（`npx playwright-core install ffmpeg`，仅为本地构建工具，不是运行时依赖）。

环境：Windows 11 x64、Node v20.18.0、npm 10.8.2。配置全部从环境变量读取（见 `.env.example`）：`VITE_API_BASE_URL`（默认 `/api`）、`VITE_MOCK_SLOW_DELAY_MS`。

## 验收标准逐条对照表

### 1. "When saving with non-increasing tier starting points, an error is prompted and the corresponding input field is highlighted (screenshot)"

- **实现**：前端保存前校验在 `src/pages/CommissionRulesPage.tsx` 的 `validateDraftFrontend()`——逐级比较 `yuanToFen()` 换算后的起点金额，非递增时在字段路径 `tiers.{i}.start_amount_cents` 下生成错误「阶梯起点金额必须递增」；抽屉里对应输入框加红色边框高亮（`ERROR_HIGHLIGHT_STYLE`）并显示错误文案。mock 后端在 `src/mocks/handlers.ts` 的 `validateRuleRow()` 做同样兜底校验，返回 HTTP 422 + 字段路径错误数组（`src/api/client.ts` 的 `ApiValidationError` 负责解析并定位）。
- **证据**：`docs/screenshots/acceptance1-tier-not-ascending.png`——编辑抽屉中第 2 级起点被改为 0.00 元（等于第 1 级的 0.00 元），第 2 级起点输入框呈红色边框，下方显示红字「阶梯起点金额必须递增」，未调用保存接口。
- **测试**：`src/pages/CommissionRulesPage.test.tsx` 用例「验收1：阶梯起点金额不递增 → 前端校验报错并高亮对应输入框」——断言错误文案逐字出现且保存接口未被调用。真实运行通过（见下方测试输出）。

### 2. "Rate input 5.25 is submitted as 525 bp; starting point input 1000.50 is submitted as 100050 cents (unit tests passed)"

- **实现**：单位换算工具 `src/lib/units.ts`——`percentToBp('5.25') === 525`（百分比两位小数 → 基点，正则限制最多两位小数、负数/非法输入返回 NaN）；`yuanToFen('1000.50') === 100050`（元 → 分整数）。抽屉保存时 `draftToRow()` 用这两个函数把全部输入换算为整数分/bp 后才提交。
- **证据**：单元测试 + 组件级断言——`src/pages/CommissionRulesPage.test.tsx` 用例「验收2」拦截保存接口，断言请求体里 `tiers[0].start_amount_cents === 100050`、`tiers[0].rate_bp === 525`。
- **测试**：`src/lib/units.test.ts` 8 条用例（含 5.25→525、1000.50→100050、两位小数限制、负数/非法输入 NaN、bp→% 往返、分↔元往返、生效日期禁用规则）全部通过。

### 3. "When entering the page with an active version, the table is read-only (screenshot)"

- **实现**：`src/pages/CommissionRulesPage.tsx`——`isDraft = detail.version.status === 'draft'`。非草稿版本：顶部显示只读横幅「非草稿版本（已生效）为只读，不可编辑、不可拖拽排序」（`data-testid="readonly-banner"`），表格不渲染编辑按钮、拖拽把手和提交审批按钮；mock 后端对非草稿版本的行保存/排序请求返回 409 兜底。
- **证据**：`docs/screenshots/acceptance3-read-only-active.png`——通过 `?version=ver-v2` 直接进入已生效版本 V2，页面显示「当前版本：V2 · 已生效」+ 只读横幅，表格无操作列、无把手。
- **测试**：用例「验收3：选中已生效版本进入页面 → 只读横幅出现，无编辑按钮、无拖拽把手」断言 `row-edit-*`、`row-handle-*`、`submit-btn` 均不存在。真实运行通过。

### 4. "After drag-and-drop to adjust priority, the saved priority order is correct (screen recording)"

- **实现**：草稿版本表格行首有 ⠿ 拖拽把手（HTML5 draggable）。拖到目标行松手后，前端把拖拽行插到目标行之前，立即 `PUT /api/commission/versions/{id}/priority`（body 为 `ordered_ids` 最终顺序），成功后重新 GET 版本详情、以服务端返回的顺序渲染，并显示提示「排序已保存」（`data-testid="priority-saved"`）。
- **证据**：录屏 `docs/recordings/acceptance4-priority-drag.webm`——把「标准会员转介绍成交（REF-STD-002）」从第 2 位拖到「金卡会员转介绍成交（REF-GOLD-001）」之前，出现「排序已保存」，随后表格以服务端回读的顺序渲染（REF-STD-002 变为第 1）。截图 `docs/screenshots/acceptance4-priority-after-saved.png` 为拖拽后的表格：优先级列 1=REF-STD-002、2=REF-GOLD-001，下方绿字「排序已保存」。
- **测试**：用例「验收4：拖拽调整优先级 → 调用保存接口，保存后顺序以服务端为准」——jsdom 中派发 dragStart/drop，断言保存中/已保存提示出现、保存后 `row-priority-row-2` 文本为 "1"、`row-priority-row-1` 为 "2"（顺序来自 mock 服务端存储回读）。真实运行通过。

## 本单范围逐项对照

| # | 工单范围要求 | 实现位置 | 证据/测试 |
|---|---|---|---|
| S1 | 页面 `/commission/rules`（React+TS+TDesign） | `src/App.tsx` 路由、`src/pages/CommissionRulesPage.tsx` | App.test.tsx 路由用例 |
| S2 | 左侧规则表列表（全平台 + 单店） | `CommissionRulesPage.tsx` aside `rules-table-list`；数据 `src/mocks/commissionData.ts` `COMMISSION_TABLES`（1 全平台 + 2 单店） | 截图 rules-draft.png；默认加载用例断言两种 scope 可见 |
| S3 | 版本时间线（版本号、状态标签、生效期间、提交人、审批人） | `version-timeline` 区块，每节点含 Tag 状态、生效期间、提交/审批人 | 截图 rules-draft.png / acceptance3-read-only-active.png |
| S4 | 任意版本「复制为新草稿」 | 每个版本节点上的「复制为新草稿」按钮 → `POST /commission/versions/{id}/copy` | 用例「复制为新草稿」断言新版本 V4 出现并自动选中 |
| S5 | 草稿显示可编辑表格 | `isDraft` 分支渲染编辑按钮/把手 | 验收3/验收4 用例 |
| S6 | 12 列：优先级(拖拽)/编码/名称/交易类型/会员等级/空间类型/租期区间/线索来源/阶梯摘要/折扣系数/上限/分成比例 | 表头数组，用例逐字断言 12+操作 列名 | 默认加载用例 `expect(headers).toEqual([...])` |
| S7a | 条件多选（交易类型/会员等级/空间类型/线索来源） | 抽屉 fieldset + Checkbox | 截图 drawer-open.png |
| S7b | 阶梯编辑器（增删阶梯；起点元输入→分提交） | 抽屉「添加阶梯/删除」按钮 + `draftToRow()` | 截图 drawer-open.png；units.test.ts |
| S7c | 费率 % 两位小数输入 → bp 提交 | `percentToBp()` | units.test.ts；验收2 用例 |
| S7d | 折扣系数编辑器 | 抽屉 0~1 输入，×100 存整数 | validateDraftFrontend 校验 |
| S7e | 上限（cap） | 抽屉元输入→分提交，留空=无上限 | 表格「上限」列显示 50000.00 元 / 无上限 |
| S7f | 主/协签比例自动计算 | 主签输入后协签 = 100% − 主签（`bpToPercent(10000 - bp)`） | 截图 drawer-assist-auto-calc.png；用例断言 70→30.00 |
| S8 | 前端校验：阶梯递增、比例合计 100% | `validateDraftFrontend()` | 验收1 用例 |
| S9 | 后端字段路径错误显示并定位输入框 | `ApiValidationError` + `field-{path}` 高亮包装 + `field-error-{path}` 文案 | 用例「后端字段路径错误：编码为空」断言「编码不能为空（后端校验）」出现 |
| S10 | 非草稿版本只读 | `readonly-banner` + 后端 409 兜底 | 验收3 用例 + 截图 |
| S11 | 提交审批弹窗（变更说明 + 生效日期禁今天及以前） | Dialog + Textarea + DatePicker `disableDate=isDisabledEffectiveDate` | 截图 submit-modal-disabled-dates.png；units.test.ts 日期用例；提交用例 |
| S12 | mock 接口 | MSW handlers（`src/mocks/handlers.ts`），支持 `?mock=success\|empty\|error\|slow` | 截图 rules-tables-empty.png / rules-tables-error.png |
| D1 | 页面代码 | `src/pages/CommissionRulesPage.tsx` | — |
| D2 | 单位换算工具 + 单测 | `src/lib/units.ts` + `src/lib/units.test.ts` | 8 条用例 |
| D3 | mock 数据 | `src/mocks/commissionData.ts` | — |
| D4 | 截图和录屏 | `docs/screenshots/`（9 张）、`docs/recordings/`（1 段） | shots 脚本内置状态等待 + md5 去重 |
| D5 | README | 本文件 | — |

## 真实运行输出

环境：Windows 11 x64，Node v20.18.0，npm 10.8.2，主要依赖：react 18.3、tdesign-react 1.9.6、msw 2.4.11、vitest 2.0.5、vite 5.4.2。

`npm test`（最后 20 行原始输出）：

```
 ✓ src/lib/treeUtils.test.ts (11 tests) 7ms
 ✓ src/mocks/scenario.test.ts (2 tests) 4ms
 ✓ src/lib/money.test.ts (3 tests) 5ms
 ✓ src/lib/units.test.ts (8 tests) 5ms
 ✓ src/components/PageState.test.tsx (3 tests) 107ms
 ✓ src/pages/MemberFormPage.test.tsx (4 tests) 215ms
 ✓ src/pages/TagTreePage.test.tsx (6 tests) 324ms
 ✓ src/pages/MemberListPage.test.tsx (6 tests) 443ms
 ✓ src/App.test.tsx (3 tests) 248ms
 ✓ src/pages/CommissionRulesPage.test.tsx (10 tests) 965ms

 Test Files  10 passed (10)
      Tests  56 passed (56)
   Start at  00:45:40
   Duration  10.65s
```

（运行期间 stderr 有 React Router v7 future flag 警告，为库的升级提示，不影响测试与构建结果。）

`npm run build`（尾部原始输出）：

```
✓ 4152 modules transformed.
dist/index.html                   0.41 kB │ gzip:  0.36 kB
dist/assets/index-CzxODgUm.css   273.28 kB │ gzip: 29.24 kB
dist/assets/index-sJhc9pB4.js  1,178.49 kB │ gzip: 363.55 kB
✓ built in 11.30s
```

（有 chunk 大于 500 kB 的警告：TDesign + React 未做代码分割，本单是单页配置功能，不影响运行；如需可加 manualChunks，不属于本单范围。）

`npm run shots`（尾部原始输出）：

```
[shots] rules-draft.png  <-  草稿版本 V3 · 12 列规则行 + 版本时间线 + 左侧规则表列表
[shots] acceptance3-read-only-active.png  <-  验收3：进入页面即选中已生效版本 V2，只读横幅出现、无编辑按钮
[shots] rules-tables-empty.png  <-  mock=empty：规则表列表为空态
[shots] rules-tables-error.png  <-  mock=error：加载失败态
[shots] drawer-open.png  <-  编辑抽屉：条件多选 + 阶梯编辑器 + 折扣系数 + 上限 + 主/协签比例
[shots] acceptance1-tier-not-ascending.png  <-  验收1：阶梯起点金额不递增，错误提示 + 对应输入框红色高亮
[shots] drawer-assist-auto-calc.png  <-  输入主签 70% → 协签自动显示 30.00%（合计 100%）
[shots] submit-modal-disabled-dates.png  <-  提交审批弹窗：变更说明 + 生效日期，今天及以前的日期呈禁用样式
[shots] 拖拽后 row-2 优先级=1（服务端回读），录屏中
[shots] 录屏：docs\recordings\acceptance4-priority-drag.webm（验收4）
[shots] acceptance4-priority-after-saved.png  <-  验收4：拖拽后优先级顺序变化且提示「排序已保存」（row-2 升为第 1）
[shots] 完成，共 9 张，输出目录：docs\screenshots
```

## 依赖与集成点（真实接入时改什么）

- 依赖工单：S2-IAM（身份/角色/数据范围）、S2-WB（工作台前端框架）。当前用本仓库的布局壳（`src/layouts/AdminLayout.tsx`）与 MSW mock 充当，真实接入时：
  1. 把 `VITE_API_BASE_URL` 指向真实后端，删除 `src/main.tsx` 里 MSW worker 的启动（或按环境开关）；
  2. mock 接口端点即集成契约：`GET /api/commission/tables`、`GET /api/commission/tables/{id}/versions`、`GET /api/commission/versions/{id}`、`POST /api/commission/versions/{id}/copy`、`PUT /api/commission/versions/{id}/rows/{rowId}`、`PUT /api/commission/versions/{id}/priority`、`POST /api/commission/versions/{id}/submit`；
  3. 后端 422 响应体约定：`{ code: 1, message, errors: [{ field, message }] }`，`field` 为字段路径（如 `code`、`tiers.1.start_amount_cents`、`primary_ratio_bp`），前端按路径定位输入框；
  4. 侧边栏入口挂在 `/commission/rules`（`AdminLayout.tsx` 的 NAV）。
- 提交审批的生效日期禁用规则在前端（`isDisabledEffectiveDate`）与 mock 后端各实现一次，真实后端需保留同等校验（生效日期必须晚于今天）。

## 硬约束遵守

- 金额一律以分存整数（`yuanToFen`/`fenToYuan`，换算用 `Math.round`）；费率/比例以基点（bp）存整数；折扣系数 ×100 存整数。
- 配置与密钥全部从环境变量读取（`.env.example`），代码中无任何密钥。
- 未引入会把数据发送到境外服务器的第三方 SDK（依赖仅 react/react-dom/react-router-dom/tdesign-react/msw 及开发工具链；playwright-core 与 ffmpeg 仅为本机截图/录屏构建工具，不在运行时依赖内）。
- 全部数据为自拟虚构数据（规则行、操作员「张运营（虚构）」、门店「示例联合空间·东湖店（虚构）」等），不出现真实个人/企业信息，不出现客户名。

## 目录结构

```
src/
  pages/CommissionRulesPage.tsx      # #2370 主页面（本单交付物 D1）
  pages/CommissionRulesPage.test.tsx # 10 条用例（4 条验收均有对应用例）
  lib/units.ts / units.test.ts       # 单位换算工具（交付物 D2）
  api/client.ts                      # apiGet/apiPost/apiPut + ApiValidationError（422 字段路径错误）
  mocks/commissionData.ts            # 佣金规则表 mock 数据（交付物 D3）
  mocks/handlers.ts                  # MSW 处理器（含 mock 后端校验与字段路径错误）
  layouts/ components/ pages/...     # 工作台布局壳与模板示例页（充当 S2-WB 依赖桩）
scripts/shots.mjs                    # 截图+录屏脚本（先等状态文字出现，md5 去重）
docs/screenshots/  docs/recordings/  # 交付物 D4
```
