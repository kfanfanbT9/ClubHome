'use strict';

const { AppError } = require('../middlewares/errorHandler');
const practiceRoomService = require('../services/practice-room-service');
const reservationService = require('../services/reservation-service');

/** path의 roomId. 양의 정수(int4 범위 내)가 아니면 400. */
function requireRoomId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1 || id > 2147483647) {
    throw new AppError(400, 'BAD_REQUEST', '연습실 ID가 올바르지 않습니다.');
  }
  return id;
}

/**
 * 'YYYY-MM-DD' 형식 + 실존 날짜만 허용한다.
 * UTC 자정 앵커로 파싱해 왕복 비교하므로 서버 타임존과 무관하다.
 */
function requireDate(value, field = 'date') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError(400, 'BAD_REQUEST', `${field}는 YYYY-MM-DD 형식이어야 합니다.`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new AppError(400, 'BAD_REQUEST', `${field}는 YYYY-MM-DD 형식이어야 합니다.`);
  }
  return value;
}

const SLOT_TIME = /^([01]\d|2[0-3]):(00|30)$/;

/** 'HH:mm'(30분 경계) 형식만 허용한다. 초 표기·범위 밖 값은 400. */
function requireSlotTime(value, field) {
  if (typeof value !== 'string' || !SLOT_TIME.test(value)) {
    throw new AppError(400, 'BAD_REQUEST', `${field}은 30분 단위(HH:00 또는 HH:30)여야 합니다.`);
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

/** POST /api/practice-rooms/:roomId/reservations */
async function createReservation(req, res) {
  const roomId = requireRoomId(req.params.roomId);
  const body = req.body || {};
  const reservationDate = requireDate(body.reservationDate, 'reservationDate');
  const startTime = requireSlotTime(body.startTime, '시작 시각');
  const endTime = requireSlotTime(body.endTime, '종료 시각');
  if (startTime >= endTime) {
    throw new AppError(400, 'BAD_REQUEST', '종료 시각은 시작 시각보다 뒤여야 합니다.');
  }

  const reservation = await reservationService.createReservation({
    roomId,
    memberId: req.member.id,
    reservationDate,
    startTime,
    endTime,
  });
  res.status(201).json(reservation);
}

module.exports = { listRooms, getDayReservations, createReservation };
