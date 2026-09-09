'use strict';

const { AppError } = require('../middlewares/errorHandler');
const practiceRoomRepository = require('../repositories/practice-room-repository');
const reservationRepository = require('../repositories/reservation-repository');

/** 'HH:mm' | 'HH:mm:ss' -> 자정으로부터의 분(정수). */
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/** 자정으로부터의 분(정수) -> 'HH:mm'. */
function toHHmm(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 운영시간(openTime~closeTime)을 30분 단위 슬롯으로 전개하고, 각 슬롯이 어느 예약과
 * 겹치는지 판정해 붙인다. 시작은 30분 경계로 올림, 끝은 close_time을 넘지 않도록 절단한다.
 */
function buildSlots(openTime, closeTime, reservations) {
  const openMin = toMinutes(openTime);
  const closeMin = toMinutes(closeTime);
  const start = Math.ceil(openMin / 30) * 30;

  const slots = [];
  for (let m = start; m + 30 <= closeMin; m += 30) {
    const slotStart = m;
    const slotEnd = m + 30;

    // 겹침 판정: slotStart < 예약종료 && slotEnd > 예약시작
    const hit = reservations.find(
      (r) => slotStart < toMinutes(r.endTime) && slotEnd > toMinutes(r.startTime)
    );

    slots.push({
      startTime: toHHmm(slotStart),
      endTime: toHHmm(slotEnd),
      isAvailable: !hit,
      reservationId: hit ? hit.id : null,
      memberName: hit ? hit.memberName : null,
    });
  }
  return slots;
}

/** 활성 연습실 목록을 조회한다. */
async function listRooms() {
  return practiceRoomRepository.findActiveRooms();
}

/** 연습실의 하루 예약현황을 30분 슬롯으로 전개해 반환한다. */
async function getDaySlots({ roomId, date }) {
  const room = await practiceRoomRepository.findActiveRoomById(roomId);
  if (room === null) {
    throw new AppError(404, 'PRACTICE_ROOM_NOT_FOUND', '연습실을 찾을 수 없습니다.');
  }

  const reservations = await reservationRepository.findReservedByRoomAndDate({
    practiceRoomId: roomId,
    date,
  });

  return {
    practiceRoomId: room.id,
    date,
    slots: buildSlots(room.openTime, room.closeTime, reservations),
  };
}

module.exports = { listRooms, getDaySlots };
