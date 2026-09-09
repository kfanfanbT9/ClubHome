'use strict';

const { AppError } = require('../middlewares/errorHandler');
const boardRepository = require('../repositories/board-repository');

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

module.exports = { getBoards, getAccessibleBoard };
