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

/** 비활성 포함 전체 연습실을 등록순(id)으로 조회한다(관리자 전용). */
async function findAllRooms() {
  const result = await query(
    `SELECT id, name, location, capacity, open_time, close_time, is_active
       FROM practice_rooms
      ORDER BY id`
  );
  return result.rows.map(toPracticeRoom);
}

/**
 * id로 연습실을 조회한다(관리자 전용). 비잠금·is_active 미필터 —
 * plan-BE-08 §9-4의 findRoomByIdForUpdate와는 별개 함수다(트랜잭션 클라이언트 불필요).
 */
async function findRoomById(id) {
  const result = await query(
    `SELECT id, name, location, capacity, open_time, close_time, is_active
       FROM practice_rooms
      WHERE id = $1`,
    [id]
  );
  return result.rows[0] ? toPracticeRoom(result.rows[0]) : null;
}

/** 연습실을 등록한다(관리자 전용). */
async function insertRoom({ name, location, capacity, openTime, closeTime, isActive }) {
  const result = await query(
    `INSERT INTO practice_rooms (name, location, capacity, open_time, close_time, is_active)
     VALUES ($1, $2, $3, $4::time, $5::time, $6)
     RETURNING id, name, location, capacity, open_time, close_time, is_active`,
    [name, location, capacity, openTime, closeTime, isActive]
  );
  return toPracticeRoom(result.rows[0]);
}

/** 연습실을 전체 교체 수정한다(관리자 전용). 대상 미존재 시 0행 → null. */
async function updateRoom(id, { name, location, capacity, openTime, closeTime, isActive }) {
  const result = await query(
    `UPDATE practice_rooms
        SET name = $2, location = $3, capacity = $4,
            open_time = $5::time, close_time = $6::time, is_active = $7
      WHERE id = $1
      RETURNING id, name, location, capacity, open_time, close_time, is_active`,
    [id, name, location, capacity, openTime, closeTime, isActive]
  );
  return result.rows[0] ? toPracticeRoom(result.rows[0]) : null;
}

/**
 * 참조하는 예약 이력이 없을 때만 연습실을 삭제한다(관리자 전용).
 * reservation_status를 보지 않는다 — FK RESTRICT는 canceled·completed 예약도 차단한다.
 */
async function deleteRoomIfUnused(id) {
  const result = await query(
    `DELETE FROM practice_rooms AS r
      WHERE r.id = $1
        AND NOT EXISTS (SELECT 1 FROM reservations v WHERE v.practice_room_id = r.id)`,
    [id]
  );
  return result.rowCount > 0;
}

module.exports = {
  findActiveRooms,
  findActiveRoomById,
  findRoomByIdForUpdate,
  findAllRooms,
  findRoomById,
  insertRoom,
  updateRoom,
  deleteRoomIfUnused,
};
