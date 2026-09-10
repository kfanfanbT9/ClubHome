import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../src/features/auth/authStore';
import PracticeRoomPage from '../src/pages/PracticeRoomPage';
import { type FetchMock, fetch가로채기, 응답 } from './fetchMock';
import { renderWithProviders } from './renderWithProviders';

const 연습실목록 = [
  { id: 1, name: '1연습실', location: '2층', capacity: 4, openTime: '09:00', closeTime: '22:00', isActive: true },
  { id: 2, name: '2연습실', location: '3층', capacity: 2, openTime: '10:00', closeTime: '20:00', isActive: true },
];

/** 09:00부터 30분씩 n칸. taken 인덱스는 예약불가로 만든다. */
function 슬롯들(n: number, taken: number[] = []) {
  return Array.from({ length: n }, (_, i) => {
    const 분 = 9 * 60 + i * 30;
    const 시각 = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const 막힘 = taken.includes(i);
    return {
      startTime: 시각(분),
      endTime: 시각(분 + 30),
      isAvailable: !막힘,
      reservationId: 막힘 ? 500 + i : null,
      memberName: 막힘 ? '김색소' : null,
    };
  });
}

let fetchMock: FetchMock;

function 렌더(경로 = '/practice-rooms') {
  return renderWithProviders(
    <Routes>
      <Route path="/practice-rooms" element={<PracticeRoomPage />} />
      <Route path="/practice-rooms/:roomId/reserve" element={<h1>예약 신청 화면</h1>} />
      <Route path="/me/reservations" element={<h1>내 예약 내역</h1>} />
    </Routes>,
    경로,
  );
}

function 목설정(slots = 슬롯들(4)) {
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve(
      url.includes('/reservations')
        ? 응답(200, { practiceRoomId: 1, date: '2026-09-20', slots })
        : 응답(200, 연습실목록),
    ),
  );
}

const 체크박스들 = () => screen.getAllByRole('checkbox');

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

describe('예약현황 표시', () => {
  it('하루 전체 30분 슬롯이 표시된다', async () => {
    목설정(슬롯들(4));
    렌더('/practice-rooms?roomId=1&date=2026-09-20');

    expect(await screen.findByText('09:00-09:30')).toBeInTheDocument();
    expect(screen.getByText('09:30-10:00')).toBeInTheDocument();
    expect(screen.getByText('10:00-10:30')).toBeInTheDocument();
    expect(screen.getByText('10:30-11:00')).toBeInTheDocument();
  });

  it('운영시간을 안내한다', async () => {
    목설정();
    렌더('/practice-rooms?roomId=1&date=2026-09-20');

    // 슬롯은 서버가 전개해 주고, 프론트는 운영시간을 계산하지 않는다.
    expect(await screen.findByText(/운영시간 09:00-22:00/)).toBeInTheDocument();
  });

  it('예약된 슬롯은 예약자 이름과 함께 표시되고 고를 수 없다', async () => {
    목설정(슬롯들(4, [3]));
    렌더('/practice-rooms?roomId=1&date=2026-09-20');

    await screen.findByText('09:00-09:30');
    // 와이어프레임 9번: "예약불가 (김OO)"
    expect(screen.getByText('예약불가 (김색소)')).toBeInTheDocument();
    expect(체크박스들()[3]).toBeDisabled();
    expect(체크박스들()[0]).toBeEnabled();
  });

  it('연습실을 바꾸면 주소가 바뀌고 그 연습실 현황을 요청한다', async () => {
    목설정();
    렌더('/practice-rooms?roomId=1&date=2026-09-20');

    await screen.findByText('09:00-09:30');
    fireEvent.change(screen.getByLabelText('연습실'), { target: { value: '2' } });

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) =>
          (url as string).includes('/api/practice-rooms/2/reservations'),
        ),
      ).toBe(true),
    );
  });
});

describe('연속 슬롯 선택', () => {
  it('선택 요약에 시작~종료와 슬롯 수가 나온다', async () => {
    목설정(슬롯들(4));
    렌더('/practice-rooms?roomId=1&date=2026-09-20');

    await screen.findByText('09:00-09:30');
    fireEvent.click(체크박스들()[0]);
    fireEvent.click(체크박스들()[1]);
    fireEvent.click(체크박스들()[2]);

    expect(screen.getByText('선택한 시간대: 09:00 ~ 10:30 (30분 단위 3슬롯)')).toBeInTheDocument();
  });

  it('비연속 슬롯을 고르면 안내가 뜨고 예약이 진행되지 않는다', async () => {
    목설정(슬롯들(6));
    렌더('/practice-rooms?roomId=1&date=2026-09-20');

    await screen.findByText('09:00-09:30');
    fireEvent.click(체크박스들()[0]);
    fireEvent.click(체크박스들()[3]);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '연속된 시간대만 함께 예약할 수 있습니다.',
    );
    // 기존 선택은 지켜진다
    expect(screen.getByText('선택한 시간대: 09:00 ~ 09:30 (30분 단위 1슬롯)')).toBeInTheDocument();
    expect(체크박스들()[3]).not.toBeChecked();
  });

  it('아무것도 안 고르면 예약 신청 버튼이 비활성이다', async () => {
    목설정();
    렌더('/practice-rooms?roomId=1&date=2026-09-20');

    await screen.findByText('09:00-09:30');
    expect(screen.getByRole('button', { name: '예약 신청' })).toBeDisabled();
    expect(screen.getByText('예약할 시간대를 선택하세요.')).toBeInTheDocument();
  });

  it('날짜를 바꾸면 선택이 초기화된다', async () => {
    목설정(슬롯들(4));
    렌더('/practice-rooms?roomId=1&date=2026-09-20');

    await screen.findByText('09:00-09:30');
    fireEvent.click(체크박스들()[0]);
    expect(screen.getByText(/30분 단위 1슬롯/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('날짜'), { target: { value: '2026-09-21' } });

    // 슬롯 인덱스가 다른 날의 것을 가리키면 엉뚱한 시간대를 예약하게 된다.
    await waitFor(() =>
      expect(screen.getByText('예약할 시간대를 선택하세요.')).toBeInTheDocument(),
    );
  });
});

describe('예약 신청으로 이동', () => {
  it('선택 구간을 주소에 실어 신청 화면으로 보낸다', async () => {
    목설정(슬롯들(4));
    렌더('/practice-rooms?roomId=1&date=2026-09-20');

    await screen.findByText('09:00-09:30');
    fireEvent.click(체크박스들()[0]);
    fireEvent.click(체크박스들()[1]);
    fireEvent.click(screen.getByRole('button', { name: '예약 신청' }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('예약 신청 화면'),
    );
  });
});

describe('예약 확정 후 돌아온 화면', () => {
  it('성공 안내가 표시된다', async () => {
    목설정();
    렌더('/practice-rooms?roomId=1&date=2026-09-20&reserved=1');

    expect(await screen.findByRole('status')).toHaveTextContent('예약이 확정되었습니다.');
  });
});

describe('내 예약 내역 링크', () => {
  it('예약현황에서 내 예약 내역으로 갈 수 있다', async () => {
    목설정();
    렌더('/practice-rooms?roomId=1&date=2026-09-20');

    await screen.findByText('09:00-09:30');
    expect(screen.getByRole('link', { name: /내 예약 내역 보기/ })).toHaveAttribute(
      'href',
      '/me/reservations',
    );
  });
});
