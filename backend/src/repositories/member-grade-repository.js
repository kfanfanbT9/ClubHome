'use strict';

const { query } = require('../db/pool');

/**
 * 최저 등급(grade_level이 가장 작은 등급)의 id를 조회한다.
 * 회원가입 시 기본 등급 부여에 사용한다. grade_level은 NOT NULL UNIQUE이므로
 * 결과가 항상 유일하다.
 */
async function findLowestGradeId() {
  const result = await query(
    `SELECT id
       FROM member_grades
      ORDER BY grade_level ASC
      LIMIT 1`
  );
  return result.rows[0] ? result.rows[0].id : null;
}

/**
 * member_grades 행을 swagger MemberGrade 스키마 형태로 변환한다.
 * export하지 않는다 — member_grades 행을 API 응답으로 바꾸는 코드는 이 파일에만 존재해야 한다.
 */
function toMemberGrade(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    gradeLevel: row.grade_level,
    isAdmin: row.is_admin,
  };
}

/** 전체 등급 목록을 등급서열(grade_level) 오름차순으로 조회한다. */
async function findAllGrades() {
  const result = await query(
    `SELECT id, name, description, grade_level, is_admin
       FROM member_grades
      ORDER BY grade_level ASC`
  );
  return result.rows.map(toMemberGrade);
}

/** id로 등급을 조회한다. 없으면 null. */
async function findGradeById(id) {
  const result = await query(
    `SELECT id, name, description, grade_level, is_admin
       FROM member_grades
      WHERE id = $1`,
    [id]
  );
  return result.rows[0] ? toMemberGrade(result.rows[0]) : null;
}

/** 해당 등급서열을 가진 등급이 존재하는지 확인한다(FK 사전 검사용). */
async function existsGradeLevel(gradeLevel) {
  const result = await query(`SELECT 1 FROM member_grades WHERE grade_level = $1`, [gradeLevel]);
  return result.rows.length > 0;
}

/**
 * 등급을 생성한다. name·grade_level UNIQUE 충돌 시 아무것도 하지 않고 null을 반환한다
 * (409 판정은 service 책임이므로 여기서 예외를 던지지 않는다). conflict target을
 * 지정하지 않는다 — name·grade_level 두 UNIQUE 제약을 모두 잡아야 한다.
 */
async function insertGrade({ name, description, gradeLevel, isAdmin }) {
  const result = await query(
    `INSERT INTO member_grades (name, description, grade_level, is_admin)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING
     RETURNING id, name, description, grade_level, is_admin`,
    [name, description, gradeLevel, isAdmin]
  );
  return result.rows[0] ? toMemberGrade(result.rows[0]) : null;
}

/**
 * 등급을 전체 교체 수정한다. NOT EXISTS 가드가 자기 자신을 제외한 다른 행과의
 * name·grade_level 중복을 막는다(ON CONFLICT DO NOTHING의 UPDATE 대응물).
 * 대상 미존재 또는 중복 시 0행 → null.
 */
async function updateGrade(id, { name, description, gradeLevel, isAdmin }) {
  const result = await query(
    `UPDATE member_grades AS g
        SET name = $2, description = $3, grade_level = $4, is_admin = $5
      WHERE g.id = $1
        AND NOT EXISTS (SELECT 1 FROM member_grades o
                         WHERE o.id <> g.id AND (o.name = $2 OR o.grade_level = $4))
      RETURNING g.id, g.name, g.description, g.grade_level, g.is_admin`,
    [id, name, description, gradeLevel, isAdmin]
  );
  return result.rows[0] ? toMemberGrade(result.rows[0]) : null;
}

module.exports = {
  findLowestGradeId,
  findAllGrades,
  findGradeById,
  existsGradeLevel,
  insertGrade,
  updateGrade,
};
