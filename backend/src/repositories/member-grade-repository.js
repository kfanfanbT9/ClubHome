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

module.exports = { findLowestGradeId };
