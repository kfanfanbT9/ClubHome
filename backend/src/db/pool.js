'use strict';

const { Pool } = require('pg');

// DATABASE_URL이 없으면 pg가 PGHOST/PGUSER 등 표준 환경변수로 폴백한다
// (프로젝트 구조 설계 원칙 §5 환경변수 목록).
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

/** 단건 질의. SQL은 repository 레이어에서만 호출한다 (원칙 §2.2). */
function query(text, params) {
  return pool.query(text, params);
}

/**
 * 트랜잭션 실행. 콜백에 전용 클라이언트를 넘겨 같은 커넥션에서
 * 잠금(SELECT ... FOR UPDATE)과 쓰기를 수행할 수 있게 한다.
 */
async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
