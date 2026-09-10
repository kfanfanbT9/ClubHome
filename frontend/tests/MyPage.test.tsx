import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../src/features/auth/authStore';
import MyPage from '../src/pages/MyPage';
import { type FetchMock, fetch가로채기, 응답, 항상응답 } from './fetchMock';
import { renderWithProviders } from './renderWithProviders';

const 회원 = {
  id: 7,
  email: 'hong@example.com',
  name: '홍길동',
  phone: '010-1234-5678',
  memberGradeId: 1,
  memberGrade: { id: 1, name: '준회원', description: null, gradeLevel: 10, isAdmin: false },
  accountStatus: 'active',
  // UTC 자정 직전 값 — 날짜를 문자열로 자르면 하루가 어긋나는 경우다.
  joinedAt: '2026-01-10T05:00:00.000Z',
};

let fetchMock: FetchMock;

function 입력하기(라벨: string, 값: string) {
  fireEvent.change(screen.getByLabelText(라벨), { target: { value: 값 } });
}

const 저장 = () => fireEvent.click(screen.getByRole('button', { name: '저장' }));

beforeEach(() => {
  useAuthStore.setState({
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    memberId: 7,
    isAdmin: false,
  });
  localStorage.clear();
  fetchMock = fetch가로채기();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('본인 정보 표시', () => {
  it('조회한 정보가 화면에 채워진다', async () => {
    fetchMock.mockImplementation(항상응답(200, 회원));
    renderWithProviders(<MyPage />);

    expect(await screen.findByDisplayValue('홍길동')).toBeInTheDocument();
    expect(screen.getByDisplayValue('010-1234-5678')).toBeInTheDocument();
    expect(screen.getByText('hong@example.com')).toBeInTheDocument();
    expect(screen.getByText('준회원')).toBeInTheDocument();
    expect(screen.getByText('2026-01-10')).toBeInTheDocument();
  });

  it('이메일과 회원등급은 입력창이 아니라 읽기 전용 표기로 나온다', async () => {
    fetchMock.mockImplementation(항상응답(200, 회원));
    renderWithProviders(<MyPage />);

    await screen.findByDisplayValue('홍길동');

    // 입력창이면 눌러도 안 바뀌는 칸이 되고 탭 순서만 차지한다.
    expect(screen.queryByDisplayValue('hong@example.com')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('준회원')).not.toBeInTheDocument();
    expect(screen.getByText('(수정불가)')).toBeInTheDocument();
    expect(screen.getByText('(변경은 관리자만 가능)')).toBeInTheDocument();
  });

  it('연락처가 없는 회원도 빈 칸으로 표시된다', async () => {
    fetchMock.mockImplementation(항상응답(200, { ...회원, phone: null }));
    renderWithProviders(<MyPage />);

    await screen.findByDisplayValue('홍길동');
    // null이 "null" 문자열로 새어 나오면 안 된다.
    expect(screen.getByLabelText('연락처')).toHaveValue('');
  });

  it('조회 실패는 안내로 표시된다', async () => {
    fetchMock.mockImplementation(항상응답(500, { message: '서버 오류가 발생했습니다.' }));
    renderWithProviders(<MyPage />);

    // 5xx는 queryClient 정책상 한 번 재시도하므로(lib/queryClient.ts) 오류가
    // 화면에 뜨기까지 기본 대기시간(1초)보다 오래 걸린다.
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent(
      '서버 오류가 발생했습니다.',
    );
  });
});

describe('저장', () => {
  it('이름과 연락처만 보낸다', async () => {
    fetchMock.mockImplementation(항상응답(200, 회원));
    renderWithProviders(<MyPage />);
    await screen.findByDisplayValue('홍길동');

    입력하기('이름', '홍길순');
    입력하기('연락처', '010-9999-8888');
    저장();

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit)?.method === 'PATCH',
      );
      expect(patch).toBeDefined();
      // 이메일·등급·계정상태는 서버가 거부하는 필드다. 애초에 보내지 않는다.
      expect(JSON.parse((patch as [string, RequestInit])[1].body as string)).toEqual({
        name: '홍길순',
        phone: '010-9999-8888',
      });
    });
  });

  it('저장에 성공하면 안내를 띄우고 본인 정보를 다시 조회한다', async () => {
    let get횟수 = 0;
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      if (init?.method === 'PATCH') return Promise.resolve(응답(200, { ...회원, name: '홍길순' }));
      get횟수 += 1;
      return Promise.resolve(응답(200, get횟수 === 1 ? 회원 : { ...회원, name: '홍길순' }));
    });
    renderWithProviders(<MyPage />);
    await screen.findByDisplayValue('홍길동');

    입력하기('이름', '홍길순');
    저장();

    expect(await screen.findByRole('status')).toHaveTextContent('저장했습니다.');
    // "재조회 시에도 반영되어 있다"가 완료조건이므로 캐시를 무효화해 다시 받아야 한다.
    await waitFor(() => expect(get횟수).toBe(2));
  });

  it('필수값이 비면 저장을 보내지 않는다', async () => {
    fetchMock.mockImplementation(항상응답(200, 회원));
    renderWithProviders(<MyPage />);
    await screen.findByDisplayValue('홍길동');

    입력하기('이름', '   ');
    저장();

    expect(screen.getByText('이름을 입력하세요.')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === 'PATCH'),
    ).toBe(false);
  });

  it('서버 400은 안내로 표시된다', async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) =>
      init?.method === 'PATCH'
        ? Promise.resolve(응답(400, { message: '연락처 형식이 올바르지 않습니다.' }))
        : Promise.resolve(응답(200, 회원)),
    );
    renderWithProviders(<MyPage />);
    await screen.findByDisplayValue('홍길동');

    입력하기('연락처', '아무거나');
    저장();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '연락처 형식이 올바르지 않습니다.',
    );
  });

  it('다시 입력하면 직전 저장 결과 안내가 사라진다', async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) =>
      init?.method === 'PATCH'
        ? Promise.resolve(응답(400, { message: '연락처 형식이 올바르지 않습니다.' }))
        : Promise.resolve(응답(200, 회원)),
    );
    renderWithProviders(<MyPage />);
    await screen.findByDisplayValue('홍길동');

    입력하기('연락처', '아무거나');
    저장();
    await screen.findByRole('alert');

    입력하기('연락처', '010-2222-3333');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('리뷰에서 발견한 문제', () => {
  it('저장 중에 입력해도 저장 결과가 사라지지 않는다', async () => {
    let patch완료: (r: Response) => void = () => {};
    let get횟수 = 0;
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      if (init?.method === 'PATCH') {
        // 응답을 붙잡아 두고 그 사이에 입력이 들어오는 상황을 만든다.
        return new Promise<Response>((resolve) => {
          patch완료 = resolve;
        });
      }
      get횟수 += 1;
      return Promise.resolve(응답(200, 회원));
    });
    renderWithProviders(<MyPage />);
    await screen.findByDisplayValue('홍길동');

    입력하기('이름', '홍길순');
    저장();

    // PATCH가 실제로 나가기를 기다린다. 저장() 직후에는 아직 fetch가 불리지 않아
    // patch완료가 no-op이다.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === 'PATCH'),
      ).toBe(true),
    );

    // 저장이 끝나기 전에 계속 타이핑한다 — 입력칸은 비활성이 아니다.
    입력하기('연락처', '010-5555-6666');
    patch완료(응답(200, { ...회원, name: '홍길순' }));

    // reset이 진행 중인 mutation을 지워버리면 안내도 재조회도 사라진다.
    expect(await screen.findByRole('status')).toHaveTextContent('저장했습니다.');
    await waitFor(() => expect(get횟수).toBe(2));
  });

  it('이름이 50자를 넘으면 보내지 않는다', async () => {
    fetchMock.mockImplementation(항상응답(200, 회원));
    renderWithProviders(<MyPage />);
    await screen.findByDisplayValue('홍길동');

    // swagger MemberUpdateRequest.name.maxLength 와 같은 기준이다.
    입력하기('이름', '가'.repeat(51));
    저장();

    expect(screen.getByText('이름은 50자를 넘을 수 없습니다.')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === 'PATCH'),
    ).toBe(false);
  });

  it('연락처가 20자를 넘으면 보내지 않는다', async () => {
    fetchMock.mockImplementation(항상응답(200, 회원));
    renderWithProviders(<MyPage />);
    await screen.findByDisplayValue('홍길동');

    입력하기('연락처', '0'.repeat(21));
    저장();

    expect(screen.getByText('연락처는 20자를 넘을 수 없습니다.')).toBeInTheDocument();
  });
});
