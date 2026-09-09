'use strict';
// BE-11 (#22) — 별도 테스트 DB(clubhome_test)를 준비하는 셋업 스크립트다.
// node --test 의 발견 패턴에 걸리지 않도록 파일명을 setup-test-db.js 로 둔다
// (*.test.js / *-test.* / *_test.* / test-*.* / test.* 중 어느 것에도 해당하지 않음).
// 개발 DB(.env 의 DATABASE_URL)에는 접속하지 않는다 — 문자열 파싱에만 쓴다.
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg'); // Pool 이 아니라 Client — 접속 대상을 두 번(유지보수용/작업용) 바꾼다

const DOCS = path.join(__dirname, '..', '..', 'docs'); // D:\work\ClubHome\docs

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL 미설정. backend/.env 를 먼저 채우라.');

  const url = new URL(raw);
  const devName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const testName = devName.endsWith('_test') ? devName : `${devName}_test`;
  // 식별자는 파라미터 바인딩이 불가하므로 화이트리스트 검증 후에만 문자열에 넣는다.
  if (!/^[a-z0-9_]+$/.test(testName)) throw new Error(`테스트 DB 이름이 부적절하다: ${testName}`);

  const testUrl = new URL(raw); testUrl.pathname = `/${testName}`;
  const adminUrl = new URL(raw); adminUrl.pathname = '/postgres'; // 유지보수 접속 대상(개발 DB 아님)

  // 1) DB 생성(없을 때만) — CREATE DATABASE 는 트랜잭션 안에서 실행할 수 없다
  const admin = new Client({ connectionString: adminUrl.href });
  await admin.connect();
  try {
    const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [testName]);
    if (rows.length === 0) {
      try {
        await admin.query(`CREATE DATABASE "${testName}"`);
        console.log(`생성: ${testName}`);
      } catch (createError) {
        if (createError.code === '42501') {
          throw new Error(
            '테스트 DB 생성 권한이 없다. 이미 만들어진 DB 이름을 backend/.env.test 의 ' +
            `DATABASE_URL 에 직접 적으라. 원본 에러: ${createError.message}`,
          );
        }
        throw createError;
      }
    } else {
      console.log(`이미 존재: ${testName}`);
    }
  } finally {
    await admin.end();
  }

  // 2) 스키마(테이블이 없을 때만 — schema.sql 은 CREATE TABLE 이라 재실행 불가)
  const db = new Client({ connectionString: testUrl.href });
  await db.connect();
  try {
    const { rows: reg } = await db.query("SELECT to_regclass('public.reservations') AS t");
    if (reg[0].t === null) {
      await db.query(fs.readFileSync(path.join(DOCS, 'schema.sql'), 'utf8'));
      console.log('적용: docs/schema.sql');
    } else {
      console.log('건너뜀: docs/schema.sql (이미 적용됨)');
    }

    // 3) 시드(seed-dev.sql 자체가 NOT EXISTS 가드 + ON CONFLICT 로 멱등)
    await db.query(fs.readFileSync(path.join(DOCS, 'seed-dev.sql'), 'utf8'));

    // 4) 시드 전제 검증 — 기존 224건이 하드코딩 단정하는 최소 조건을 여기서 먼저 깬다
    const { rows: [c] } = await db.query(`
      SELECT (SELECT count(*) FROM member_grades)                      AS grades,
             (SELECT count(*) FROM boards)                             AS boards,
             (SELECT count(*) FROM boards WHERE is_active = FALSE)      AS inactive_boards,
             (SELECT count(*) FROM practice_rooms WHERE is_active)      AS active_rooms,
             (SELECT count(*) FROM practice_rooms WHERE NOT is_active)  AS inactive_rooms,
             (SELECT count(*) FROM members)                            AS members`);
    console.log(c);
    for (const [키, 기대] of [
      ['grades', 3], ['boards', 4], ['inactive_boards', 1],
      ['active_rooms', 1], ['inactive_rooms', 1], ['members', 4],
    ]) {
      if (Number(c[키]) < 기대) {
        throw new Error(
          `시드 전제 미달: ${키}=${c[키]} (최소 ${기대}). 테스트 DB가 부분 적용 상태일 수 있다. ` +
          `DROP DATABASE ${testName}; 후 다시 실행하라.`,
        );
      }
    }
  } finally {
    await db.end();
  }

  // 5) .env.test(없을 때만 생성 — 있으면 손대지 않는다)
  const envTest = path.join(__dirname, '..', '.env.test');
  if (!fs.existsSync(envTest)) {
    fs.writeFileSync(
      envTest,
      '# BE-11: 테스트 전용 DB. npm test 가 --env-file-if-exists 로 읽는다. git 미포함.\n' +
      `DATABASE_URL=${testUrl.href}\n`,
    );
    console.log('생성: backend/.env.test');
  } else {
    console.log('이미 존재: backend/.env.test (그대로 사용)');
  }
  console.log('완료. 이제 npm test 를 실행하라.');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
