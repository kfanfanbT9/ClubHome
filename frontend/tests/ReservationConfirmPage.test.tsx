import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../src/features/auth/authStore';
import { roomKeys } from '../src/features/practiceRoom/useReservationQueries';
import ReservationConfirmPage from '../src/pages/ReservationConfirmPage';
import { type FetchMock, fetch가로채기, 응답 } from './fetchMock';
import { renderWithProviders } from './renderWithProviders';

const 연습실목록 = [
  { id: 1, name: '1연습실', location: '2층', capacity: 4, openTime: '09:00', closeTime: '22:00', isActive: true },
];

let fetchMock: FetchMock;

const 신청경로 = '/practice-rooms/1/reserve?date=2026-09-20&start=09:00&end=10:30';

function 렌더(경로 = 신청경로) {
  return renderWithProviders(
    <Routes>
      <Route path="/practice-rooms/:roomId/reserve" element={<ReservationConfirmPage />} />
      <Route path="/practice-rooms" element={<h1>예약현황</h1>} />
    </Routes>,
    경로,
  );
}

function 목설정(예약응답: { status: number; body?: unknown }) {
  fetchMock.mockImplementation((url: string, init: RequestInit) =>
    Promise.resolve(
      init?.method === 'POST'
        ? 응답(예약응답.status, 예약응답.body)
        : 응답(200, url.includes('/reservations') ? { practiceRoomId: 1, date: '2026-09-20', slots: [] } : 연습실목록),
    ),
  );
}

const 확정 = () => fireEvent.click(screen.getByRole('button', { name: '예약 확정' }));

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

describe('신청 내용 확인', () => {
  it('연습실·날짜·구간과 슬롯 수가 표시된다', async () => {
    목설정({ status: 201, body: {} });
    렌더();

    expect(await screen.findByText('1연습실')).toBeInTheDocument();
    expect(screen.getByText('2026-09-20')).toBeInTheDocument();
    expect(screen.getByText('09:00 ~ 10:30 (30분 단위 3슬롯 연속)')).toBeInTheDocument();
  });

  it('전체 거부 규칙을 미리 알려준다', async () => {
    목설정({ status: 201, body: {} });
    렌더();

    await screen.findByText('1연습실');
    expect(
      screen.getByText(/슬롯 중 하나라도 이미 예약되어 있으면 신청 전체가 거부됩니다/),
    ).toBeInTheDocument();
  });

  it('구간이 지정되지 않은 주소에서는 안내와 돌아갈 길을 준다', () => {
    목설정({ status: 201, body: {} });
    렌더('/practice-rooms/1/reserve');

    expect(screen.getByText(/예약할 시간대가 지정되지 않았습니다/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '예약 확정' })).not.toBeInTheDocument();
  });
});

describe('예약 확정', () => {
  it('슬롯 배열이 아니라 시작~종료 한 쌍을 보낸다', async () => {
    목설정({ status: 201, body: { id: 9 } });
    렌더();

    await screen.findByText('1연습실');
    확정();

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit)?.method === 'POST',
      );
      expect(post).toBeDefined();
      // 예약은 슬롯 단위 행이 아니라 구간 한 행으로 저장된다(ERD §4).
      expect(JSON.parse((post as [string, RequestInit])[1].body as string)).toEqual({
        reservationDate: '2026-09-20',
        startTime: '09:00',
        endTime: '10:30',
      });
    });
  });

  it('성공하면 예약현황으로 돌아간다', async () => {
    목설정({ status: 201, body: { id: 9 } });
    렌더();

    await screen.findByText('1연습실');
    확정();

    // 완료조건: 예약 확정 시 성공 안내 후 현황이 갱신된다.
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('예약현황'),
    );
  });
});

describe('서버 거절 처리', () => {
  it('409면 중복 안내와 최신 현황 링크를 보여준다', async () => {
    목설정({
      status: 409,
      body: { code: 'RESERVATION_SLOT_CONFLICT', message: '이미 예약된 시간대가 포함되어 있습니다.' },
    });
    렌더();

    await screen.findByText('1연습실');
    확정();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '이미 예약된 시간대가 포함되어 있습니다.',
    );
    expect(screen.getByRole('link', { name: '최신 예약현황 보기' })).toBeInTheDocument();
  });

  it('409를 받아도 그 연습실 현황 캐시를 무효화한다', async () => {
    목설정({ status: 409, body: { message: '이미 예약된 시간대가 포함되어 있습니다.' } });
    const { queryClient } = 렌더();
    // 화면이 보고 있던 현황을 캐시에 심어 둔다.
    queryClient.setQueryData(roomKeys.slots(1, '2026-09-20'), {
      practiceRoomId: 1,
      date: '2026-09-20',
      slots: [],
    });

    await screen.findByText('1연습실');
    확정();

    // 409는 다른 회원이 그 사이에 확정했다는 뜻이므로 화면의 "예약가능"이 이미 거짓이다.
    // 갱신하지 않으면 사용자가 같은 시간대를 또 고른다.
    await waitFor(() =>
      expect(queryClient.getQueryState(roomKeys.slots(1, '2026-09-20'))?.isInvalidated).toBe(true),
    );
  });

  it('400은 입력 오류 안내로 보여준다', async () => {
    목설정({ status: 400, body: { message: '운영시간을 벗어난 요청입니다.' } });
    렌더();

    await screen.findByText('1연습실');
    확정();

    expect(await screen.findByRole('alert')).toHaveTextContent('운영시간을 벗어난 요청입니다.');
    // 400에는 최신 현황 링크를 붙이지 않는다 — 현황이 낡은 것이 원인이 아니다.
    expect(screen.queryByRole('link', { name: '최신 예약현황 보기' })).not.toBeInTheDocument();
  });
});
