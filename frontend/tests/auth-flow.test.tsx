import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { useAuthStore } from '../src/features/auth/authStore';
import { type FetchMock, fetch가로채기, 경로별응답, 항상응답 } from './fetchMock';
import { renderWithProviders } from './renderWithProviders';

/**
 * 화면 하나가 아니라 App 전체를 렌더해 라우팅까지 함께 검증한다.
 * 시나리오 S-01(가입 → 로그인)과 보호 경로 가드가 여기 대상이다.
 */

const 회원 = {
  id: 7,
  email: 'sax@example.com',
  name: '김색소',
  phone: '010-1234-5678',
  memberGradeId: 1,
  memberGrade: { id: 1, name: '준회원', description: null, gradeLevel: 10, isAdmin: false },
  accountStatus: 'active',
  joinedAt: '2026-09-01T00:00:00.000Z',
};

const 토큰쌍 = { accessToken: 'access-1', refreshToken: 'refresh-1', member: 회원 };

let fetchMock: FetchMock;

const 제목 = () => screen.getByRole('heading', { level: 1 }).textContent;

function 입력하기(라벨: string, 값: string) {
  fireEvent.change(screen.getByLabelText(라벨), { target: { value: 값 } });
}

function 로그인상태로(isAdmin = false) {
  useAuthStore.getState().setAuth({
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    memberId: 7,
    isAdmin,
  });
}

beforeEach(() => {
  useAuthStore.setState({ accessToken: null, refreshToken: null, memberId: null, isAdmin: false });
  localStorage.clear();
  fetchMock = fetch가로채기();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('S-01 가입 후 로그인까지', () => {
  it('가입에 성공하면 로그인 화면으로 이동하며 안내가 표시된다', async () => {
    fetchMock.mockImplementation(항상응답(201, 회원));
    renderWithProviders(<App />, '/signup');

    expect(제목()).toBe('회원가입');

    입력하기('이름', '김색소');
    입력하기('이메일(ID)', 'sax@example.com');
    입력하기('비밀번호', 'password123');
    입력하기('비밀번호 확인', 'password123');
    입력하기('연락처', '010-1234-5678');
    fireEvent.click(screen.getByRole('button', { name: '가입하기' }));

    // 가입 응답에 토큰이 없으므로(201 + Member) 로그인은 별도로 해야 한다.
    await waitFor(() => expect(제목()).toBe('로그인'));
    expect(screen.getByText('가입이 완료되었습니다. 로그인해 주세요.')).toBeInTheDocument();
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('이어서 로그인하면 홈으로 이동하고 메뉴가 로그아웃으로 바뀐다', async () => {
    fetchMock.mockImplementation(항상응답(200, 토큰쌍));
    renderWithProviders(<App />, '/login');

    입력하기('이메일(ID)', 'sax@example.com');
    입력하기('비밀번호', 'password123');
    fireEvent.click(screen.getByRole('button', { name: '로그인' }));

    await waitFor(() =>
      expect(제목()).toBe('색소폰 동호회 “색연필”에 오신 것을 환영합니다'),
    );
    expect(screen.getByRole('button', { name: '로그아웃' })).toBeInTheDocument();
  });
});

describe('보호 경로 가드', () => {
  it('비로그인 상태로 보호 경로에 가면 로그인 화면으로 보낸다', () => {
    renderWithProviders(<App />, '/me');

    expect(제목()).toBe('로그인');
  });

  it.each(['/boards', '/practice-rooms', '/me', '/admin'])(
    '%s 도 비로그인이면 막힌다',
    (경로) => {
      renderWithProviders(<App />, 경로);

      expect(제목()).toBe('로그인');
    },
  );

  it('로그인 상태면 보호 경로가 열린다', () => {
    로그인상태로();
    renderWithProviders(<App />, '/me');

    // 화면 자체는 아직 없으므로 "준비 중"이 뜬다 — 가드를 통과했다는 뜻이다.
    expect(제목()).toBe('준비 중인 화면입니다');
  });

  it('쿼리 문자열이 붙은 보호 경로도 로그인 후 그대로 복원된다', async () => {
    fetchMock.mockImplementation(항상응답(200, 토큰쌍));
    renderWithProviders(<App />, '/boards?page=3');

    expect(제목()).toBe('로그인');

    입력하기('이메일(ID)', 'sax@example.com');
    입력하기('비밀번호', 'password123');
    fireEvent.click(screen.getByRole('button', { name: '로그인' }));

    await waitFor(() => expect(제목()).toBe('준비 중인 화면입니다'));
    // pathname만 넘기면 ?page=3 이 사라져 목록 3페이지를 보려던 사용자가 1페이지로 떨어진다.
    expect(screen.getByText(/page=3/)).toBeInTheDocument();
  });

  it('로그인 후에는 원래 가려던 경로로 돌아간다', async () => {
    fetchMock.mockImplementation(항상응답(200, 토큰쌍));
    renderWithProviders(<App />, '/practice-rooms');

    // 가드가 튕겨내며 원래 경로를 state.from에 실어 보낸다.
    expect(제목()).toBe('로그인');

    입력하기('이메일(ID)', 'sax@example.com');
    입력하기('비밀번호', 'password123');
    fireEvent.click(screen.getByRole('button', { name: '로그인' }));

    // 홈이 아니라 원래 목적지로 가야 한다.
    await waitFor(() => expect(제목()).toBe('준비 중인 화면입니다'));
  });
});

describe('로그아웃', () => {
  it('로그아웃하면 토큰이 폐기되고 보호 경로가 다시 막힌다', async () => {
    fetchMock.mockImplementation(항상응답(204));
    로그인상태로();
    renderWithProviders(<App />, '/me');

    expect(제목()).toBe('준비 중인 화면입니다');

    fireEvent.click(screen.getByRole('button', { name: '로그아웃' }));

    await waitFor(() => expect(useAuthStore.getState().accessToken).toBeNull());
    // 로그아웃 요청은 확인 응답용이고 폐기의 실체는 클라이언트 토큰 삭제다.
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain('/api/auth/logout');
    await waitFor(() => expect(제목()).toBe('색소폰 동호회 “색연필”에 오신 것을 환영합니다'));

    // 로그아웃 뒤에 보호 경로로 다시 들어가면 막힌다.
    renderWithProviders(<App />, '/me');
    expect(screen.getAllByRole('heading', { level: 1 }).pop()?.textContent).toBe('로그인');
  });

  it('로그아웃 요청이 실패해도 토큰은 폐기된다', async () => {
    // 네트워크가 끊긴 상태에서 로그아웃할 방법이 없어지면 안 된다.
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    로그인상태로();
    renderWithProviders(<App />, '/');

    fireEvent.click(screen.getByRole('button', { name: '로그아웃' }));

    await waitFor(() => expect(useAuthStore.getState().accessToken).toBeNull());
  });
});

describe('새로고침 후 로그인 유지', () => {
  it('localStorage에 남은 토큰으로 보호 경로가 그대로 열린다', () => {
    // 새로고침은 앱을 처음부터 다시 올리는 것이므로, 저장소에 값만 심고 렌더한다.
    localStorage.setItem(
      'clubhome-auth',
      JSON.stringify({
        state: { accessToken: 'access-1', refreshToken: 'refresh-1', memberId: 7, isAdmin: false },
        version: 0,
      }),
    );
    useAuthStore.persist.rehydrate();

    renderWithProviders(<App />, '/me');

    expect(제목()).toBe('준비 중인 화면입니다');
    expect(screen.getByRole('button', { name: '로그아웃' })).toBeInTheDocument();
  });
});

describe('Access Token 만료 시 자동 재발급', () => {
  it('보호 API가 401을 주면 재발급 후 요청이 재개된다', async () => {
    로그인상태로();
    let me호출 = 0;
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/api/auth/refresh')) {
        return 경로별응답({ '/api/auth/refresh': { status: 200, body: { accessToken: 'access-2' } } })(
          url,
        );
      }
      me호출 += 1;
      // 첫 호출은 만료된 토큰, 두 번째는 재발급된 토큰으로 온다.
      return 경로별응답({
        '/api/members/me':
          me호출 === 1
            ? { status: 401, body: { message: '토큰이 만료되었습니다.' } }
            : { status: 200, body: 회원 },
      })(url);
    });

    const { api } = await import('../src/api/client');
    const 결과 = await api.get<typeof 회원>('/api/members/me');

    expect(결과.id).toBe(7);
    expect(useAuthStore.getState().accessToken).toBe('access-2');
    // 로그인 상태는 끊기지 않는다.
    expect(useAuthStore.getState().memberId).toBe(7);
  });
});
