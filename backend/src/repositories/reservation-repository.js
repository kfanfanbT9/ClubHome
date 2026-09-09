'use strict';

const { query } = require('../db/pool');

/**
 * reservations 행(+ 조인된 members 행)을 슬롯 매핑에 필요한 최소 형태로 변환한다.
 * export하지 않는다 — reservations 행을 API 응답으로 바꾸는 코드는 이 파일에만 존재해야 한다.
 */
function toDayReservation(row) {
  return {
    id: row.id,
    startTime: row.start_time.slice(0, 5),
    endTime: row.end_time.slice(0, 5),
    memberName: row.member_name,
  };
}

/**
 * 특정 연습실·날짜의 유효(reserved) 예약을 시작시각 오름차순으로 조회한다.
 * canceled·completed 예약은 점유 판정 대상이 아니므로 여기서 제외한다.
 * 예약자 표시는 이름 1개만 담는다(개인정보 최소화) — member_id·email·phone은 조회하지 않는다.
 */
async function findReservedByRoomAndDate({ practiceRoomId, date }) {
  const result = await query(
    `SELECT r.id,
            r.start_time,
            r.end_time,
            m.name AS member_name
       FROM reservations r
       JOIN members m ON m.id = r.member_id
      WHERE r.practice_room_id = $1
        AND r.reservation_date = $2::date
        AND r.reservation_status = 'reserved'
      ORDER BY r.start_time`,
    [practiceRoomId, date]
  );
  return result.rows.map(toDayReservation);
}

/**
 * 특정 연습실·날짜의 유효(reserved) 예약을 시작시각 오름차순으로 잠가서 조회한다.
 * members를 조인하지 않는다 — 겹침 판정에 예약자 정보가 필요 없고, 조인이 있으면
 * FOR UPDATE가 members 행까지 잠근다. ORDER BY start_time으로 잠금 획득 순서를 고정해
 * 다중 행 잠금에서의 데드락 여지를 없앤다.
 */
async function findReservedForUpdate(client, { practiceRoomId, date }) {
  const result = await client.query(
    `SELECT id,
            start_time,
            end_time
       FROM reservations
      WHERE practice_room_id = $1
        AND reservation_date = $2::date
        AND reservation_status = 'reserved'
      ORDER BY start_time
      FOR UPDATE`,
    [practiceRoomId, date]
  );
  return result.rows.map((row) => ({
    id: row.id,
    startTime: row.start_time.slice(0, 5),
    endTime: row.end_time.slice(0, 5),
  }));
}

/**
 * 예약을 생성한다. reservation_status·created_at은 DB 기본값을 쓰기 위해 컬럼 목록에서 제외한다.
 * ON CONFLICT의 WHERE는 부분 유니크 인덱스 uq_reservations_active_slot의 술어와 일치시켜
 * 그 인덱스를 지목해 추론시킨다. 충돌 시 0행 → null을 반환하며 예외를 던지지 않으므로
 * 트랜잭션이 abort 상태로 빠지지 않는다. service가 null을 409로 판정한다.
 * RETURNING에는 reservation_date·start_time·end_time을 넣지 않는다 — DATE는 pg가 JS Date로
 * 반환해 KST 기준으로 하루 어긋난다. 응답의 세 값은 controller가 검증한 요청 문자열을 그대로 쓴다.
 */
async function insertReservation(client, { practiceRoomId, memberId, date, startTime, endTime }) {
  const result = await client.query(
    `INSERT INTO reservations (practice_room_id, member_id, reservation_date, start_time, end_time)
     VALUES ($1, $2, $3::date, $4, $5)
     ON CONFLICT (practice_room_id, reservation_date, start_time)
       WHERE reservation_status = 'reserved'
       DO NOTHING
     RETURNING id, reservation_status, created_at`,
    [practiceRoomId, memberId, date, startTime, endTime]
  );
  if (!result.rows[0]) {
    return null;
  }
  const row = result.rows[0];
  return {
    id: row.id,
    practiceRoomId,
    memberId,
    reservationDate: date,
    startTime,
    endTime,
    reservationStatus: row.reservation_status,
    createdAt: row.created_at,
  };
}

/**
 * reservations 행을 swagger Reservation 스키마 형태(8키)로 변환한다. export하지 않는다.
 * reservation_date는 SQL이 to_char로 문자열화해 넘긴 값이라 여기서 Date를 다루지 않는다.
 */
function toReservation(row) {
  return {
    id: row.id,
    practiceRoomId: row.practice_room_id,
    memberId: row.member_id,
    reservationDate: row.reservation_date,
    startTime: row.start_time.slice(0, 5),
    endTime: row.end_time.slice(0, 5),
    reservationStatus: row.reservation_status,
    createdAt: row.created_at,
  };
}

/**
 * 회원 본인의 예약 내역을 상태 필터 없이(reserved/completed/canceled 전부) 조회한다.
 * WHERE 선두가 idx_reservations_member와 일치한다. roomId 선택 조건은 문자열 concat 없이
 * 순수 파라미터 바인딩으로 표현한다 — practiceRoomId가 null이면 $2가 NULL이 되어 조건이
 * 항상 참이 되고 전체가 반환된다.
 * reservation_date는 to_char로 문자열화한다 — pg가 DATE를 JS Date로 반환해 KST 서버에서
 * 하루 어긋난 ISO 문자열이 되는 것을 막는 유일한 지점이다.
 * ponytail: ($2 IS NULL OR ...)는 practice_room_id 조건이 인덱스 조건으로 승격되지 않는다.
 * 회원당 예약 수가 수십 건 규모라 무의미하며, 실측 문제가 되면 그때 쿼리 2개로 분기한다.
 */
async function findReservationsByMember(memberId, practiceRoomId) {
  const result = await query(
    `SELECT id,
            practice_room_id,
            member_id,
            to_char(reservation_date, 'YYYY-MM-DD') AS reservation_date,
            start_time,
            end_time,
            reservation_status,
            created_at
       FROM reservations
      WHERE member_id = $1
        AND ($2::int IS NULL OR practice_room_id = $2)
      ORDER BY reservation_date DESC, start_time DESC, id DESC`,
    [memberId, practiceRoomId]
  );
  return result.rows.map(toReservation);
}

/**
 * 예약 단건을 has_started(취소 인가 판정 전용 파생값, 응답에는 싣지 않는다)와 함께 조회한다.
 * FOR UPDATE를 쓰지 않는다 — 상태 전이는 UPDATE의 WHERE가 원자적으로 보장한다.
 *
 * ponytail: 동호회 운영 시간대를 'Asia/Seoul'로 고정한다. reservation_date/start_time은
 * 무시간대 벽시계 값이므로 비교 시 반드시 시간대를 명시해야 한다.
 * 세션 TimeZone GUC에 의존하는 암묵 변환((date+time) <= now())을 쓰면 DB 설정 변경으로
 * 조용히 깨진다. 운영 시간대가 바뀌면 이 리터럴 1곳만 고친다.
 */
async function findReservationById(id) {
  const result = await query(
    `SELECT id,
            practice_room_id,
            member_id,
            to_char(reservation_date, 'YYYY-MM-DD') AS reservation_date,
            start_time,
            end_time,
            reservation_status,
            created_at,
            ((reservation_date + start_time) AT TIME ZONE 'Asia/Seoul') <= now() AS has_started
       FROM reservations
      WHERE id = $1`,
    [id]
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return { ...toReservation(row), hasStarted: row.has_started };
}

/**
 * 예약 상태를 canceled로 전이한다. AND reservation_status = 'reserved'가 상태 전이 가드다.
 * 이미 canceled/completed면 0행 → null → service가 400으로 판정한다. 동시 취소 2건 중
 * 하나만 200이 된다.
 * 행을 삭제하지 않는다 — 이력이 남고 부분 유니크 인덱스 술어에서 빠져 재예약이 열린다.
 * RETURNING이 응답의 유일한 출처다 — findReservationById 결과에 상태만 갈아끼우지 않는다.
 */
async function cancelReservation(id) {
  const result = await query(
    `UPDATE reservations
        SET reservation_status = 'canceled'
      WHERE id = $1
        AND reservation_status = 'reserved'
      RETURNING id,
                practice_room_id,
                member_id,
                to_char(reservation_date, 'YYYY-MM-DD') AS reservation_date,
                start_time,
                end_time,
                reservation_status,
                created_at`,
    [id]
  );
  const row = result.rows[0];
  return row ? toReservation(row) : null;
}

/**
 * 전체 예약을 연습실/날짜 조건으로 필터링해 조회한다(관리자 전용, 상태 필터 없음).
 * practiceRoomId·date가 null이면 해당 조건은 통과된다(전체). to_char로 KST 하루 어긋남을 막는다.
 */
async function findReservations({ practiceRoomId, date }) {
  const result = await query(
    `SELECT id,
            practice_room_id,
            member_id,
            to_char(reservation_date, 'YYYY-MM-DD') AS reservation_date,
            start_time,
            end_time,
            reservation_status,
            created_at
       FROM reservations
      WHERE ($1::int  IS NULL OR practice_room_id = $1)
        AND ($2::date IS NULL OR reservation_date = $2::date)
      ORDER BY reservation_date DESC, start_time DESC, id DESC`,
    [practiceRoomId, date]
  );
  return result.rows.map(toReservation);
}

/**
 * 관리자 강제취소. 상태 가드가 없다(§8) — 소유권·시작여부·현재 상태와 무관하게 항상
 * canceled로 전이한다. 대상 미존재 시 0행 → null. 일반 회원 cancelReservation과
 * 구조적으로 다른 지점이며 그래서 함수를 공유하지 않는다.
 */
async function forceCancelReservation(id) {
  const result = await query(
    `UPDATE reservations
        SET reservation_status = 'canceled'
      WHERE id = $1
      RETURNING id,
                practice_room_id,
                member_id,
                to_char(reservation_date, 'YYYY-MM-DD') AS reservation_date,
                start_time,
                end_time,
                reservation_status,
                created_at`,
    [id]
  );
  return result.rows[0] ? toReservation(result.rows[0]) : null;
}

module.exports = {
  findReservedByRoomAndDate,
  findReservedForUpdate,
  insertReservation,
  findReservationsByMember,
  findReservationById,
  cancelReservation,
  findReservations,
  forceCancelReservation,
};
