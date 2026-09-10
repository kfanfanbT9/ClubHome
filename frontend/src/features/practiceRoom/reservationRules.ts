import type { Reservation, ReservationStatus } from '../../types';

/** 예약상태 코드를 화면 문구로 (원칙 §3 용어 매핑표 밖의 동의어를 쓰지 않는다). */
export const 상태문구: Record<ReservationStatus, string> = {
  reserved: '예약',
  completed: '완료',
  canceled: '취소',
};

/**
 * 예약 시작 시각. 날짜와 시각이 따로 오므로 붙여서 해석한다.
 *
 * `T`로 이어 붙이면 시간대 표시가 없는 지역 시각으로 해석된다 —
 * 예약은 연습실이 있는 곳의 벽시계 시각이므로 그게 맞다.
 * `Z`를 붙이면 UTC로 읽혀 한국에서는 9시간 밀린다.
 */
export function 시작시각(reservation: Reservation): Date {
  return new Date(`${reservation.reservationDate}T${reservation.startTime}`);
}

/**
 * 취소 버튼을 보여줄지.
 *
 * `reserved`이고 아직 시작하지 않은 건에만 보여준다(도메인 정의서 §6).
 * 이건 표시 제어일 뿐이고 최종 판정은 서버가 한다 — 시작 후 취소는 403,
 * 이미 취소·완료된 건은 400으로 거절된다. 관리자 예외(시작 후에도 취소 가능)는
 * 이 화면 범위가 아니다.
 *
 * `기준시각`을 인자로 받는 이유: 경계(시작 시각 정각)를 테스트로 확인하려면
 * "지금"을 바깥에서 정할 수 있어야 한다.
 */
export function 취소할수있나(reservation: Reservation, 기준시각: Date = new Date()): boolean {
  if (reservation.reservationStatus !== 'reserved') return false;

  const 시작 = 시작시각(reservation);
  // 형식이 어긋난 값이 오면 버튼을 감춘다 — 서버가 거절할 요청을 굳이 권하지 않는다.
  if (Number.isNaN(시작.getTime())) return false;

  return 기준시각 < 시작;
}
