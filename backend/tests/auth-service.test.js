'use strict';

require('dotenv').config();

// BE-11 (#22) — 원칙 §4 "service 레이어 단위" 요구를 충족하는 파일 계열이다.
// 이 파일은 HTTP를 거치지 않는다(서버·fetch·bearer 헤더 없음). 픽스처 회원도
// authService.signup을 직접 호출해 만든다.
//
// 위 require('dotenv').config()가 src/** require보다 **먼저** 와야 한다 —
// src/utils/jwt.js:19-22가 모듈 로드 즉시 환경변수 4개를 fail-fast로 읽는다.
//
// 접두사: be11a- (reservation-service.test.js는 be11r-). 두 파일이 접두사를 공유하면 안 된다 —
// node --test는 파일을 별도 프로세스로 병렬 실행하므로 서로의 before 정리가 상대 픽스처를 지운다.
// 기존 점유: be03- be04- be06- be07- be08- be09- be10-.
//
// 이 파일은 reservations를 만들지 않으므로 날짜 센티널을 점유하지 않는다
// (센티널 점유 현황은 tests/reservation-service.test.js 헤더 주석 참조).
//
// 대상 DB: DATABASE_URL의 DB 이름이 _test로 끝나야 한다(완료조건 ③). npm run test:db 참조.

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const authService = require('../src/services/auth-service');
const { verifyAccessToken, verifyRefreshToken } = require('../src/utils/jwt');
const { pool, query } = require('../src/db/pool');

// ── 상수 ────────────────────────────────────────────────────────────────────

/** 이 파일이 만드는 모든 회원 이메일의 접두사. 생성과 정리가 이 상수 하나만 쓴다. */
const PREFIX = 'be11a-';

/** docs/seed-dev.sql 계정 비밀번호. 픽스처 회원 가입에도 그대로 쓴다. */
const 비밀번호 = 'Test1234!';

/** swagger Member 프로퍼티 8개(정렬본). passwordHash는 절대 포함되지 않는다. */
const 회원키 = [
  'accountStatus',
  'email',
  'id',
  'joinedAt',
  'memberGrade',
  'memberGradeId',
  'name',
  'phone',
];

/** 접두사 규약을 지키는 유일한 이메일 생성기. */
let 이메일순번 = 0;
const 새이메일 = (구분) => `${PREFIX}${구분}-${Date.now()}-${(이메일순번 += 1)}@example.test`;

/** 픽스처 정리. 이 파일은 members만 만든다(reservations·posts를 만들지 않는다). */
async function 정리() {
  await query('DELETE FROM members WHERE email LIKE $1', [`${PREFIX}%`]);
}

// ── 공유 픽스처 ─────────────────────────────────────────────────────────────
let 가입; // authService.signup이 반환한 Member(8키)

test.before(async () => {
  // 개발 DB 실행 차단 가드(완료조건 ③). 정리()보다 반드시 앞에 둔다 —
  // 픽스처 생성 전에 죽어야 개발 DB가 조용히 오염되는 경로가 사라진다.
  const dbName = new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '');
  assert.ok(
    dbName.endsWith('_test'),
    `테스트는 별도 테스트 DB에서만 실행한다(완료조건 ③). 현재 대상=${dbName}. ` +
      '`npm run test:db` 를 먼저 실행하고 npm test 로 실행하라.',
  );

  // 선행 정리: 이전 실행이 중간에 죽었으면 email UNIQUE로 아래 가입이 터진다.
  // 행이 없으면 무연산이다.
  await 정리();

  가입 = await authService.signup({
    name: '테스트인증',
    email: 새이메일('login'),
    password: 비밀번호,
    phone: '010-0000-0011',
  });
  assert.ok(Number.isInteger(가입.id), '픽스처 회원 생성 실패');
});

test.after(async () => {
  await 정리();
  await pool.end();
});

// ── A. 인증 — 발급·재발급·만료 거부 (원칙 §4 "인증/인가") ────────────────────

test('A-1 로그인 성공이 토큰 2종과 회원을 반환한다', async () => {
  // login은 **객체 인자 1개**이며 키는 email·password다.
  const 결과 = await authService.login({ email: 가입.email, password: 비밀번호 });

  assert.deepEqual(Object.keys(결과).sort(), ['accessToken', 'member', 'refreshToken']);
  assert.equal(typeof 결과.accessToken, 'string');
  assert.equal(typeof 결과.refreshToken, 'string');
  assert.notEqual(결과.accessToken, 결과.refreshToken, '두 토큰은 서로 다른 값이다');

  // Access Token에는 등급·관리자 여부가 실린다.
  const access = verifyAccessToken(결과.accessToken);
  assert.equal(access.memberId, 가입.id);
  assert.equal(access.gradeLevel, 10, '신규 가입은 최저 등급(10)이다');
  assert.equal(access.isAdmin, false);
  assert.equal(access.typ, 'access');

  // Refresh Token에는 회원ID만 실린다 — 등급을 싣지 않는 것이 스펙이다(jwt.js:34-38).
  const refresh = verifyRefreshToken(결과.refreshToken);
  assert.equal(refresh.memberId, 가입.id);
  assert.equal(refresh.typ, 'refresh');
  assert.equal(refresh.gradeLevel, undefined, 'Refresh Token에 등급을 싣지 않는다');

  assert.deepEqual(Object.keys(결과.member).sort(), 회원키);
  assert.equal(결과.member.id, 가입.id);
  assert.equal(결과.member.email, 가입.email);
  assert.equal(결과.member.accountStatus, 'active');
  assert.equal(결과.member.memberGrade.gradeLevel, 10);
  assert.equal(결과.member.memberGrade.isAdmin, false);
  assert.equal('passwordHash' in 결과.member, false, '응답에 비밀번호 해시가 새면 안 된다');
});

test('A-2 Refresh Token으로 Access Token이 재발급된다', async () => {
  const 로그인 = await authService.login({ email: 가입.email, password: 비밀번호 });

  // refreshAccessToken은 **문자열 위치인자 1개**다. 객체({ refreshToken })를 넘기면 안 된다.
  const 결과 = await authService.refreshAccessToken(로그인.refreshToken);

  assert.deepEqual(Object.keys(결과).sort(), ['accessToken'], 'Refresh Token은 재발급하지 않는다');
  const access = verifyAccessToken(결과.accessToken);
  assert.equal(access.memberId, 가입.id);
  assert.equal(access.gradeLevel, 10, '등급은 DB에서 재조회한 최신 값이다');
  assert.equal(access.isAdmin, false);
  assert.equal(access.typ, 'access');
});

test('A-3 만료된 Refresh Token은 거부된다', async () => {
  // signRefreshToken으로는 만료 토큰을 만들 수 없다(유효기간이 모듈 로드 시 상수로 고정).
  // 그래서 jsonwebtoken으로 직접 서명하며, **typ:'refresh'가 필수**다 —
  // 누락하면 TOKEN_EXPIRED가 아니라 UNAUTHORIZED가 되어 이 케이스가 의미를 잃는다.
  const 만료토큰 = jwt.sign(
    { memberId: 가입.id, typ: 'refresh' },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '-1s' },
  );

  await assert.rejects(
    () => authService.refreshAccessToken(만료토큰),
    (error) => {
      assert.equal(error.status, 401, '만료: status');
      assert.equal(error.code, 'TOKEN_EXPIRED', '만료: code');
      assert.equal(error.message, '토큰이 만료되었습니다.', '만료: message');
      return true;
    },
  );

  // typ 누락 토큰은 유효기간이 남아 있어도 거부되며 **code가 다르다**.
  // 이 대조가 위 만료 단정이 우연히 초록불이 되는 경로를 막는다.
  const typ누락토큰 = jwt.sign({ memberId: 가입.id }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: '1h',
  });

  await assert.rejects(
    () => authService.refreshAccessToken(typ누락토큰),
    (error) => {
      assert.equal(error.status, 401, 'typ 누락: status');
      assert.equal(error.code, 'UNAUTHORIZED', 'typ 누락: code (TOKEN_EXPIRED가 아니다)');
      assert.equal(error.message, '유효하지 않은 토큰입니다.', 'typ 누락: message');
      return true;
    },
  );
});
