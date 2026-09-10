import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api/client';
import { createQueryClient } from '../src/lib/queryClient';

/** 기본 옵션의 retry는 boolean 또는 (실패횟수, 에러) => boolean 형태다. */
function 쿼리재시도판정(failureCount: number, error: Error): boolean {
  const retry = createQueryClient().getDefaultOptions().queries?.retry;
  if (typeof retry !== 'function') throw new Error('queries.retry가 함수가 아니다');
  return retry(failureCount, error) as boolean;
}

describe('queryClient 재시도 정책', () => {
  it('4xx는 재시도하지 않는다', () => {
    expect(쿼리재시도판정(0, new ApiError(403, '권한이 없습니다.'))).toBe(false);
    expect(쿼리재시도판정(0, new ApiError(404, '게시글이 없습니다.'))).toBe(false);
    // client.ts가 이미 재발급을 시도했고 실패해서 여기까지 온 것이다.
    expect(쿼리재시도판정(0, new ApiError(401, '인증이 필요합니다.'))).toBe(false);
  });

  it('5xx는 한 번만 재시도한다', () => {
    expect(쿼리재시도판정(0, new ApiError(500, '서버 오류'))).toBe(true);
    expect(쿼리재시도판정(1, new ApiError(500, '서버 오류'))).toBe(false);
  });

  it('네트워크 오류도 한 번 재시도한다', () => {
    expect(쿼리재시도판정(0, new TypeError('Failed to fetch'))).toBe(true);
    expect(쿼리재시도판정(1, new TypeError('Failed to fetch'))).toBe(false);
  });

  it('뮤테이션은 재시도하지 않는다', () => {
    // 예약 신청·글 작성을 자동 재시도하면 중복 생성 위험이 있다.
    expect(createQueryClient().getDefaultOptions().mutations?.retry).toBe(false);
  });
});
