'use strict';

const { AppError } = require('../middlewares/errorHandler');
const boardService = require('../services/board-service');

// boards.id는 INTEGER — 초과 값은 pg 22003(500)이 된다.
const MAX_INT4 = 2147483647;

/**
 * boardId 경로 파라미터를 정수로 파싱한다. swagger에 이 경로의 400이 정의되어 있지 않으므로
 * 형식 불량도 미존재와 동일하게 404로 응답한다.
 * parseInt를 쓰지 않는다: parseInt('1.5')는 1, parseInt('12abc')는 12로 조용히 통과한다.
 */
function parseBoardId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1 || id > MAX_INT4) {
    throw new AppError(404, 'NOT_FOUND', '게시판을 찾을 수 없습니다.');
  }
  return id;
}

/** GET /api/boards */
async function list(req, res) {
  const boards = await boardService.getBoards(req.member.gradeLevel);
  res.status(200).json(boards);
}

/** GET /api/boards/:boardId */
async function detail(req, res) {
  const boardId = parseBoardId(req.params.boardId);
  const board = await boardService.getAccessibleBoard(boardId, req.member.gradeLevel);
  res.status(200).json(board);
}

module.exports = { list, detail };
