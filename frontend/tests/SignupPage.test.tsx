import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SignupPage from '../src/pages/SignupPage';
import { type FetchMock, fetch가로채기, 항상응답 } from './fetchMock';
import { renderWithProviders } from './renderWithProviders';

let fetchMock: FetchMock;

function 입력하기(라벨: string, 값: string) {
  fireEvent.change(screen.getByLabelText(라벨), { target: { value: 값 } });
}

function 제출() {
  fireEvent.click(screen.getByRole('button', { name: '가입하기' }));
}

/** 모든 칸을 유효하게 채운다. 개별 테스트는 검증하려는 칸만 덮어쓴다. */
function 정상입력() {
  입력하기('이름', '김색소');
  입력하기('이메일(ID)', 'sax@example.com');
  입력하기('비밀번호', 'password123');
  입력하기('비밀번호 확인', 'password123');
  입력하기('연락처', '010-1234-5678');
}

beforeEach(() => {
  localStorage.clear();
  fetchMock = fetch가로채기();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('회원가입 폼 클라이언트 검증', () => {
  it('빈 값으로 제출하면 다섯 칸 모두 안내가 나오고 요청을 보내지 않는다', () => {
    renderWithProviders(<SignupPage />);

    제출();

    expect(screen.getByText('이름을 입력하세요.')).toBeInTheDocument();
    expect(screen.getByText('이메일을 입력하세요.')).toBeInTheDocument();
    expect(screen.getByText('비밀번호를 입력하세요.')).toBeInTheDocument();
    expect(screen.getByText('비밀번호를 한 번 더 입력하세요.')).toBeInTheDocument();
    expect(screen.getByText('연락처를 입력하세요.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('비밀번호가 8자 미만이면 거부한다', () => {
    renderWithProviders(<SignupPage />);

    정상입력();
    입력하기('비밀번호', 'short');
    입력하기('비밀번호 확인', 'short');
    제출();

    // swagger SignupRequest.password.minLength 와 같은 기준이다.
    expect(screen.getByText('비밀번호는 8자 이상이어야 합니다.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('비밀번호 확인이 다르면 거부한다', () => {
    renderWithProviders(<SignupPage />);

    정상입력();
    입력하기('비밀번호 확인', 'password456');
    제출();

    expect(screen.getByText('비밀번호가 일치하지 않습니다.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('이메일 형식이 틀리면 거부한다', () => {
    renderWithProviders(<SignupPage />);

    정상입력();
    입력하기('이메일(ID)', 'sax@');
    제출();

    expect(screen.getByText('이메일 형식이 올바르지 않습니다.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('회원가입 요청', () => {
  it('비밀번호 확인은 서버로 보내지 않는다', async () => {
    fetchMock.mockImplementation(항상응답(201, { id: 9 }));
    renderWithProviders(<SignupPage />);

    정상입력();
    제출();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const 본문 = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    // 서버 스키마(SignupRequest)에 없는 필드다. 오타 확인용으로 클라이언트에만 있다.
    expect(본문).toEqual({
      name: '김색소',
      email: 'sax@example.com',
      password: 'password123',
      phone: '010-1234-5678',
    });
    expect(본문).not.toHaveProperty('passwordConfirm');
  });
});

describe('회원가입 서버 오류 표시', () => {
  it('이메일 중복(409)은 이메일 칸 아래에 붙는다', async () => {
    fetchMock.mockImplementation(
      항상응답(409, { code: 'EMAIL_DUPLICATED', message: '이미 사용 중인 이메일입니다.' }),
    );
    renderWithProviders(<SignupPage />);

    정상입력();
    제출();

    const 문구 = await screen.findByText('이미 사용 중인 이메일입니다.');
    // 와이어프레임 3번이 요구하는 "인라인 에러" — 어느 칸 문제인지 보여야 한다.
    expect(screen.getByLabelText('이메일(ID)')).toHaveAttribute(
      'aria-describedby',
      문구.getAttribute('id'),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('어느 칸인지 알 수 없는 오류(400)는 폼 전체 안내로 보여준다', async () => {
    fetchMock.mockImplementation(
      항상응답(400, { code: 'BAD_REQUEST', message: '입력값을 확인해 주세요.' }),
    );
    renderWithProviders(<SignupPage />);

    정상입력();
    제출();

    expect(await screen.findByRole('alert')).toHaveTextContent('입력값을 확인해 주세요.');
    expect(screen.getByLabelText('이메일(ID)')).not.toHaveAttribute('aria-invalid');
  });
});

describe('서버 오류가 남아 있는 문제', () => {
  it('이메일을 고치면 이전 중복 오류가 사라진다', async () => {
    fetchMock.mockImplementation(
      항상응답(409, { code: 'EMAIL_DUPLICATED', message: '이미 사용 중인 이메일입니다.' }),
    );
    renderWithProviders(<SignupPage />);

    정상입력();
    제출();
    await screen.findByText('이미 사용 중인 이메일입니다.');

    입력하기('이메일(ID)', 'another@example.com');

    // 다른 이메일을 입력했는데도 "이미 사용 중"이 붙어 있으면,
    // 방금 고친 문제를 계속 지적하는 셈이 된다.
    expect(screen.queryByText('이미 사용 중인 이메일입니다.')).not.toBeInTheDocument();
  });
});
