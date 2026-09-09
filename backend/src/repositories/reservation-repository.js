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

module.exports = { findReservedByRoomAndDate };
