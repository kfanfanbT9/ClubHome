import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  type SlotSelection,
  toggleSlot,
} from '../features/practiceRoom/slotSelection';
import { useDaySlots, usePracticeRooms } from '../features/practiceRoom/useReservationQueries';
import { todayISODate } from '../lib/format';
import type { ReservationSlot } from '../types';

function 슬롯줄({
  slot,
  선택됨,
  onToggle,
}: {
  slot: ReservationSlot;
  선택됨: boolean;
  onToggle: () => void;
}) {
  const 예약가능 = slot.isAvailable;
  const 클래스 = ['slot', 선택됨 && 'slot--picked', !예약가능 && 'slot--taken']
    .filter(Boolean)
    .join(' ');

  return (
    <li className={클래스}>
      <label className="slot__label">
        {/* 예약된 슬롯은 고를 수 없게 막는다 — 이 덕분에 선택 구간 안에 예약된
            슬롯이 끼는 경우가 아예 생기지 않는다(slotSelection.ts 주석). */}
        <input
          type="checkbox"
          checked={선택됨}
          disabled={!예약가능}
          onChange={onToggle}
        />
        <span className="slot__time">
          {slot.startTime}-{slot.endTime}
        </span>
        <span className="slot__state">
          {예약가능 ? '예약가능' : `예약불가${slot.memberName ? ` (${slot.memberName})` : ''}`}
        </span>
      </label>
    </li>
  );
}

/**
 * 연습실 예약현황 (와이어프레임 9번, S-05).
 *
 * 연습실·날짜·선택 구간을 모두 주소에 둔다 — 새로고침해도 보고 있던 현황이 유지되고,
 * 예약 신청 화면으로 넘길 때 따로 상태를 실어 보낼 필요가 없다.
 */
export default function PracticeRoomPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rooms = usePracticeRooms();
  const navigate = useNavigate();

  const 주소의연습실 = Number(searchParams.get('roomId'));
  // 주소에 없으면 첫 연습실을 본다. 서버가 활성 연습실만 주므로 목록의 첫 항목이 안전하다.
  const roomId = Number.isInteger(주소의연습실) && 주소의연습실 > 0
    ? 주소의연습실
    : (rooms.data?.[0]?.id ?? 0);
  const date = searchParams.get('date') ?? todayISODate();

  const slots = useDaySlots(roomId, date);
  const [선택, set선택] = useState<SlotSelection>({ selected: [] });

  const room = rooms.data?.find((r) => r.id === roomId);
  const 슬롯목록 = slots.data?.slots ?? [];

  const 조건바꾸기 = (키: 'roomId' | 'date', 값: string) => {
    const 갱신 = new URLSearchParams(searchParams);
    갱신.set('roomId', 키 === 'roomId' ? 값 : String(roomId));
    갱신.set('date', 키 === 'date' ? 값 : date);
    setSearchParams(갱신);
    // 연습실이나 날짜가 바뀌면 슬롯 인덱스가 다른 날의 것을 가리키게 된다.
    set선택({ selected: [] });
  };

  const 처음 = 선택.selected[0];
  const 마지막 = 선택.selected[선택.selected.length - 1];
  const 시작시각 = 슬롯목록[처음]?.startTime;
  const 종료시각 = 슬롯목록[마지막]?.endTime;
  const 고른개수 = 선택.selected.length;

  const 신청하기 = () => {
    if (!시작시각 || !종료시각) return;
    navigate(
      `/practice-rooms/${roomId}/reserve?date=${date}&start=${시작시각}&end=${종료시각}`,
    );
  };

  return (
    <main className="page">
      <h1 className="page__title">연습실 예약</h1>

      {/* 예약 확정 화면에서 돌아왔을 때의 성공 안내. 아래 현황은 캐시 무효화로 이미 갱신됐다. */}
      {searchParams.get('reserved') === '1' && (
        <p className="notice notice--success" role="status">
          예약이 확정되었습니다.
        </p>
      )}

      <div className="picker">
        <label className="picker__field">
          <span className="field__label">연습실</span>
          <select
            className="field__input"
            value={roomId || ''}
            onChange={(event) => 조건바꾸기('roomId', event.target.value)}
          >
            {rooms.data?.map((r) => (
              <option value={r.id} key={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>

        <label className="picker__field">
          <span className="field__label">날짜</span>
          <input
            className="field__input"
            type="date"
            value={date}
            onChange={(event) => 조건바꾸기('date', event.target.value)}
          />
        </label>
      </div>

      {room && (
        <p className="page__note">
          하루 전체 예약현황 (30분 단위, 운영시간 {room.openTime}-{room.closeTime})
        </p>
      )}

      {(rooms.isPending || slots.isPending) && <p className="page__note">불러오는 중…</p>}

      {rooms.isError && (
        <p className="notice notice--error" role="alert">
          {rooms.error.message}
        </p>
      )}
      {slots.isError && (
        <p className="notice notice--error" role="alert">
          {slots.error.message}
        </p>
      )}

      {slots.data && 슬롯목록.length === 0 && (
        <p className="empty">이 날짜에 예약할 수 있는 시간대가 없습니다.</p>
      )}

      {슬롯목록.length > 0 && (
        <ul className="slot-list">
          {슬롯목록.map((slot, 순서) => (
            <슬롯줄
              key={slot.startTime}
              slot={slot}
              선택됨={선택.selected.includes(순서)}
              onToggle={() => set선택(toggleSlot(선택.selected, 순서))}
            />
          ))}
        </ul>
      )}

      {/* 비연속 선택 등으로 거절했을 때의 이유 */}
      {선택.notice && (
        <p className="notice notice--error" role="alert">
          {선택.notice}
        </p>
      )}

      {/* 선택 요약 — 모바일에서는 화면 하단에 붙는다(와이어프레임 9번) */}
      <div className="summary">
        <span className="summary__text">
          {고른개수 > 0
            ? `선택한 시간대: ${시작시각} ~ ${종료시각} (30분 단위 ${고른개수}슬롯)`
            : '예약할 시간대를 선택하세요.'}
        </span>
        <button
          type="button"
          className="button button--primary"
          disabled={고른개수 === 0}
          onClick={신청하기}
        >
          예약 신청
        </button>
      </div>

      <p className="page__note">
        <Link className="link" to="/me/reservations">
          내 예약 내역 보기 &gt;
        </Link>
      </p>
    </main>
  );
}
