import { Link, useSearchParams } from 'react-router-dom';
import ConfirmButton from '../components/common/ConfirmButton';
import { 상태문구, 취소할수있나 } from '../features/practiceRoom/reservationRules';
import {
  useCancelReservation,
  useMyReservations,
  usePracticeRooms,
} from '../features/practiceRoom/useReservationQueries';
import type { PracticeRoom, Reservation } from '../types';

function 예약줄({
  reservation,
  연습실이름,
  onCancel,
  취소중,
}: {
  reservation: Reservation;
  연습실이름: string;
  onCancel: () => void;
  취소중: boolean;
}) {
  return (
    <li className="res-row">
      <span className="res-row__room">{연습실이름}</span>
      <span className="res-row__date">{reservation.reservationDate}</span>
      <span className="res-row__time">
        {reservation.startTime}-{reservation.endTime}
      </span>
      {/* 색과 함께 한글 라벨을 표기한다 — 색만으로 구분하지 않는다(9-style.md §6) */}
      <span className={`res-row__state res-row__state--${reservation.reservationStatus}`}>
        {상태문구[reservation.reservationStatus]}
      </span>
      <span className="res-row__manage">
        {취소할수있나(reservation) ? (
          <ConfirmButton
            label="취소"
            question="예약을 취소할까요?"
            진행중={취소중}
            진행중라벨="취소 중…"
            onConfirm={onCancel}
          />
        ) : (
          <span className="res-row__none" aria-hidden="true">
            -
          </span>
        )}
      </span>
    </li>
  );
}

/** 예약의 연습실 이름. 목록에 없으면(비활성으로 바뀐 연습실) 번호로 보여준다. */
function 연습실이름찾기(rooms: PracticeRoom[] | undefined, practiceRoomId: number): string {
  return rooms?.find((room) => room.id === practiceRoomId)?.name ?? `연습실 #${practiceRoomId}`;
}

/**
 * 내 예약 내역 (와이어프레임 11번, S-06).
 *
 * PC는 표, 모바일은 카드 리스트. DOM 하나에 CSS로 배치를 바꾼다.
 */
export default function MyReservationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const 주소의연습실 = Number(searchParams.get('roomId'));
  // "전체"는 파라미터를 아예 붙이지 않는 것으로 표현한다(PRD F-22).
  const 필터 = Number.isInteger(주소의연습실) && 주소의연습실 > 0 ? 주소의연습실 : undefined;

  const rooms = usePracticeRooms();
  const reservations = useMyReservations(필터);
  const cancel = useCancelReservation();

  const 필터바꾸기 = (값: string) => {
    const 갱신 = new URLSearchParams(searchParams);
    if (값) 갱신.set('roomId', 값);
    else 갱신.delete('roomId');
    setSearchParams(갱신);
  };

  return (
    <main className="page">
      <h1 className="page__title">
        <Link className="page__back" to="/me">
          &lt; 마이페이지
        </Link>{' '}
        - 내 예약 내역
      </h1>

      <div className="picker">
        <label className="picker__field">
          <span className="field__label">연습실 필터</span>
          <select
            className="field__input"
            value={필터 ?? ''}
            onChange={(event) => 필터바꾸기(event.target.value)}
          >
            <option value="">전체</option>
            {rooms.data?.map((room) => (
              <option value={room.id} key={room.id}>
                {room.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {reservations.isPending && <p className="page__note">불러오는 중…</p>}

      {reservations.isError && (
        <p className="notice notice--error" role="alert">
          {reservations.error.message}
        </p>
      )}

      {/* 취소 실패 사유는 서버 문구를 그대로 보여준다 —
          403(이미 시작된 예약·타인 예약), 400(이미 취소·완료된 예약). */}
      {cancel.isError && (
        <p className="notice notice--error" role="alert">
          {cancel.error.message}
        </p>
      )}

      {reservations.data && reservations.data.length === 0 && (
        <p className="empty">
          {필터 ? '이 연습실의 예약 내역이 없습니다.' : '예약 내역이 없습니다.'}
        </p>
      )}

      {reservations.data && reservations.data.length > 0 && (
        <div className="res-list">
          {/* PC에서만 보이는 열 제목 */}
          <div className="res-list__head">
            <span>연습실</span>
            <span>날짜</span>
            <span>시간대</span>
            <span>상태</span>
            <span>관리</span>
          </div>
          <ul className="res-list__body">
            {reservations.data.map((reservation) => (
              <예약줄
                key={reservation.id}
                reservation={reservation}
                연습실이름={연습실이름찾기(rooms.data, reservation.practiceRoomId)}
                취소중={cancel.isPending && cancel.variables?.id === reservation.id}
                onCancel={() => cancel.mutate(reservation)}
              />
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
