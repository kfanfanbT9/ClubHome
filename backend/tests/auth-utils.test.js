'use strict';

require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const jwt = require('jsonwebtoken');

const {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} = require('../src/utils/jwt');
const { hashPassword, verifyPassword } = require('../src/utils/password');

/** 401 UNAUTHORIZED AppError 검증 함수 */
const isUnauthorized = (error) => error.status === 401 && error.code === 'UNAUTHORIZED';

const 회원 = { id: 7, gradeLevel: 3, isAdmin: false };

test('signAccessToken → verifyAccessToken 왕복', () => {
  const payload = verifyAccessToken(signAccessToken(회원));
  assert.equal(payload.memberId, 회원.id);
  assert.equal(payload.gradeLevel, 회원.gradeLevel);
  assert.equal(payload.isAdmin, 회원.isAdmin);
  assert.equal(payload.typ, 'access');
});

test('signRefreshToken → verifyRefreshToken 왕복', () => {
  const payload = verifyRefreshToken(signRefreshToken({ id: 회원.id }));
  assert.equal(payload.memberId, 회원.id);
  assert.equal(payload.gradeLevel, undefined, 'Refresh에는 등급을 싣지 않는다');
  assert.equal(payload.isAdmin, undefined, 'Refresh에는 관리자 여부를 싣지 않는다');
  assert.equal(payload.typ, 'refresh');
});

test('Refresh 토큰을 verifyAccessToken에 투입', () => {
  const refreshToken = signRefreshToken({ id: 회원.id });
  assert.throws(() => verifyAccessToken(refreshToken), isUnauthorized);
});

test("Access 시크릿으로 서명한 typ:'refresh' payload를 verifyAccessToken에 투입", () => {
  // 두 시크릿에 같은 값을 넣는 실수를 재현 — typ 클레임 검사가 걸러야 한다.
  const token = jwt.sign({ memberId: 회원.id, typ: 'refresh' }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: '1h',
  });
  assert.throws(() => verifyAccessToken(token), isUnauthorized);
});

test('만료 토큰', () => {
  const token = jwt.sign(
    { memberId: 회원.id, gradeLevel: 회원.gradeLevel, isAdmin: 회원.isAdmin, typ: 'access' },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: '-1s' },
  );
  assert.throws(
    () => verifyAccessToken(token),
    (error) =>
      error.status === 401 &&
      error.code === 'TOKEN_EXPIRED' &&
      error.message === '토큰이 만료되었습니다.',
  );
});

test('위조 토큰(마지막 서명 문자 변조)', () => {
  const token = signAccessToken(회원);
  const 마지막 = token.slice(-1);
  const 위조 = token.slice(0, -1) + (마지막 === 'A' ? 'B' : 'A');
  assert.throws(() => verifyAccessToken(위조), isUnauthorized);
});

test('토큰 형식 아님', () => {
  for (const 잘못된값 of ['not.a.jwt', '']) {
    assert.throws(() => verifyAccessToken(잘못된값), isUnauthorized);
    assert.throws(() => verifyRefreshToken(잘못된값), isUnauthorized);
  }
});

test('시크릿 미설정 시 모듈 로드 실패', () => {
  const env = { ...process.env };
  for (const key of [
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'JWT_ACCESS_EXPIRES_IN',
    'JWT_REFRESH_EXPIRES_IN',
  ]) {
    delete env[key];
  }

  // dotenv를 호출하지 않는다 — .env를 다시 읽으면 미설정 상황이 재현되지 않는다.
  const 결과 = spawnSync(process.execPath, ['-e', "require('./src/utils/jwt')"], {
    cwd: path.join(__dirname, '..'),
    env,
    encoding: 'utf8',
  });

  assert.notEqual(결과.status, 0, '시크릿 없이 모듈이 로드되면 폴백 기본값이 있는 것이다');
  assert.match(결과.stderr, /JWT_ACCESS_SECRET/);
});

test('hashPassword 결과 형식', async () => {
  const 평문 = '색연필1234';
  const 해시1 = await hashPassword(평문);
  const 해시2 = await hashPassword(평문);

  assert.notEqual(해시1, 평문);
  assert.match(해시1, /^\$2[aby]\$/);
  assert.notEqual(해시1, 해시2, '같은 평문이라도 salt가 달라 해시가 달라야 한다');
});

test('verifyPassword 정답/오답', async () => {
  const 해시 = await hashPassword('색연필1234');
  assert.equal(await verifyPassword('색연필1234', 해시), true);
  assert.equal(await verifyPassword('색연필12345', 해시), false);
});

test('다른 salt로 만든 두 해시 모두 검증 통과', async () => {
  const 평문 = '색연필1234';
  const 해시1 = await hashPassword(평문);
  const 해시2 = await hashPassword(평문);

  assert.equal(await verifyPassword(평문, 해시1), true);
  assert.equal(await verifyPassword(평문, 해시2), true);
});
