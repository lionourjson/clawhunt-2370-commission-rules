/**
 * 截图 + 录屏脚本（npm run shots）：
 * 1. 构建产物必须先存在（先跑 npm run build）；
 * 2. 启动 vite preview 提供静态服务；
 * 3. 用 playwright-core 驱动本机已安装的 Chrome 无头截图/录屏，输出到 docs/screenshots/ 与 docs/recordings/。
 * 每次截图前先用 waitForSelector 等到能证明该状态的文字/元素出现，等不到就报错退出（不准截无证据的图）。
 * 全部数据为自拟虚构数据。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const REC = path.join(ROOT, 'docs', 'recordings');
const PORT = 5217;
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 1440, height: 900 };

function findLocalBrowser() {
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error('本机未找到 Chrome/Edge，请安装其一，或在 scripts/shots.mjs 的 candidates 里加路径');
}

async function waitForServer(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* 未就绪继续等 */
    }
    if (Date.now() > deadline) throw new Error(`preview 服务 ${url} 启动超时`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

const md5s = new Map();

/** 用真实鼠标事件把 row-2 的 ⠿ 把手拖到 row-1 上（插到 row-1 之前）。 */
async function dragRow2OntoRow1(page) {
  const src = await page.locator('[data-testid="row-handle-row-2"]').boundingBox();
  const dst = await page.locator('[data-testid="rule-row-row-1"]').boundingBox();
  if (!src || !dst) throw new Error('拖拽起/终点元素不可见');
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
  await page.mouse.down();
  await page.mouse.move(dst.x + dst.width / 2, dst.y + 4, { steps: 12 });
  await page.waitForTimeout(200);
  await page.mouse.up();
}
async function shot(page, file, note = '') {
  await page.waitForTimeout(500); // 字体/动画稳定
  const out = path.join(OUT, file);
  await page.screenshot({ path: out, fullPage: false });
  const md5 = createHash('md5').update(await readFile(out)).digest('hex');
  if (md5s.has(md5)) throw new Error(`截图重复：${file} 与 ${md5s.get(md5)} 的 md5 相同（${md5}）`);
  md5s.set(md5, file);
  console.log(`[shots] ${file}  <-  ${note}`);
}

async function main() {
  if (!existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    throw new Error('dist/index.html 不存在：请先运行 npm run build');
  }
  mkdirSync(OUT, { recursive: true });
  mkdirSync(REC, { recursive: true });

  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  try {
    await waitForServer(`${BASE}/`);

    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ executablePath: findLocalBrowser(), headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: VIEWPORT });
    page.setDefaultTimeout(30000);

    // 1. 草稿版本全貌（默认加载最新版本 V3 草稿）
    await page.goto(`${BASE}/commission/rules?mock=success`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="rule-row-row-1"]');
    await page.waitForSelector('[data-testid="version-node-ver-v3"]');
    await shot(page, 'rules-draft.png', '草稿版本 V3 · 12 列规则行 + 版本时间线 + 左侧规则表列表');

    // 2. 已生效版本只读态（验收3）
    await page.goto(`${BASE}/commission/rules?mock=success&version=ver-v2`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="readonly-banner"]');
    const bannerText = await page.textContent('[data-testid="readonly-banner"]');
    if (!bannerText.includes('只读')) throw new Error(`只读横幅文案不对：${bannerText}`);
    await shot(page, 'acceptance3-read-only-active.png', '验收3：进入页面即选中已生效版本 V2，只读横幅出现、无编辑按钮');

    // 3. 空态 / 报错态（左侧规则表列表为空 / 加载失败）
    await page.goto(`${BASE}/commission/rules?mock=empty`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="page-empty"]');
    await shot(page, 'rules-tables-empty.png', 'mock=empty：规则表列表为空态');
    await page.goto(`${BASE}/commission/rules?mock=error`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="page-error"]');
    await shot(page, 'rules-tables-error.png', 'mock=error：加载失败态');

    // 4. 编辑抽屉打开（草稿）
    await page.goto(`${BASE}/commission/rules?mock=success`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="rule-row-row-1"]');
    await page.click('[data-testid="row-edit-row-1"]');
    await page.waitForSelector('[data-testid="drawer-save"]');
    await shot(page, 'drawer-open.png', '编辑抽屉：条件多选 + 阶梯编辑器 + 折扣系数 + 上限 + 主/协签比例');

    // 5. 验收1：阶梯起点不递增 → 报错并高亮
    const tierInput = page.locator('[data-testid="tier-start-1"] input');
    await tierInput.fill('0.00');
    await page.click('[data-testid="drawer-save"]');
    await page.waitForSelector('[data-testid="field-error-tiers.1.start_amount_cents"]');
    const errText = await page.textContent('[data-testid="field-error-tiers.1.start_amount_cents"]');
    if (!errText.includes('递增')) throw new Error(`阶梯校验错误文案不对：${errText}`);
    await shot(page, 'acceptance1-tier-not-ascending.png', '验收1：阶梯起点金额不递增，错误提示 + 对应输入框红色高亮');

    // 6. 主签比例自动计算协签
    await page.locator('[data-testid="drawer-primary-ratio"] input').fill('70');
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="drawer-assist-ratio"] input');
      return el && el.value === '30.00';
    });
    await shot(page, 'drawer-assist-auto-calc.png', '输入主签 70% → 协签自动显示 30.00%（合计 100%）');
    await page.click('[data-testid="drawer-cancel"]');

    // 7. 提交审批弹窗：生效日期今天及以前禁用
    await page.click('[data-testid="submit-btn"]');
    await page.waitForSelector('[data-testid="submit-confirm"]');
    await page.click('input[placeholder="选择生效日期（今天及以前不可选）"]');
    await page.waitForSelector('.t-date-picker__cell--disabled');
    await shot(page, 'submit-modal-disabled-dates.png', '提交审批弹窗：变更说明 + 生效日期，今天及以前的日期呈禁用样式');

    // 8. 录屏（验收4）：拖拽调整优先级 → 「排序已保存」→ 服务端顺序回读
    const videoContext = await browser.newContext({
      viewport: VIEWPORT,
      recordVideo: { dir: REC, size: { width: 1280, height: 800 } },
    });
    const vpage = await videoContext.newPage();
    vpage.setDefaultTimeout(30000);
    await vpage.goto(`${BASE}/commission/rules?mock=success`, { waitUntil: 'domcontentloaded' });
    await vpage.waitForSelector('[data-testid="rule-row-row-1"]');
    await vpage.waitForSelector('[data-testid="row-priority-row-2"]');
    const before = await vpage.textContent('[data-testid="row-priority-row-2"]');
    if (before !== '2') throw new Error(`拖拽前 row-2 优先级应为 2，实际 ${before}`);
    await dragRow2OntoRow1(vpage);
    // 「排序保存中」是瞬态，直接等最终的「排序已保存」与服务端回读的顺序
    await vpage.waitForSelector('[data-testid="priority-saved"]', { timeout: 15000 });
    const savedText = await vpage.textContent('[data-testid="priority-saved"]');
    if (savedText !== '排序已保存') throw new Error(`保存提示不对：${savedText}`);
    await vpage.waitForFunction(() => document.querySelector('[data-testid="row-priority-row-2"]')?.textContent === '1');
    console.log('[shots] 拖拽后 row-2 优先级=1（服务端回读），录屏中');
    await vpage.waitForTimeout(800);
    const videoPath = await vpage.video().path();
    await videoContext.close();
    const finalVideo = path.join(REC, 'acceptance4-priority-drag.webm');
    renameSync(videoPath, finalVideo);
    console.log(`[shots] 录屏：${finalVideo}（验收4：拖拽调整优先级 → 排序已保存 → 保存后顺序回读）`);

    // 9. 拖拽后的表格截图（新页面会话：mock 存储按会话隔离，重新执行同一拖拽保证状态一致）
    await page.goto(`${BASE}/commission/rules?mock=success`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="rule-row-row-1"]');
    await dragRow2OntoRow1(page);
    await page.waitForSelector('[data-testid="priority-saved"]', { timeout: 15000 });
    await page.waitForFunction(() => document.querySelector('[data-testid="row-priority-row-2"]')?.textContent === '1');
    await shot(page, 'acceptance4-priority-after-saved.png', '验收4：拖拽后优先级顺序变化且提示「排序已保存」（row-2 升为第 1）');

    await browser.close();
    console.log(`[shots] 完成，共 ${md5s.size} 张，输出目录：${OUT}`);
  } finally {
    server.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error('[shots] 失败：', err.message);
  process.exit(1);
});
