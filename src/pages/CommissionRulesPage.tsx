import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Dialog, Drawer, Input, Tag, Textarea, DatePicker, Checkbox } from 'tdesign-react';
import PageState from '../components/PageState';
import { apiGet, apiPost, apiPut, ApiValidationError } from '../api/client';
import { fenToYuan, yuanToFen } from '../lib/money';
import { bpToPercent, isDisabledEffectiveDate, percentToBp } from '../lib/units';
import {
  LEAD_SOURCE_OPTIONS,
  MEMBER_TIER_OPTIONS,
  SPACE_TYPE_OPTIONS,
  STATUS_LABEL,
  TRANSACTION_TYPE_OPTIONS,
  type CommissionTable,
  type CommissionVersion,
  type RuleRow,
  type VersionStatus,
} from '../mocks/commissionData';

const statusTheme: Record<VersionStatus, 'default' | 'primary' | 'success' | 'warning'> = {
  draft: 'warning',
  pending_approval: 'primary',
  active: 'success',
  archived: 'default',
};

/** 抽屉编辑态：全部输入层字符串（元 / 百分比），保存时才换算为分 / bp 提交。 */
interface DrawerDraft {
  id: string;
  code: string;
  name: string;
  transaction_types: string[];
  member_tiers: string[];
  space_types: string[];
  lease_term_min_months: string;
  lease_term_max_months: string;
  lead_sources: string[];
  tiers: { id: string; startYuan: string; ratePercent: string }[];
  discount_coefficient: string;
  cap_yuan: string;
  primary_ratio_percent: string;
}

function rowToDraft(row: RuleRow): DrawerDraft {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    transaction_types: [...row.transaction_types],
    member_tiers: [...row.member_tiers],
    space_types: [...row.space_types],
    lease_term_min_months: row.lease_term_min_months == null ? '' : String(row.lease_term_min_months),
    lease_term_max_months: row.lease_term_max_months == null ? '' : String(row.lease_term_max_months),
    lead_sources: [...row.lead_sources],
    tiers: row.tiers.map((t) => ({ id: t.id, startYuan: fenToYuan(t.start_amount_cents), ratePercent: bpToPercent(t.rate_bp) })),
    discount_coefficient: String(row.discount_coefficient_x100 / 100),
    cap_yuan: row.cap_cents == null ? '' : fenToYuan(row.cap_cents),
    primary_ratio_percent: row.primary_ratio_bp == null ? '' : bpToPercent(row.primary_ratio_bp),
  };
}

function draftToRow(draft: DrawerDraft): RuleRow {
  return {
    id: draft.id,
    code: draft.code,
    name: draft.name,
    transaction_types: draft.transaction_types,
    member_tiers: draft.member_tiers,
    space_types: draft.space_types,
    lease_term_min_months: draft.lease_term_min_months === '' ? null : Number(draft.lease_term_min_months),
    lease_term_max_months: draft.lease_term_max_months === '' ? null : Number(draft.lease_term_max_months),
    lead_sources: draft.lead_sources,
    tiers: draft.tiers.map((t) => ({ id: t.id, start_amount_cents: yuanToFen(t.startYuan), rate_bp: percentToBp(t.ratePercent) })),
    discount_coefficient_x100: Math.round(Number(draft.discount_coefficient) * 100),
    cap_cents: draft.cap_yuan === '' ? null : yuanToFen(draft.cap_yuan),
    primary_ratio_bp: draft.primary_ratio_percent === '' ? null : percentToBp(draft.primary_ratio_percent),
    assist_ratio_bp: draft.primary_ratio_percent === '' ? null : 10000 - percentToBp(draft.primary_ratio_percent),
  };
}

function tierSummary(row: RuleRow): string {
  return row.tiers.map((t) => `≥${fenToYuan(t.start_amount_cents)}元：${bpToPercent(t.rate_bp)}%`).join('｜');
}

function allocationRatio(row: RuleRow): string {
  if (row.primary_ratio_bp == null || row.assist_ratio_bp == null) return '—';
  return `主签 ${bpToPercent(row.primary_ratio_bp)}% / 协签 ${bpToPercent(row.assist_ratio_bp)}%`;
}

/** 前端保存前校验：阶梯起点递增、比例之和 100%（协签自动 = 100% − 主签）。返回字段路径 → 错误信息。 */
export function validateDraftFrontend(draft: DrawerDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  const fens = draft.tiers.map((t) => yuanToFen(t.startYuan));
  draft.tiers.forEach((t, i) => {
    if (Number.isNaN(fens[i]) || fens[i] < 0) {
      errors[`tiers.${i}.start_amount_cents`] = '起点金额须为不小于 0 的金额（元）';
    }
  });
  for (let i = 1; i < draft.tiers.length; i += 1) {
    if (!Number.isNaN(fens[i]) && !Number.isNaN(fens[i - 1]) && fens[i] <= fens[i - 1]) {
      errors[`tiers.${i}.start_amount_cents`] = '阶梯起点金额必须递增';
    }
  }
  draft.tiers.forEach((t, i) => {
    if (Number.isNaN(percentToBp(t.ratePercent))) {
      errors[`tiers.${i}.rate_bp`] = '费率须为百分比、最多两位小数';
    }
  });
  const primaryBp = percentToBp(draft.primary_ratio_percent);
  if (Number.isNaN(primaryBp) || primaryBp <= 0 || primaryBp >= 10000) {
    errors.primary_ratio_bp = '主签比例须在 0%~100% 之间（协签自动按 100% 减主签计算，合计 100%）';
  } else if (primaryBp + (10000 - primaryBp) !== 10000) {
    // 协签恒由 100% 减主签得出；显式断言合计 100%，任何偏离都拦住保存
    errors.primary_ratio_bp = '主签与协签比例合计必须为 100%';
  }
  const dc = Number(draft.discount_coefficient);
  if (!Number.isFinite(dc) || dc <= 0 || dc > 1) {
    errors.discount_coefficient = '折扣系数须在 0 ~ 1 之间';
  }
  if (draft.cap_yuan !== '') {
    const capFen = yuanToFen(draft.cap_yuan);
    if (Number.isNaN(capFen) || capFen < 0) {
      errors.cap_cents = '上限金额须为不小于 0 的金额（元）';
    }
  }
  return errors;
}

const ERROR_HIGHLIGHT_STYLE = { border: '2px solid var(--td-error-color, #d54941)', borderRadius: 3 } as const;

export default function CommissionRulesPage() {
  const [searchParams] = useSearchParams();
  const [tables, setTables] = useState<CommissionTable[] | null>(null);
  const [tablesError, setTablesError] = useState<string | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [versions, setVersions] = useState<CommissionVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ version: CommissionVersion; rows: RuleRow[] } | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [priorityState, setPriorityState] = useState<'saving' | 'saved' | null>(null);
  const [priorityError, setPriorityError] = useState<string | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draft, setDraft] = useState<DrawerDraft | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [drawerSaving, setDrawerSaving] = useState(false);
  const [drawerSuccess, setDrawerSuccess] = useState<string | null>(null);

  const [submitOpen, setSubmitOpen] = useState(false);
  const [changeDescription, setChangeDescription] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [submitErrors, setSubmitErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  const loadTables = useCallback(async () => {
    setTablesError(null);
    try {
      const data = await apiGet<CommissionTable[]>('/commission/tables');
      setTables(data);
      if (data.length > 0) {
        const fromUrl = searchParams.get('table');
        setSelectedTableId(fromUrl && data.some((t) => t.id === fromUrl) ? fromUrl : data[0].id);
      }
    } catch (e) {
      setTablesError((e as Error).message);
    }
  }, [searchParams]);

  useEffect(() => {
    void loadTables();
  }, [loadTables]);

  // 选定规则表后加载版本时间线
  useEffect(() => {
    if (!selectedTableId) return;
    let cancelled = false;
    setVersionsLoading(true);
    apiGet<CommissionVersion[]>(`/commission/tables/${selectedTableId}/versions`)
      .then((data) => {
        if (cancelled) return;
        setVersions(data);
        const fromUrl = searchParams.get('version');
        const initial =
          fromUrl && data.some((v) => v.id === fromUrl) ? fromUrl : data.length > 0 ? data[data.length - 1].id : null;
        setSelectedVersionId(initial);
      })
      .catch((e) => {
        if (!cancelled) setDetailError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setVersionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTableId, searchParams]);

  // 选定版本后加载版本详情（版本 + 规则行）
  useEffect(() => {
    if (!selectedVersionId) return;
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    apiGet<{ version: CommissionVersion; rows: RuleRow[] }>(`/commission/versions/${selectedVersionId}`)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((e) => {
        if (!cancelled) setDetailError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedVersionId]);

  const refreshDetail = useCallback(async (versionId: string) => {
    const data = await apiGet<{ version: CommissionVersion; rows: RuleRow[] }>(`/commission/versions/${versionId}`);
    setDetail(data);
  }, []);

  const isDraft = detail?.version.status === 'draft';

  /** 拖拽换位：把拖拽行插到目标行之前，随后保存最终顺序 */
  const handleDrop = useCallback(
    async (targetId: string) => {
      if (!detail || !draggingId || draggingId === targetId || !isDraft) return;
      const beforeRows = detail.rows;
      const rows = [...detail.rows];
      const fromIdx = rows.findIndex((r) => r.id === draggingId);
      const [moved] = rows.splice(fromIdx, 1);
      const toIdx = rows.findIndex((r) => r.id === targetId);
      rows.splice(toIdx, 0, moved);
      setDetail({ ...detail, rows });
      setDraggingId(null);
      setPriorityState('saving');
      setPriorityError(null);
      try {
        await apiPut<{ ordered_ids: string[] }, unknown>(`/commission/versions/${detail.version.id}/priority`, {
          ordered_ids: rows.map((r) => r.id),
        });
        await refreshDetail(detail.version.id); // 以服务端返回的顺序为准（证明已保存）
        setPriorityState('saved');
        setTimeout(() => setPriorityState(null), 4000);
      } catch (e) {
        // 保存失败：回滚到拖拽前的顺序，并把失败原因显示出来（不留下未保存的假顺序）
        setDetail((prev) => (prev ? { ...prev, rows: beforeRows } : prev));
        setPriorityState(null);
        setPriorityError(`排序保存失败：${(e as Error).message}`);
      }
    },
    [detail, draggingId, isDraft, refreshDetail],
  );

  const openDrawer = useCallback((row: RuleRow) => {
    setDraft(rowToDraft(row));
    setFieldErrors({});
    setDrawerSuccess(null);
    setDrawerOpen(true);
  }, []);

  const saveDraftRow = useCallback(async () => {
    if (!draft || !detail) return;
    const frontendErrors = validateDraftFrontend(draft);
    if (Object.keys(frontendErrors).length > 0) {
      setFieldErrors(frontendErrors);
      setDrawerSuccess(null);
      return;
    }
    setDrawerSaving(true);
    setFieldErrors({});
    try {
      const saved = await apiPut<RuleRow, RuleRow>(
        `/commission/versions/${detail.version.id}/rows/${draft.id}`,
        draftToRow(draft),
      );
      await refreshDetail(detail.version.id);
      setDrawerSuccess(`已保存：${saved.code}`);
      setTimeout(() => {
        setDrawerOpen(false);
        setDrawerSuccess(null);
      }, 1200);
    } catch (e) {
      if (e instanceof ApiValidationError) {
        const errs: Record<string, string> = {};
        for (const fe of e.errors) errs[fe.field] = fe.message;
        setFieldErrors(errs); // 后端字段路径错误 → 定位对应输入框（红色高亮 + 错误文案）
      } else {
        setFieldErrors({ _global: (e as Error).message });
      }
    } finally {
      setDrawerSaving(false);
    }
  }, [draft, detail, refreshDetail]);

  const copyAsDraft = useCallback(
    async (sourceVersionId: string) => {
      setCopySuccess(null);
      setCopyError(null);
      try {
        const created = await apiPost<Record<string, never>, CommissionVersion>(
          `/commission/versions/${sourceVersionId}/copy`,
          {},
        );
        const data = await apiGet<CommissionVersion[]>(`/commission/tables/${created.table_id}/versions`);
        setVersions(data);
        setSelectedVersionId(created.id);
        setCopySuccess(`已复制为新草稿 ${created.version_no}`);
        setTimeout(() => setCopySuccess(null), 4000);
      } catch (e) {
        setCopyError(`复制失败：${(e as Error).message}`);
      }
    },
    [],
  );

  const openSubmitModal = useCallback(() => {
    setChangeDescription('');
    setEffectiveDate('');
    setSubmitErrors({});
    setSubmitSuccess(null);
    setSubmitOpen(true);
  }, []);

  const confirmSubmit = useCallback(async () => {
    if (!detail) return;
    const errs: Record<string, string> = {};
    if (!changeDescription.trim()) errs.change_description = '变更说明不能为空';
    if (!effectiveDate) errs.effective_date = '请选择生效日期（今天及以前不可选）';
    if (Object.keys(errs).length > 0) {
      setSubmitErrors(errs);
      return;
    }
    setSubmitting(true);
    setSubmitErrors({});
    try {
      const updated = await apiPost<{ change_description: string; effective_date: string }, CommissionVersion>(
        `/commission/versions/${detail.version.id}/submit`,
        { change_description: changeDescription, effective_date: effectiveDate },
      );
      setSubmitSuccess(`版本 ${updated.version_no} 已提交审批，生效日期 ${effectiveDate}`);
      const data = await apiGet<CommissionVersion[]>(`/commission/tables/${updated.table_id}/versions`);
      setVersions(data);
      await refreshDetail(updated.id);
      setTimeout(() => {
        setSubmitOpen(false);
        setSubmitSuccess(null);
      }, 1600);
    } catch (e) {
      if (e instanceof ApiValidationError) {
        const map: Record<string, string> = {};
        for (const fe of e.errors) map[fe.field] = fe.message;
        setSubmitErrors(map);
      } else {
        setSubmitErrors({ effective_date: (e as Error).message });
      }
    } finally {
      setSubmitting(false);
    }
  }, [changeDescription, effectiveDate, detail, refreshDetail]);

  const assistPercent = useMemo(() => {
    if (!draft) return '';
    const bp = percentToBp(draft.primary_ratio_percent);
    if (Number.isNaN(bp) || bp < 0 || bp > 10000) return '';
    return bpToPercent(10000 - bp);
  }, [draft]);

  const setTier = (idx: number, patch: Partial<{ startYuan: string; ratePercent: string }>) => {
    setDraft((d) => {
      if (!d) return d;
      const tiers = d.tiers.map((t, i) => (i === idx ? { ...t, ...patch } : t));
      return { ...d, tiers };
    });
  };

  const table = tables?.find((t) => t.id === selectedTableId) ?? null;
  const versionLabel = detail ? `${detail.version.version_no} · ${STATUS_LABEL[detail.version.status]}` : '';

  return (
    <div data-testid="commission-rules-page">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>佣金规则表配置</h2>
        <span style={{ color: 'var(--td-text-color-placeholder, #a0a0a0)' }}>/commission/rules</span>
        {copySuccess && (
          <span data-testid="copy-success" style={{ color: 'var(--td-success-color, #2ba471)' }}>
            {copySuccess}
          </span>
        )}
        {copyError && (
          <span data-testid="copy-error" role="alert" style={{ color: 'var(--td-error-color, #d54941)' }}>
            {copyError}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'stretch' }}>
        {/* 左侧：规则表列表（全平台 + 单店） */}
        <aside
          data-testid="rules-table-list"
          style={{ width: 240, flexShrink: 0, border: '1px solid var(--td-border-level-1-color, #e7e7e7)', borderRadius: 6, background: '#fff', padding: 8 }}
        >
          <div style={{ fontWeight: 600, padding: '8px 8px 4px' }}>规则表列表</div>
          <PageState loading={tables == null && tablesError == null} error={tablesError} isEmpty={!!tables && tables.length === 0} onRetry={loadTables} />
          {tables?.map((t) => (
            <div
              key={t.id}
              data-testid={`rules-table-item-${t.id}`}
              onClick={() => setSelectedTableId(t.id)}
              style={{
                padding: 10,
                borderRadius: 4,
                cursor: 'pointer',
                marginBottom: 4,
                background: t.id === selectedTableId ? 'var(--td-brand-color-light, #f2f3ff)' : 'transparent',
              }}
            >
              <div style={{ fontWeight: 600 }}>{t.name}</div>
              <div style={{ fontSize: 12, color: 'var(--td-text-color-placeholder, #a0a0a0)' }}>
                {t.scope === 'group' ? '全平台' : `单店 · ${t.club_name ?? ''}`}
              </div>
            </div>
          ))}
        </aside>

        <section style={{ flex: 1, minWidth: 0 }}>
          {/* 右上：版本时间线 */}
          <div
            data-testid="version-timeline"
            style={{ border: '1px solid var(--td-border-level-1-color, #e7e7e7)', borderRadius: 6, background: '#fff', padding: 12, marginBottom: 16, display: 'flex', gap: 8, overflowX: 'auto' }}
          >
            {versions.map((v, i) => (
              <div
                key={v.id}
                data-testid={`version-node-${v.id}`}
                onClick={() => setSelectedVersionId(v.id)}
                style={{
                  minWidth: 190,
                  border: v.id === selectedVersionId ? '2px solid var(--td-brand-color, #0052d9)' : '1px solid var(--td-border-level-1-color, #e7e7e7)',
                  borderRadius: 6,
                  padding: 10,
                  cursor: 'pointer',
                  position: 'relative',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong data-testid={`version-no-${v.id}`}>{v.version_no}</strong>
                  <Tag theme={statusTheme[v.status]} data-testid={`version-status-${v.id}`}>
                    {STATUS_LABEL[v.status]}
                  </Tag>
                </div>
                <div style={{ fontSize: 12, marginTop: 6 }}>
                  生效：{v.effective_from ?? '—'} ~ {v.effective_to ?? '—'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--td-text-color-placeholder, #a0a0a0)' }}>
                  提交：{v.submitted_by ?? '—'} · 审批：{v.approved_by ?? '—'}
                </div>
                {i < versions.length - 1 && (
                  <span aria-hidden style={{ position: 'absolute', right: -10, top: '45%', color: '#bbb' }}>
                    ▶
                  </span>
                )}
                <Button
                  size="small"
                  variant="outline"
                  style={{ marginTop: 8 }}
                  data-testid={`version-copy-${v.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void copyAsDraft(v.id);
                  }}
                >
                  复制为新草稿
                </Button>
              </div>
            ))}
          </div>

          {/* 工具行：当前版本 + 只读提示 + 提交审批 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            {detail && (
              <strong data-testid="current-version-label">当前版本：{versionLabel}</strong>
            )}
            {detail && !isDraft && (
              <span
                data-testid="readonly-banner"
                style={{ background: 'var(--td-gray-color-1, #f3f3f3)', border: '1px solid var(--td-border-level-1-color, #e7e7e7)', borderRadius: 4, padding: '4px 10px', color: 'var(--td-text-color-secondary, #555)' }}
              >
                非草稿版本（{STATUS_LABEL[detail.version.status]}）为只读，不可编辑、不可拖拽排序
              </span>
            )}
            {isDraft && (
              <Button theme="primary" data-testid="submit-btn" onClick={openSubmitModal}>
                提交审批
              </Button>
            )}
            {submitSuccess && (
              <span data-testid="submit-success" style={{ color: 'var(--td-success-color, #2ba471)' }}>
                {submitSuccess}
              </span>
            )}
          </div>

          {/* 规则行表格 */}
          <PageState loading={detailLoading || (versionsLoading && !detail)} error={detailError} isEmpty={!detailLoading && !!detail && detail.rows.length === 0} onRetry={() => selectedVersionId && void refreshDetail(selectedVersionId)} />
          {detail && detail.rows.length > 0 && (
            <div style={{ border: '1px solid var(--td-border-level-1-color, #e7e7e7)', borderRadius: 6, background: '#fff', overflowX: 'auto' }}>
              <table data-testid="rules-grid" style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13, minWidth: 1180 }}>
                <thead>
                  <tr style={{ background: 'var(--td-gray-color-1, #f3f3f3)', textAlign: 'left' }}>
                    <th style={{ padding: 8, whiteSpace: 'nowrap' }}>优先级（拖拽排序）</th>
                    <th style={{ padding: 8 }}>编码</th>
                    <th style={{ padding: 8 }}>名称</th>
                    <th style={{ padding: 8 }}>交易类型</th>
                    <th style={{ padding: 8 }}>会员等级</th>
                    <th style={{ padding: 8 }}>空间类型</th>
                    <th style={{ padding: 8 }}>租期区间</th>
                    <th style={{ padding: 8 }}>线索来源</th>
                    <th style={{ padding: 8 }}>阶梯摘要</th>
                    <th style={{ padding: 8 }}>折扣系数摘要</th>
                    <th style={{ padding: 8 }}>封顶</th>
                    <th style={{ padding: 8 }}>分配比例</th>
                    {isDraft && <th style={{ padding: 8 }}>操作</th>}
                  </tr>
                </thead>
                <tbody>
                  {detail.rows.map((r, idx) => (
                    <tr
                      key={r.id}
                      data-testid={`rule-row-${r.id}`}
                      onDragOver={(e) => {
                        if (draggingId && draggingId !== r.id) e.preventDefault();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        void handleDrop(r.id);
                      }}
                      onClick={() => {
                        // 工单要求「点击行打开编辑抽屉」；非草稿版本整行只读，不弹抽屉
                        if (isDraft) openDrawer(r);
                      }}
                      style={{ borderTop: '1px solid var(--td-border-level-1-color, #e7e7e7)', opacity: draggingId === r.id ? 0.5 : 1, cursor: isDraft ? 'pointer' : 'default' }}
                    >
                      <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                        {isDraft ? (
                          <span
                            draggable
                            data-testid={`row-handle-${r.id}`}
                            onDragStart={() => setDraggingId(r.id)}
                            onDragEnd={() => setDraggingId(null)}
                            onClick={(e) => e.stopPropagation()}
                            title="拖拽调整优先级"
                            style={{ cursor: 'grab', userSelect: 'none', marginRight: 6 }}
                          >
                            ⠿
                          </span>
                        ) : null}
                        <span data-testid={`row-priority-${r.id}`}>{idx + 1}</span>
                      </td>
                      <td style={{ padding: 8 }}>{r.code}</td>
                      <td style={{ padding: 8 }}>{r.name}</td>
                      <td style={{ padding: 8 }}>{r.transaction_types.join('、')}</td>
                      <td style={{ padding: 8 }}>{r.member_tiers.join('、')}</td>
                      <td style={{ padding: 8 }}>{r.space_types.join('、')}</td>
                      <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                        {r.lease_term_min_months ?? '—'} ~ {r.lease_term_max_months ?? '—'} 个月
                      </td>
                      <td style={{ padding: 8 }}>{r.lead_sources.join('、')}</td>
                      <td style={{ padding: 8 }}>{tierSummary(r)}</td>
                      <td style={{ padding: 8 }}>{r.discount_coefficient_x100 / 100}</td>
                      <td style={{ padding: 8, whiteSpace: 'nowrap' }}>{r.cap_cents == null ? '无上限' : `${fenToYuan(r.cap_cents)}元`}</td>
                      <td style={{ padding: 8, whiteSpace: 'nowrap' }}>{allocationRatio(r)}</td>
                      {isDraft && (
                        <td style={{ padding: 8 }}>
                          <Button size="small" variant="text" theme="primary" data-testid={`row-edit-${r.id}`} onClick={(e) => { e.stopPropagation(); openDrawer(r); }}>
                            编辑
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {isDraft && (
            <div style={{ marginTop: 8, fontSize: 13, color: 'var(--td-text-color-secondary, #555)' }}>
              {priorityState === 'saving' && <span data-testid="priority-saving">排序保存中...</span>}
              {priorityState === 'saved' && (
                <span data-testid="priority-saved" style={{ color: 'var(--td-success-color, #2ba471)' }}>
                  排序已保存
                </span>
              )}
              {priorityError && (
                <span data-testid="priority-error" role="alert" style={{ color: 'var(--td-error-color, #d54941)' }}>
                  {priorityError}
                </span>
              )}
              {priorityState === null && <span>提示：拖拽 ⠿ 把手调整优先级，松手即调用保存接口（mock）。</span>}
            </div>
          )}
        </section>
      </div>

      {/* 编辑抽屉（仅草稿） */}
      <Drawer header={detail ? `编辑规则行（${detail.version.version_no} 草稿）` : '编辑规则行'} visible={drawerOpen} onClose={() => setDrawerOpen(false)} size="620px" footer={null} data-testid="edit-drawer">
        {draft && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              编码
              <span data-testid={`field-code`} style={fieldErrors.code ? ERROR_HIGHLIGHT_STYLE : undefined}>
                <Input value={draft.code} data-testid="drawer-code" onChange={(v: string) => setDraft({ ...draft, code: v })} />
              </span>
              {fieldErrors.code && (
                <span role="alert" data-testid="field-error-code" style={{ color: 'var(--td-error-color, #d54941)', fontSize: 12 }}>
                  {fieldErrors.code}
                </span>
              )}
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              名称
              <Input value={draft.name} data-testid="drawer-name" onChange={(v: string) => setDraft({ ...draft, name: v })} />
            </label>

            {(
              [
                ['transaction_types', '交易类型（多选）', TRANSACTION_TYPE_OPTIONS],
                ['member_tiers', '会员等级（多选）', MEMBER_TIER_OPTIONS],
                ['space_types', '空间类型（多选）', SPACE_TYPE_OPTIONS],
                ['lead_sources', '线索来源（多选）', LEAD_SOURCE_OPTIONS],
              ] as const
            ).map(([key, label, options]) => (
              <fieldset key={key} style={{ border: '1px solid var(--td-border-level-1-color, #e7e7e7)', borderRadius: 4, margin: 0, padding: 8 }}>
                <legend style={{ fontSize: 13 }}>{label}</legend>
                <div data-testid={`drawer-${key}`} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {options.map((opt) => (
                    <Checkbox
                      key={opt}
                      checked={draft[key].includes(opt)}
                      onChange={(checked: boolean) => {
                        const list = checked ? [...draft[key], opt] : draft[key].filter((x) => x !== opt);
                        setDraft({ ...draft, [key]: list });
                      }}
                      label={opt}
                    />
                  ))}
                </div>
              </fieldset>
            ))}

            <fieldset style={{ border: '1px solid var(--td-border-level-1-color, #e7e7e7)', borderRadius: 4, margin: 0, padding: 8 }}>
              <legend style={{ fontSize: 13 }}>租期区间（月）</legend>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Input style={{ width: 120 }} value={draft.lease_term_min_months} data-testid="drawer-lease-min" onChange={(v: string) => setDraft({ ...draft, lease_term_min_months: v })} />
                <span>~</span>
                <Input style={{ width: 120 }} value={draft.lease_term_max_months} data-testid="drawer-lease-max" onChange={(v: string) => setDraft({ ...draft, lease_term_max_months: v })} />
                <span style={{ color: 'var(--td-text-color-placeholder, #a0a0a0)' }}>个月</span>
              </div>
            </fieldset>

            {/* 阶梯编辑器：起点按元输入、按分提交；费率按百分比两位小数输入、按 bp 提交 */}
            <fieldset style={{ border: '1px solid var(--td-border-level-1-color, #e7e7e7)', borderRadius: 4, margin: 0, padding: 8 }}>
              <legend style={{ fontSize: 13 }}>阶梯（起点金额按元输入 → 按分提交；费率按 % 两位小数输入 → 按 bp 提交）</legend>
              {draft.tiers.map((t, i) => (
                <div key={t.id || i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}>
                  <div style={{ flex: 1 }}>
                    <span data-testid={`field-tiers.${i}.start_amount_cents`} style={fieldErrors[`tiers.${i}.start_amount_cents`] ? ERROR_HIGHLIGHT_STYLE : undefined}>
                      <Input value={t.startYuan} placeholder="起点金额（元）" data-testid={`tier-start-${i}`} onChange={(v: string) => setTier(i, { startYuan: v })} />
                    </span>
                    {fieldErrors[`tiers.${i}.start_amount_cents`] && (
                      <div role="alert" data-testid={`field-error-tiers.${i}.start_amount_cents`} style={{ color: 'var(--td-error-color, #d54941)', fontSize: 12 }}>
                        {fieldErrors[`tiers.${i}.start_amount_cents`]}
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <span data-testid={`field-tiers.${i}.rate_bp`} style={fieldErrors[`tiers.${i}.rate_bp`] ? ERROR_HIGHLIGHT_STYLE : undefined}>
                      <Input value={t.ratePercent} placeholder="费率（%）" data-testid={`tier-rate-${i}`} onChange={(v: string) => setTier(i, { ratePercent: v })} />
                    </span>
                    {fieldErrors[`tiers.${i}.rate_bp`] && (
                      <div role="alert" data-testid={`field-error-tiers.${i}.rate_bp`} style={{ color: 'var(--td-error-color, #d54941)', fontSize: 12 }}>
                        {fieldErrors[`tiers.${i}.rate_bp`]}
                      </div>
                    )}
                  </div>
                  <Button
                    size="small"
                    variant="outline"
                    theme="danger"
                    data-testid={`tier-remove-${i}`}
                    disabled={draft.tiers.length <= 1}
                    onClick={() => setDraft({ ...draft, tiers: draft.tiers.filter((_, j) => j !== i) })}
                  >
                    删除
                  </Button>
                </div>
              ))}
              <Button
                size="small"
                variant="outline"
                data-testid="tier-add"
                onClick={() =>
                  setDraft({
                    ...draft,
                    tiers: [...draft.tiers, { id: '', startYuan: '', ratePercent: '' }],
                  })
                }
              >
                添加阶梯
              </Button>
            </fieldset>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              折扣系数（0 ~ 1）
              <span data-testid="field-discount_coefficient" style={fieldErrors.discount_coefficient ? ERROR_HIGHLIGHT_STYLE : undefined}>
                <Input value={draft.discount_coefficient} data-testid="drawer-discount" onChange={(v: string) => setDraft({ ...draft, discount_coefficient: v })} />
              </span>
              {fieldErrors.discount_coefficient && (
                <span role="alert" data-testid="field-error-discount_coefficient" style={{ color: 'var(--td-error-color, #d54941)', fontSize: 12 }}>
                  {fieldErrors.discount_coefficient}
                </span>
              )}
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              上限（元，留空 = 无上限）
              <span data-testid="field-cap_cents" style={fieldErrors.cap_cents ? ERROR_HIGHLIGHT_STYLE : undefined}>
                <Input value={draft.cap_yuan} data-testid="drawer-cap" onChange={(v: string) => setDraft({ ...draft, cap_yuan: v })} />
              </span>
              {fieldErrors.cap_cents && (
                <span role="alert" data-testid="field-error-cap_cents" style={{ color: 'var(--td-error-color, #d54941)', fontSize: 12 }}>
                  {fieldErrors.cap_cents}
                </span>
              )}
            </label>

            <fieldset style={{ border: '1px solid var(--td-border-level-1-color, #e7e7e7)', borderRadius: 4, margin: 0, padding: 8 }}>
              <legend style={{ fontSize: 13 }}>主/协签比例（输入主签后自动计算协签，合计 100%）</legend>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <span data-testid="field-primary_ratio_bp" style={fieldErrors.primary_ratio_bp ? ERROR_HIGHLIGHT_STYLE : undefined}>
                    <Input value={draft.primary_ratio_percent} placeholder="主签比例（%）" data-testid="drawer-primary-ratio" onChange={(v: string) => setDraft({ ...draft, primary_ratio_percent: v })} />
                  </span>
                  {fieldErrors.primary_ratio_bp && (
                    <div role="alert" data-testid="field-error-primary_ratio_bp" style={{ color: 'var(--td-error-color, #d54941)', fontSize: 12 }}>
                      {fieldErrors.primary_ratio_bp}
                    </div>
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <Input value={assistPercent} placeholder="协签比例" data-testid="drawer-assist-ratio" disabled />
                  <div style={{ fontSize: 12, color: 'var(--td-text-color-placeholder, #a0a0a0)', marginTop: 2 }}>
                    协签比例 = 100% − 主签比例（自动计算，合计恒为 100%）
                  </div>
                </div>
              </div>
            </fieldset>

            {fieldErrors._global && (
              <div role="alert" data-testid="field-error-global" style={{ color: 'var(--td-error-color, #d54941)' }}>
                {fieldErrors._global}
              </div>
            )}
            {drawerSuccess && (
              <div data-testid="drawer-success" style={{ color: 'var(--td-success-color, #2ba471)' }}>
                {drawerSuccess}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button theme="primary" data-testid="drawer-save" disabled={drawerSaving} onClick={() => void saveDraftRow()}>
                {drawerSaving ? '保存中...' : '保存'}
              </Button>
              <Button variant="outline" data-testid="drawer-cancel" onClick={() => setDrawerOpen(false)}>
                取消
              </Button>
            </div>
          </div>
        )}
      </Drawer>

      {/* 提交审批弹窗：变更说明 + 生效日期（禁用今天及以前） */}
      <Dialog
        visible={submitOpen}
        header={`提交审批（${detail?.version.version_no ?? ''} 草稿）`}
        onClose={() => setSubmitOpen(false)}
        footer={null}
        width={520}
        data-testid="submit-modal"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            变更说明
            <span data-testid="field-change_description">
              <Textarea value={changeDescription} placeholder="描述本次调整内容（必填）" data-testid="submit-desc" onChange={(v: string) => setChangeDescription(v)} />
            </span>
            {submitErrors.change_description && (
              <span role="alert" data-testid="field-error-change_description" style={{ color: 'var(--td-error-color, #d54941)', fontSize: 12 }}>
                {submitErrors.change_description}
              </span>
            )}
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            生效日期（今天及以前的日期不可选）
            <span data-testid="field-effective_date">
              <DatePicker
                value={effectiveDate}
                placeholder="选择生效日期（今天及以前不可选）"
                disableDate={(d: unknown) => isDisabledEffectiveDate(d instanceof Date ? d : new Date(d as string))}
                onChange={(v: unknown) => setEffectiveDate((v as string) ?? '')}
                clearable
              />
            </span>
            {submitErrors.effective_date && (
              <span role="alert" data-testid="field-error-effective_date" style={{ color: 'var(--td-error-color, #d54941)', fontSize: 12 }}>
                {submitErrors.effective_date}
              </span>
            )}
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button theme="primary" data-testid="submit-confirm" disabled={submitting} onClick={() => void confirmSubmit()}>
              {submitting ? '提交中...' : '确认提交'}
            </Button>
            <Button variant="outline" data-testid="submit-cancel" onClick={() => setSubmitOpen(false)}>
              取消
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
