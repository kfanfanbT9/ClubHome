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

module.exports = { findReservedByRoomAndDate, findReservedForUpdate, insertReservation };
