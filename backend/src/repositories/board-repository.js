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

/** 비활성 포함 전체 게시판을 조회한다(관리자 전용). WHERE가 없는 것이 계약이다. */
async function findAllBoards() {
  const result = await query(
    `SELECT id,
            name,
            description,
            min_grade_level,
            is_active
       FROM boards
      ORDER BY min_grade_level ASC, id ASC`
  );
  return result.rows.map(toBoard);
}

/** 게시판을 생성한다(관리자 전용). */
async function insertBoard({ name, description, minGradeLevel, isActive }) {
  const result = await query(
    `INSERT INTO boards (name, description, min_grade_level, is_active)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, description, min_grade_level, is_active`,
    [name, description, minGradeLevel, isActive]
  );
  return toBoard(result.rows[0]);
}

/** 게시판을 전체 교체 수정한다(관리자 전용). 대상 미존재 시 0행 → null. */
async function updateBoard(id, { name, description, minGradeLevel, isActive }) {
  const result = await query(
    `UPDATE boards
        SET name = $2, description = $3, min_grade_level = $4, is_active = $5
      WHERE id = $1
      RETURNING id, name, description, min_grade_level, is_active`,
    [id, name, description, minGradeLevel, isActive]
  );
  return result.rows[0] ? toBoard(result.rows[0]) : null;
}

/**
 * 참조하는 게시글이 없을 때만 게시판을 삭제한다(관리자 전용).
 * NOT EXISTS 가드가 posts FK RESTRICT를 사전에 회피시켜 23503이 애플리케이션에 등장하지 않게 한다.
 * status를 모른다 — 삭제 여부만 boolean으로 반환한다.
 */
async function deleteBoardIfUnused(id) {
  const result = await query(
    `DELETE FROM boards AS b
      WHERE b.id = $1
        AND NOT EXISTS (SELECT 1 FROM posts p WHERE p.board_id = b.id)`,
    [id]
  );
  return result.rowCount > 0;
}

/**
 * 해당 값을 최소등급으로 쓰는 게시판 수를 센다(등급서열 재배치 사전 검사용).
 * 인가 판정이 아니다 — 비교 없이 등호로만 세며, member_grades.grade_level을 옮길 때
 * boards.min_grade_level FK(ON UPDATE NO ACTION)가 23503을 던지는 것을 막기 위한
 * 참조 정합성 검사다. 인자는 "요청자의 등급"이 아니라 "이동 대상 서열 값"이다.
 */
async function countBoardsByMinGradeLevel(minGradeLevel) {
  const result = await query(`SELECT COUNT(*) AS count FROM boards WHERE min_grade_level = $1`, [
    minGradeLevel,
  ]);
  return Number(result.rows[0].count);
}

module.exports = {
  findActiveBoards,
  findBoardById,
  findAllBoards,
  insertBoard,
  updateBoard,
  deleteBoardIfUnused,
  countBoardsByMinGradeLevel,
};
