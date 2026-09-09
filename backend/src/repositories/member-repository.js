'use strict';

const { query } = require('../db/pool');

/**
 * members 행(+ 조인된 member_grades 행)을 swagger Member 스키마 형태로 변환한다.
 * export하지 않는다 — members 행을 API 응답으로 바꾸는 코드는 이 파일에만 존재해야 한다.
 * password_hash는 절대 읽지 않는다(화이트리스트 방식).
 */
function toMember(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone,
    memberGradeId: row.member_grade_id,
    memberGrade: {
      id: row.grade_id,
      name: row.grade_name,
      description: row.grade_description,
      gradeLevel: row.grade_level,
      isAdmin: row.is_admin,
    },
    accountStatus: row.account_status,
    joinedAt: row.joined_at,
  };
}

/**
 * 회원을 생성한다. 이메일이 이미 존재하면 아무것도 하지 않고 null을 반환한다
 * (409 판정은 service 책임이므로 여기서 예외를 던지지 않는다).
 * account_status·joined_at은 DB 기본값을 쓰기 위해 컬럼 목록에서 제외한다.
 */
async function insertMember({ email, passwordHash, name, phone, memberGradeId }) {
  const result = await query(
    `INSERT INTO members (email, password_hash, name, phone, member_grade_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email) DO NOTHING
     RETURNING id`,
    [email, passwordHash, name, phone, memberGradeId]
  );
  return result.rows[0] ? result.rows[0].id : null;
}

/** id로 회원(+ 등급)을 조회한다. 없으면 null. */
async function findMemberById(id) {
  const result = await query(
    `SELECT m.id,
            m.email,
            m.name,
            m.phone,
            m.member_grade_id,
            m.account_status,
            m.joined_at,
            g.id          AS grade_id,
            g.name        AS grade_name,
            g.description AS grade_description,
            g.grade_level,
            g.is_admin
       FROM members m
       JOIN member_grades g ON g.id = m.member_grade_id
      WHERE m.id = $1`,
    [id]
  );
  return result.rows[0] ? toMember(result.rows[0]) : null;
}

/**
 * 이메일로 인증에 필요한 정보를 조회한다. password_hash는 member 객체 밖으로
 * 분리해 응답 유출을 구조적으로 차단한다. 없으면 null.
 */
async function findAuthByEmail(email) {
  const result = await query(
    `SELECT m.id,
            m.email,
            m.password_hash,
            m.name,
            m.phone,
            m.member_grade_id,
            m.account_status,
            m.joined_at,
            g.id          AS grade_id,
            g.name        AS grade_name,
            g.description AS grade_description,
            g.grade_level,
            g.is_admin
       FROM members m
       JOIN member_grades g ON g.id = m.member_grade_id
      WHERE m.email = $1`,
    [email]
  );
  if (!result.rows[0]) {
    return null;
  }
  const row = result.rows[0];
  return { member: toMember(row), passwordHash: row.password_hash };
}

/**
 * 회원 정보(이름·연락처)를 수정한다. name·phone 중 undefined가 아닌 것만 SET 절에 포함한다.
 * 둘 다 undefined면 SQL을 실행하지 않고 null을 반환한다(이중 방어. controller가 이미 400 처리).
 * 수정 후 최신 상태(등급 조인 포함)를 반환한다. 대상 행이 없으면 null.
 */
async function updateMember(id, { name, phone }) {
  const sets = [];
  const values = [];
  if (name !== undefined) {
    values.push(name);
    sets.push(`name = $${values.length}`);
  }
  if (phone !== undefined) {
    values.push(phone);
    sets.push(`phone = $${values.length}`);
  }
  if (sets.length === 0) {
    return null;
  }
  values.push(id);
  const result = await query(
    `UPDATE members
        SET ${sets.join(', ')}
      WHERE id = $${values.length}`,
    values
  );
  return result.rowCount === 0 ? null : findMemberById(id);
}

module.exports = { insertMember, findMemberById, findAuthByEmail, updateMember };
