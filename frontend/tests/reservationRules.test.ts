import { describe, expect, it } from 'vitest';
import {
  상태문구,
  시작시각,
  취소할수있나,
} from '../src/features/practiceRoom/reservationRules';
import type { Reservation, ReservationStatus } from '../src/types';

function 예약(덮어쓰기: Partial<Reservation> = {}): Reservation {
  return {
    id: 1,
    practiceRoomId: 1,
    memberId: 7,
    reservationDate: '2026-09-20',
    startTime: '14:00',
    endTime: '15:00',
    reservationStatus: 'reserved',
    createdAt: '2026-09-10T00:00:00.000Z',
    ...덮어쓰기,
  };
}

describe('상태 문구', () => {
  it('용어 매핑표대로 옮긴다', () => {
    // 원칙 §3: reserved/completed/canceled → 예약/완료/취소
    expect(상태문구.reserved).toBe('예약');
    expect(상태문구.completed).toBe('완료');
    expect(상태문구.canceled).toBe('취소');
  });
});

describe('시작 시각 해석', () => {
  it('날짜와 시각을 지역 시각으로 붙인다', () => {
    const 시작 = 시작시각(예약({ reservationDate: '2026-09-20', startTime: '14:00' }));

    // 예약은 연습실이 있는 곳의 벽시계 시각이다. UTC로 읽으면 한국에서 9시간 밀린다.
    expect(시작.getFullYear()).toBe(2026);
    expect(시작.getMonth()).toBe(8);
    expect(시작.getDate()).toBe(20);
    expect(시작.getHours()).toBe(14);
    expect(시작.getMinutes()).toBe(0);
  });
});

describe('취소 버튼 노출 판정', () => {
  const 시작전 = new Date('2026-09-20T13:59:59');
  const 시작정각 = new Date('2026-09-20T14:00:00');
  const 시작후 = new Date('2026-09-20T14:00:01');

  it('예약 상태이고 시작 전이면 취소할 수 있다', () => {
    expect(취소할수있나(예약(), 시작전)).toBe(true);
  });

  it('시작 정각부터는 취소 버튼을 감춘다', () => {
    // 서버도 "시작 시각 이전에만" 허용하므로 정각은 이미 늦은 것이다.
    expect(취소할수있나(예약(), 시작정각)).toBe(false);
    expect(취소할수있나(예약(), 시작후)).toBe(false);
  });

  it('완료·취소된 예약에는 취소 버튼이 없다', () => {
    expect(취소할수있나(예약({ reservationStatus: 'completed' }), 시작전)).toBe(false);
    expect(취소할수있나(예약({ reservationStatus: 'canceled' }), 시작전)).toBe(false);
  });

  it('완료·취소 상태는 시작 전이어도 마찬가지다', () => {
    const 상태들: ReservationStatus[] = ['completed', 'canceled'];
    for (const 상태 of 상태들) {
      expect(취소할수있나(예약({ reservationStatus: 상태 }), 시작전)).toBe(false);
    }
  });

  it('해석할 수 없는 시각이면 버튼을 감춘다', () => {
    // 서버가 거절할 요청을 굳이 권하지 않는다.
    expect(취소할수있나(예약({ startTime: '언젠가' }), 시작전)).toBe(false);
    expect(취소할수있나(예약({ reservationDate: '' }), 시작전)).toBe(false);
  });

  it('다음 날 예약은 당연히 취소할 수 있다', () => {
    expect(취소할수있나(예약({ reservationDate: '2026-09-21' }), 시작정각)).toBe(true);
  });
});
