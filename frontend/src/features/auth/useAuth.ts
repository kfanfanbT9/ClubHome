import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { endpoints } from '../../api/endpoints';
import type { Member, TokenPairResponse } from '../../types';
import { useAuthStore } from './authStore';

/**
 * 인증 mutation. 화면 컴포넌트는 조립만 하고 요청은 여기서만 보낸다(원칙 §6, §1 SRP).
 *
 * 세 요청 모두 skipRefresh로 보낸다 — 이들의 401은 "토큰이 만료됐다"가 아니라
 * "비밀번호가 틀렸다"는 뜻이라 재발급으로 되살릴 수 없다(api/client.ts).
 */

export interface SignupInput {
  name: string;
  email: string;
  password: string;
  phone: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

/**
 * 가입은 토큰을 주지 않는다(201 + Member). 시나리오 S-01도 가입 뒤 별도로 로그인하는
 * 흐름이므로 자동 로그인을 만들지 않고 로그인 화면으로 보낸다.
 */
export function useSignup() {
  return useMutation({
    mutationFn: (input: SignupInput) =>
      api.post<Member>(endpoints.signup, input, { skipRefresh: true }),
  });
}

export function useLogin() {
  const setAuth = useAuthStore((state) => state.setAuth);

  return useMutation({
    mutationFn: (input: LoginInput) =>
      api.post<TokenPairResponse>(endpoints.login, input, { skipRefresh: true }),
    onSuccess: ({ accessToken, refreshToken, member }) => {
      // 프로필 전체가 아니라 토큰과 최소 신원만 저장한다(원칙 §2.1 이중 저장 금지).
      setAuth({
        accessToken,
        refreshToken,
        memberId: member.id,
        isAdmin: member.memberGrade.isAdmin,
      });
    },
  });
}

export function useLogout() {
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.post<void>(endpoints.logout, undefined, { skipRefresh: true }),
    /**
     * onSuccess가 아니라 onSettled인 이유: 서버에 토큰 저장소가 없으므로 폐기의 실체는
     * 클라이언트 토큰 삭제다(PRD F-02, ERD §4). 확인 응답용 204 요청이 실패했다고
     * 로그아웃을 막으면, 네트워크가 끊긴 상태에서 로그아웃할 방법이 없어진다.
     */
    onSettled: () => {
      clearAuth();
      // 이전 사용자의 서버 데이터가 캐시에 남으면 다음 로그인 직후 그 데이터가 보인다.
      queryClient.clear();
    },
  });
}
