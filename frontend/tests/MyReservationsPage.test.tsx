import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../src/features/auth/authStore';
import { roomKeys } from '../src/features/practiceRoom/useReservationQueries';
import MyReservationsPage from '../src/pages/MyReservationsPage';
import { type FetchMock, fetch가로채기, 응답 } from './fetchMock';
import { renderWithProviders } from './renderWithProviders';

const 연습실목록 = [
  { id: 1, name: '1연습실', location: '2층', capacity: 4, openTime: '09:00', closeTime: '22:00', isActive: true },
  { id: 2, name: '2연습실', location: '3층', capacity: 2, openTime: '10:00', closeTime: '20:00', isActive: true },
];

/** 시작 전 예약(취소 가능) — 먼 미래로 잡아 실행 시각에 흔들리지 않게 한다. */
const 시작전예약 = {
  id: 11,
  practiceRoomId: 1,
  memberId: 7,
  reservationDate: '2094-09-09',
  startTime: '09:00',
  endTime: '10:00',
  reservationStatus: 'reserved',
  createdAt: '2026-09-01T00:00:00.000Z',
};

const 완료예약 = {
  ...시작전예약,
  id: 12,
  practiceRoomId: 2,
  reservationDate: '2026-09-08',
  startTime: '18:00',
  endTime: '19:00',
  reservationStatus: 'completed',
};

const 취소예약 = {
  ...시작전예약,
  id: 13,
  reservationDate: '2026-09-07',
  startTime: '20:00',
  endTime: '21:00',
  reservationStatus: 'canceled',
};

let fetchMock: FetchMock;

function 렌더(경로 = '/me/reservations') {
  return renderWithProviders(
    <Routes>
      <Route path="/me/reservations" element={<MyReservationsPage />} />
      <Route path="/me" element={<h1>마이페이지</h1>} />
    </Routes>,
    경로,
  );
}

function 목설정(예약목록: unknown[], 취소응답 = { status: 200, body: {} }) {
  fetchMock.mockImplementation((url: string, init: RequestInit) => {
    if (init?.method === 'PATCH') return Promise.resolve(응답(취소응답.status, 취소응답.body));
    if (url.includes('/api/members/me/reservations')) return Promise.resolve(응답(200, 예약목록));
    return Promise.resolve(응답(200, 연습실목록));
  });
}

/** 연습실 이름은 필터 option 에도 같은 글자로 있으므로 행에서만 찾는다. */
const 행연습실 = () => [...document.querySelectorAll('.res-row__room')].map((e) => e.textContent);
const 행이생길때까지 = () => waitFor(() => expect(행연습실().length).toBeGreaterThan(0));

beforeEach(() => {
  useAuthStore.getState().setAuth({
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

describe('예약 내역 표시', () => {
  it('연습실·날짜·시간대·상태가 표시된다', async () => {
    목설정([시작전예약, 완료예약, 취소예약]);
    렌더();

    await 행이생길때까지();
    expect(행연습실()).toEqual(['1연습실', '2연습실', '1연습실']);
    expect(screen.getByText('2094-09-09')).toBeInTheDocument();
    expect(screen.getByText('09:00-10:00')).toBeInTheDocument();
    // 상태는 한글 라벨로 표기한다(원칙 §3 용어 매핑표).
    // "취소"는 취소 버튼 글자와 겹치므로 상태 칸에서만 찾는다.
    expect([...document.querySelectorAll('.res-row__state')].map((e) => e.textContent)).toEqual([
      '예약',
      '완료',
      '취소',
    ]);
  });

  it('비활성으로 바뀐 연습실의 예약도 번호로 표시된다', async () => {
    // GET /api/practice-rooms 는 활성 연습실만 주므로 이름을 찾을 수 없는 경우가 있다.
    목설정([{ ...시작전예약, practiceRoomId: 99 }]);
    렌더();

    expect(await screen.findByText('연습실 #99')).toBeInTheDocument();
  });

  it('예약이 없으면 빈 상태 안내를 보여준다', async () => {
    목설정([]);
    렌더();

    expect(await screen.findByText('예약 내역이 없습니다.')).toBeInTheDocument();
  });

  it('필터를 걸었는데 비면 그 사실을 알려준다', async () => {
    목설정([]);
    렌더('/me/reservations?roomId=2');

    expect(await screen.findByText('이 연습실의 예약 내역이 없습니다.')).toBeInTheDocument();
  });
});

describe('연습실 필터', () => {
  it('기본값은 "전체"이고 파라미터를 붙이지 않는다', async () => {
    목설정([시작전예약]);
    렌더();

    await 행이생길때까지();
    expect(screen.getByLabelText('연습실 필터')).toHaveValue('');
    // "전체"는 파라미터 미지정으로 표현한다 — 전체를 받아 프론트에서 걸러내지 않는다.
    const 목록요청 = fetchMock.mock.calls.filter(([url]) =>
      (url as string).includes('/api/members/me/reservations'),
    );
    expect((목록요청[0] as [string])[0]).not.toContain('roomId');
  });

  it('연습실을 고르면 그 연습실만 서버에 요청한다', async () => {
    목설정([시작전예약]);
    렌더();

    await 행이생길때까지();
    fireEvent.change(screen.getByLabelText('연습실 필터'), { target: { value: '2' } });

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => (url as string).includes('roomId=2')),
      ).toBe(true),
    );
  });

  it('주소의 roomId가 필터에 반영된다', async () => {
    목설정([시작전예약]);
    렌더('/me/reservations?roomId=2');

    await 행이생길때까지();
    expect(screen.getByLabelText('연습실 필터')).toHaveValue('2');
  });

  it('"전체"로 되돌리면 파라미터가 사라진다', async () => {
    목설정([시작전예약]);
    렌더('/me/reservations?roomId=2');

    await 행이생길때까지();
    fireEvent.change(screen.getByLabelText('연습실 필터'), { target: { value: '' } });

    await waitFor(() => {
      const 마지막 = fetchMock.mock.calls
        .filter(([url]) => (url as string).includes('/api/members/me/reservations'))
        .pop();
      expect((마지막 as [string])[0]).not.toContain('roomId');
    });
  });
});

describe('취소 버튼 노출', () => {
  it('시작 전 예약 건에만 취소 버튼이 있다', async () => {
    목설정([시작전예약, 완료예약, 취소예약]);
    렌더();

    await 행이생길때까지();
    // 예약 3건 중 취소할 수 있는 것은 1건이다.
    expect(screen.getAllByRole('button', { name: '취소' })).toHaveLength(1);
  });

  it('이미 시작된 예약에는 취소 버튼이 없다', async () => {
    목설정([{ ...시작전예약, reservationDate: '2020-01-01' }]);
    렌더();

    await 행이생길때까지();
    expect(screen.queryByRole('button', { name: '취소' })).not.toBeInTheDocument();
  });
});

describe('예약 취소', () => {
  it('한 번 더 묻고 나서 취소한다', async () => {
    목설정([시작전예약]);
    렌더();

    fireEvent.click(await screen.findByRole('button', { name: '취소' }));

    // 9-style.md §6: 삭제·취소는 확인 절차를 먼저 거친다.
    expect(screen.getByText('예약을 취소할까요?')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === 'PATCH'),
    ).toBe(false);
  });

  it('확인하면 취소 요청을 보낸다', async () => {
    목설정([시작전예약]);
    렌더();

    fireEvent.click(await screen.findByRole('button', { name: '취소' }));
    fireEvent.click(screen.getAllByRole('button', { name: '취소' })[0]);

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit)?.method === 'PATCH',
      );
      expect((patch as [string])[0]).toContain('/api/reservations/11/cancel');
    });
  });

  it('취소하면 내 목록과 그 연습실 예약현황을 함께 무효화한다', async () => {
    목설정([시작전예약]);
    const { queryClient } = 렌더();
    queryClient.setQueryData(roomKeys.slots(1, '2094-09-09'), {
      practiceRoomId: 1,
      date: '2094-09-09',
      slots: [],
    });

    fireEvent.click(await screen.findByRole('button', { name: '취소' }));
    fireEvent.click(screen.getAllByRole('button', { name: '취소' })[0]);

    // 완료조건: 취소한 시간대가 예약현황에서 다시 예약가능으로 표시된다.
    // 내 목록만 갱신하면 조건을 절반만 만족한다.
    await waitFor(() =>
      expect(queryClient.getQueryState(roomKeys.slots(1, '2094-09-09'))?.isInvalidated).toBe(true),
    );
  });

  it('403은 서버 문구로 안내한다', async () => {
    목설정([시작전예약], { status: 403, body: { message: '이미 시작된 예약은 취소할 수 없습니다.' } });
    렌더();

    fireEvent.click(await screen.findByRole('button', { name: '취소' }));
    fireEvent.click(screen.getAllByRole('button', { name: '취소' })[0]);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '이미 시작된 예약은 취소할 수 없습니다.',
    );
  });

  it('400도 서버 문구로 안내한다', async () => {
    목설정([시작전예약], { status: 400, body: { message: '이미 취소된 예약입니다.' } });
    렌더();

    fireEvent.click(await screen.findByRole('button', { name: '취소' }));
    fireEvent.click(screen.getAllByRole('button', { name: '취소' })[0]);

    expect(await screen.findByRole('alert')).toHaveTextContent('이미 취소된 예약입니다.');
  });
});
