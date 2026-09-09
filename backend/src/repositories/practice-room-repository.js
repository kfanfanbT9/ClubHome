'use strict';

const { query } = require('../db/pool');

/**
 * practice_rooms 행을 swagger PracticeRoom 스키마 형태로 변환한다.
 * export하지 않는다 — practice_rooms 행을 API 응답으로 바꾸는 코드는 이 파일에만 존재해야 한다.
 */
function toPracticeRoom(row) {
  return {
    id: row.id,
    name: row.name,
    location: row.location,
    capacity: row.capacity,
    openTime: row.open_time.slice(0, 5),
    closeTime: row.close_time.slice(0, 5),
    isActive: row.is_active,
  };
}

/** 활성 연습실 목록을 등록순(id)으로 조회한다. */
async function findActiveRooms() {
  const result = await query(
    `SELECT id,
            name,
            location,
            capacity,
            open_time,
            close_time,
            is_active
       FROM practice_rooms
      WHERE is_active = TRUE
      ORDER BY id`
  );
  return result.rows.map(toPracticeRoom);
}

/**
 * id로 활성 연습실을 조회한다. 미존재·비활성을 구분하지 않고 둘 다 null을 반환한다
 * — 조회 API의 404 응답을 두 사유 모두 동일하게 만들기 위한 구조적 보장이다.
 */
async function findActiveRoomById(id) {
  const result = await query(
    `SELECT id, name, location, capacity, open_time, close_time, is_active
       FROM practice_rooms
      WHERE id = $1
        AND is_active = TRUE`,
    [id]
  );
  return result.rows[0] ? toPracticeRoom(result.rows[0]) : null;
}

/**
 * id로 연습실을 조회하며 해당 행에 FOR UPDATE 잠금을 건다. is_active로 필터하지 않는다
 * — 예약 신청(POST)은 미존재(404)와 비활성(403)을 구분해야 하므로 findActiveRoomById를 쓸 수 없다.
 * 이 잠금이 동일 연습실에 대한 동시 예약 신청을 직렬화하는 실제 장치다(reservation-service 참고).
 */
async function findRoomByIdForUpdate(client, id) {
  const result = await client.query(
    `SELECT id, name, location, capacity, open_time, close_time, is_active
       FROM practice_rooms
      WHERE id = $1
        FOR UPDATE`,
    [id]
  );
  return result.rows[0] ? toPracticeRoom(result.rows[0]) : null;
}

module.exports = { findActiveRooms, findActiveRoomById, findRoomByIdForUpdate };
