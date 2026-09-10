/**
 * API 경로 상수 (원칙 §6).
 * 지금 화면에서 쓰는 경로만 둔다 — 나머지 24개 경로를 미리 적어두지 않는다(§1 YAGNI).
 * 화면을 추가하는 이슈에서 그 화면이 부르는 경로를 함께 넣는다.
 */

/** 비워 두면 같은 출처로 요청한다. 개발 중에는 .env의 VITE_API_BASE_URL이 백엔드를 가리킨다. */
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '';

export const endpoints = {
  signup: '/api/auth/signup',
  login: '/api/auth/login',
  refresh: '/api/auth/refresh',
  logout: '/api/auth/logout',
  me: '/api/members/me',
} as const;
