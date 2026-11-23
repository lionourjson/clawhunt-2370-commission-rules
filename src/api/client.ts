/** 统一 API 客户端：基地址从环境变量读取；超时与错误处理集中在这里。 */
import { config } from '../config';

export interface ApiEnvelope<T> {
  code: number;
  message?: string;
  data: T;
}

export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface FieldError {
  /** 字段路径，如 code、tiers.1.start_amount_cents、primary_ratio_bp */
  field: string;
  message: string;
}

/** 后端 422 字段路径校验错误（工单：显示后端返回的字段路径错误并定位对应输入框） */
export class ApiValidationError extends Error {
  errors: FieldError[];

  constructor(errors: FieldError[], message?: string) {
    super(message ?? '后端校验未通过');
    this.name = 'ApiValidationError';
    this.errors = errors;
  }
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${config.apiBaseUrl}${path}`, { signal });
  if (!res.ok) {
    throw new ApiError(`接口异常：HTTP ${res.status}`);
  }
  const body = (await res.json()) as ApiEnvelope<T>;
  if (body.code !== 0) {
    throw new ApiError(body.message ?? '接口返回错误');
  }
  return body.data;
}

async function parseBody<T>(res: Response): Promise<T> {
  if (res.status === 422) {
    const body = (await res.json()) as ApiEnvelope<unknown> & { errors?: FieldError[] };
    throw new ApiValidationError(body.errors ?? [], body.message);
  }
  if (!res.ok) {
    throw new ApiError(`接口异常：HTTP ${res.status}`);
  }
  const env = (await res.json()) as ApiEnvelope<T>;
  if (env.code !== 0) {
    throw new ApiError(env.message ?? '接口返回错误');
  }
  return env.data;
}

export async function apiPost<TBody extends object, T>(path: string, body: TBody, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${config.apiBaseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  return parseBody<T>(res);
}

export async function apiPut<TBody extends object, T>(path: string, body: TBody, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${config.apiBaseUrl}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  return parseBody<T>(res);
}
