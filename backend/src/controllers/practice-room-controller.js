'use strict';

const { AppError } = require('../middlewares/errorHandler');
const practiceRoomService = require('../services/practice-room-service');

/** path의 roomId. 양의 정수(int4 범위 내)가 아니면 400. */
function requireRoomId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1 || id > 2147483647) {
    throw new AppError(400, 'BAD_REQUEST', '연습실 ID가 올바르지 않습니다.');
  }
  return id;
}

/**
 * query의 date. 'YYYY-MM-DD' 형식 + 실존 날짜만 허용한다.
 * UTC 자정 앵커로 파싱해 왕복 비교하므로 서버 타임존과 무관하다.
 */
function requireDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError(400, 'BAD_REQUEST', 'date는 YYYY-MM-DD 형식이어야 합니다.');
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new AppError(400, 'BAD_REQUEST', 'date는 YYYY-MM-DD 형식이어야 합니다.');
  }
  return value;
}

/** GET /api/practice-rooms */
async function listRooms(req, res) {
  const rooms = await practiceRoomService.listRooms();
  res.status(200).json(rooms);
}

/** GET /api/practice-rooms/:roomId/reservations */
async function getDayReservations(req, res) {
  const roomId = requireRoomId(req.params.roomId);
  const date = requireDate(req.query.date);

  const result = await practiceRoomService.getDaySlots({ roomId, date });
  res.status(200).json(result);
}

module.exports = { listRooms, getDayReservations };
