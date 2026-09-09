'use strict';

const { query } = require('../db/pool');

/**
 * posts 행(+ 조인된 members 행)을 swagger Post 스키마 형태로 변환한다.
 * export하지 않는다 — posts 행을 API 응답으로 바꾸는 코드는 이 파일에만 존재해야 한다.
 */
function toPost(row) {
  return {
    id: row.id,
    boardId: row.board_id,
    memberId: row.member_id,
    authorName: row.author_name,
    title: row.title,
    // 목록 SQL(findPostsByBoardId)은 content를 SELECT하지 않는다 → undefined →
    // JSON.stringify가 키 자체를 제외한다. 의도된 동작이다(§6-4). 버그가 아니다.
    content: row.content,
    viewCount: row.view_count,
    createdAt: row.created_at,
  };
}

/** 게시판의 게시글 총 건수를 조회한다. COUNT(*)는 bigint → pg가 문자열로 반환하므로 Number로 변환한다. */
async function countPostsByBoardId(boardId) {
  const result = await query(
    `SELECT COUNT(*) AS count
       FROM posts
      WHERE board_id = $1`,
    [boardId]
  );
  return Number(result.rows[0].count);
}

/**
 * 게시판의 게시글 목록을 페이지네이션해 조회한다.
 * 목록에는 content를 담지 않는다(§6-4) — p.content를 SELECT하지 않는다.
 */
async function findPostsByBoardId(boardId, { limit, offset }) {
  const result = await query(
    `SELECT p.id,
            p.board_id,
            p.member_id,
            p.title,
            p.view_count,
            p.created_at,
            m.name AS author_name
       FROM posts p
       JOIN members m ON m.id = p.member_id
      WHERE p.board_id = $1
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT $2 OFFSET $3`,
    [boardId, limit, offset]
  );
  return result.rows.map(toPost);
}

/** id로 게시글(+ 작성자명)을 조회한다. 없으면 null. */
async function findPostById(id) {
  const result = await query(
    `SELECT p.id, p.board_id, p.member_id, p.title, p.content, p.view_count, p.created_at,
            m.name AS author_name
       FROM posts p
       JOIN members m ON m.id = p.member_id
      WHERE p.id = $1`,
    [id]
  );
  return result.rows[0] ? toPost(result.rows[0]) : null;
}

/**
 * 게시글을 생성한다. view_count·created_at은 DB 기본값을 쓰기 위해 컬럼 목록에서 제외한다.
 * authorName은 members 조인이 필요해 RETURNING으로 만들 수 없으므로 findPostById를 재사용한다.
 */
async function insertPost({ boardId, memberId, title, content }) {
  const result = await query(
    `INSERT INTO posts (board_id, member_id, title, content)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [boardId, memberId, title, content]
  );
  return findPostById(result.rows[0].id);
}

/** 조회수를 원자적으로 1 증가시키고 증가 후 값을 반환한다. 대상 행이 없으면 null. */
async function increaseViewCount(id) {
  const result = await query(
    `UPDATE posts
        SET view_count = view_count + 1
      WHERE id = $1
      RETURNING view_count`,
    [id]
  );
  return result.rows[0] ? result.rows[0].view_count : null;
}

/**
 * 게시글(제목·내용)을 수정한다. title·content 중 undefined가 아닌 것만 SET 절에 포함한다.
 * 둘 다 undefined면 SQL을 실행하지 않고 null을 반환한다(이중 방어. controller가 이미 400 처리).
 * 수정 후 최신 상태를 반환한다. 대상 행이 없으면 null.
 */
async function updatePost(id, { title, content }) {
  const sets = [];
  const values = [];
  if (title !== undefined) {
    values.push(title);
    sets.push(`title = $${values.length}`);
  }
  if (content !== undefined) {
    values.push(content);
    sets.push(`content = $${values.length}`);
  }
  if (sets.length === 0) {
    return null;
  }
  values.push(id);
  const result = await query(
    `UPDATE posts
        SET ${sets.join(', ')}
      WHERE id = $${values.length}`,
    values
  );
  return result.rowCount === 0 ? null : findPostById(id);
}

/** 게시글을 하드 삭제한다. 삭제되면 true, 대상 행이 없으면 false. */
async function deletePost(id) {
  const result = await query('DELETE FROM posts WHERE id = $1', [id]);
  return result.rowCount > 0;
}

module.exports = {
  findPostsByBoardId,
  countPostsByBoardId,
  findPostById,
  insertPost,
  increaseViewCount,
  updatePost,
  deletePost,
};
