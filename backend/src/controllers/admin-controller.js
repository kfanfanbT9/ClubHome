'use strict';

const { AppError } = require('../middlewares/errorHandler');
const { requireString, josa } = require('../middlewares/validate');
const memberService = require('../services/member-service');
const boardService = require('../services/board-service');
const practiceRoomService = require('../services/practice-room-service');
const reservationService = require('../services/reservation-service');

// members.id·member_grades.id·boards.id·practice_rooms.id·reservations.id는 INTEGER —
// 초과 값은 pg 22003(500)이 된다.
const MAX_INT4 = 2147483647;

/**
 * path id 공통 파서. 정수·1~MAX_INT4 범위가 아니면 404(notFoundMessage).
 * parseInt를 쓰지 않는다: parseInt('12abc')가 12로 조용히 통과하는 것을 막는다.
 */
function parseId(value, notFoundMessage) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1 || id > MAX_INT4) {
    throw new AppError(404, 'NOT_FOUND', notFoundMessage);
  }
  return id;
}

/** 선택적 검색어(q). 문자열이 아니거나 trim 후 빈 값이면 null(=전체). 던지지 않는다. */
function optionalQuery(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** 선택적 roomId 필터. 형식 불량이면 null(=전체)로 떨어뜨린다. 던지지 않는다. */
function parseRoomIdFilter(value) {
  const id = Number(value);
  return Number.isInteger(id) && id >= 1 && id <= MAX_INT4 ? id : null;
}

/**
 * 선택적 date 필터('YYYY-MM-DD'). 형식·실존 날짜 검증에 실패하면 null(=전체)로 떨어뜨린다.
 * 검증 없이 $2::date에 넘기면 pg 22007(500)이 되므로 이 파서가 500 방어선이다.
 */
function parseDateFilter(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return null;
  }
  return value;
}

/**
 * 필수 정수값 검증. min~MAX_INT4 범위가 아니면 400.
 * typeof를 먼저 보는 이유: Number('3')이 3으로 통과해 swagger의 integer 스키마를 위반한
 * 문자열 본문이 조용히 들어온다. 아래 optionalBoolean이 문자열 'true'를 거부하는 것과
 * 같은 엄격성이며, 본문 값 전용이다(path id는 parseId가 문자열을 받아 따로 변환한다).
 */
function requireInt(value, field, { min = 1 } = {}) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > MAX_INT4) {
    throw new AppError(400, 'BAD_REQUEST', `${field}${josa(field, '이', '가')} 올바르지 않습니다.`);
  }
  return value;
}

/**
 * 선택적 문자열 필드 검증. undefined·null은 null. 문자열이 아니면 400.
 * trim 후 빈 문자열은 null. maxLength 초과는 400. requireString은 빈 값을 400으로 만들어
 * 선택 필드에는 쓸 수 없다.
 */
function optionalText(value, field, { maxLength } = {}) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new AppError(400, 'BAD_REQUEST', `${field}${josa(field, '은', '는')} 문자열이어야 합니다.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (maxLength !== undefined && trimmed.length > maxLength) {
    throw new AppError(
      400,
      'BAD_REQUEST',
      `${field}${josa(field, '은', '는')} ${maxLength}자 이하여야 합니다.`
    );
  }
  return trimmed;
}

/** 선택적 불리언 필드 검증. undefined·null은 defaultValue. 문자열 'true' 강제변환은 하지 않는다. */
function optionalBoolean(value, field, defaultValue) {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value !== 'boolean') {
    throw new AppError(400, 'BAD_REQUEST', `${field}${josa(field, '은', '는')} true/false여야 합니다.`);
  }
  return value;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** 필수 시각값('HH:mm') 검증. 30분 경계를 요구하지 않는다(운영시간에는 그 제약이 없다). */
function requireTime(value, field) {
  if (typeof value !== 'string' || !TIME_PATTERN.test(value)) {
    throw new AppError(400, 'BAD_REQUEST', `${field}${josa(field, '은', '는')} HH:mm 형식이어야 합니다.`);
  }
  return value;
}

/** 게시판 생성/수정 본문을 검증한다(POST·PATCH 공용, 전체 교체). */
function parseBoardBody(body) {
  const name = requireString(body.name, '게시판명', { maxLength: 100 });
  const description = optionalText(body.description, '설명');
  const minGradeLevel = requireInt(body.minGradeLevel, '최소등급', { min: -MAX_INT4 });
  const isActive = optionalBoolean(body.isActive, '사용여부', true);
  return { name, description, minGradeLevel, isActive };
}

/** 연습실 등록/수정 본문을 검증한다(POST·PATCH 공용, 전체 교체). */
function parseRoomBody(body) {
  const name = requireString(body.name, '연습실명', { maxLength: 100 });
  const location = optionalText(body.location, '위치', { maxLength: 100 });
  const capacity = requireInt(body.capacity, '수용인원', { min: 1 });
  const openTime = requireTime(body.openTime, '운영 시작시간');
  const closeTime = requireTime(body.closeTime, '운영 종료시간');
  if (openTime >= closeTime) {
    throw new AppError(400, 'BAD_REQUEST', '운영 종료시간은 시작시간보다 뒤여야 합니다.');
  }
  const isActive = optionalBoolean(body.isActive, '사용여부', true);
  return { name, location, capacity, openTime, closeTime, isActive };
}

/** 회원등급 생성/수정 본문을 검증한다(POST·PATCH 공용, 전체 교체). */
function parseMemberGradeBody(body) {
  const name = requireString(body.name, '등급명', { maxLength: 30 });
  const description = optionalText(body.description, '설명');
  const gradeLevel = requireInt(body.gradeLevel, '등급서열', { min: -MAX_INT4 });
  const isAdmin = optionalBoolean(body.isAdmin, '관리자 권한 여부', false);
  return { name, description, gradeLevel, isAdmin };
}

/** GET /api/admin/members */
async function listMembers(req, res) {
  const q = optionalQuery(req.query.q);
  const members = await memberService.listMembers(q, req.member.isAdmin);
  res.status(200).json(members);
}

/** PATCH /api/admin/members/:memberId/grade */
async function changeMemberGrade(req, res) {
  const memberId = parseId(req.params.memberId, '회원을 찾을 수 없습니다.');
  const body = req.body || {};
  const memberGradeId = requireInt(body.memberGradeId, '회원등급 ID');

  const member = await memberService.changeMemberGrade(memberId, memberGradeId, req.member.isAdmin);
  res.status(200).json(member);
}

/** GET /api/admin/member-grades */
async function listMemberGrades(req, res) {
  const grades = await memberService.listMemberGrades(req.member.isAdmin);
  res.status(200).json(grades);
}

/** POST /api/admin/member-grades */
async function createMemberGrade(req, res) {
  const payload = parseMemberGradeBody(req.body || {});
  const grade = await memberService.createMemberGrade(payload, req.member.isAdmin);
  res.status(201).json(grade);
}

/** PATCH /api/admin/member-grades/:gradeId */
async function updateMemberGrade(req, res) {
  const gradeId = parseId(req.params.gradeId, '회원등급을 찾을 수 없습니다.');
  const payload = parseMemberGradeBody(req.body || {});
  const grade = await memberService.updateMemberGrade(gradeId, payload, req.member.isAdmin);
  res.status(200).json(grade);
}

/** GET /api/admin/boards */
async function listBoards(req, res) {
  const boards = await boardService.listAllBoards(req.member.isAdmin);
  res.status(200).json(boards);
}

/** POST /api/admin/boards */
async function createBoard(req, res) {
  const payload = parseBoardBody(req.body || {});
  const board = await boardService.createBoard(payload, req.member.isAdmin);
  res.status(201).json(board);
}

/** PATCH /api/admin/boards/:boardId */
async function updateBoard(req, res) {
  const boardId = parseId(req.params.boardId, '게시판을 찾을 수 없습니다.');
  const payload = parseBoardBody(req.body || {});
  const board = await boardService.updateBoard(boardId, payload, req.member.isAdmin);
  res.status(200).json(board);
}

/** DELETE /api/admin/boards/:boardId */
async function removeBoard(req, res) {
  const boardId = parseId(req.params.boardId, '게시판을 찾을 수 없습니다.');
  await boardService.deleteBoard(boardId, req.member.isAdmin);
  res.status(204).end();
}

/** GET /api/admin/practice-rooms */
async function listRooms(req, res) {
  const rooms = await practiceRoomService.listAllRooms(req.member.isAdmin);
  res.status(200).json(rooms);
}

/** POST /api/admin/practice-rooms */
async function createRoom(req, res) {
  const payload = parseRoomBody(req.body || {});
  const room = await practiceRoomService.createRoom(payload, req.member.isAdmin);
  res.status(201).json(room);
}

/** PATCH /api/admin/practice-rooms/:roomId */
async function updateRoom(req, res) {
  const roomId = parseId(req.params.roomId, '연습실을 찾을 수 없습니다.');
  const payload = parseRoomBody(req.body || {});
  const room = await practiceRoomService.updateRoom(roomId, payload, req.member.isAdmin);
  res.status(200).json(room);
}

/** DELETE /api/admin/practice-rooms/:roomId */
async function removeRoom(req, res) {
  const roomId = parseId(req.params.roomId, '연습실을 찾을 수 없습니다.');
  await practiceRoomService.deleteRoom(roomId, req.member.isAdmin);
  res.status(204).end();
}

/** GET /api/admin/reservations */
async function listReservations(req, res) {
  const practiceRoomId = parseRoomIdFilter(req.query.roomId);
  const date = parseDateFilter(req.query.date);

  const reservations = await reservationService.getAllReservations(
    { practiceRoomId, date },
    req.member.isAdmin
  );
  res.status(200).json(reservations);
}

/** PATCH /api/admin/reservations/:reservationId/cancel */
async function forceCancelReservation(req, res) {
  const reservationId = parseId(req.params.reservationId, '예약을 찾을 수 없습니다.');
  const reservation = await reservationService.forceCancelReservation(reservationId, req.member.isAdmin);
  res.status(200).json(reservation);
}

module.exports = {
  listMembers,
  changeMemberGrade,
  listMemberGrades,
  createMemberGrade,
  updateMemberGrade,
  listBoards,
  createBoard,
  updateBoard,
  removeBoard,
  listRooms,
  createRoom,
  updateRoom,
  removeRoom,
  listReservations,
  forceCancelReservation,
};
