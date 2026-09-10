import { useAuthStore } from '../features/auth/authStore';
import type { ErrorResponse } from '../types';
import { API_BASE_URL, endpoints } from './endpoints';

/**
 * API 클라이언트 (원칙 §2.1).
 *
 * 이 레이어는 도메인 지식을 갖지 않는다 — 등급 비교나 예약 규칙 판단은 하지 않고
 * 인증 헤더 주입, Access Token 재발급, 에러 형태 통일만 책임진다.
 * 컴포넌트는 fetch를 직접 부르지 않고 항상 이 모듈을 경유한다.
 */

/** 서버가 내려준 code/message를 그대로 실어 화면이 상태코드별로 분기할 수 있게 한다. */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /**
   * 재발급을 시도하지 않는다. 로그인·가입·재발급 요청에 쓴다 —
   * 이들의 401은 "토큰이 만료됐다"가 아니라 "비밀번호가 틀렸다"는 뜻이라서
   * 재발급으로 되살릴 수 있는 상황이 아니고, 재발급 요청 자체에 걸면 무한 재귀가 된다.
   */
  skipRefresh?: boolean;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${API_BASE_URL}${path}`;
  if (!query) return url;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    // 미지정 필터는 파라미터를 아예 붙이지 않는다("전체" = 파라미터 없음, FE-08).
    if (value !== undefined) params.set(key, String(value));
  }
  const queryString = params.toString();
  return queryString ? `${url}?${queryString}` : url;
}

function send(path: string, options: RequestOptions, token: string | null): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  return fetch(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    // 프록시·게이트웨이가 HTML 오류 페이지를 내려주는 경우가 있다. 본문을 통째로 버리지 않는다.
    return { message: text } satisfies ErrorResponse;
  }
}

async function toResult<T>(response: Response): Promise<T> {
  // 로그아웃·삭제·취소는 204(본문 없음)로 응답한다.
  if (response.status === 204) return undefined as T;

  const payload = await parseBody(response);
  if (response.ok) return payload as T;

  const error = payload as ErrorResponse | undefined;
  throw new ApiError(
    response.status,
    error?.message ?? `요청이 실패했습니다 (${response.status})`,
    error?.code,
  );
}

/**
 * 동시에 여러 요청이 401을 받아도 재발급은 한 번만 보낸다.
 * 화면 하나가 쿼리 3개를 동시에 던지는 일이 흔한데, 그때마다 재발급을 보내면
 * 나중 응답이 앞선 응답의 토큰을 덮어써 방금 받은 토큰이 무효가 된다.
 */
let refreshInFlight: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  const { refreshToken, setAccessToken } = useAuthStore.getState();
  if (!refreshToken) return null;

  try {
    // 이 요청만은 request()를 거치지 않는다 — 401에 또 재발급을 걸면 무한 재귀다.
    const response = await fetch(buildUrl(endpoints.refresh), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) return null;

    const { accessToken } = (await response.json()) as { accessToken: string };
    setAccessToken(accessToken);
    return accessToken;
  } catch {
    // 네트워크 단절도 "재발급 실패"로 같게 취급한다.
    return null;
  }
}

function refreshAccessToken(): Promise<string | null> {
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(path, options, useAuthStore.getState().accessToken);
  if (response.status !== 401 || options.skipRefresh) return toResult<T>(response);

  const accessToken = await refreshAccessToken();
  if (!accessToken) {
    // Refresh Token까지 만료·위조면 로그아웃한다(FE-01 기술적 고려사항).
    useAuthStore.getState().clearAuth();
    return toResult<T>(response);
  }

  const retried = await send(path, options, accessToken);
  // 방금 받은 토큰으로도 401이면 재발급으로 풀 수 있는 문제가 아니다.
  if (retried.status === 401) useAuthStore.getState().clearAuth();
  return toResult<T>(retried);
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'DELETE' }),
};
