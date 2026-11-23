/**
 * 单位换算工具（#2370 交付物 D2）。
 * 约定（工单统一技术规范）：金额一律以分存整数；费率/比例以基点（bp，1bp = 0.01%）存整数。
 * 输入层：起点金额按「元」输入，费率按「百分比、最多两位小数」输入。
 * 提交层：一律转为整数（分 / bp）后提交给后端。
 */

/** 元输入转分（表单层），非法输入返回 NaN。金额一律以分存整数。 */
export function yuanToFen(yuan: string): number {
  const n = Number(yuan);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

/** 分转元展示字符串（展示层）。 */
export function fenToYuan(fen: number): string {
  if (!Number.isInteger(fen)) {
    throw new TypeError(`金额必须以分存整数，收到：${fen}`);
  }
  return (fen / 100).toFixed(2);
}

/**
 * 百分比输入转基点（bp）。"5.25" → 525。
 * 最多允许两位小数（工单要求「按百分比两位小数输入」），超过或非法输入返回 NaN。
 * 负数返回 NaN（费率/比例不允许为负）。
 */
export function percentToBp(percent: string): number {
  const trimmed = percent.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return NaN;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

/** 基点转百分比展示字符串（两位小数）。525 → "5.25"。 */
export function bpToPercent(bp: number): string {
  if (!Number.isInteger(bp) || bp < 0) {
    throw new TypeError(`基点必须是非负整数，收到：${bp}`);
  }
  return (bp / 100).toFixed(2);
}

/**
 * 提交审批生效日期是否应禁用：今天及以前的日期一律禁用（工单要求）。
 * 参数为本地时区的 Date（TDesign DatePicker disableDate 回调入参）。
 */
export function isDisabledEffectiveDate(date: Date, now: Date = new Date()): boolean {
  const dayStart = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return dayStart(date) <= dayStart(now);
}
