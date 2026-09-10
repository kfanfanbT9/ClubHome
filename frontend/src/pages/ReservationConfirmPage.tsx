import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import {
  useCreateReservation,
  usePracticeRooms,
} from '../features/practiceRoom/useReservationQueries';

/**
 * 30분 슬롯 몇 칸인지. 칸 수로 셀 수 없는 값이면 null 을 준다.
 *
 * 주소를 손으로 고칠 수 있는 화면이라(`?start=abc`) 파싱 실패를 그냥 두면
 * "NaN슬롯"이 화면에 찍히고, 그대로 확정을 눌러 400을 받게 된다.
 */
function 슬롯수(start: string, end: string): number | null {
  const 분 = (시각: string) => {
    const 조각 = /^(\d{1,2}):(\d{2})$/.exec(시각);
    if (!조각) return null;
    return Number(조각[1]) * 60 + Number(조각[2]);
  };
  const 시작분 = 분(start);
  const 종료분 = 분(end);
  if (시작분 === null || 종료분 === null) return null;
  const 칸 = (종료분 - 시작분) / 30;
  // 30분 경계가 아니거나 순서가 뒤바뀐 구간은 셀 수 없다.
  return Number.isInteger(칸) && 칸 > 0 ? 칸 : null;
}

/**
 * 예약 신청 확인 (와이어프레임 10번, S-05).
 *
 * 연습실·날짜·구간을 모두 주소에서 읽는다 — 새로고침해도 확인 화면이 유지되고,
 * 앞 화면에서 상태를 실어 보낼 필요가 없다.
 */
export default function ReservationConfirmPage() {
  const { roomId: 경로파라미터 } = useParams();
  const roomId = Number(경로파라미터);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const date = searchParams.get('date') ?? '';
  const start = searchParams.get('start') ?? '';
  const end = searchParams.get('end') ?? '';

  const rooms = usePracticeRooms();
  const room = rooms.data?.find((r) => r.id === roomId);
  const create = useCreateReservation(roomId);

  const 현황경로 = `/practice-rooms?roomId=${roomId}&date=${date}`;
  /**
   * 409는 다른 회원이 그 사이에 확정했을 때 정상적으로 발생하는 경로다
   * (사용자 시나리오 S-05). 안내와 함께 현황으로 돌아가는 길을 준다 —
   * useCreateReservation 이 이미 현황 캐시를 무효화해 뒀으므로 최신 상태가 보인다.
   */
  const 중복거절 = create.error instanceof ApiError && create.error.status === 409;

  const 확정 = () =>
    create.mutate(
      { reservationDate: date, startTime: start, endTime: end },
      {
        /**
         * 완료조건이 "성공 안내 후 현황이 갱신된다"이므로 예약현황으로 돌려보낸다.
         * 캐시는 useCreateReservation 이 이미 무효화했으므로 방금 잡은 시간대가
         * 예약불가로 바뀐 최신 현황이 보인다.
         */
        onSuccess: () => navigate(`${현황경로}&reserved=1`, { replace: true }),
      },
    );

  const 칸수 = 슬롯수(start, end);
  const 값이빠졌다 = !date || !start || !end || 칸수 === null;

  return (
    <main className="page page--form">
      <h1 className="page__title">
        <Link className="page__back" to={현황경로}>
          &lt; 연습실예약
        </Link>{' '}
        - 예약 신청
      </h1>

      {값이빠졌다 ? (
        <p className="empty">
          예약할 시간대가 지정되지 않았습니다.{' '}
          <Link className="link" to="/practice-rooms">
            예약현황으로
          </Link>
        </p>
      ) : (
        <>
          <dl className="confirm-list">
            <dt>연습실</dt>
            <dd>{room?.name ?? '—'}</dd>
            <dt>날짜</dt>
            <dd>{date}</dd>
            <dt>선택 시간대</dt>
            <dd>
              {start} ~ {end} (30분 단위 {칸수}슬롯 연속)
            </dd>
          </dl>

          <p className="notice">
            ※ 선택 구간 내 슬롯 중 하나라도 이미 예약되어 있으면 신청 전체가 거부됩니다.
          </p>

          {create.isError && (
            <p className="notice notice--error" role="alert">
              {create.error.message}
              {중복거절 && (
                <>
                  {' '}
                  <Link className="link" to={현황경로}>
                    최신 예약현황 보기
                  </Link>
                </>
              )}
            </p>
          )}

          <div className="form__actions">
            <button
              type="button"
              className="button button--primary"
              disabled={create.isPending}
              onClick={확정}
            >
              {create.isPending ? '확정 중…' : '예약 확정'}
            </button>
            <Link className="button button--quiet" to={현황경로}>
              취소
            </Link>
          </div>
        </>
      )}
    </main>
  );
}
