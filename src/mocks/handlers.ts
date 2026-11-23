import { http, HttpResponse, delay } from 'msw';
import { config } from '../config';
import { MEMBERS, DEMO_TAGS, type Member, type TagNode } from './data';
import { moveNode } from '../lib/treeUtils';
import type { MockScenario } from './scenario';
import {
  COMMISSION_ROWS_BY_VERSION,
  COMMISSION_TABLES,
  COMMISSION_VERSIONS,
  type CommissionTable,
  type CommissionTier,
  type CommissionVersion,
  type FieldError,
  type RuleRow,
} from './commissionData';

/**
 * MSW 请求处理器。场景（success/empty/error/slow）由初始化方注入：
 * - 浏览器端：启动时按 URL ?mock= 参数解析（见 src/mocks/browser.ts）
 * - Vitest 端：默认 success，需要其它场景时用 server.use 覆盖（见各测试文件）
 */
export interface HandlerOptions {
  scenario: MockScenario;
  slowDelayMs?: number;
}

/** 标签树的可变副本：拖拽保存接口演示"改动被持久化"（仅在当前页面会话内） */
let tagStore: TagNode[] = DEMO_TAGS;

/** 佣金规则表的可变副本（深拷贝，仅在当前页面会话内持久化） */
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
let commissionTables: CommissionTable[] = clone(COMMISSION_TABLES);
let commissionVersions: CommissionVersion[] = clone(COMMISSION_VERSIONS);
let commissionRows: Record<string, RuleRow[]> = clone(COMMISSION_ROWS_BY_VERSION);
let versionSeq = commissionVersions.length;
let tierIdSeq = 1000;

/**
 * 复位全部 mock 会话状态（测试用）。handlers.ts 的存储是模块级可变状态，
 * Vitest 同一文件里的用例共享；「复制为新草稿」用例会往全平台表追加 V4+ 版本，
 * 不复位的话后续用例默认选中的不再是 V3 草稿，用例结果会依赖执行顺序。
 */
export function resetCommissionMockStore() {
  commissionTables = clone(COMMISSION_TABLES);
  commissionVersions = clone(COMMISSION_VERSIONS);
  commissionRows = clone(COMMISSION_ROWS_BY_VERSION);
  versionSeq = commissionVersions.length;
  tierIdSeq = 1000;
}

function fail() {
  return HttpResponse.json({ code: 1, message: '服务异常（mock 演示）' }, { status: 500 });
}

/** mock 后端对规则行的服务端校验（返回字段路径错误）。前端已先校验阶梯递增与比例 100%，这里兜底并演示字段路径错误。 */
function validateRuleRow(row: RuleRow): FieldError[] {
  const errors: FieldError[] = [];
  if (!row.code || !String(row.code).trim()) {
    errors.push({ field: 'code', message: '编码不能为空（后端校验）' });
  }
  if (!row.tiers || row.tiers.length === 0) {
    errors.push({ field: 'tiers.0.start_amount_cents', message: '至少需要一个阶梯（后端校验）' });
  } else {
    for (let i = 1; i < row.tiers.length; i += 1) {
      if (row.tiers[i].start_amount_cents <= row.tiers[i - 1].start_amount_cents) {
        errors.push({
          field: `tiers.${i}.start_amount_cents`,
          message: '阶梯起点金额必须递增（后端校验）',
        });
        break;
      }
    }
    for (const t of row.tiers) {
      if (!Number.isInteger(t.start_amount_cents) || t.start_amount_cents < 0) {
        errors.push({ field: 'tiers.0.start_amount_cents', message: '起点金额必须为非负整数分（后端校验）' });
        break;
      }
    }
  }
  if (row.primary_ratio_bp != null && row.assist_ratio_bp != null) {
    if (row.primary_ratio_bp + row.assist_ratio_bp !== 10000) {
      errors.push({ field: 'primary_ratio_bp', message: '主签+协签比例之和必须为 100%（后端校验）' });
    }
  }
  return errors;
}

export function createHandlers({ scenario, slowDelayMs = 3000 }: HandlerOptions) {
  const maybeSlow = async () => {
    if (scenario === 'slow') await delay(slowDelayMs);
  };

  return [
    http.get(`${config.apiBaseUrl}/members`, async ({ request }) => {
      await maybeSlow();
      if (scenario === 'error') return fail();
      const url = new URL(request.url);
      const keyword = (url.searchParams.get('keyword') ?? '').trim();
      const status = url.searchParams.get('status') ?? '';
      const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
      const pageSize = Math.max(1, Number(url.searchParams.get('pageSize') ?? 10));
      let list = MEMBERS;
      if (keyword) list = list.filter((m) => m.name.includes(keyword) || m.phone.includes(keyword));
      if (status) list = list.filter((m) => m.status === status);
      const total = scenario === 'empty' ? 0 : list.length;
      const paged = scenario === 'empty' ? [] : list.slice((page - 1) * pageSize, page * pageSize);
      return HttpResponse.json({ code: 0, data: { list: paged, total } });
    }),

    http.post(`${config.apiBaseUrl}/members`, async ({ request }) => {
      await maybeSlow();
      if (scenario === 'error') return fail();
      const body = (await request.json()) as Partial<Member>;
      if (!body?.name || typeof body.balance_cents !== 'number') {
        return HttpResponse.json({ code: 1, message: '参数缺失（mock 演示）' }, { status: 400 });
      }
      return HttpResponse.json(
        { code: 0, data: { id: `m-${Date.now()}`, ...body, org_id: 'org-demo-001', created_at: '2026-11-18 00:00:00' } },
        { status: 201 },
      );
    }),

    http.get(`${config.apiBaseUrl}/tags`, async () => {
      await maybeSlow();
      if (scenario === 'error') return fail();
      return HttpResponse.json({ code: 0, data: scenario === 'empty' ? [] : tagStore });
    }),

    http.post(`${config.apiBaseUrl}/tags/move`, async ({ request }) => {
      await maybeSlow();
      if (scenario === 'error') return fail();
      const body = (await request.json()) as { id?: string; targetId?: string; position?: 'before' | 'after' | 'inside' };
      if (!body?.id || !body?.targetId || !body?.position) {
        return HttpResponse.json({ code: 1, message: '参数缺失（mock 演示）' }, { status: 400 });
      }
      tagStore = moveNode(tagStore, body.id, body.targetId, body.position);
      return HttpResponse.json({ code: 0, data: tagStore });
    }),

    // ===== 佣金规则表（#2370，全部为 mock 演示；真实接入点见 README） =====

    http.get(`${config.apiBaseUrl}/commission/tables`, async () => {
      await maybeSlow();
      if (scenario === 'error') return fail();
      return HttpResponse.json({ code: 0, data: scenario === 'empty' ? [] : commissionTables });
    }),

    http.get(`${config.apiBaseUrl}/commission/tables/:tableId/versions`, async ({ params }) => {
      await maybeSlow();
      if (scenario === 'error') return fail();
      const { tableId } = params as { tableId: string };
      const versions = commissionVersions
        .filter((v) => v.table_id === tableId)
        .slice()
        .sort((a, b) => a.version_no.localeCompare(b.version_no));
      return HttpResponse.json({ code: 0, data: versions });
    }),

    http.get(`${config.apiBaseUrl}/commission/versions/:versionId`, async ({ params }) => {
      await maybeSlow();
      if (scenario === 'error') return fail();
      const { versionId } = params as { versionId: string };
      const version = commissionVersions.find((v) => v.id === versionId);
      if (!version) {
        return HttpResponse.json({ code: 1, message: '版本不存在（mock 演示）' }, { status: 404 });
      }
      return HttpResponse.json({ code: 0, data: { version, rows: commissionRows[versionId] ?? [] } });
    }),

    // 复制为新草稿：把源版本的全部规则行复制成新草稿版本
    http.post(`${config.apiBaseUrl}/commission/versions/:versionId/copy`, async ({ params }) => {
      await maybeSlow();
      if (scenario === 'error') return fail();
      const { versionId } = params as { versionId: string };
      const source = commissionVersions.find((v) => v.id === versionId);
      if (!source) {
        return HttpResponse.json({ code: 1, message: '源版本不存在（mock 演示）' }, { status: 404 });
      }
      versionSeq += 1;
      const sameTableCount = commissionVersions.filter((v) => v.table_id === source.table_id).length + 1;
      const draft: CommissionVersion = {
        id: `ver-copy-${versionSeq}`,
        table_id: source.table_id,
        version_no: `V${sameTableCount}`,
        status: 'draft',
        effective_from: null,
        effective_to: null,
        submitted_by: null,
        approved_by: null,
      };
      commissionVersions.push(draft);
      const sourceRows = commissionRows[source.id] ?? [];
      commissionRows[draft.id] = sourceRows.map((r) => ({ ...clone(r), id: `row-copy-${versionSeq}-${r.id}` }));
      return HttpResponse.json({ code: 0, data: draft }, { status: 201 });
    }),

    // 保存规则行（草稿）：返回后端字段路径错误演示（HTTP 422）
    http.put(`${config.apiBaseUrl}/commission/versions/:versionId/rows/:rowId`, async ({ params, request }) => {
      await maybeSlow();
      if (scenario === 'error') return fail();
      const { versionId, rowId } = params as { versionId: string; rowId: string };
      const version = commissionVersions.find((v) => v.id === versionId);
      if (!version) {
        return HttpResponse.json({ code: 1, message: '版本不存在（mock 演示）' }, { status: 404 });
      }
      if (version.status !== 'draft') {
        return HttpResponse.json({ code: 1, message: '非草稿版本不允许编辑（mock 演示）' }, { status: 409 });
      }
      const body = (await request.json()) as RuleRow;
      const errors = validateRuleRow(body);
      if (errors.length > 0) {
        return HttpResponse.json({ code: 1, message: '校验失败（mock 后端）', errors }, { status: 422 });
      }
      const rows = commissionRows[versionId] ?? [];
      const idx = rows.findIndex((r) => r.id === rowId);
      if (idx === -1) {
        return HttpResponse.json({ code: 1, message: '规则行不存在（mock 演示）' }, { status: 404 });
      }
      const nextTierId = () => {
        tierIdSeq += 1;
        return `t-mock-${tierIdSeq}`;
      };
      const saved: RuleRow = { ...body, id: rowId, tiers: body.tiers.map((t) => ({ ...t, id: t.id || nextTierId() })) };
      rows[idx] = saved;
      return HttpResponse.json({ code: 0, data: saved });
    }),

    // 优先级拖拽排序保存：ordered_ids 即最终顺序
    http.put(`${config.apiBaseUrl}/commission/versions/:versionId/priority`, async ({ params, request }) => {
      await maybeSlow();
      if (scenario === 'error') return fail();
      const { versionId } = params as { versionId: string };
      const version = commissionVersions.find((v) => v.id === versionId);
      if (!version) {
        return HttpResponse.json({ code: 1, message: '版本不存在（mock 演示）' }, { status: 404 });
      }
      if (version.status !== 'draft') {
        return HttpResponse.json({ code: 1, message: '非草稿版本不允许调整优先级（mock 演示）' }, { status: 409 });
      }
      const body = (await request.json()) as { ordered_ids?: string[] };
      if (!body?.ordered_ids || !Array.isArray(body.ordered_ids)) {
        return HttpResponse.json({ code: 1, message: '参数缺失（mock 演示）' }, { status: 400 });
      }
      const rows = commissionRows[versionId] ?? [];
      const byId = new Map(rows.map((r) => [r.id, r]));
      const ordered: RuleRow[] = [];
      for (const id of body.ordered_ids) {
        const r = byId.get(id);
        if (r) {
          ordered.push(r);
          byId.delete(id);
        }
      }
      const next = [...ordered, ...byId.values()];
      commissionRows[versionId] = next;
      return HttpResponse.json({ code: 0, data: next.map((r, i) => ({ id: r.id, priority: i + 1 })) });
    }),

    // 提交审批：生效日期必须晚于今天（与前端日期选择器禁用规则一致）
    http.post(`${config.apiBaseUrl}/commission/versions/:versionId/submit`, async ({ params, request }) => {
      await maybeSlow();
      if (scenario === 'error') return fail();
      const { versionId } = params as { versionId: string };
      const version = commissionVersions.find((v) => v.id === versionId);
      if (!version) {
        return HttpResponse.json({ code: 1, message: '版本不存在（mock 演示）' }, { status: 404 });
      }
      if (version.status !== 'draft') {
        return HttpResponse.json({ code: 1, message: '只有草稿可以提交审批（mock 演示）' }, { status: 409 });
      }
      const body = (await request.json()) as { change_description?: string; effective_date?: string };
      const errors: FieldError[] = [];
      if (!body?.change_description || !body.change_description.trim()) {
        errors.push({ field: 'change_description', message: '变更说明不能为空（后端校验）' });
      }
      if (!body?.effective_date) {
        errors.push({ field: 'effective_date', message: '生效日期不能为空（后端校验）' });
      } else {
        const today = new Date();
        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const eff = new Date(`${body.effective_date}T00:00:00`);
        if (!(eff.getTime() > todayStart.getTime())) {
          errors.push({ field: 'effective_date', message: '生效日期必须晚于今天（后端校验）' });
        }
      }
      if (errors.length > 0) {
        return HttpResponse.json({ code: 1, message: '校验失败（mock 后端）', errors }, { status: 422 });
      }
      version.status = 'pending_approval';
      version.submitted_by = '当前操作员（虚构）';
      return HttpResponse.json({ code: 0, data: version });
    }),
  ];
}

export const handlers = createHandlers({ scenario: 'success' });
