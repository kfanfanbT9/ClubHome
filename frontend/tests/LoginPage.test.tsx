import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../src/features/auth/authStore';
import LoginPage from '../src/pages/LoginPage';
import { type FetchMock, fetch가로채기, 항상응답 } from './fetchMock';
import { renderWithProviders } from './renderWithProviders';

const 회원 = {
  id: 7,
  email: 'sax@example.com',
  name: '김색소',
  phone: '010-0000-0000',
  memberGradeId: 2,
  memberGrade: { id: 2, name: '정회원', description: null, gradeLevel: 20, isAdmin: false },
  accountStatus: 'active',
  joinedAt: '2026-09-01T00:00:00.000Z',
};

let fetchMock: FetchMock;

function 입력하기(라벨: string, 값: string) {
  fireEvent.change(screen.getByLabelText(라벨), { target: { value: 값 } });
}

function 제출() {
  fireEvent.click(screen.getByRole('button', { name: '로그인' }));
}

beforeEach(() => {
  useAuthStore.setState({ accessToken: null, refreshToken: null, memberId: null, isAdmin: false });
  localStorage.clear();
  fetchMock = fetch가로채기();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('로그인 폼 클라이언트 검증', () => {
  it('빈 값으로 제출하면 요청을 보내지 않고 안내를 표시한다', () => {
    renderWithProviders(<LoginPage />);

    제출();

    expect(screen.getByText('이메일을 입력하세요.')).toBeInTheDocument();
    expect(screen.getByText('비밀번호를 입력하세요.')).toBeInTheDocument();
    // 서버에 다녀오지 않고 알 수 있는 것은 보내지 않는다.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('이메일 형식이 틀리면 요청을 보내지 않는다', () => {
    renderWithProviders(<LoginPage />);

    입력하기('이메일(ID)', 'not-an-email');
    입력하기('비밀번호', 'password123');
    제출();

    expect(screen.getByText('이메일 형식이 올바르지 않습니다.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('고치기 시작하면 그 칸의 오류 문구가 사라진다', () => {
    renderWithProviders(<LoginPage />);

    제출();
    expect(screen.getByText('이메일을 입력하세요.')).toBeInTheDocument();

    입력하기('이메일(ID)', 's');

    // 이미 고치고 있는 문제를 계속 지적하면 폼이 시끄러워진다.
    expect(screen.queryByText('이메일을 입력하세요.')).not.toBeInTheDocument();
    expect(screen.getByText('비밀번호를 입력하세요.')).toBeInTheDocument();
  });

  it('오류가 난 칸은 aria-invalid로도 표시된다', () => {
    renderWithProviders(<LoginPage />);

    제출();

    expect(screen.getByLabelText('이메일(ID)')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('로그인 성공', () => {
  it('토큰과 최소 신원을 저장한다', async () => {
    fetchMock.mockImplementation(
      항상응답(200, { accessToken: 'access-1', refreshToken: 'refresh-1', member: 회원 }),
    );
    renderWithProviders(<LoginPage />);

    입력하기('이메일(ID)', 'sax@example.com');
    입력하기('비밀번호', 'password123');
    제출();

    await waitFor(() => expect(useAuthStore.getState().accessToken).toBe('access-1'));
    expect(useAuthStore.getState().refreshToken).toBe('refresh-1');
    expect(useAuthStore.getState().memberId).toBe(7);
    expect(useAuthStore.getState().isAdmin).toBe(false);
    // 프로필은 스토어에 복사하지 않는다(원칙 §2.1).
    expect(Object.keys(useAuthStore.getState())).not.toContain('name');
  });

  it('관리자로 로그인하면 isAdmin이 서버 응답대로 저장된다', async () => {
    const 관리자 = {
      ...회원,
      memberGrade: { ...회원.memberGrade, name: '운영진', gradeLevel: 40, isAdmin: true },
    };
    fetchMock.mockImplementation(
      항상응답(200, { accessToken: 'access-1', refreshToken: 'refresh-1', member: 관리자 }),
    );
    renderWithProviders(<LoginPage />);

    입력하기('이메일(ID)', 'admin@example.com');
    입력하기('비밀번호', 'password123');
    제출();

    await waitFor(() => expect(useAuthStore.getState().isAdmin).toBe(true));
  });

  it('로그인 요청은 재발급을 시도하지 않는다', async () => {
    fetchMock.mockImplementation(
      항상응답(200, { accessToken: 'access-1', refreshToken: 'refresh-1', member: 회원 }),
    );
    renderWithProviders(<LoginPage />);

    입력하기('이메일(ID)', 'sax@example.com');
    입력하기('비밀번호', 'password123');
    제출();

    await waitFor(() => expect(useAuthStore.getState().accessToken).toBe('access-1'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('로그인 서버 오류 표시', () => {
  it('401이면 서버가 준 불일치 안내를 그대로 보여준다', async () => {
    fetchMock.mockImplementation(
      항상응답(401, { code: 'UNAUTHORIZED', message: '이메일 또는 비밀번호가 일치하지 않습니다.' }),
    );
    renderWithProviders(<LoginPage />);

    입력하기('이메일(ID)', 'sax@example.com');
    입력하기('비밀번호', 'wrong-password');
    제출();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '이메일 또는 비밀번호가 일치하지 않습니다.',
    );
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('403이면 탈퇴 계정 안내를 보여준다', async () => {
    fetchMock.mockImplementation(
      항상응답(403, { code: 'ACCOUNT_WITHDRAWN', message: '탈퇴한 계정입니다.' }),
    );
    renderWithProviders(<LoginPage />);

    입력하기('이메일(ID)', 'gone@example.com');
    입력하기('비밀번호', 'password123');
    제출();

    expect(await screen.findByRole('alert')).toHaveTextContent('탈퇴한 계정입니다.');
  });
});

// 가입 직후 안내는 실제로 SignupPage가 state를 실어 이동해야 나타나므로
// App 수준 흐름 테스트(auth-flow.test.tsx)에서 검증한다.

describe('서버 오류가 남아 있는 문제', () => {
  it('비밀번호를 고치면 이전 실패 안내가 사라진다', async () => {
    fetchMock.mockImplementation(
      항상응답(401, { code: 'UNAUTHORIZED', message: '이메일 또는 비밀번호가 일치하지 않습니다.' }),
    );
    renderWithProviders(<LoginPage />);

    입력하기('이메일(ID)', 'sax@example.com');
    입력하기('비밀번호', 'wrong-password');
    제출();
    await screen.findByRole('alert');

    입력하기('비밀번호', 'another-password');

    // 방금 비밀번호를 고쳤는데 "일치하지 않습니다"가 그대로 붙어 있으면
    // 그게 어느 시도의 결과인지 알 수 없다.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
