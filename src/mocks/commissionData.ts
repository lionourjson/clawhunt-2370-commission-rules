/** 佣金规则表 mock 数据（全部自拟虚构，不出现真实企业/客户名；金额以分存整数，费率/比例以 bp 存整数）。 */

export interface CommissionTable {
  id: string;
  name: string;
  /** group = 全平台；club = 单店 */
  scope: 'group' | 'club';
  club_name?: string;
}

export type VersionStatus = 'draft' | 'pending_approval' | 'active' | 'archived';

export interface CommissionVersion {
  id: string;
  table_id: string;
  version_no: string;
  status: VersionStatus;
  effective_from: string | null;
  effective_to: string | null;
  submitted_by: string | null;
  approved_by: string | null;
}

export interface CommissionTier {
  id: string;
  /** 阶梯起点金额，单位：分 */
  start_amount_cents: number;
  /** 该阶梯的分成费率，单位：bp（基点） */
  rate_bp: number;
}

export interface RuleRow {
  id: string;
  code: string;
  name: string;
  transaction_types: string[];
  member_tiers: string[];
  space_types: string[];
  lease_term_min_months: number | null;
  lease_term_max_months: number | null;
  lead_sources: string[];
  tiers: CommissionTier[];
  /** 折扣系数，放大 100 倍存整数（0.85 → 85） */
  discount_coefficient_x100: number;
  /** 上限金额，单位：分；null = 无上限 */
  cap_cents: number | null;
  /** 主签分成比例，单位：bp（7000 = 70%） */
  primary_ratio_bp: number | null;
  /** 协签分成比例，单位：bp */
  assist_ratio_bp: number | null;
}

export interface FieldError {
  /** 字段路径，如 code、tiers.1.start_amount_cents、primary_ratio_bp */
  field: string;
  message: string;
}

export const STATUS_LABEL: Record<VersionStatus, string> = {
  draft: '草稿',
  pending_approval: '待审批',
  active: '已生效',
  archived: '已归档',
};

/** 条件多选的可选项（虚构字典） */
export const TRANSACTION_TYPE_OPTIONS = ['新签', '续约', '转介绍', '增购'];
export const MEMBER_TIER_OPTIONS = ['基础会员', '银卡会员', '金卡会员'];
export const SPACE_TYPE_OPTIONS = ['开放工位', '独立办公室', '会议室', '虚拟办公室'];
export const LEAD_SOURCE_OPTIONS = ['官网表单', '会员引荐', '运营活动', '小程序'];

export const COMMISSION_TABLES: CommissionTable[] = [
  { id: 'tbl-group-referral', name: '全平台引荐佣金规则表', scope: 'group' },
  { id: 'tbl-club-donghu', name: '单店成交佣金规则表', scope: 'club', club_name: '示例联合空间·东湖店（虚构）' },
  { id: 'tbl-club-qilin', name: '单店成交佣金规则表', scope: 'club', club_name: '示例联合空间·麒麟店（虚构）' },
];

let tierSeq = 0;
const tier = (start_amount_cents: number, rate_bp: number): CommissionTier => {
  tierSeq += 1;
  return { id: `t-${tierSeq}`, start_amount_cents, rate_bp };
};

export const COMMISSION_VERSIONS: CommissionVersion[] = [
  { id: 'ver-v1', table_id: 'tbl-group-referral', version_no: 'V1', status: 'archived', effective_from: '2025-01-01', effective_to: '2025-12-31', submitted_by: '张运营（虚构）', approved_by: '王审批（虚构）' },
  { id: 'ver-v2', table_id: 'tbl-group-referral', version_no: 'V2', status: 'active', effective_from: '2026-01-01', effective_to: '2026-12-31', submitted_by: '张运营（虚构）', approved_by: '王审批（虚构）' },
  { id: 'ver-v3', table_id: 'tbl-group-referral', version_no: 'V3', status: 'draft', effective_from: null, effective_to: null, submitted_by: null, approved_by: null },
  { id: 'ver-club-1', table_id: 'tbl-club-donghu', version_no: 'V1', status: 'active', effective_from: '2026-03-01', effective_to: '2027-02-28', submitted_by: '李店长（虚构）', approved_by: '王审批（虚构）' },
];

let rowSeq = 0;
const row = (r: Omit<RuleRow, 'id'>): RuleRow => {
  rowSeq += 1;
  return { id: `row-${rowSeq}`, ...r };
};

export const COMMISSION_ROWS: RuleRow[] = [
  row({
    code: 'REF-GOLD-001',
    name: '金卡会员转介绍成交',
    transaction_types: ['转介绍'],
    member_tiers: ['金卡会员'],
    space_types: ['独立办公室'],
    lease_term_min_months: 6,
    lease_term_max_months: 36,
    lead_sources: ['会员引荐'],
    tiers: [tier(0, 800), tier(5000000, 600)],
    discount_coefficient_x100: 85,
    cap_cents: 5000000,
    primary_ratio_bp: 7000,
    assist_ratio_bp: 3000,
  }),
  row({
    code: 'REF-STD-002',
    name: '标准会员转介绍成交',
    transaction_types: ['转介绍'],
    member_tiers: ['基础会员', '银卡会员'],
    space_types: ['开放工位', '独立办公室'],
    lease_term_min_months: 3,
    lease_term_max_months: 24,
    lead_sources: ['会员引荐'],
    tiers: [tier(0, 500)],
    discount_coefficient_x100: 100,
    cap_cents: null,
    primary_ratio_bp: 6000,
    assist_ratio_bp: 4000,
  }),
  row({
    code: 'EVENT-003',
    name: '运营活动线索新签',
    transaction_types: ['新签'],
    member_tiers: ['基础会员', '银卡会员', '金卡会员'],
    space_types: ['开放工位', '虚拟办公室'],
    lease_term_min_months: 1,
    lease_term_max_months: 12,
    lead_sources: ['运营活动'],
    tiers: [tier(0, 300)],
    discount_coefficient_x100: 90,
    cap_cents: 1000000,
    primary_ratio_bp: 8000,
    assist_ratio_bp: 2000,
  }),
  row({
    code: 'RENEW-004',
    name: '官网表单续约',
    transaction_types: ['续约'],
    member_tiers: ['基础会员'],
    space_types: ['开放工位'],
    lease_term_min_months: 3,
    lease_term_max_months: 12,
    lead_sources: ['官网表单'],
    tiers: [tier(0, 200)],
    discount_coefficient_x100: 100,
    cap_cents: null,
    primary_ratio_bp: 5000,
    assist_ratio_bp: 5000,
  }),
];

/** 各版本的行数据（草稿 V3 与 V2 相同起点；V1 简化为 2 行；单店版本 2 行） */
export const COMMISSION_ROWS_BY_VERSION: Record<string, RuleRow[]> = {
  'ver-v3': COMMISSION_ROWS,
  'ver-v2': COMMISSION_ROWS,
  'ver-v1': COMMISSION_ROWS.slice(0, 2),
  'ver-club-1': COMMISSION_ROWS.slice(2, 4),
};
