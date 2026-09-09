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

/** 관리자 전용 함수의 첫 관문. export하지 않는다 — 이 파일의 service 함수들만 공유한다. */
function assertAdmin(isAdmin) {
  if (!isAdmin) {
    throw new AppError(403, 'FORBIDDEN', '관리자만 접근할 수 있습니다.');
  }
}

/** 비활성 포함 전체 연습실 목록을 조회한다(관리자 전용). */
async function listAllRooms(isAdmin) {
  assertAdmin(isAdmin);
  return practiceRoomRepository.findAllRooms();
}

/** 연습실을 등록한다(관리자 전용). CHECK 제약(capacity·운영시간)은 controller가 사전 검증한다. */
async function createRoom({ name, location, capacity, openTime, closeTime, isActive }, isAdmin) {
  assertAdmin(isAdmin);
  return practiceRoomRepository.insertRoom({ name, location, capacity, openTime, closeTime, isActive });
}

/**
 * 연습실을 전체 교체 수정한다(관리자 전용). findRoomById(비잠금·is_active 미필터)를 쓴다
 * — 수정 대상이 비활성 연습실일 수 있다.
 */
async function updateRoom(roomId, { name, location, capacity, openTime, closeTime, isActive }, isAdmin) {
  assertAdmin(isAdmin);

  const room = await practiceRoomRepository.findRoomById(roomId);
  if (!room) {
    throw new AppError(404, 'PRACTICE_ROOM_NOT_FOUND', '연습실을 찾을 수 없습니다.');
  }

  const updated = await practiceRoomRepository.updateRoom(roomId, {
    name,
    location,
    capacity,
    openTime,
    closeTime,
    isActive,
  });
  if (!updated) {
    throw new AppError(404, 'PRACTICE_ROOM_NOT_FOUND', '연습실을 찾을 수 없습니다.');
  }
  return updated;
}

/**
 * 연습실을 삭제한다(관리자 전용). 존재 확인을 먼저 해야 미존재(404)와 참조중(409)이
 * 구분된다(NOT EXISTS 가드는 둘 다 0행으로 만든다).
 */
async function deleteRoom(roomId, isAdmin) {
  assertAdmin(isAdmin);

  const room = await practiceRoomRepository.findRoomById(roomId);
  if (!room) {
    throw new AppError(404, 'PRACTICE_ROOM_NOT_FOUND', '연습실을 찾을 수 없습니다.');
  }

  const deleted = await practiceRoomRepository.deleteRoomIfUnused(roomId);
  if (!deleted) {
    throw new AppError(
      409,
      'PRACTICE_ROOM_HAS_RESERVATIONS',
      '예약 이력이 있는 연습실은 삭제할 수 없습니다.'
    );
  }
}

module.exports = { listRooms, getDaySlots, listAllRooms, createRoom, updateRoom, deleteRoom };
