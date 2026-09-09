'use strict';

require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

const { signAccessToken, signRefreshToken } = require('../src/utils/jwt');
const { requireAuth } = require('../src/middlewares/auth');
const { errorHandler } = require('../src/middlewares/errorHandler');

/** 임시 포트로 앱을 띄우고 콜백에 base URL을 넘긴다. */
async function withServer(target, callback) {
  const server = target.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    return await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const 회원 = { id: 7, gradeLevel: 3, isAdmin: false };

/** 만료된 Access Token을 직접 서명해 만든다. */
function 만료Access토큰() {
  return jwt.sign(
    { memberId: 회원.id, gradeLevel: 회원.gradeLevel, isAdmin: 회원.isAdmin, typ: 'access' },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: '-1s' },
  );
}

/** 서명 마지막 문자를 변조한 Access Token. */
function 위조Access토큰() {
  const token = signAccessToken(회원);
  const 마지막 = token.slice(-1);
  return token.slice(0, -1) + (마지막 === 'A' ? 'B' : 'A');
}

/** 가짜 req와 next 스파이로 requireAuth를 직접 호출한다. */
function requireAuth호출(headers) {
  const req = { headers };
  const next호출들 = [];
  const next = (...args) => next호출들.push(args);
  requireAuth(req, {}, next);
  return { req, next호출들 };
}

/** requireAuth가 던진 오류를 잡아 돌려준다. */
function 던진오류(headers) {
  try {
    requireAuth호출(headers);
  } catch (error) {
    return error;
  }
  return null;
}

// 13~18의 실패 시나리오. 케이스 19가 이 목록의 status를 모아 검증한다.
const 실패시나리오 = {
  헤더없음: {},
  Basic스킴: { authorization: 'Basic abc' },
  스킴없이토큰만: { authorization: 'abc' },
  토큰없는Bearer: { authorization: 'Bearer' },
  만료토큰: () => ({ authorization: `Bearer ${만료Access토큰()}` }),
  위조토큰: () => ({ authorization: `Bearer ${위조Access토큰()}` }),
  Refresh토큰: () => ({ authorization: `Bearer ${signRefreshToken({ id: 회원.id })}` }),
};

/** 시나리오 값이 함수면 호출해 헤더를 만든다(토큰은 매번 새로 서명). */
const 헤더만들기 = (시나리오) => (typeof 시나리오 === 'function' ? 시나리오() : 시나리오);

test('유효 Access Token', () => {
  const { req, next호출들 } = requireAuth호출({
    authorization: `Bearer ${signAccessToken(회원)}`,
  });

  assert.equal(next호출들.length, 1, 'next()가 1회 호출되어야 한다');
  assert.deepEqual(next호출들[0], [], 'next()에 인자가 없어야 한다');
  assert.deepEqual(req.member, { id: 회원.id, gradeLevel: 회원.gradeLevel, isAdmin: 회원.isAdmin });
});

test('Authorization 헤더 없음', () => {
  const headers = 헤더만들기(실패시나리오.헤더없음);
  const req = { headers };
  assert.throws(
    () => requireAuth(req, {}, () => {}),
    (error) => error.status === 401 && error.code === 'UNAUTHORIZED',
  );
  assert.equal(req.member, undefined, '실패 시 req.member를 주입하지 않는다');
});

test('Basic abc / 토큰만(abc) / Bearer(토큰 없음)', () => {
  for (const 키 of ['Basic스킴', '스킴없이토큰만', '토큰없는Bearer']) {
    const 오류 = 던진오류(헤더만들기(실패시나리오[키]));
    assert.ok(오류, `${키}: 오류가 던져져야 한다`);
    assert.equal(오류.status, 401, `${키}: status`);
    assert.equal(오류.code, 'UNAUTHORIZED', `${키}: code`);
  }
});

test('소문자 스킴 bearer <token>', () => {
  const { req, next호출들 } = requireAuth호출({
    authorization: `bearer ${signAccessToken(회원)}`,
  });

  assert.equal(next호출들.length, 1);
  assert.equal(req.member.id, 회원.id);
});

test('만료 Access Token', () => {
  assert.throws(
    () => requireAuth호출(헤더만들기(실패시나리오.만료토큰)),
    (error) => error.status === 401 && error.code === 'TOKEN_EXPIRED',
  );
});

test('위조 Access Token', () => {
  assert.throws(
    () => requireAuth호출(헤더만들기(실패시나리오.위조토큰)),
    (error) => error.status === 401 && error.code === 'UNAUTHORIZED',
  );
});

test('Refresh Token으로 보호 라우트 접근', () => {
  assert.throws(
    () => requireAuth호출(헤더만들기(실패시나리오.Refresh토큰)),
    (error) => error.status === 401 && error.code === 'UNAUTHORIZED',
  );
});

test('미들웨어는 403을 만들지 않는다', () => {
  const status목록 = Object.entries(실패시나리오).map(([키, 시나리오]) => {
    const 오류 = 던진오류(헤더만들기(시나리오));
    assert.ok(오류, `${키}: 오류가 던져져야 한다`);
    return 오류.status;
  });

  assert.deepEqual(
    [...new Set(status목록)],
    [401],
    'requireAuth는 401만 던져야 한다(403은 service 책임)',
  );
});

test('통합: express + requireAuth + 유효 토큰', async () => {
  const target = express();
  target.get('/me', requireAuth, (req, res) => res.json({ memberId: req.member.id }));
  target.use(errorHandler);

  await withServer(target, async (base) => {
    const response = await fetch(`${base}/me`, {
      headers: { Authorization: `Bearer ${signAccessToken(회원)}` },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { memberId: 회원.id });
  });
});

test('통합: express + requireAuth + 만료 토큰 + errorHandler', async () => {
  const target = express();
  target.get('/me', requireAuth, (req, res) => res.json({ memberId: req.member.id }));
  target.use(errorHandler);

  await withServer(target, async (base) => {
    const response = await fetch(`${base}/me`, {
      headers: { Authorization: `Bearer ${만료Access토큰()}` },
    });
    assert.equal(response.status, 401);

    const body = await response.json();
    assert.deepEqual(Object.keys(body).sort(), ['code', 'message'], '본문 키는 2개뿐이어야 한다');
    assert.equal(body.code, 'TOKEN_EXPIRED');
    assert.equal(typeof body.message, 'string');
  });
});
