'use strict';

const { AppError } = require('../middlewares/errorHandler');
const postService = require('../services/post-service');
const { requireString } = require('../middlewares/validate');

// posts.id·boards.id는 INTEGER — 초과 값은 pg 22003(500)이 된다
const MAX_INT4 = 2147483647;

/** path의 정수 id. 형식 불량은 404로 통일한다(각 경로에 400이 정의되어 있지 않다). */
function parseId(value, notFoundMessage) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1 || id > MAX_INT4) {
    throw new AppError(404, 'NOT_FOUND', notFoundMessage);
  }
  return id;
}

/** 쿼리 정수. 미지정·형식 불량·하한 미달은 기본값, 상한 초과는 상한으로 클램프한다(§6). */
function parsePositiveInt(value, defaultValue, maxValue) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return defaultValue;
  return n > maxValue ? maxValue : n;
}

/** GET /api/boards/:boardId/posts */
async function list(req, res) {
  const boardId = parseId(req.params.boardId, '게시판을 찾을 수 없습니다.');
  const page = parsePositiveInt(req.query.page, 1, MAX_INT4);
  const pageSize = parsePositiveInt(req.query.pageSize, 20, 100);

  const result = await postService.getPosts(boardId, page, pageSize, req.member.gradeLevel);
  res.status(200).json(result);
}

/** POST /api/boards/:boardId/posts */
async function create(req, res) {
  const boardId = parseId(req.params.boardId, '게시판을 찾을 수 없습니다.');
  const body = req.body || {};

  const title = requireString(body.title, '제목', { maxLength: 200 });
  const content = requireString(body.content, '내용');

  const post = await postService.createPost(
    boardId,
    { title, content },
    req.member.id,
    req.member.gradeLevel
  );
  res.status(201).json(post);
}

/** GET /api/posts/:postId */
async function detail(req, res) {
  const postId = parseId(req.params.postId, '게시글을 찾을 수 없습니다.');

  const post = await postService.getPost(postId, req.member.gradeLevel);
  res.status(200).json(post);
}

/** PATCH /api/posts/:postId */
async function update(req, res) {
  const postId = parseId(req.params.postId, '게시글을 찾을 수 없습니다.');
  const body = req.body || {};

  const patch = {};
  if (body.title !== undefined) {
    patch.title = requireString(body.title, '제목', { maxLength: 200 });
  }
  if (body.content !== undefined) {
    patch.content = requireString(body.content, '내용');
  }
  if (patch.title === undefined && patch.content === undefined) {
    throw new AppError(400, 'BAD_REQUEST', '수정할 항목이 없습니다.');
  }

  const post = await postService.updatePost(
    postId,
    patch,
    req.member.id,
    req.member.gradeLevel,
    req.member.isAdmin
  );
  res.status(200).json(post);
}

/** DELETE /api/posts/:postId */
async function remove(req, res) {
  const postId = parseId(req.params.postId, '게시글을 찾을 수 없습니다.');

  await postService.deletePost(postId, req.member.id, req.member.gradeLevel, req.member.isAdmin);
  res.status(204).end();
}

module.exports = { list, create, detail, update, remove };
