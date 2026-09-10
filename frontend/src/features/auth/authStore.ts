import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * 클라이언트 전용 인증 상태 (원칙 §2.1).
 *
 * 여기에 두는 것은 토큰과 "메뉴를 그리는 데 필요한 최소 신원"(회원ID, 관리자 여부)까지다.
 * 이름·연락처·가입일·등급명 같은 프로필은 서버 데이터이므로 TanStack Query 캐시에만 두고
 * 이 스토어에 복사하지 않는다 — 같은 데이터를 두 곳에 두면 반드시 어긋난다.
 *
 * isAdmin을 예외로 여기 두는 이유: 상단 메뉴의 [관리자] 노출 판정(FE-02)이 매 렌더에
 * 필요한데 이를 위해 회원 조회를 기다리게 하면 메뉴가 깜빡인다. 어차피 표시 제어일 뿐이고
 * 실제 차단은 서버가 403으로 한다.
 */
export interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  memberId: number | null;
  isAdmin: boolean;
  setAuth: (auth: {
    accessToken: string;
    refreshToken: string;
    memberId: number;
    isAdmin: boolean;
  }) => void;
  /** 토큰 재발급 성공 시 Access Token만 교체한다 (api/client.ts 인터셉터가 호출). */
  setAccessToken: (accessToken: string) => void;
  clearAuth: () => void;
}

const 초기상태 = {
  accessToken: null,
  refreshToken: null,
  memberId: null,
  isAdmin: false,
} as const;

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      ...초기상태,
      setAuth: ({ accessToken, refreshToken, memberId, isAdmin }) =>
        set({ accessToken, refreshToken, memberId, isAdmin }),
      setAccessToken: (accessToken) => set({ accessToken }),
      clearAuth: () => set({ ...초기상태 }),
    }),
    {
      // 새로고침 후에도 로그인 상태가 유지되어야 한다(FE-03 완료조건).
      name: 'clubhome-auth',
      // 함수까지 저장되지 않도록 저장 대상을 명시한다.
      partialize: ({ accessToken, refreshToken, memberId, isAdmin }) => ({
        accessToken,
        refreshToken,
        memberId,
        isAdmin,
      }),
    },
  ),
);

/** 컴포넌트에서 `useAuthStore(selectIsAuthenticated)` 형태로 쓴다. */
export const selectIsAuthenticated = (state: AuthState): boolean => state.accessToken !== null;
