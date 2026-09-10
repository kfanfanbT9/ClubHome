import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';

/**
 * 서버 상태 캐시. 모든 서버 데이터는 이 캐시에만 두고 Zustand에 복사하지 않는다(원칙 §2.1).
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        /**
         * 4xx는 다시 보내도 같은 답이 온다 — 없는 게시글은 세 번 더 물어도 없다.
         * 401은 client.ts가 이미 재발급으로 한 번 되살려봤고, 그래도 실패해서 여기까지 온 것이다.
         * 서버 오류(5xx)와 네트워크 단절만 한 번 더 시도한다.
         */
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status < 500) return false;
          return failureCount < 1;
        },
      },
      mutations: {
        // 예약 신청·글 작성을 자동 재시도하면 중복 생성 위험이 있다. 재시도는 사용자가 결정한다.
        retry: false,
      },
    },
  });
}
