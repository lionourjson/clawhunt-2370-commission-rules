import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import CommissionRulesPage from './CommissionRulesPage';
import { server } from '../setupTests';
import { createHandlers, resetCommissionMockStore } from '../mocks/handlers';
import type { RuleRow } from '../mocks/commissionData';

/** TDesign 的 Input/Textarea 把 data-testid 落在包装元素上（有的组件直接落在输入框本身），取真正的输入框。 */
function inputOf(testId: string): HTMLInputElement {
  const wrapper = screen.getByTestId(testId);
  if (wrapper instanceof HTMLInputElement || wrapper instanceof HTMLTextAreaElement) return wrapper as HTMLInputElement;
  const el = wrapper.querySelector('input, textarea') as HTMLInputElement | null;
  if (!el) throw new Error(`${testId} 内没有找到 input/textarea`);
  return el;
}

function fillInput(testId: string, value: string) {
  fireEvent.change(inputOf(testId), { target: { value } });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/commission/rules']}>
      <CommissionRulesPage />
    </MemoryRouter>,
  );
}

async function openDrawerForFirstRow() {
  await waitFor(() => expect(screen.getByTestId('row-edit-row-1')).toBeInTheDocument());
  fireEvent.click(screen.getByTestId('row-edit-row-1'));
  await waitFor(() => expect(screen.getByTestId('drawer-save')).toBeInTheDocument());
}

describe('CommissionRulesPage（佣金规则表配置页 #2370）', () => {
  it('默认加载：左侧规则表列表、版本时间线、草稿版本 12 列规则行', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('rules-table-item-tbl-group-referral')).toBeInTheDocument());
    // 全平台 + 单店两个条目都可见
    expect(screen.getByText('全平台引荐佣金规则表')).toBeInTheDocument();
    expect(screen.getByText(/单店 · 示例联合空间·东湖店（虚构）/)).toBeInTheDocument();
    // 默认选中最新版本（V3 草稿，可编辑）
    await waitFor(() => expect(screen.getByTestId('current-version-label').textContent).toContain('V3 · 草稿'));
    await waitFor(() => expect(screen.getByTestId('rule-row-row-1')).toBeInTheDocument());
    // 12 列表头
    const headers = Array.from(screen.getAllByRole('columnheader')).map((th) => th.textContent);
    expect(headers).toEqual([
      '优先级（拖拽排序）',
      '编码',
      '名称',
      '交易类型',
      '会员等级',
      '空间类型',
      '租期区间',
      '线索来源',
      '阶梯摘要',
      '折扣系数摘要',
      '封顶',
      '分配比例',
      '操作',
    ]);
    expect(screen.getByText('金卡会员转介绍成交')).toBeInTheDocument();
    expect(screen.getByText('REF-GOLD-001')).toBeInTheDocument();
  });

  it('验收3：选中已生效版本进入页面 → 只读横幅出现，无编辑按钮、无拖拽把手', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('version-node-ver-v2')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('version-node-ver-v2'));
    await waitFor(() => expect(screen.getByTestId('readonly-banner')).toBeInTheDocument());
    expect(screen.getByTestId('readonly-banner').textContent).toContain('非草稿版本（已生效）为只读');
    expect(screen.getByTestId('current-version-label').textContent).toContain('V2 · 已生效');
    await waitFor(() => expect(screen.getByTestId('rule-row-row-1')).toBeInTheDocument());
    expect(screen.queryByTestId('row-edit-row-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('row-handle-row-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('submit-btn')).not.toBeInTheDocument();
  });

  it('验收1：阶梯起点金额不递增 → 前端校验报错并高亮对应输入框', async () => {
    renderPage();
    await openDrawerForFirstRow();
    // 第 2 级起点改为 0.00（元），等于第 1 级的 0 元起点 → 递增被破坏
    fillInput('tier-start-1', '0.00');
    fireEvent.click(screen.getByTestId('drawer-save'));
    await waitFor(() => expect(screen.getByTestId('field-error-tiers.1.start_amount_cents')).toBeInTheDocument());
    expect(screen.getByTestId('field-error-tiers.1.start_amount_cents').textContent).toBe('阶梯起点金额必须递增');
    // 对应输入框被红色高亮（field 包装元素存在，错误信息出现即定位成功）
    expect(screen.getByTestId('field-tiers.1.start_amount_cents')).toBeInTheDocument();
    // 未调用保存接口（前端拦截）
    expect(screen.queryByTestId('drawer-success')).not.toBeInTheDocument();
  });

  it('验收2：起点 1000.50 元 → 提交 100050 分；费率 5.25% → 提交 525 bp（保存接口收到换算后的整数）', async () => {
    let captured: RuleRow | undefined;
    server.use(
      http.put('*/commission/versions/:versionId/rows/:rowId', async ({ request }) => {
        captured = (await request.json()) as RuleRow;
        return HttpResponse.json({ code: 0, data: captured });
      }),
    );
    renderPage();
    await openDrawerForFirstRow();
    fillInput('tier-start-0', '1000.50');
    fillInput('tier-rate-0', '5.25');
    fireEvent.click(screen.getByTestId('drawer-save'));
    await waitFor(() => expect(screen.getByTestId('drawer-success')).toBeInTheDocument());
    expect(captured).toBeDefined();
    expect(captured?.tiers[0].start_amount_cents).toBe(100050);
    expect(captured?.tiers[0].rate_bp).toBe(525);
  });

  it('验收4：拖拽调整优先级 → 调用保存接口，保存后顺序以服务端为准（row-2 变为第 1）', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('rule-row-row-1')).toBeInTheDocument());
    expect(screen.getByTestId('row-priority-row-2').textContent).toBe('2');
    // 把 row-2（标准会员转介绍成交）拖到 row-1 上（插到它前面）
    fireEvent.dragStart(screen.getByTestId('row-handle-row-2'), { dataTransfer: { setData: () => undefined } });
    fireEvent.drop(screen.getByTestId('rule-row-row-1'), { dataTransfer: {} });
    await waitFor(() => expect(screen.getByTestId('priority-saving')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('priority-saved')).toBeInTheDocument());
    expect(screen.getByTestId('priority-saved').textContent).toBe('排序已保存');
    // 保存后从服务端刷新：row-2 的优先级变为 1
    await waitFor(() => expect(screen.getByTestId('row-priority-row-2').textContent).toBe('1'));
    expect(screen.getByTestId('row-priority-row-1').textContent).toBe('2');
  });

  it('抽屉：输入主签比例 70 → 协签自动显示 30.00（合计 100%）', async () => {
    renderPage();
    await openDrawerForFirstRow();
    fillInput('drawer-primary-ratio', '70');
    await waitFor(() => expect(inputOf('drawer-assist-ratio').value).toBe('30.00'));
  });

  it('后端字段路径错误：编码为空 → 显示后端错误并高亮编码输入框', async () => {
    renderPage();
    await openDrawerForFirstRow();
    fillInput('drawer-code', '');
    fireEvent.click(screen.getByTestId('drawer-save'));
    await waitFor(() => expect(screen.getByTestId('field-error-code')).toBeInTheDocument());
    expect(screen.getByTestId('field-error-code').textContent).toBe('编码不能为空（后端校验）');
    expect(screen.getByTestId('field-code')).toBeInTheDocument();
  });

  it('复制为新草稿：任意版本可复制，新草稿出现在时间线并自动选中', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('version-copy-ver-v1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('version-copy-ver-v1'));
    await waitFor(() => expect(screen.getByTestId('copy-success')).toBeInTheDocument());
    expect(screen.getByTestId('copy-success').textContent).toContain('已复制为新草稿 V4');
    // 新草稿自动选中：当前版本标签变为 V4 · 草稿
    await waitFor(() => expect(screen.getByTestId('current-version-label').textContent).toContain('V4 · 草稿'));
    // 复制出的行数与源版本一致（V1 有 2 行）
    await waitFor(() => {
      const rows = screen.getAllByText(/^REF-|^EVENT-|^RENEW-/);
      expect(rows.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('提交审批：变更说明为空 → 字段错误；填写后提交成功，版本状态变为待审批', async () => {
    server.use(
      http.post('*/commission/versions/:versionId/submit', async ({ request }) => {
        const body = (await request.json()) as { change_description: string; effective_date: string };
        return HttpResponse.json({
          code: 0,
          data: { id: 'ver-v3', table_id: 'tbl-group-referral', version_no: 'V3', status: 'pending_approval', effective_from: body.effective_date, effective_to: null, submitted_by: '测试（虚构）', approved_by: null },
        });
      }),
    );
    renderPage();
    await waitFor(() => expect(screen.getByTestId('submit-btn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('submit-btn'));
    await waitFor(() => expect(screen.getByTestId('submit-confirm')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('submit-confirm'));
    await waitFor(() => expect(screen.getByTestId('field-error-change_description')).toBeInTheDocument());
    fillInput('submit-desc', '调整金卡会员转介绍费率（测试提交）');
    // TDesign DatePicker 在按下 Enter（onEnter）时才提交输入值：先 change 再 keyDown Enter
    const dateInput = screen.getByPlaceholderText('选择生效日期（今天及以前不可选）');
    fireEvent.change(dateInput, { target: { value: '2027-01-01' } });
    fireEvent.keyDown(dateInput, { key: 'Enter', code: 'Enter' });
    fireEvent.click(screen.getByTestId('submit-confirm'));
    await waitFor(() => expect(screen.getByTestId('submit-success')).toBeInTheDocument());
    expect(screen.getByTestId('submit-success').textContent).toContain('已提交审批');
  });

  it('切换规则表：点击单店规则表 → 右侧加载该表的版本与规则行', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('rules-table-item-tbl-club-donghu')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('rules-table-item-tbl-club-donghu'));
    // 单店版本 V1 自动选中，右侧规则行换为该表的行（EVENT-003 / RENEW-004）
    await waitFor(() => expect(screen.getByTestId('current-version-label').textContent).toContain('V1 · 已生效'));
    await waitFor(() => expect(screen.getByText('运营活动线索新签')).toBeInTheDocument());
    expect(screen.queryByText('金卡会员转介绍成交')).not.toBeInTheDocument();
  });

  it('点击规则行打开编辑抽屉（草稿版本）', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('rule-row-row-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('rule-row-row-1'));
    await waitFor(() => expect(screen.getByTestId('drawer-save')).toBeInTheDocument());
    expect(inputOf('drawer-code').value).toBe('REF-GOLD-001');
  });

  it('阶梯可增删档位：添加后出现第 3 级输入，删除后回到 2 级', async () => {
    renderPage();
    await openDrawerForFirstRow();
    expect(screen.getAllByTestId(/^tier-start-\d+$/)).toHaveLength(2);
    fireEvent.click(screen.getByTestId('tier-add'));
    await waitFor(() => expect(screen.getAllByTestId(/^tier-start-\d+$/)).toHaveLength(3));
    fireEvent.click(screen.getByTestId('tier-remove-2'));
    await waitFor(() => expect(screen.getAllByTestId(/^tier-start-\d+$/)).toHaveLength(2));
  });

  it('阶梯边界：起点相等与负数起点都不递增 → 前端报错并定位对应输入框', async () => {
    renderPage();
    await openDrawerForFirstRow();
    // 相等起点：0.00 与 0.00 → 不递增
    fillInput('tier-start-1', '0.00');
    fireEvent.click(screen.getByTestId('drawer-save'));
    await waitFor(() => expect(screen.getByTestId('field-error-tiers.1.start_amount_cents')).toBeInTheDocument());
    expect(screen.getByTestId('field-error-tiers.1.start_amount_cents').textContent).toBe('阶梯起点金额必须递增');
    // 负数起点 → 第 2 级起点本身非法
    fillInput('tier-start-1', '-1');
    fireEvent.click(screen.getByTestId('drawer-save'));
    await waitFor(() =>
      expect(screen.getByTestId('field-error-tiers.1.start_amount_cents').textContent).toBe(
        '起点金额须为不小于 0 的金额（元）',
      ),
    );
  });

  it('比例边界：主签 100%、0%、-1 都被前端校验拦住并定位主签输入框', async () => {
    for (const bad of ['100', '0', '-1']) {
      renderPage();
      await openDrawerForFirstRow();
      fillInput('drawer-primary-ratio', bad);
      fireEvent.click(screen.getByTestId('drawer-save'));
      await waitFor(() => expect(screen.getByTestId('field-error-primary_ratio_bp')).toBeInTheDocument());
      expect(screen.getByTestId('field-error-primary_ratio_bp').textContent).toContain('主签比例须在 0%~100% 之间');
      cleanup();
    }
  });

  it('折扣系数边界：1 合法、>1 与 0 被拦住；1 保存请求体为 100', async () => {
    let captured: RuleRow | undefined;
    server.use(
      http.put('*/commission/versions/:versionId/rows/:rowId', async ({ request }) => {
        captured = (await request.json()) as RuleRow;
        return HttpResponse.json({ code: 0, data: captured });
      }),
    );
    renderPage();
    await openDrawerForFirstRow();
    fillInput('drawer-discount', '1');
    fireEvent.click(screen.getByTestId('drawer-save'));
    await waitFor(() => expect(screen.getByTestId('drawer-success')).toBeInTheDocument());
    expect(captured?.discount_coefficient_x100).toBe(100);
  });

  it('折扣系数 > 1 与 0 被前端拦住并定位折扣系数输入框', async () => {
    for (const bad of ['1.5', '0']) {
      renderPage();
      await openDrawerForFirstRow();
      fillInput('drawer-discount', bad);
      fireEvent.click(screen.getByTestId('drawer-save'));
      await waitFor(() => expect(screen.getByTestId('field-error-discount_coefficient')).toBeInTheDocument());
      expect(screen.getByTestId('field-error-discount_coefficient').textContent).toBe('折扣系数须在 0 ~ 1 之间');
      cleanup();
    }
  });

  it('封顶：留空按无上限提交（cap_cents=null），负数金额被拦住', async () => {
    let captured: RuleRow | undefined;
    server.use(
      http.put('*/commission/versions/:versionId/rows/:rowId', async ({ request }) => {
        captured = (await request.json()) as RuleRow;
        return HttpResponse.json({ code: 0, data: captured });
      }),
    );
    renderPage();
    await openDrawerForFirstRow();
    fillInput('drawer-cap', '');
    fireEvent.click(screen.getByTestId('drawer-save'));
    await waitFor(() => expect(screen.getByTestId('drawer-success')).toBeInTheDocument());
    expect(captured?.cap_cents).toBeNull();
    renderPage();
    await openDrawerForFirstRow();
    fillInput('drawer-cap', '-5');
    fireEvent.click(screen.getByTestId('drawer-save'));
    await waitFor(() => expect(screen.getByTestId('field-error-cap_cents')).toBeInTheDocument());
    expect(screen.getByTestId('field-error-cap_cents').textContent).toBe('上限金额须为不小于 0 的金额（元）');
  });

  it('后端字段路径错误定位到嵌套阶梯输入框（tiers.1.start_amount_cents）', async () => {
    server.use(
      http.put('*/commission/versions/:versionId/rows/:rowId', async () =>
        HttpResponse.json(
          {
            code: 1,
            message: '校验失败（mock 后端）',
            errors: [
              { field: 'tiers.1.start_amount_cents', message: '阶梯起点金额必须递增（后端校验）' },
            ],
          },
          { status: 422 },
        ),
      ),
    );
    renderPage();
    await openDrawerForFirstRow();
    fillInput('tier-start-1', '0.00');
    fireEvent.click(screen.getByTestId('drawer-save'));
    await waitFor(() => expect(screen.getByTestId('field-error-tiers.1.start_amount_cents')).toBeInTheDocument());
    expect(screen.getByTestId('field-error-tiers.1.start_amount_cents').textContent).toBe(
      '阶梯起点金额必须递增（后端校验）',
    );
  });

  it('非草稿版本整行点击不打开抽屉；mock 对非草稿保存返回 409', async () => {
    let status = 0;
    server.use(
      http.put('*/commission/versions/:versionId/rows/:rowId', async () => {
        status = 409;
        return HttpResponse.json({ code: 1, message: '非草稿版本不允许编辑（mock 演示）' }, { status });
      }),
    );
    renderPage();
    await waitFor(() => expect(screen.getByTestId('version-node-ver-v2')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('version-node-ver-v2'));
    await waitFor(() => expect(screen.getByTestId('readonly-banner')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('rule-row-row-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('rule-row-row-1'));
    expect(screen.queryByTestId('drawer-save')).not.toBeInTheDocument();
    await waitFor(() => expect(status).toBe(409));
  });

  it('排序保存失败 → 回滚到拖拽前顺序并显示失败提示', async () => {
    server.use(
      http.put('*/commission/versions/:versionId/priority', async () =>
        HttpResponse.json({ code: 1, message: '服务异常（mock 演示）' }, { status: 500 }),
      ),
    );
    renderPage();
    await waitFor(() => expect(screen.getByTestId('rule-row-row-2')).toBeInTheDocument());
    expect(screen.getByTestId('row-priority-row-2').textContent).toBe('2');
    fireEvent.dragStart(screen.getByTestId('row-handle-row-2'), { dataTransfer: { setData: () => undefined } });
    fireEvent.drop(screen.getByTestId('rule-row-row-1'), { dataTransfer: {} });
    await waitFor(() => expect(screen.getByTestId('priority-error')).toBeInTheDocument());
    expect(screen.getByTestId('priority-error').textContent).toContain('排序保存失败');
    // 回滚：row-2 优先级仍是 2
    await waitFor(() => expect(screen.getByTestId('row-priority-row-2').textContent).toBe('2'));
    expect(screen.getByTestId('row-priority-row-1').textContent).toBe('1');
    expect(screen.queryByTestId('priority-saved')).not.toBeInTheDocument();
  });

  it('重复复制同一版本 → 生成两个新草稿（幂等性按服务端语义：每次都新建）', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('version-copy-ver-v3')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('version-copy-ver-v3'));
    await waitFor(() => expect(screen.getByTestId('copy-success').textContent).toContain('V4'));
    // 复制成功后新版本自动选中并加载，版本号以 mock 返回的为准（同一会话内递增）
    await waitFor(() => expect(screen.getByTestId('version-copy-ver-v3')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('version-copy-ver-v3'));
    await waitFor(() => expect(screen.getByTestId('copy-success').textContent).toContain('V5'));
  });

  it('提交审批失败（后端 422 生效日期不合规）→ 弹窗内字段错误，不改版本状态', async () => {
    server.use(
      http.post('*/commission/versions/:versionId/submit', async () =>
        HttpResponse.json(
          { code: 1, message: '校验失败（mock 后端）', errors: [{ field: 'effective_date', message: '生效日期必须晚于今天（后端校验）' }] },
          { status: 422 },
        ),
      ),
    );
    renderPage();
    await waitFor(() => expect(screen.getByTestId('submit-btn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('submit-btn'));
    await waitFor(() => expect(screen.getByTestId('submit-confirm')).toBeInTheDocument());
    fillInput('submit-desc', '调整金卡会员转介绍费率（测试提交）');
    const dateInput = screen.getByPlaceholderText('选择生效日期（今天及以前不可选）');
    fireEvent.change(dateInput, { target: { value: '2027-01-01' } });
    fireEvent.keyDown(dateInput, { key: 'Enter', code: 'Enter' });
    fireEvent.click(screen.getByTestId('submit-confirm'));
    await waitFor(() => expect(screen.getByTestId('field-error-effective_date')).toBeInTheDocument());
    expect(screen.getByTestId('field-error-effective_date').textContent).toContain('生效日期必须晚于今天（后端校验）');
    expect(screen.queryByTestId('submit-success')).not.toBeInTheDocument();
  });

  it('报错态：mock=error 时显示报错+重试，重试后恢复', async () => {
    server.use(...createHandlers({ scenario: 'error' }));
    renderPage();
    await waitFor(() => expect(screen.getByTestId('page-error')).toBeInTheDocument());
    server.use(...createHandlers({ scenario: 'success' }));
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(screen.getByTestId('rules-table-item-tbl-group-referral')).toBeInTheDocument());
  });
});
