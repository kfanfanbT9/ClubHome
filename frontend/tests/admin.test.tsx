import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { adminKeys } from '../src/features/admin/useAdminQueries';
import { useAuthStore } from '../src/features/auth/authStore';
import { boardKeys } from '../src/features/board/useBoardQueries';
import { roomKeys } from '../src/features/practiceRoom/useReservationQueries';
import BoardAdminPage from '../src/pages/admin/BoardAdminPage';
import MemberGradeAdminPage from '../src/pages/admin/MemberGradeAdminPage';
import PracticeRoomAdminPage from '../src/pages/admin/PracticeRoomAdminPage';
import { type FetchMock, fetch가로채기, 응답 } from './fetchMock';
import { renderWithProviders } from './renderWithProviders';

const 등급들 = [
  { id: 1, name: '준회원', description: null, gradeLevel: 10, isAdmin: false },
  { id: 2, name: '정회원', description: null, gradeLevel: 20, isAdmin: false },
  { id: 3, name: '운영진', description: null, gradeLevel: 30, isAdmin: true },
];

const 회원들 = [
  {
    id: 7,
    email: 'kim@ex.com',
    name: '김색소',
    phone: null,
    memberGradeId: 1,
    memberGrade: 등급들[0],
    accountStatus: 'active',
    joinedAt: '2026-01-10T00:00:00.000Z',
  },
];

const 게시판들 = [
  { id: 1, name: '자유게시판', description: null, minGradeLevel: 10, isActive: true },
  { id: 4, name: '이전 공지(보관)', description: null, minGradeLevel: 30, isActive: false },
];

const 연습실들 = [
  { id: 1, name: '1연습실', location: '2층', capacity: 4, openTime: '09:00', closeTime: '22:00', isActive: true },
  { id: 2, name: '2연습실', location: '3층', capacity: 2, openTime: '09:00', closeTime: '22:00', isActive: false },
];

const 예약들 = [
  {
    id: 31,
    practiceRoomId: 1,
    memberId: 7,
    reservationDate: '2026-09-09',
    startTime: '09:00',
    endTime: '10:00',
    reservationStatus: 'reserved',
    createdAt: '2026-09-01T00:00:00.000Z',
  },
];

let fetchMock: FetchMock;

/** 경로별 기본 응답. 개별 테스트는 덮어쓸 응답만 넘긴다. */
function 목설정(덮어쓰기: (url: string, init: RequestInit) => Response | undefined = () => undefined) {
  fetchMock.mockImplementation((url: string, init: RequestInit) => {
    const 덮어쓴것 = 덮어쓰기(url, init);
    if (덮어쓴것) return Promise.resolve(덮어쓴것);
    if (url.includes('/api/admin/member-grades')) return Promise.resolve(응답(200, 등급들));
    if (url.includes('/api/admin/members')) return Promise.resolve(응답(200, 회원들));
    if (url.includes('/api/admin/boards')) return Promise.resolve(응답(200, 게시판들));
    if (url.includes('/api/admin/practice-rooms')) return Promise.resolve(응답(200, 연습실들));
    if (url.includes('/api/admin/reservations')) return Promise.resolve(응답(200, 예약들));
    return Promise.resolve(응답(200, []));
  });
}

function 로그인(isAdmin: boolean) {
  useAuthStore.getState().setAuth({
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    memberId: 7,
    isAdmin,
  });
}

/** 같은 글자의 버튼이 여러 곳에 있어 범위를 좁혀야 하는 경우가 많다. */
const 폼안 = () => within(document.querySelector('form.form:not(.search)') as HTMLElement);
const 줄이름 = () => [...document.querySelectorAll('.adm-row__main')].map((e) => e.textContent);
const 배지들 = () => [...document.querySelectorAll('.adm-row .badge')].map((e) => e.textContent);

beforeEach(() => {
  useAuthStore.setState({ accessToken: null, refreshToken: null, memberId: null, isAdmin: false });
  localStorage.clear();
  fetchMock = fetch가로채기();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('관리자 경로 차단', () => {
  it.each(['/admin', '/admin/members', '/admin/boards', '/admin/practice-rooms'])(
    '비관리자는 %s 에 들어갈 수 없다',
    (경로) => {
      목설정();
      로그인(false);
      renderWithProviders(<App />, 경로);

      // 완료조건: 비관리자 계정이 관리자 경로에 접근하면 차단된다.
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        '색소폰 동호회 “색연필”에 오신 것을 환영합니다',
      );
    },
  );

  it('비로그인은 로그인 화면으로 간다', () => {
    목설정();
    renderWithProviders(<App />, '/admin');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('로그인');
  });

  it('관리자는 관리자 메뉴로 들어간다', () => {
    목설정();
    로그인(true);
    renderWithProviders(<App />, '/admin');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('관리자');
    expect(screen.getByRole('link', { name: /회원 등급 관리/ })).toBeInTheDocument();
  });
});

describe('회원 등급 관리 (화면 12)', () => {
  const 렌더 = (경로 = '/admin/members') =>
    renderWithProviders(
      <Routes>
        <Route path="/admin/members" element={<MemberGradeAdminPage />} />
      </Routes>,
      경로,
    );

  beforeEach(() => 로그인(true));

  it('회원 목록과 현재 등급이 표시된다', async () => {
    목설정();
    렌더();

    expect(await screen.findByText('김색소')).toBeInTheDocument();
    expect(screen.getByText('kim@ex.com')).toBeInTheDocument();
    expect(screen.getByText('현재등급: 준회원')).toBeInTheDocument();
  });

  it('검색어를 서버로 보낸다', async () => {
    목설정();
    렌더();

    await screen.findByText('김색소');
    fireEvent.change(screen.getByLabelText(/검색/), { target: { value: '김' } });
    fireEvent.click(screen.getByRole('button', { name: '검색' }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => (url as string).includes('q=%EA%B9%80'))).toBe(
        true,
      ),
    );
  });

  it('등급을 바꾸지 않으면 저장 버튼이 비활성이다', async () => {
    목설정();
    렌더();

    await screen.findByText('김색소');
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
  });

  it('등급을 고르면 저장할 수 있고 그 값을 보낸다', async () => {
    목설정();
    렌더();

    await screen.findByText('김색소');
    fireEvent.change(screen.getByLabelText('김색소 등급'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit)?.method === 'PATCH',
      );
      expect((patch as [string])[0]).toContain('/api/admin/members/7/grade');
      expect(JSON.parse((patch as [string, RequestInit])[1].body as string)).toEqual({
        memberGradeId: 2,
      });
    });
  });

  it('등급 변경은 게시판 목록 캐시도 무효화한다', async () => {
    목설정();
    const { queryClient } = 렌더();
    queryClient.setQueryData(boardKeys.list, 게시판들);

    await screen.findByText('김색소');
    fireEvent.change(screen.getByLabelText('김색소 등급'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    // 등급이 바뀌면 canAccess가 달라진다(S-07).
    await waitFor(() =>
      expect(queryClient.getQueryState(boardKeys.list)?.isInvalidated).toBe(true),
    );
  });

  it('등급 체계가 서열 순으로 표시된다', async () => {
    목설정();
    렌더();

    await screen.findByText('김색소');
    const 배지 = [...document.querySelectorAll('.adm-grades .badge')].map((e) => e.textContent);
    expect(배지).toEqual(['준회원 (10)', '정회원 (20)', '운영진 (30) · 관리자']);
  });

  it('등급 추가 폼에서 빈 값은 보내지 않는다', async () => {
    목설정();
    렌더();

    await screen.findByText('김색소');
    fireEvent.click(screen.getByRole('button', { name: '+ 등급 추가' }));
    fireEvent.click(폼안().getByRole('button', { name: '저장' }));

    expect(screen.getByText('등급명을 입력하세요.')).toBeInTheDocument();
    expect(screen.getByText('등급서열은 1 이상의 정수여야 합니다.')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === 'POST'),
    ).toBe(false);
  });

  it('등급 중복(409)은 폼 오류로 보여준다', async () => {
    목설정((_url, init) =>
      init?.method === 'POST'
        ? 응답(409, { message: '이미 사용 중인 등급명 또는 등급서열입니다.' })
        : undefined,
    );
    렌더();

    await screen.findByText('김색소');
    fireEvent.click(screen.getByRole('button', { name: '+ 등급 추가' }));
    fireEvent.change(screen.getByLabelText('등급명'), { target: { value: '정회원' } });
    fireEvent.change(screen.getByLabelText(/등급서열/), { target: { value: '20' } });
    fireEvent.click(폼안().getByRole('button', { name: '저장' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '이미 사용 중인 등급명 또는 등급서열입니다.',
    );
  });
});

describe('게시판 관리 (화면 13)', () => {
  const 렌더 = () =>
    renderWithProviders(
      <Routes>
        <Route path="/admin/boards" element={<BoardAdminPage />} />
      </Routes>,
      '/admin/boards',
    );

  beforeEach(() => 로그인(true));

  it('비활성 게시판까지 관리자용 목록으로 보여준다', async () => {
    목설정();
    렌더();

    // 일반 회원용 GET /api/boards 는 비활성을 숨긴다 — 그것을 쓰면 다시 켤 방법이 없다.
    expect(await screen.findByText('이전 공지(보관)')).toBeInTheDocument();
    expect(screen.getByText('비활성')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) => (url as string).includes('/api/admin/boards')),
    ).toBe(true);
  });

  it('생성 폼에서 최소등급은 등급서열 값으로 보낸다', async () => {
    목설정();
    렌더();

    await screen.findByText('자유게시판');
    fireEvent.click(screen.getByRole('button', { name: '+ 게시판 생성' }));
    fireEvent.change(screen.getByLabelText('게시판명'), { target: { value: '새 게시판' } });
    fireEvent.change(screen.getByLabelText('이용가능 최소등급'), { target: { value: '20' } });
    fireEvent.click(폼안().getByRole('button', { name: '저장' }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit)?.method === 'POST',
      );
      // 게시판이 참조하는 것은 등급 id가 아니라 등급서열이다(ERD §3).
      expect(JSON.parse((post as [string, RequestInit])[1].body as string)).toMatchObject({
        name: '새 게시판',
        minGradeLevel: 20,
        isActive: true,
      });
    });
  });

  it('게시판 변경은 일반 회원용 목록 캐시도 무효화한다', async () => {
    목설정();
    const { queryClient } = 렌더();
    queryClient.setQueryData(boardKeys.list, 게시판들);

    await screen.findByText('자유게시판');
    fireEvent.click(screen.getByRole('button', { name: '+ 게시판 생성' }));
    fireEvent.change(screen.getByLabelText('게시판명'), { target: { value: '새 게시판' } });
    fireEvent.click(폼안().getByRole('button', { name: '저장' }));

    // 최소등급·사용여부 변경은 일반 회원 화면에 즉시 반영되어야 한다(S-08).
    await waitFor(() =>
      expect(queryClient.getQueryState(boardKeys.list)?.isInvalidated).toBe(true),
    );
  });

  it('삭제는 한 번 더 묻는다', async () => {
    목설정();
    렌더();

    await screen.findByText('자유게시판');
    fireEvent.click(screen.getAllByRole('button', { name: '삭제' })[0]);

    expect(screen.getByText('이 게시판을 삭제할까요?')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === 'DELETE'),
    ).toBe(false);
  });

  it('삭제 409는 비활성 경로를 안내한다', async () => {
    목설정((_url, init) =>
      init?.method === 'DELETE'
        ? 응답(409, { message: '참조 중인 게시글이 있어 삭제할 수 없습니다.' })
        : undefined,
    );
    렌더();

    await screen.findByText('자유게시판');
    fireEvent.click(screen.getAllByRole('button', { name: '삭제' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: '삭제' })[0]);

    const 안내 = await screen.findByRole('alert');
    expect(안내).toHaveTextContent('참조 중인 게시글이 있어 삭제할 수 없습니다.');
    // 지우는 대신 비활성으로 바꾸는 길을 알려준다(ERD §4 FK RESTRICT, S-08 예외).
    expect(안내).toHaveTextContent('사용여부를 비활성으로 바꾸면');
  });
});

describe('연습실 관리 (화면 14)', () => {
  const 렌더 = () =>
    renderWithProviders(
      <Routes>
        <Route path="/admin/practice-rooms" element={<PracticeRoomAdminPage />} />
      </Routes>,
      '/admin/practice-rooms',
    );

  beforeEach(() => 로그인(true));

  it('비활성 연습실까지 보여준다', async () => {
    목설정();
    렌더();

    await waitFor(() => expect(줄이름()).toContain('2연습실'));
    expect(배지들()).toContain('비활성');
  });

  it('운영시간이 30분 경계가 아니면 보내지 않는다', async () => {
    목설정();
    렌더();

    await waitFor(() => expect(줄이름()).toContain('1연습실'));
    fireEvent.click(screen.getByRole('button', { name: '+ 연습실 등록' }));
    fireEvent.change(screen.getByLabelText('연습실명'), { target: { value: '3연습실' } });
    fireEvent.change(screen.getByLabelText(/운영 시작시간/), { target: { value: '09:15' } });
    fireEvent.click(폼안().getByRole('button', { name: '저장' }));

    // 서버가 30분 단위로 슬롯을 전개하므로 경계가 맞아야 한다.
    expect(
      screen.getByText('운영 시작시간을 HH:00 또는 HH:30으로 입력하세요.'),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === 'POST'),
    ).toBe(false);
  });

  it('종료시간이 시작시간보다 이르면 거부한다', async () => {
    목설정();
    렌더();

    await waitFor(() => expect(줄이름()).toContain('1연습실'));
    fireEvent.click(screen.getByRole('button', { name: '+ 연습실 등록' }));
    fireEvent.change(screen.getByLabelText('연습실명'), { target: { value: '3연습실' } });
    fireEvent.change(screen.getByLabelText(/운영 종료시간/), { target: { value: '08:00' } });
    fireEvent.click(폼안().getByRole('button', { name: '저장' }));

    expect(screen.getByText('운영 종료시간은 시작시간보다 늦어야 합니다.')).toBeInTheDocument();
  });

  it('연습실 변경은 예약 화면의 연습실 목록도 무효화한다', async () => {
    목설정();
    const { queryClient } = 렌더();
    queryClient.setQueryData(roomKeys.list, 연습실들);

    await waitFor(() => expect(줄이름()).toContain('1연습실'));
    fireEvent.click(screen.getByRole('button', { name: '+ 연습실 등록' }));
    fireEvent.change(screen.getByLabelText('연습실명'), { target: { value: '3연습실' } });
    fireEvent.click(폼안().getByRole('button', { name: '저장' }));

    await waitFor(() => expect(queryClient.getQueryState(roomKeys.list)?.isInvalidated).toBe(true));
  });

  it('예약 목록에 예약자 이름을 붙여 보여준다', async () => {
    목설정();
    렌더();

    // 예약 응답에는 memberId만 있어 회원 목록과 맞춰야 한다.
    expect(await screen.findByText(/김색소 · 2026-09-09 · 09:00-10:00/)).toBeInTheDocument();
  });

  it('관리자는 예약을 강제 취소할 수 있다', async () => {
    목설정();
    const { queryClient } = 렌더();
    queryClient.setQueryData(roomKeys.slots(1, '2026-09-09'), {
      practiceRoomId: 1,
      date: '2026-09-09',
      slots: [],
    });

    fireEvent.click(await screen.findByRole('button', { name: '강제취소' }));
    fireEvent.click(screen.getByRole('button', { name: '강제취소' }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([url, init]) =>
          (init as RequestInit)?.method === 'PATCH' &&
          (url as string).includes('/api/admin/reservations/31/cancel'),
      );
      expect(patch).toBeDefined();
    });
    // 취소한 시간대가 예약 화면에서 다시 예약가능으로 보여야 한다.
    await waitFor(() =>
      expect(queryClient.getQueryState(roomKeys.slots(1, '2026-09-09'))?.isInvalidated).toBe(true),
    );
  });

  it('예약 상태가 reserved가 아니면 강제취소 버튼이 없다', async () => {
    목설정((url) =>
      url.includes('/api/admin/reservations')
        ? 응답(200, [{ ...예약들[0], reservationStatus: 'canceled' }])
        : undefined,
    );
    렌더();

    await screen.findByText(/김색소 · 2026-09-09/);
    expect(screen.queryByRole('button', { name: '강제취소' })).not.toBeInTheDocument();
  });

  it('예약 조회는 관리자용 엔드포인트를 쓴다', async () => {
    목설정();
    렌더();

    await waitFor(() => expect(줄이름()).toContain('1연습실'));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) =>
          (url as string).includes('/api/admin/reservations'),
        ),
      ).toBe(true),
    );
    // 관리자 화면에서 일반 회원용 엔드포인트를 쓰면 남의 예약이 보이지 않는다.
    expect(
      fetchMock.mock.calls.some(([url]) =>
        (url as string).includes('/api/members/me/reservations'),
      ),
    ).toBe(false);
  });
});

describe('쿼리 키가 서로를 침범하지 않는다', () => {
  it('관리자 키와 일반 회원 키가 접두사로 겹치지 않는다', () => {
    // 겹치면 한쪽만 갱신하려다 다른 쪽까지 다시 불러온다.
    expect(adminKeys.boards[0]).toBe('admin');
    expect(boardKeys.list[0]).toBe('boards');
    expect(adminKeys.rooms[0]).toBe('admin');
    expect(roomKeys.list[0]).toBe('practiceRooms');
  });
});

describe('수정 흐름', () => {
  beforeEach(() => 로그인(true));

  it('게시판 수정 폼이 기존 값으로 채워지고 PATCH로 보낸다', async () => {
    목설정();
    renderWithProviders(
      <Routes>
        <Route path="/admin/boards" element={<BoardAdminPage />} />
      </Routes>,
      '/admin/boards',
    );

    await waitFor(() => expect(줄이름()).toContain('자유게시판'));
    fireEvent.click(screen.getAllByRole('button', { name: '수정' })[0]);

    expect(screen.getByLabelText('게시판명')).toHaveValue('자유게시판');
    expect(screen.getByLabelText('이용가능 최소등급')).toHaveValue('10');

    // 사용여부를 끈다 — 삭제가 막힌 게시판을 숨기는 운영 경로다.
    fireEvent.click(폼안().getByRole('checkbox'));
    fireEvent.click(폼안().getByRole('button', { name: '저장' }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([url, init]) =>
          (init as RequestInit)?.method === 'PATCH' &&
          (url as string).includes('/api/admin/boards/1'),
      );
      expect(patch).toBeDefined();
      expect(JSON.parse((patch as [string, RequestInit])[1].body as string)).toMatchObject({
        name: '자유게시판',
        minGradeLevel: 10,
        isActive: false,
      });
    });
  });

  it('게시판 수정에 성공하면 폼이 닫힌다', async () => {
    목설정();
    renderWithProviders(
      <Routes>
        <Route path="/admin/boards" element={<BoardAdminPage />} />
      </Routes>,
      '/admin/boards',
    );

    await waitFor(() => expect(줄이름()).toContain('자유게시판'));
    fireEvent.click(screen.getAllByRole('button', { name: '수정' })[0]);
    fireEvent.click(폼안().getByRole('button', { name: '저장' }));

    await waitFor(() => expect(screen.queryByLabelText('게시판명')).not.toBeInTheDocument());
  });

  it('연습실 수정 폼이 기존 값으로 채워지고 사용여부를 바꿔 보낸다', async () => {
    목설정();
    renderWithProviders(
      <Routes>
        <Route path="/admin/practice-rooms" element={<PracticeRoomAdminPage />} />
      </Routes>,
      '/admin/practice-rooms',
    );

    await waitFor(() => expect(줄이름()).toContain('2연습실'));
    // 비활성 연습실(2연습실)을 다시 켠다
    fireEvent.click(screen.getAllByRole('button', { name: '수정' })[1]);

    expect(screen.getByLabelText('연습실명')).toHaveValue('2연습실');
    expect(screen.getByLabelText('수용인원')).toHaveValue('2');
    expect(폼안().getByRole('checkbox')).not.toBeChecked();

    fireEvent.click(폼안().getByRole('checkbox'));
    fireEvent.click(폼안().getByRole('button', { name: '저장' }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([url, init]) =>
          (init as RequestInit)?.method === 'PATCH' &&
          (url as string).includes('/api/admin/practice-rooms/2'),
      );
      expect(JSON.parse((patch as [string, RequestInit])[1].body as string)).toMatchObject({
        name: '2연습실',
        capacity: 2,
        openTime: '09:00',
        closeTime: '22:00',
        isActive: true,
      });
    });
  });

  it('연습실 삭제 409도 비활성 경로를 안내한다', async () => {
    목설정((_url, init) =>
      init?.method === 'DELETE'
        ? 응답(409, { message: '참조 중인 예약 이력이 있어 삭제할 수 없습니다.' })
        : undefined,
    );
    renderWithProviders(
      <Routes>
        <Route path="/admin/practice-rooms" element={<PracticeRoomAdminPage />} />
      </Routes>,
      '/admin/practice-rooms',
    );

    await waitFor(() => expect(줄이름()).toContain('1연습실'));
    fireEvent.click(screen.getAllByRole('button', { name: '삭제' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: '삭제' })[0]);

    const 안내 = await screen.findByRole('alert');
    expect(안내).toHaveTextContent('참조 중인 예약 이력이 있어 삭제할 수 없습니다.');
    expect(안내).toHaveTextContent('사용여부를 비활성으로 바꾸면');
  });

  it('게시판 생성 폼을 취소하면 닫힌다', async () => {
    목설정();
    renderWithProviders(
      <Routes>
        <Route path="/admin/boards" element={<BoardAdminPage />} />
      </Routes>,
      '/admin/boards',
    );

    await waitFor(() => expect(줄이름()).toContain('자유게시판'));
    fireEvent.click(screen.getByRole('button', { name: '+ 게시판 생성' }));
    expect(screen.getByLabelText('게시판명')).toBeInTheDocument();

    fireEvent.click(폼안().getByRole('button', { name: '취소' }));
    expect(screen.queryByLabelText('게시판명')).not.toBeInTheDocument();
  });

  it('예약 목록을 연습실·날짜로 걸러 서버에 보낸다', async () => {
    목설정();
    renderWithProviders(
      <Routes>
        <Route path="/admin/practice-rooms" element={<PracticeRoomAdminPage />} />
      </Routes>,
      '/admin/practice-rooms',
    );

    await waitFor(() => expect(줄이름()).toContain('1연습실'));
    const 셀렉트들 = screen.getAllByRole('combobox');
    fireEvent.change(셀렉트들[셀렉트들.length - 1], { target: { value: '1' } });

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url]) =>
            (url as string).includes('/api/admin/reservations') &&
            (url as string).includes('roomId=1'),
        ),
      ).toBe(true),
    );
  });
});

describe('브라우저에서 발견한 문제', () => {
  beforeEach(() => 로그인(true));

  it('등급 변경 성공 안내가 실제로 표시된다', async () => {
    let 조회 = 0;
    목설정((url, init) => {
      if (url.includes('/api/admin/members') && init?.method === 'PATCH') {
        return 응답(200, { ...회원들[0], memberGradeId: 2, memberGrade: 등급들[1] });
      }
      if (url.includes('/api/admin/members') && !url.includes('member-grades')) {
        조회 += 1;
        // 변경 후 재조회에서는 서버가 바뀐 등급을 준다.
        return 응답(200, 조회 === 1 ? 회원들 : [{ ...회원들[0], memberGradeId: 2, memberGrade: 등급들[1] }]);
      }
      return undefined;
    });
    renderWithProviders(
      <Routes>
        <Route path="/admin/members" element={<MemberGradeAdminPage />} />
      </Routes>,
      '/admin/members',
    );

    await screen.findByText('김색소');
    fireEvent.change(screen.getByLabelText('김색소 등급'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    // 재조회가 끝나 새 등급이 보인 다음에도 안내가 살아 있어야 한다.
    // key에 등급을 섞으면 그 순간 줄이 remount 되면서 안내가 사라진다.
    await waitFor(() => expect(screen.getByText('현재등급: 정회원')).toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('등급을 변경했습니다.');
    // 저장할 것이 없어졌으므로 버튼은 다시 비활성이다.
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
  });
});
