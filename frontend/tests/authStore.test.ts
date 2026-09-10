import { beforeEach, describe, expect, it } from 'vitest';
import { selectIsAuthenticated, useAuthStore } from '../src/features/auth/authStore';

const 로그인정보 = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  memberId: 7,
  isAdmin: false,
};

beforeEach(() => {
  useAuthStore.setState({ accessToken: null, refreshToken: null, memberId: null, isAdmin: false });
  localStorage.clear();
});

describe('authStore', () => {
  it('초기 상태는 비로그인이다', () => {
    const state = useAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.memberId).toBeNull();
    expect(state.isAdmin).toBe(false);
    expect(selectIsAuthenticated(state)).toBe(false);
  });

  it('setAuth는 토큰과 최소 신원을 함께 저장한다', () => {
    useAuthStore.getState().setAuth({ ...로그인정보, isAdmin: true });

    const state = useAuthStore.getState();
    expect(state.accessToken).toBe('access-1');
    expect(state.refreshToken).toBe('refresh-1');
    expect(state.memberId).toBe(7);
    expect(state.isAdmin).toBe(true);
    expect(selectIsAuthenticated(state)).toBe(true);
  });

  it('setAccessToken은 Access Token만 바꾸고 Refresh Token은 남겨둔다', () => {
    useAuthStore.getState().setAuth(로그인정보);
    useAuthStore.getState().setAccessToken('access-2');

    const state = useAuthStore.getState();
    expect(state.accessToken).toBe('access-2');
    // 재발급 후에도 Refresh Token이 유지되지 않으면 다음 만료 때 로그아웃된다.
    expect(state.refreshToken).toBe('refresh-1');
    expect(state.memberId).toBe(7);
  });

  it('clearAuth는 토큰과 신원을 모두 비운다', () => {
    useAuthStore.getState().setAuth({ ...로그인정보, isAdmin: true });
    useAuthStore.getState().clearAuth();

    const state = useAuthStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
    expect(state.memberId).toBeNull();
    expect(state.isAdmin).toBe(false);
    expect(selectIsAuthenticated(state)).toBe(false);
  });

  it('저장 대상은 토큰·회원ID·관리자여부뿐이고 프로필과 함수는 저장하지 않는다', () => {
    useAuthStore.getState().setAuth(로그인정보);

    const 저장값 = JSON.parse(localStorage.getItem('clubhome-auth') ?? '{}');
    // 새로고침 후 로그인 상태가 유지되어야 한다(FE-03 완료조건).
    expect(저장값.state).toEqual(로그인정보);
    // 서버 데이터를 이중 저장하지 않는다(원칙 §2.1) — 이름·연락처·등급명이 새어 들어오면 안 된다.
    expect(Object.keys(저장값.state).sort()).toEqual([
      'accessToken',
      'isAdmin',
      'memberId',
      'refreshToken',
    ]);
  });
});
