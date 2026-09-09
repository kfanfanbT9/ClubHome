'use strict';

const { AppError } = require('../middlewares/errorHandler');
const { withTransaction } = require('../db/pool');
const memberService = require('../services/member-service');
const practiceRoomRepository = require('../repositories/practice-room-repository');
const reservationRepository = require('../repositories/reservation-repository');

/**
 * 두 구간이 겹치는지 판정한다(포함이 아니라 겹침). 경계가 맞닿은 경우는 겹침이 아니다.
 * 'HH:mm'은 0패딩 고정폭 문자열이므로 사전순 비교가 곧 시각 비교다.
 * export하지 않는다 — createReservation 내부에서만 쓴다.
 */
function overlaps(a, b) {
  return a.startTime < b.endTime && a.endTime > b.startTime;
}

/**
 * 예약을 신청한다. 판정 순서: 탈퇴 검사(트랜잭션 밖) → 연습실 잠금 조회 → 미존재(404) →
 * 비활성(403) → 운영시간(400) → 예약 잠금 조회 → 겹침(409) → INSERT → 인덱스 충돌(409).
 */
async function createReservation({ roomId, memberId, reservationDate, startTime, endTime }) {
  const member = await memberService.getMyProfile(memberId);
  if (member.accountStatus === 'withdrawn') {
    throw new AppError(403, 'ACCOUNT_WITHDRAWN', '탈퇴한 계정입니다.');
  }

  return withTransaction(async (client) => {
    // ponytail: 연습실 단위 잠금(날짜 단위 아님). 동시접속 20명 규모에서 충분하다.
    // 경합이 실제로 문제가 되면 pg_advisory_xact_lock(roomId, YYYYMMDD)로 날짜 단위로 좁힌다.
    const room = await practiceRoomRepository.findRoomByIdForUpdate(client, roomId);
    if (room === null) {
      throw new AppError(404, 'PRACTICE_ROOM_NOT_FOUND', '연습실을 찾을 수 없습니다.');
    }
    if (!room.isActive) {
      throw new AppError(403, 'FORBIDDEN', '현재 사용할 수 없는 연습실입니다.');
    }
    if (startTime < room.openTime || endTime > room.closeTime) {
      throw new AppError(
        400,
        'BAD_REQUEST',
        `연습실 운영시간(${room.openTime}~${room.closeTime}) 내에서만 예약할 수 있습니다.`
      );
    }

    const reserved = await reservationRepository.findReservedForUpdate(client, {
      practiceRoomId: roomId,
      date: reservationDate,
    });
    if (reserved.some((r) => overlaps({ startTime, endTime }, r))) {
      throw new AppError(409, 'RESERVATION_SLOT_CONFLICT', '이미 예약된 시간대가 포함되어 있습니다.');
    }

    const created = await reservationRepository.insertReservation(client, {
      practiceRoomId: roomId,
      memberId,
      date: reservationDate,
      startTime,
      endTime,
    });
    if (created === null) {
      throw new AppError(409, 'RESERVATION_SLOT_CONFLICT', '이미 예약된 시간대가 포함되어 있습니다.');
    }
    return created;
  });
}

module.exports = { createReservation };
