import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, request } from '../src/api/client';
import { API_BASE_URL, endpoints } from '../src/api/endpoints';
import { useAuthStore } from '../src/features/auth/authStore';

/** 본문 있는 응답. 204는 본문을 가질 수 없으므로 null을 넘긴다. */
function 응답(status: number, body?: unknown): Response {
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
function 항상응답(status: number, body?: unknown): () => Promise<Response> {
  return () => Promise.resolve(응답(status, body));
}

let fetchMock: ReturnType<typeof vi.fn>;

/** fetch 호출 n번째의 [url, init] */
function 호출(n: number): [string, RequestInit] {
  return fetchMock.mock.calls[n] as [string, RequestInit];
}

function 헤더(n: number): Record<string, string> {
  return (호출(n)[1].headers ?? {}) as Record<string, string>;
}

beforeEach(() => {
  useAuthStore.setState({ accessToken: null, refreshToken: null, memberId: null, isAdmin: false });
  localStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('요청 조립', () => {
  it('토큰이 없으면 Authorization 헤더를 붙이지 않는다', async () => {
    fetchMock.mockImplementation(항상응답(200, { ok: true }));

    await api.get(endpoints.me);

    expect(호출(0)[0]).toBe(`${API_BASE_URL}${endpoints.me}`);
    expect(호출(0)[1].method).toBe('GET');
    expect(헤더(0).Authorization).toBeUndefined();
  });

  it('토큰이 있으면 Bearer 헤더를 주입한다', async () => {
    useAuthStore.setState({ accessToken: 'access-1' });
    fetchMock.mockImplementation(항상응답(200, { id: 1 }));

    const 결과 = await api.get<{ id: number }>(endpoints.me);

    expect(헤더(0).Authorization).toBe('Bearer access-1');
    expect(결과).toEqual({ id: 1 });
  });

  it('본문이 있는 요청만 Content-Type을 붙이고 JSON으로 직렬화한다', async () => {
    fetchMock.mockImplementation(항상응답(200, {}));

    await api.post(endpoints.login, { email: 'a@b.com', password: 'pw' });

    expect(헤더(0)['Content-Type']).toBe('application/json');
    expect(호출(0)[1].body).toBe(JSON.stringify({ email: 'a@b.com', password: 'pw' }));
  });

  it('본문 없는 요청에는 Content-Type을 붙이지 않는다', async () => {
    fetchMock.mockImplementation(항상응답(204));

    await api.delete('/api/posts/1');

    expect(호출(0)[1].method).toBe('DELETE');
    expect(헤더(0)['Content-Type']).toBeUndefined();
  });

  it('PATCH도 본문과 함께 보낸다', async () => {
    fetchMock.mockImplementation(항상응답(200, { name: '홍길동' }));

    await api.patch(endpoints.me, { name: '홍길동' });

    expect(호출(0)[1].method).toBe('PATCH');
    expect(호출(0)[1].body).toBe(JSON.stringify({ name: '홍길동' }));
  });

  it('method를 생략하면 GET으로 보낸다', async () => {
    fetchMock.mockImplementation(항상응답(200, { ok: true }));

    await request(endpoints.me);

    expect(호출(0)[1].method).toBe('GET');
  });

  it('undefined 쿼리 파라미터는 아예 붙이지 않는다', async () => {
    fetchMock.mockImplementation(항상응답(200, []));

    // "전체" 필터는 파라미터 미지정으로 보낸다(FE-08).
    await api.get('/api/members/me/reservations', { query: { roomId: undefined } });
    expect(호출(0)[0]).toBe(`${API_BASE_URL}/api/members/me/reservations`);

    await api.get('/api/members/me/reservations', { query: { roomId: 3 } });
    expect(호출(1)[0]).toBe(`${API_BASE_URL}/api/members/me/reservations?roomId=3`);
  });
});

describe('응답 해석', () => {
  it('204는 본문 없이 성공으로 처리한다', async () => {
    fetchMock.mockImplementation(항상응답(204));

    await expect(api.post(endpoints.logout)).resolves.toBeUndefined();
  });

  it('4xx는 서버의 code·message를 담은 ApiError로 던진다', async () => {
    fetchMock.mockImplementation(
      항상응답(409, { code: 'RESERVATION_SLOT_CONFLICT', message: '이미 예약된 시간대가 포함되어 있습니다.' }),
    );

    const error = await api.post('/api/practice-rooms/1/reservations', {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).code).toBe('RESERVATION_SLOT_CONFLICT');
    expect((error as ApiError).message).toBe('이미 예약된 시간대가 포함되어 있습니다.');
  });

  it('JSON이 아닌 오류 본문도 메시지로 살려둔다', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response('<html>502 Bad Gateway</html>', { status: 502 })));

    const error = await api.get(endpoints.me).catch((e: unknown) => e);

    expect((error as ApiError).status).toBe(502);
    expect((error as ApiError).message).toBe('<html>502 Bad Gateway</html>');
  });

  it('본문이 비어 있는 오류에는 기본 메시지를 넣는다', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 500 })));

    const error = await api.get(endpoints.me).catch((e: unknown) => e);

    expect((error as ApiError).message).toBe('요청이 실패했습니다 (500)');
    expect((error as ApiError).code).toBeUndefined();
  });
});

describe('Access Token 재발급', () => {
  it('401을 받으면 재발급하고 새 토큰으로 원 요청을 재개한다', async () => {
    useAuthStore.getState().setAuth({
      accessToken: 'expired',
      refreshToken: 'refresh-1',
      memberId: 7,
      isAdmin: false,
    });
    fetchMock
      .mockResolvedValueOnce(응답(401, { message: '토큰이 만료되었습니다.' }))
      .mockResolvedValueOnce(응답(200, { accessToken: 'access-2' }))
      .mockResolvedValueOnce(응답(200, { id: 7, name: '홍길동' }));

    const 결과 = await api.get<{ id: number }>(endpoints.me);

    expect(결과).toEqual({ id: 7, name: '홍길동' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // 두 번째 호출이 재발급이다
    expect(호출(1)[0]).toBe(`${API_BASE_URL}${endpoints.refresh}`);
    expect(호출(1)[1].body).toBe(JSON.stringify({ refreshToken: 'refresh-1' }));
    // 세 번째 호출은 새 토큰으로 재개된 원 요청이다
    expect(헤더(2).Authorization).toBe('Bearer access-2');
    // 스토어의 Access Token도 교체돼 다음 요청부터 바로 쓰인다
    expect(useAuthStore.getState().accessToken).toBe('access-2');
    // 로그인 상태는 유지된다
    expect(useAuthStore.getState().memberId).toBe(7);
  });

  it('재발급이 401로 거부되면 로그아웃하고 원래 401을 던진다', async () => {
    useAuthStore.getState().setAuth({
      accessToken: 'expired',
      refreshToken: 'refresh-expired',
      memberId: 7,
      isAdmin: false,
    });
    fetchMock
      .mockResolvedValueOnce(응답(401, { message: '토큰이 만료되었습니다.' }))
      .mockResolvedValueOnce(응답(401, { message: '만료된 Refresh Token입니다.' }));

    const error = await api.get(endpoints.me).catch((e: unknown) => e);

    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).message).toBe('토큰이 만료되었습니다.');
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().refreshToken).toBeNull();
    expect(useAuthStore.getState().memberId).toBeNull();
  });

  it('Refresh Token이 아예 없으면 재발급을 시도하지 않고 로그아웃한다', async () => {
    useAuthStore.setState({ accessToken: 'orphan', refreshToken: null });
    fetchMock.mockResolvedValueOnce(응답(401, { message: '인증이 필요합니다.' }));

    const error = await api.get(endpoints.me).catch((e: unknown) => e);

    expect((error as ApiError).status).toBe(401);
    // 재발급 요청은 보내지 않았다
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('재발급 중 네트워크가 끊겨도 로그아웃으로 수습한다', async () => {
    useAuthStore.setState({ accessToken: 'expired', refreshToken: 'refresh-1' });
    fetchMock
      .mockResolvedValueOnce(응답(401, { message: '토큰이 만료되었습니다.' }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const error = await api.get(endpoints.me).catch((e: unknown) => e);

    expect((error as ApiError).status).toBe(401);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('새로 받은 토큰으로도 401이면 로그아웃한다', async () => {
    useAuthStore.setState({ accessToken: 'expired', refreshToken: 'refresh-1' });
    fetchMock
      .mockResolvedValueOnce(응답(401, { message: '토큰이 만료되었습니다.' }))
      .mockResolvedValueOnce(응답(200, { accessToken: 'access-2' }))
      .mockResolvedValueOnce(응답(401, { message: '인증이 필요합니다.' }));

    const error = await api.get(endpoints.me).catch((e: unknown) => e);

    expect((error as ApiError).status).toBe(401);
    // 재발급으로 풀 수 있는 문제가 아니므로 재발급을 또 시도하지 않는다
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('skipRefresh 요청의 401은 재발급 없이 그대로 올린다', async () => {
    useAuthStore.setState({ accessToken: null, refreshToken: 'refresh-1' });
    fetchMock.mockResolvedValueOnce(응답(401, { message: '이메일 또는 비밀번호가 일치하지 않습니다.' }));

    const error = await request(endpoints.login, {
      method: 'POST',
      body: { email: 'a@b.com', password: 'wrong' },
      skipRefresh: true,
    }).catch((e: unknown) => e);

    // 로그인 401은 "비밀번호가 틀렸다"는 뜻이라 재발급으로 되살릴 수 없다.
    expect((error as ApiError).message).toBe('이메일 또는 비밀번호가 일치하지 않습니다.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 로그인 실패가 기존 Refresh Token을 지워버리면 안 된다
    expect(useAuthStore.getState().refreshToken).toBe('refresh-1');
  });

  it('401이 동시에 여러 개 떠도 재발급은 한 번만 보낸다', async () => {
    useAuthStore.setState({ accessToken: 'expired', refreshToken: 'refresh-1' });
    fetchMock.mockImplementation((url: string, init: RequestInit) => {
      if (url.endsWith(endpoints.refresh)) {
        return Promise.resolve(응답(200, { accessToken: 'access-2' }));
      }
      const headers = (init.headers ?? {}) as Record<string, string>;
      return Promise.resolve(
        headers.Authorization === 'Bearer access-2'
          ? 응답(200, { ok: true })
          : 응답(401, { message: '토큰이 만료되었습니다.' }),
      );
    });

    const 결과 = await Promise.all([
      api.get(endpoints.me),
      api.get('/api/boards'),
      api.get('/api/practice-rooms'),
    ]);

    expect(결과).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    const 재발급횟수 = fetchMock.mock.calls.filter(([url]) =>
      (url as string).endsWith(endpoints.refresh),
    ).length;
    // 요청마다 재발급을 보내면 나중 응답이 앞선 토큰을 덮어써 방금 받은 토큰이 무효가 된다.
    expect(재발급횟수).toBe(1);
  });
});
