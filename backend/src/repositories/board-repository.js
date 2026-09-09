'use strict';

const { query } = require('../db/pool');

/**
 * boards 행을 swagger Board 스키마 형태로 변환한다.
 * export하지 않는다 — boards 행을 API 응답으로 바꾸는 코드는 이 파일에만 존재해야 한다.
 * 접근 가능 여부는 인가 판정 결과이므로 여기서 만들지 않는다(service 책임).
 */
function toBoard(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    minGradeLevel: row.min_grade_level,
    isActive: row.is_active,
  };
}

/** 활성 게시판 전체를 조회한다. 0건이면 []. */
async function findActiveBoards() {
  const result = await query(
    `SELECT id,
            name,
            description,
            min_grade_level,
            is_active
       FROM boards
      WHERE is_active = TRUE
      ORDER BY min_grade_level ASC, id ASC`
  );
  return result.rows.map(toBoard);
}

/** id로 게시판을 조회한다. 활성 여부와 무관하게 조회하며, 없으면 null. */
async function findBoardById(id) {
  const result = await query(
    `SELECT id,
            name,
            description,
            min_grade_level,
            is_active
       FROM boards
      WHERE id = $1`,
    [id]
  );
  return result.rows[0] ? toBoard(result.rows[0]) : null;
}

module.exports = { findActiveBoards, findBoardById };
