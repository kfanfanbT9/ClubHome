import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { endpoints } from '../../api/endpoints';
import type { Member } from '../../types';

/**
 * 본인 정보 조회·수정. 서버 데이터는 이 캐시에만 두고 Zustand에 복사하지 않는다(원칙 §2.1).
 */

/** 쿼리 키를 문자열로 흩뿌리지 않고 한곳에 모아, invalidate할 때 오타로 빗나가지 않게 한다. */
export const memberKeys = {
  me: ['members', 'me'] as const,
};

export interface MemberUpdateInput {
  name: string;
  phone: string;
}

export function useMe() {
  return useQuery({
    queryKey: memberKeys.me,
    queryFn: () => api.get<Member>(endpoints.me),
  });
}

export function useUpdateMe() {
  const queryClient = useQueryClient();

  return useMutation({
    /**
     * 이름·연락처만 보낸다. 이메일·등급·계정상태는 서버가 허용 필드에서 제외하지만
     * (BE-04) 애초에 보내지 않는 것이 의도를 분명히 한다.
     */
    mutationFn: (input: MemberUpdateInput) => api.patch<Member>(endpoints.me, input),
    onSuccess: () => {
      /**
       * 응답 본문으로 캐시를 덮어쓰지 않고 무효화해 다시 조회한다.
       * "재조회 시에도 반영되어 있다"가 완료조건이므로, 서버가 확정한 값을 다시 받아
       * 보여주는 편이 그 조건을 실제로 만족하는지 확인해준다.
       */
      queryClient.invalidateQueries({ queryKey: memberKeys.me });
    },
  });
}
