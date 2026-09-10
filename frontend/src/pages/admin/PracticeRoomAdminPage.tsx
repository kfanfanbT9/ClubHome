import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../api/client';
import ConfirmButton from '../../components/common/ConfirmButton';
import Field from '../../components/common/Field';
import {
  type PracticeRoomInput,
  useAdminMembers,
  useAdminPracticeRooms,
  useAdminReservations,
  useCreatePracticeRoom,
  useDeletePracticeRoom,
  useForceCancelReservation,
  useUpdatePracticeRoom,
} from '../../features/admin/useAdminQueries';
import { 상태문구 } from '../../features/practiceRoom/reservationRules';
import type { PracticeRoom, Reservation } from '../../types';

type 오류목록 = Partial<Record<'name' | 'capacity' | 'openTime' | 'closeTime', string>>;

/** 30분 경계의 HH:mm 인지. 서버가 30분 단위로 슬롯을 전개하므로 경계가 맞아야 한다. */
const 시각형식 = /^([01]\d|2[0-3]):(00|30)$/;

function 검증(값: PracticeRoomInput): 오류목록 {
  const 오류: 오류목록 = {};

  if (!값.name.trim()) 오류.name = '연습실명을 입력하세요.';
  if (!Number.isInteger(값.capacity) || 값.capacity < 1) {
    오류.capacity = '수용인원은 1명 이상이어야 합니다.';
  }
  if (!시각형식.test(값.openTime)) 오류.openTime = '운영 시작시간을 HH:00 또는 HH:30으로 입력하세요.';
  if (!시각형식.test(값.closeTime)) 오류.closeTime = '운영 종료시간을 HH:00 또는 HH:30으로 입력하세요.';
  else if (시각형식.test(값.openTime) && 값.openTime >= 값.closeTime) {
    오류.closeTime = '운영 종료시간은 시작시간보다 늦어야 합니다.';
  }

  return 오류;
}

function 연습실폼({
  초기값,
  진행중,
  서버오류,
  onSubmit,
  onCancel,
  onChange,
}: {
  초기값: PracticeRoomInput;
  진행중: boolean;
  서버오류?: string;
  onSubmit: (값: PracticeRoomInput) => void;
  onCancel: () => void;
  onChange: () => void;
}) {
  const [값, set값] = useState<PracticeRoomInput>(초기값);
  const [오류, set오류] = useState<오류목록>({});

  const 바꾸기 = <K extends keyof PracticeRoomInput>(키: K, 새값: PracticeRoomInput[K]) => {
    set값((이전) => ({ ...이전, [키]: 새값 }));
    set오류((이전) => ({ ...이전, [키]: undefined }));
    onChange();
  };

  const 제출 = (event: FormEvent) => {
    event.preventDefault();
    const 새오류 = 검증(값);
    set오류(새오류);
    if (Object.keys(새오류).length > 0) return;
    onSubmit(값);
  };

  return (
    <form className="form adm-form" onSubmit={제출} noValidate>
      <Field
        label="연습실명"
        name="roomName"
        value={값.name}
        error={오류.name}
        onChange={(event) => 바꾸기('name', event.target.value)}
      />
      <Field
        label="위치"
        name="roomLocation"
        value={값.location ?? ''}
        onChange={(event) => 바꾸기('location', event.target.value)}
      />
      <Field
        label="수용인원"
        name="roomCapacity"
        value={값.capacity ? String(값.capacity) : ''}
        error={오류.capacity}
        onChange={(event) => 바꾸기('capacity', Number(event.target.value))}
      />
      <Field
        label="운영 시작시간 (HH:mm)"
        name="openTime"
        value={값.openTime}
        error={오류.openTime}
        onChange={(event) => 바꾸기('openTime', event.target.value)}
      />
      <Field
        label="운영 종료시간 (HH:mm)"
        name="closeTime"
        value={값.closeTime}
        error={오류.closeTime}
        onChange={(event) => 바꾸기('closeTime', event.target.value)}
      />

      <label className="check">
        <input
          type="checkbox"
          checked={값.isActive}
          onChange={(event) => 바꾸기('isActive', event.target.checked)}
        />
        사용 (끄면 예약 화면에서 숨는다)
      </label>

      {서버오류 && (
        <p className="notice notice--error" role="alert">
          {서버오류}
        </p>
      )}

      <div className="form__actions">
        <button type="submit" className="button button--primary" disabled={진행중}>
          {진행중 ? '저장 중…' : '저장'}
        </button>
        <button type="button" className="button button--quiet" onClick={onCancel}>
          취소
        </button>
      </div>
    </form>
  );
}

function 수정폼({ room, onClose }: { room: PracticeRoom; onClose: () => void }) {
  const update = useUpdatePracticeRoom(room.id);

  return (
    <연습실폼
      초기값={{
        name: room.name,
        location: room.location ?? '',
        capacity: room.capacity,
        openTime: room.openTime,
        closeTime: room.closeTime,
        isActive: room.isActive,
      }}
      진행중={update.isPending}
      서버오류={update.isError ? update.error.message : undefined}
      onChange={() => update.isError && update.reset()}
      onCancel={onClose}
      onSubmit={(값) => update.mutate(값, { onSuccess: onClose })}
    />
  );
}

function 연습실줄({ room }: { room: PracticeRoom }) {
  const [수정중, set수정중] = useState(false);
  const remove = useDeletePracticeRoom();

  /** 참조 중인 예약 이력이 있으면 409다(FK RESTRICT). 지우는 대신 비활성을 권한다. */
  const 참조중 = remove.error instanceof ApiError && remove.error.status === 409;

  return (
    <li className="adm-row">
      <span className="adm-row__main">{room.name}</span>
      <span className="adm-row__sub">
        {room.location ?? '위치 미지정'} · {room.capacity}명 · {room.openTime}-{room.closeTime}
      </span>
      <span className={room.isActive ? 'badge' : 'badge badge--off'}>
        {room.isActive ? '활성' : '비활성'}
      </span>
      <span className="adm-row__manage">
        <button
          type="button"
          className="button button--quiet"
          onClick={() => set수정중((이전) => !이전)}
        >
          {수정중 ? '수정 닫기' : '수정'}
        </button>
        <ConfirmButton
          label="삭제"
          question="이 연습실을 삭제할까요?"
          진행중={remove.isPending && remove.variables === room.id}
          진행중라벨="삭제 중…"
          onConfirm={() => remove.mutate(room.id)}
        />
      </span>

      {remove.isError && remove.variables === room.id && (
        <p className="adm-row__error" role="alert">
          {remove.error.message}
          {참조중 && ' 대신 사용여부를 비활성으로 바꾸면 예약 화면에서 숨겨집니다.'}
        </p>
      )}

      {수정중 && <수정폼 room={room} onClose={() => set수정중(false)} />}
    </li>
  );
}

/** 예약 현황·내역 + 강제 취소 (와이어프레임 14번 하단). */
function 예약관리({ rooms }: { rooms: PracticeRoom[] }) {
  const [필터, set필터] = useState<{ roomId?: number; date?: string }>({});
  const reservations = useAdminReservations(필터.roomId, 필터.date);
  // 예약 응답에는 예약자 이름이 없고 memberId만 있다. 회원 목록과 맞춰 이름을 붙인다.
  const members = useAdminMembers();
  const cancel = useForceCancelReservation();

  const 이름 = (memberId: number) =>
    members.data?.find((member) => member.id === memberId)?.name ?? `회원 #${memberId}`;
  const 연습실 = (practiceRoomId: number) =>
    rooms.find((room) => room.id === practiceRoomId)?.name ?? `연습실 #${practiceRoomId}`;

  return (
    <section className="adm-section">
      <h2 className="adm-section__title">예약 현황·내역</h2>

      <div className="picker">
        <label className="picker__field">
          <span className="field__label">연습실</span>
          <select
            className="field__input"
            value={필터.roomId ?? ''}
            onChange={(event) => {
              const 값 = event.target.value;
              set필터((이전) => ({ ...이전, roomId: 값 ? Number(값) : undefined }));
              if (cancel.isError) cancel.reset();
            }}
          >
            <option value="">전체</option>
            {rooms.map((room) => (
              <option value={room.id} key={room.id}>
                {room.name}
              </option>
            ))}
          </select>
        </label>

        <label className="picker__field">
          <span className="field__label">날짜</span>
          <input
            className="field__input"
            type="date"
            value={필터.date ?? ''}
            onChange={(event) => {
              const 값 = event.target.value;
              set필터((이전) => ({ ...이전, date: 값 || undefined }));
              if (cancel.isError) cancel.reset();
            }}
          />
        </label>
      </div>

      {reservations.isPending && <p className="page__note">불러오는 중…</p>}
      {reservations.isError && (
        <p className="notice notice--error" role="alert">
          {reservations.error.message}
        </p>
      )}

      {reservations.data && reservations.data.length === 0 && (
        <p className="empty">조건에 맞는 예약이 없습니다.</p>
      )}

      {reservations.data && reservations.data.length > 0 && (
        <ul className="adm-list">
          {reservations.data.map((reservation: Reservation) => (
            <li className="adm-row" key={reservation.id}>
              <span className="adm-row__main">{연습실(reservation.practiceRoomId)}</span>
              <span className="adm-row__sub">
                {이름(reservation.memberId)} · {reservation.reservationDate} ·{' '}
                {reservation.startTime}-{reservation.endTime}
              </span>
              <span className={`badge badge--${reservation.reservationStatus}`}>
                {상태문구[reservation.reservationStatus]}
              </span>
              <span className="adm-row__manage">
                {reservation.reservationStatus === 'reserved' ? (
                  <ConfirmButton
                    label="강제취소"
                    question="이 예약을 강제로 취소할까요?"
                    진행중={cancel.isPending && cancel.variables?.id === reservation.id}
                    진행중라벨="취소 중…"
                    onConfirm={() => cancel.mutate(reservation)}
                  />
                ) : (
                  <span className="res-row__none" aria-hidden="true">
                    -
                  </span>
                )}
              </span>

              {cancel.isError && cancel.variables?.id === reservation.id && (
                <p className="adm-row__error" role="alert">
                  {cancel.error.message}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * 연습실 관리 (와이어프레임 14번, S-08).
 *
 * 목록은 관리자용 `GET /api/admin/practice-rooms`를 쓴다 — 일반 회원용은 비활성
 * 연습실을 숨기므로 관리 화면에서 그것을 다시 켤 방법이 없어진다.
 */
export default function PracticeRoomAdminPage() {
  const rooms = useAdminPracticeRooms();
  const create = useCreatePracticeRoom();
  const [만드는중, set만드는중] = useState(false);

  return (
    <main className="page">
      <div className="page__header">
        <h1 className="page__title">
          <Link className="page__back" to="/admin">
            &lt; 관리자
          </Link>{' '}
          - 연습실 관리
        </h1>
        {!만드는중 && (
          <button
            type="button"
            className="button button--primary"
            onClick={() => set만드는중(true)}
          >
            + 연습실 등록
          </button>
        )}
      </div>

      {만드는중 && (
        <연습실폼
          초기값={{
            name: '',
            location: '',
            capacity: 1,
            openTime: '09:00',
            closeTime: '22:00',
            isActive: true,
          }}
          진행중={create.isPending}
          서버오류={create.isError ? create.error.message : undefined}
          onChange={() => create.isError && create.reset()}
          onCancel={() => {
            set만드는중(false);
            create.reset();
          }}
          onSubmit={(값) => create.mutate(값, { onSuccess: () => set만드는중(false) })}
        />
      )}

      {rooms.isPending && <p className="page__note">불러오는 중…</p>}
      {rooms.isError && (
        <p className="notice notice--error" role="alert">
          {rooms.error.message}
        </p>
      )}

      {rooms.data && rooms.data.length === 0 && <p className="empty">연습실이 없습니다.</p>}

      {rooms.data && rooms.data.length > 0 && (
        <ul className="adm-list">
          {rooms.data.map((room) => (
            <연습실줄 room={room} key={room.id} />
          ))}
        </ul>
      )}

      {rooms.data && <예약관리 rooms={rooms.data} />}
    </main>
  );
}
