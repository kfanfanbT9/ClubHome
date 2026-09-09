'use strict';

const { AppError } = require('../middlewares/errorHandler');
const boardService = require('../services/board-service');
const memberService = require('../services/member-service');
const postRepository = require('../repositories/post-repository');

/**
 * 작성자 본인 또는 관리자만 수정·삭제할 수 있다는 규칙의 단일 판정 지점.
 * export하지 않는다 — updatePost·deletePost가 공유한다.
 */
function assertCanModify(post, memberId, isAdmin) {
  if (post.memberId !== memberId && !isAdmin) {
    throw new AppError(403, 'FORBIDDEN', '본인 또는 관리자만 수정·삭제할 수 있습니다.');
  }
}

/** 게시판의 게시글 목록을 페이지네이션해 조회한다. 게시판 인가를 먼저 통과해야 한다. */
async function getPosts(boardId, page, pageSize, gradeLevel) {
  await boardService.getAccessibleBoard(boardId, gradeLevel);

  const totalCount = await postRepository.countPostsByBoardId(boardId);
  const items = await postRepository.findPostsByBoardId(boardId, {
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  return { items, page, pageSize, totalCount };
}

/** 게시글을 작성한다. 게시판 인가 통과 후 탈퇴 회원 여부를 확인한다(§5). */
async function createPost(boardId, { title, content }, memberId, gradeLevel) {
  await boardService.getAccessibleBoard(boardId, gradeLevel);

  const member = await memberService.getMyProfile(memberId);
  if (member.accountStatus === 'withdrawn') {
    throw new AppError(403, 'ACCOUNT_WITHDRAWN', '탈퇴한 계정입니다.');
  }

  return postRepository.insertPost({ boardId, memberId, title, content });
}

/**
 * 게시글 상세를 조회하고 조회수를 1 증가시킨다.
 * 순서 고정: 게시글 조회 → 게시판 인가 → 조회수 증가(§7-2, 인가를 통과한 뒤에만 증가시킨다).
 */
async function getPost(postId, gradeLevel) {
  const post = await postRepository.findPostById(postId);
  if (!post) {
    throw new AppError(404, 'NOT_FOUND', '게시글을 찾을 수 없습니다.');
  }

  await boardService.getAccessibleBoard(post.boardId, gradeLevel);

  const viewCount = await postRepository.increaseViewCount(postId);
  if (viewCount === null) {
    throw new AppError(404, 'NOT_FOUND', '게시글을 찾을 수 없습니다.');
  }
  return { ...post, viewCount };
}

/**
 * 게시글을 수정한다. 순서 고정: 게시글 조회 → 게시판 인가 → 소유권 검사(§8-2).
 */
async function updatePost(postId, patch, memberId, gradeLevel, isAdmin) {
  const post = await postRepository.findPostById(postId);
  if (!post) {
    throw new AppError(404, 'NOT_FOUND', '게시글을 찾을 수 없습니다.');
  }

  await boardService.getAccessibleBoard(post.boardId, gradeLevel);

  assertCanModify(post, memberId, isAdmin);

  const updated = await postRepository.updatePost(postId, patch);
  if (!updated) {
    throw new AppError(404, 'NOT_FOUND', '게시글을 찾을 수 없습니다.');
  }
  return updated;
}

/**
 * 게시글을 삭제한다. 순서 고정: 게시글 조회 → 게시판 인가 → 소유권 검사(§8-2).
 */
async function deletePost(postId, memberId, gradeLevel, isAdmin) {
  const post = await postRepository.findPostById(postId);
  if (!post) {
    throw new AppError(404, 'NOT_FOUND', '게시글을 찾을 수 없습니다.');
  }

  await boardService.getAccessibleBoard(post.boardId, gradeLevel);

  assertCanModify(post, memberId, isAdmin);

  const removed = await postRepository.deletePost(postId);
  if (!removed) {
    throw new AppError(404, 'NOT_FOUND', '게시글을 찾을 수 없습니다.');
  }
}

module.exports = { getPosts, createPost, getPost, updatePost, deletePost };
