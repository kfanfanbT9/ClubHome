'use strict';

const { AppError } = require('../middlewares/errorHandler');
const reservationService = require('../services/reservation-service');

// reservations.id·practice_rooms.id는 INTEGER — 초과 값은 pg 22003(500)이 된다
const MAX_INT4 = 2147483647;

/**
 * path의 예약 id. 형식 불량은 404로 통일한다 — 이 경로의 400은 "이미 취소·완료된
 * 예약"이라는 비즈니스 의미를 이미 점유하고 있어 'abc' 등을 400으로 내면 오독을 부른다
 * (post-controller.parseId 관례).
 */
function parseReservationId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1 || id > MAX_INT4) {
    throw new AppError(404, 'NOT_FOUND', '예약을 찾을 수 없습니다.');
  }
  return id;
}

/**
 * 선택적 roomId 필터. 유효하지 않으면 null(=전체)로 떨어뜨린다 — 이 경로에는 400이
 * 정의되어 있지 않다(swagger 200·401뿐). 절대 던지지 않는다.
 */
function parseRoomIdFilter(value) {
  const id = Number(value);
  return Number.isInteger(id) && id >= 1 && id <= MAX_INT4 ? id : null;
}

/** GET /api/members/me/reservations */
async function listMine(req, res) {
  const roomId = parseRoomIdFilter(req.query.roomId);

  const reservations = await reservationService.getMyReservations(req.member.id, roomId);
  res.status(200).json(reservations);
}

/** PATCH /api/reservations/:reservationId/cancel */
async function cancel(req, res) {
  const reservationId = parseReservationId(req.params.reservationId);

  const reservation = await reservationService.cancelReservation(
    reservationId,
    req.member.id,
    req.member.isAdmin
  );
  res.status(200).json(reservation);
}

module.exports = { listMine, cancel };
