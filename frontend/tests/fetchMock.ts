import { vi } from 'vitest';

/**
 * fetch를 가로채는 공용 도구. 네 개 테스트 파일이 같은 것을 필요로 해서 분리했다.
 */

/** 본문 있는 응답. 204는 본문을 가질 수 없으므로 null을 넘긴다. */
export function 응답(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * 호출마다 새 Response를 만든다.
 * Response 본문은 한 번만 읽을 수 있어서, 같은 객체를 mockResolvedValue로 재사용하면
 * 두 번째 호출에서 "Body has already been read"로 터진다.
 */
export function 항상응답(status: number, body?: unknown): () => Promise<Response> {
  return () => Promise.resolve(응답(status, body));
}

export type FetchMock = ReturnType<typeof vi.fn>;

export function fetch가로채기(): FetchMock {
  const mock = vi.fn();
  vi.stubGlobal('fetch', mock);
  return mock;
}

/** 경로별로 응답을 정해준다. 어느 경로가 불릴지 순서로 특정하기 어려울 때 쓴다. */
export function 경로별응답(
  표: Record<string, { status: number; body?: unknown }>,
): (url: string) => Promise<Response> {
  return (url: string) => {
    const 항목 = Object.entries(표).find(([path]) => url.endsWith(path));
    if (!항목) throw new Error(`목에 등록되지 않은 요청: ${url}`);
    return Promise.resolve(응답(항목[1].status, 항목[1].body));
  };
}
