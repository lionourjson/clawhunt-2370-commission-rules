import { describe, expect, it } from 'vitest';
import { bpToPercent, isDisabledEffectiveDate, percentToBp, yuanToFen } from './units';
import { fenToYuan } from './money';

describe('单位换算（#2370 验收2：Rate 5.25 → 525 bp；起点 1000.50 → 100050 分）', () => {
  it('验收2：费率 5.25（%）提交为 525 bp', () => {
    expect(percentToBp('5.25')).toBe(525);
  });

  it('验收2：起点金额 1000.50（元）提交为 100050 分', () => {
    expect(yuanToFen('1000.50')).toBe(100050);
  });

  it('百分比转 bp：一位小数、无小数、最小粒度', () => {
    expect(percentToBp('10')).toBe(1000);
    expect(percentToBp('0.5')).toBe(50);
    expect(percentToBp('0.01')).toBe(1);
    expect(percentToBp('0')).toBe(0);
    expect(percentToBp(' 8.25 ')).toBe(825);
  });

  it('百分比转 bp：超过两位小数、非法输入、负数一律 NaN', () => {
    expect(percentToBp('5.256')).toBeNaN();
    expect(percentToBp('5.2.5')).toBeNaN();
    expect(percentToBp('abc')).toBeNaN();
    expect(percentToBp('')).toBeNaN();
    expect(percentToBp('-1')).toBeNaN();
    expect(percentToBp('1e3')).toBeNaN();
  });

  it('bp 转百分比展示（两位小数）', () => {
    expect(bpToPercent(525)).toBe('5.25');
    expect(bpToPercent(1000)).toBe('10.00');
    expect(bpToPercent(0)).toBe('0.00');
  });

  it('bpToPercent 只接受非负整数', () => {
    expect(() => bpToPercent(5.5)).toThrow(TypeError);
    expect(() => bpToPercent(-1)).toThrow(TypeError);
  });

  it('fenToYuan/yuanToFen 往返一致（以分存整数）', () => {
    expect(yuanToFen(fenToYuan(100050))).toBe(100050);
    expect(yuanToFen(fenToYuan(1))).toBe(1);
  });

  it('提交审批日期：今天及以前禁用，明天起可选', () => {
    const now = new Date(2026, 10, 19, 15, 30, 0); // 2026-11-19 15:30
    expect(isDisabledEffectiveDate(new Date(2026, 10, 19, 0, 0, 0), now)).toBe(true); // 今天
    expect(isDisabledEffectiveDate(new Date(2026, 10, 19, 23, 59, 0), now)).toBe(true); // 今天深夜
    expect(isDisabledEffectiveDate(new Date(2026, 10, 18, 10, 0, 0), now)).toBe(true); // 昨天
    expect(isDisabledEffectiveDate(new Date(2026, 10, 20, 0, 0, 0), now)).toBe(false); // 明天
    expect(isDisabledEffectiveDate(new Date(2026, 11, 1, 0, 0, 0), now)).toBe(false); // 下月
  });
});
