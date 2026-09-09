'use strict';

const { AppError } = require('../middlewares/errorHandler');
const boardRepository = require('../repositories/board-repository');
const memberGradeRepository = require('../repositories/member-grade-repository');

/**
 * 활성 게시판 목록을 조회하고 각 게시판에 요청 회원의 접근 가능 여부(canAccess)를 붙인다.
 * 접근 불가 게시판도 목록에 포함한다(잠금 표시용). 예외를 던지지 않는다.
 */
async function getBoards(gradeLevel) {
  const boards = await boardRepository.findActiveBoards();
  return boards.map((board) => ({ ...board, canAccess: gradeLevel >= board.minGradeLevel }));
}

/**
 * 등급 인가의 단일 판정 지점. 존재 → 활성 → 등급 순서로 검사한다.
 * 순서가 고정인 이유: 등급을 먼저 보면 비활성 게시판에 등급 미달로 접근했을 때
 * 403이 나가 숨긴 게시판의 존재와 최소등급이 노출된다.
 */
async function getAccessibleBoard(boardId, gradeLevel) {
  const board = await boardRepository.findBoardById(boardId);
  if (!board || !board.isActive) {
    throw new AppError(404, 'NOT_FOUND', '게시판을 찾을 수 없습니다.');
  }
  if (gradeLevel < board.minGradeLevel) {
    throw new AppError(403, 'FORBIDDEN', '이용 권한이 없는 게시판입니다.');
  }
  return board;
}

/** 관리자 전용 함수의 첫 관문. export하지 않는다 — 이 파일의 service 함수들만 공유한다. */
function assertAdmin(isAdmin) {
  if (!isAdmin) {
    throw new AppError(403, 'FORBIDDEN', '관리자만 접근할 수 있습니다.');
  }
}

/** 비활성 포함 전체 게시판 목록을 조회한다(관리자 전용). canAccess는 붙이지 않는다. */
async function listAllBoards(isAdmin) {
  assertAdmin(isAdmin);
  return boardRepository.findAllBoards();
}

/** 게시판을 생성한다(관리자 전용). minGradeLevel FK 사전 검사로 23503을 막는다. */
async function createBoard({ name, description, minGradeLevel, isActive }, isAdmin) {
  assertAdmin(isAdmin);

  const exists = await memberGradeRepository.existsGradeLevel(minGradeLevel);
  if (!exists) {
    throw new AppError(400, 'BAD_REQUEST', '존재하지 않는 최소등급입니다.');
  }

  return boardRepository.insertBoard({ name, description, minGradeLevel, isActive });
}

/**
 * 게시판을 전체 교체 수정한다(관리자 전용).
 * 순서: 관리자 판정 → 게시판 존재(404) → 최소등급 FK 사전 검사(400) → UPDATE(404).
 */
async function updateBoard(boardId, { name, description, minGradeLevel, isActive }, isAdmin) {
  assertAdmin(isAdmin);

  const board = await boardRepository.findBoardById(boardId);
  if (!board) {
    throw new AppError(404, 'NOT_FOUND', '게시판을 찾을 수 없습니다.');
  }

  const exists = await memberGradeRepository.existsGradeLevel(minGradeLevel);
  if (!exists) {
    throw new AppError(400, 'BAD_REQUEST', '존재하지 않는 최소등급입니다.');
  }

  const updated = await boardRepository.updateBoard(boardId, {
    name,
    description,
    minGradeLevel,
    isActive,
  });
  if (!updated) {
    throw new AppError(404, 'NOT_FOUND', '게시판을 찾을 수 없습니다.');
  }
  return updated;
}

/**
 * 게시판을 삭제한다(관리자 전용). 존재 확인을 먼저 해야 미존재(404)와 참조중(409)이
 * 구분된다(NOT EXISTS 가드는 둘 다 0행으로 만든다).
 */
async function deleteBoard(boardId, isAdmin) {
  assertAdmin(isAdmin);

  const board = await boardRepository.findBoardById(boardId);
  if (!board) {
    throw new AppError(404, 'NOT_FOUND', '게시판을 찾을 수 없습니다.');
  }

  const deleted = await boardRepository.deleteBoardIfUnused(boardId);
  if (!deleted) {
    throw new AppError(409, 'BOARD_HAS_POSTS', '게시글이 있는 게시판은 삭제할 수 없습니다.');
  }
}

module.exports = { getBoards, getAccessibleBoard, listAllBoards, createBoard, updateBoard, deleteBoard };
