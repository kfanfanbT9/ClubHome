'use strict';

require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const app = require('../src/app');
const { pool, query } = require('../src/db/pool');
const { signRefreshToken, verifyAccessToken } = require('../src/utils/jwt');
const { hashPassword, verifyPassword } = require('../src/utils/password');

// ── 상수 ────────────────────────────────────────────────────────────────────
// 테스트가 만드는 모든 회원 이메일의 접두사. 픽스처 생성과 정리 훅이 이 상수 하나만 쓴다
// (오타로 시드 계정을 지우는 사고를 막는 유일한 장치 — 계획서 §12-5).
const PREFIX = 'be03-';

// docs/seed-dev.sql 계정. 읽기 전용으로만 쓴다(UPDATE·DELETE 금지 — 계획서 §11-1).
const 시드비밀번호 = 'Test1234!';
const 시드주니어 = 'junior1@clubhome.local';
const 시드관리자 = 'admin@clubhome.local';

const 탈퇴이메일 = `${PREFIX}withdrawn@example.test`;

// ── 서버·HTTP 헬퍼 ──────────────────────────────────────────────────────────
// 36건마다 서버를 띄우면 느리므로 파일 전체가 포트 0으로 띄운 서버 1대를 공유한다.
let server;
let base;

/** Bearer 인증 헤더. */
const bearer = (토큰) => ({ Authorization: `Bearer ${토큰}` });

/**
 * POST 요청 1건. 본문이 undefined면 Content-Type과 body를 아예 붙이지 않는다
 * (A-11의 `req.body === undefined` 경로를 재현하기 위함).
 */
async function post(경로, 본문, 헤더 = {}) {
  const response = await fetch(`${base}${경로}`, {
    method: 'POST',
    headers: 본문 === undefined ? 헤더 : { 'Content-Type': 'application/json', ...헤더 },
    body: 본문 === undefined ? undefined : JSON.stringify(본문),
  });
  const text = await response.text();
  return { status: response.status, text, body: text ? JSON.parse(text) : null };
}

const 가입본문 = (email, 덮어쓰기 = {}) => ({
  name: '테스트회원',
  email,
  password: 'Test1234!',
  phone: '010-0000-0000',
  ...덮어쓰기,
});

/** 접두사 규약을 지키는 유일 이메일 생성기. */
const 새이메일 = (구분) => `${PREFIX}${구분}-${Date.now()}@example.test`;

/** 만료된 Access Token을 직접 서명한다. 시크릿은 환경변수에서만 읽는다. */
const 만료Access토큰 = ({ id, gradeLevel, isAdmin }) =>
  jwt.sign({ memberId: id, gradeLevel, isAdmin, typ: 'access' }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: '-1s',
  });

/** 만료된 Refresh Token을 직접 서명한다. */
const 만료Refresh토큰 = (id) =>
  jwt.sign({ memberId: id, typ: 'refresh' }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: '-1s',
  });

/** 서명 마지막 문자를 변조한다. */
const 위조 = (토큰) => 토큰.slice(0, -1) + (토큰.slice(-1) === 'A' ? 'B' : 'A');

// ── 공유 픽스처 ─────────────────────────────────────────────────────────────
// 선행 케이스의 산출물이 필요한 A-2~A-5, C-3 등을 위해 setup에서 한 번만 만든다.
let 최저등급; // { id, grade_level }
let 최상위등급; // { id, grade_level }
let 가입이메일; // A-1이 만든 이메일 (A-4·A-5가 재사용)
let 가입응답; // A-1 응답 { status, text, body }
let 탈퇴회원ID;
let 주니어세션; // 시드 junior1 로그인 결과 { accessToken, refreshToken, member }
let 등급변경회원; // C-3 전용 be03- 회원 Member

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const 등급들 = await query('SELECT id, grade_level FROM member_grades ORDER BY grade_level ASC');
  최저등급 = 등급들.rows[0];
  최상위등급 = 등급들.rows[등급들.rows.length - 1];

  // A-1: 정상 가입 1건. A-2·A-3·A-4·A-5가 이 결과를 공유한다.
  가입이메일 = 새이메일('signup');
  가입응답 = await post('/api/auth/signup', 가입본문(가입이메일));

  // 탈퇴 계정 픽스처. 시드에 withdrawn 회원이 없으므로 직접 INSERT한다.
  // 등급 ID는 하드코딩하지 않고 조회값을 쓴다.
  const 삽입 = await query(
    `INSERT INTO members (email, password_hash, name, phone, member_grade_id, account_status)
     VALUES ($1, $2, $3, $4, $5, 'withdrawn')
     RETURNING id`,
    [탈퇴이메일, await hashPassword(시드비밀번호), '탈퇴회원', '010-0000-0001', 최저등급.id],
  );
  탈퇴회원ID = 삽입.rows[0].id;

  // 시드 junior1 로그인 1회. B·C·D의 토큰 원천으로 공유한다(rotation이 없어 재사용 가능).
  주니어세션 = (await post('/api/auth/login', { email: 시드주니어, password: 시드비밀번호 })).body;

  // C-3 전용 회원. 등급 UPDATE 대상이므로 반드시 be03- 접두사 회원이어야 한다.
  등급변경회원 = (await post('/api/auth/signup', 가입본문(새이메일('grade')))).body;
});

// ── A. POST /api/auth/signup ────────────────────────────────────────────────

test('A-1 정상 가입은 201과 Member 형태를 반환한다', () => {
  assert.equal(가입응답.status, 201);
  const member = 가입응답.body;
  assert.ok(Number.isInteger(member.id));
  assert.equal(member.email, 가입이메일);
  assert.equal(member.name, '테스트회원');
  assert.equal(member.phone, '010-0000-0000');
  assert.equal(member.accountStatus, 'active');
  assert.equal(typeof member.joinedAt, 'string');
  assert.ok(!Number.isNaN(Date.parse(member.joinedAt)), 'joinedAt이 ISO 8601이어야 한다');
});

test('A-2 신규 가입에 최저 등급이 자동 부여된다', async () => {
  const { rows } = await query('SELECT MIN(grade_level) AS min FROM member_grades');
  const member = 가입응답.body;
  assert.equal(member.memberGrade.gradeLevel, Number(rows[0].min));
  assert.equal(member.memberGrade.name, '준회원');
  assert.equal(member.memberGradeId, member.memberGrade.id);
  assert.equal(typeof member.memberGrade.isAdmin, 'boolean');
});

test('A-3 비밀번호는 해시로 저장되고 응답에 포함되지 않는다', async () => {
  assert.ok(!가입응답.text.includes('Test1234!'), '응답에 평문 비밀번호가 없어야 한다');
  assert.ok(!가입응답.text.includes('$2'), '응답에 bcrypt 해시가 없어야 한다');
  assert.ok(!('password_hash' in 가입응답.body));
  assert.ok(!('passwordHash' in 가입응답.body));

  const { rows } = await query('SELECT password_hash FROM members WHERE email = $1', [가입이메일]);
  const hash = rows[0].password_hash;
  assert.notEqual(hash, 'Test1234!');
  assert.match(hash, /^\$2[aby]\$/);
  assert.equal(await verifyPassword('Test1234!', hash), true);
});

test('A-4 중복 이메일 가입은 409 EMAIL_DUPLICATE로 거부된다', async () => {
  const 재요청 = await post('/api/auth/signup', 가입본문(가입이메일));
  assert.equal(재요청.status, 409);
  assert.equal(재요청.body.code, 'EMAIL_DUPLICATE');

  const { rows } = await query('SELECT count(*)::int AS count FROM members WHERE email = $1', [
    가입이메일,
  ]);
  assert.equal(rows[0].count, 1, '중복 요청으로 행이 늘어나면 안 된다');
});

test('A-5 대소문자만 다른 중복 이메일도 409로 거부된다', async () => {
  const 응답 = await post('/api/auth/signup', 가입본문(가입이메일.toUpperCase()));
  assert.equal(응답.status, 409, '이메일 정규화가 빠지면 중복 계정이 생긴다');
  assert.equal(응답.body.code, 'EMAIL_DUPLICATE');
});

test('A-6 필수 필드 누락은 400 BAD_REQUEST로 거부된다', async () => {
  const 지시어 = { name: '이름', email: '이메일', password: '비밀번호', phone: '연락처' };
  for (const 필드 of Object.keys(지시어)) {
    const 본문 = 가입본문(새이메일('missing'));
    delete 본문[필드];
    const 응답 = await post('/api/auth/signup', 본문);
    assert.equal(응답.status, 400, `${필드} 누락: status`);
    assert.equal(응답.body.code, 'BAD_REQUEST', `${필드} 누락: code`);
    assert.ok(응답.body.message.includes(지시어[필드]), `${필드} 누락: message가 필드를 지시해야 한다`);
  }
});

test('A-7 이메일 형식 불량은 400으로 거부된다', async () => {
  for (const email of ['not-an-email', 'a@b', 'a b@c.d']) {
    const 응답 = await post('/api/auth/signup', 가입본문(email));
    assert.equal(응답.status, 400, `${email}: status`);
    assert.equal(응답.body.code, 'BAD_REQUEST', `${email}: code`);
  }
});

test('A-8 8자 미만 비밀번호는 400으로 거부된다', async () => {
  const 응답 = await post('/api/auth/signup', 가입본문(새이메일('shortpw'), { password: 'Test12!' }));
  assert.equal(응답.status, 400);
  assert.equal(응답.body.code, 'BAD_REQUEST');
  assert.ok(응답.body.message.includes('8자'), 'message에 "8자"가 포함되어야 한다');
});

test('A-9 길이 초과 필드는 500이 아니라 400으로 거부된다', async () => {
  const 초과들 = {
    'name 51자': { name: '가'.repeat(51) },
    'phone 21자': { phone: '0'.repeat(21) },
    'email 256자': { email: `${'a'.repeat(243)}@example.test` },
  };
  for (const [이름, 덮어쓰기] of Object.entries(초과들)) {
    const 응답 = await post('/api/auth/signup', 가입본문(새이메일('toolong'), 덮어쓰기));
    assert.equal(응답.status, 400, `${이름}: DB 22001이 500으로 새면 안 된다`);
    assert.equal(응답.body.code, 'BAD_REQUEST', `${이름}: code`);
  }
});

test('A-10 비문자열 타입 필드는 500이 아니라 400으로 거부된다', async () => {
  const 타입들 = [{ name: 123 }, { password: {} }, { email: null }, { phone: ['010'] }];
  for (const 덮어쓰기 of 타입들) {
    const 응답 = await post('/api/auth/signup', 가입본문(새이메일('badtype'), 덮어쓰기));
    assert.equal(응답.status, 400, `${JSON.stringify(덮어쓰기)}: status`);
    assert.equal(응답.body.code, 'BAD_REQUEST', `${JSON.stringify(덮어쓰기)}: code`);
  }
});

test('A-11 본문 없음과 빈 객체는 400으로 거부된다', async () => {
  const 본문없음 = await post('/api/auth/signup'); // Content-Type도 없음 → req.body undefined
  assert.equal(본문없음.status, 400, 'req.body undefined 가드');
  assert.equal(본문없음.body.code, 'BAD_REQUEST');

  const 빈객체 = await post('/api/auth/signup', {});
  assert.equal(빈객체.status, 400);
  assert.equal(빈객체.body.code, 'BAD_REQUEST');
});

test('A-12 회원가입은 인증 없이 호출할 수 있다', async () => {
  const 응답 = await post('/api/auth/signup', 가입본문(새이메일('noauth')));
  assert.equal(응답.status, 201, 'signup은 security: [] 이므로 401이 되면 안 된다');
});

// ── B. POST /api/auth/login ─────────────────────────────────────────────────

test('B-1 시드 계정 로그인은 200과 Access·Refresh Token을 함께 반환한다', async () => {
  const 응답 = await post('/api/auth/login', { email: 시드주니어, password: 시드비밀번호 });
  assert.equal(응답.status, 200);
  assert.equal(typeof 응답.body.accessToken, 'string');
  assert.ok(응답.body.accessToken.length > 0);
  assert.equal(typeof 응답.body.refreshToken, 'string');
  assert.ok(응답.body.refreshToken.length > 0);
  assert.equal(응답.body.member.email, 시드주니어);
  assert.equal(JSON.stringify(응답.body).includes('$2'), false, '응답에 해시가 없어야 한다');
});

test('B-2 로그인으로 발급된 Access Token은 보호 라우트를 통과한다', async () => {
  const payload = verifyAccessToken(주니어세션.accessToken);
  assert.equal(payload.memberId, 주니어세션.member.id);
  assert.equal(payload.gradeLevel, 주니어세션.member.memberGrade.gradeLevel);

  const 로그아웃 = await post('/api/auth/logout', undefined, bearer(주니어세션.accessToken));
  assert.equal(로그아웃.status, 204);
});

test('B-3 관리자 계정 로그인 시 isAdmin 클레임이 true다', async () => {
  const 응답 = await post('/api/auth/login', { email: 시드관리자, password: 시드비밀번호 });
  assert.equal(응답.status, 200);
  assert.equal(verifyAccessToken(응답.body.accessToken).isAdmin, true);
  assert.equal(응답.body.member.memberGrade.isAdmin, true);
});

test('B-4 비밀번호 불일치는 401 UNAUTHORIZED로 거부된다', async () => {
  const 응답 = await post('/api/auth/login', { email: 시드주니어, password: '틀린비밀번호1!' });
  assert.equal(응답.status, 401);
  assert.equal(응답.body.code, 'UNAUTHORIZED');
});

test('B-5 존재하지 않는 이메일은 비밀번호 불일치와 완전히 동일한 401을 반환한다', async () => {
  const 불일치 = await post('/api/auth/login', { email: 시드주니어, password: '틀린비밀번호1!' });
  const 미존재 = await post('/api/auth/login', {
    email: `${PREFIX}nobody@example.test`,
    password: '틀린비밀번호1!',
  });
  assert.equal(미존재.status, 401);
  assert.equal(미존재.status, 불일치.status, '계정 열거 방지: status가 같아야 한다');
  assert.deepEqual(미존재.body, 불일치.body, '계정 열거 방지: code·message가 같아야 한다');
});

test('B-6 탈퇴 계정에 정확한 비밀번호는 403 ACCOUNT_WITHDRAWN으로 거부된다', async () => {
  const 응답 = await post('/api/auth/login', { email: 탈퇴이메일, password: 시드비밀번호 });
  assert.equal(응답.status, 403);
  assert.equal(응답.body.code, 'ACCOUNT_WITHDRAWN');
});

test('B-7 탈퇴 계정에 틀린 비밀번호는 403이 아니라 401로 거부된다', async () => {
  const 응답 = await post('/api/auth/login', { email: 탈퇴이메일, password: '틀린비밀번호1!' });
  assert.equal(응답.status, 401, '상태 검사가 비밀번호 검증보다 앞서면 계정 열거가 된다');
  assert.equal(응답.body.code, 'UNAUTHORIZED');
});

test('B-8 로그인 자격 누락·빈값·비문자열은 모두 401로 거부된다', async () => {
  const 본문들 = [
    {},
    { email: 시드주니어 },
    { password: 시드비밀번호 },
    { email: '', password: '' },
    { email: 시드주니어, password: '' },
    { email: 123, password: 시드비밀번호 },
    { email: 시드주니어, password: null },
  ];
  for (const 본문 of 본문들) {
    const 응답 = await post('/api/auth/login', 본문);
    assert.equal(응답.status, 401, `${JSON.stringify(본문)}: 400·500이 아니라 401이어야 한다`);
    assert.equal(응답.body.code, 'UNAUTHORIZED', `${JSON.stringify(본문)}: code`);
  }
});

test('B-9 로그인은 인증 없이 호출할 수 있다', async () => {
  const 응답 = await post('/api/auth/login', { email: 시드주니어, password: 시드비밀번호 });
  assert.equal(응답.status, 200, 'login은 security: [] 이므로 401이 되면 안 된다');
});

// ── C. POST /api/auth/refresh ───────────────────────────────────────────────

test('C-1 유효 Refresh Token으로 Access Token이 재발급된다', async () => {
  const 응답 = await post('/api/auth/refresh', { refreshToken: 주니어세션.refreshToken });
  assert.equal(응답.status, 200);
  assert.deepEqual(Object.keys(응답.body), ['accessToken'], 'rotation 미도입: 응답 키는 1개뿐');
  assert.equal(verifyAccessToken(응답.body.accessToken).memberId, 주니어세션.member.id);
});

test('C-2 만료 Access Token과 유효 Refresh Token으로 재발급 후 보호 라우트를 통과한다', async () => {
  // 1) 만료 Access Token으로 보호 라우트 → 401 TOKEN_EXPIRED
  const 만료토큰 = 만료Access토큰({
    id: 주니어세션.member.id,
    gradeLevel: 주니어세션.member.memberGrade.gradeLevel,
    isAdmin: 주니어세션.member.memberGrade.isAdmin,
  });
  const 만료로그아웃 = await post('/api/auth/logout', undefined, bearer(만료토큰));
  assert.equal(만료로그아웃.status, 401);
  assert.equal(만료로그아웃.body.code, 'TOKEN_EXPIRED');

  // 2) 같은 세션의 Refresh Token으로 재발급 → 200 (refresh에 requireAuth가 없어야 성립)
  const 재발급 = await post('/api/auth/refresh', { refreshToken: 주니어세션.refreshToken });
  assert.equal(재발급.status, 200);

  // 3) 새 Access Token으로 보호 라우트 → 204
  const 재로그아웃 = await post('/api/auth/logout', undefined, bearer(재발급.body.accessToken));
  assert.equal(재로그아웃.status, 204);
});

test('C-3 재발급된 Access Token에 변경된 최신 등급이 반영된다', async () => {
  // be03- 접두사 회원에게만 UPDATE를 적용한다(시드 계정 보호).
  await query(`UPDATE members SET member_grade_id = $1 WHERE id = $2 AND email LIKE $3`, [
    최상위등급.id,
    등급변경회원.id,
    `${PREFIX}%`,
  ]);

  const 응답 = await post('/api/auth/refresh', {
    refreshToken: signRefreshToken({ id: 등급변경회원.id }),
  });
  assert.equal(응답.status, 200);
  assert.equal(
    verifyAccessToken(응답.body.accessToken).gradeLevel,
    최상위등급.grade_level,
    '재발급 시 등급을 재조회하지 않으면 낡은 등급이 재생산된다',
  );
});

test('C-4 만료 Refresh Token은 401 TOKEN_EXPIRED로 거부된다', async () => {
  const 응답 = await post('/api/auth/refresh', {
    refreshToken: 만료Refresh토큰(주니어세션.member.id),
  });
  assert.equal(응답.status, 401);
  assert.equal(응답.body.code, 'TOKEN_EXPIRED');
});

test('C-5 위조 Refresh Token은 401 UNAUTHORIZED로 거부된다', async () => {
  const 응답 = await post('/api/auth/refresh', { refreshToken: 위조(주니어세션.refreshToken) });
  assert.equal(응답.status, 401);
  assert.equal(응답.body.code, 'UNAUTHORIZED');
});

test('C-6 Access Token을 refreshToken 자리에 넣으면 401로 거부된다', async () => {
  const 응답 = await post('/api/auth/refresh', { refreshToken: 주니어세션.accessToken });
  assert.equal(응답.status, 401);
  assert.equal(응답.body.code, 'UNAUTHORIZED');
});

test('C-7 refreshToken 누락·빈값·비문자열·형식불량은 모두 401로 거부된다', async () => {
  const 본문들 = [
    {},
    { refreshToken: '' },
    { refreshToken: 123 },
    { refreshToken: null },
    { refreshToken: 'not.a.jwt' },
  ];
  for (const 본문 of 본문들) {
    const 응답 = await post('/api/auth/refresh', 본문);
    assert.equal(응답.status, 401, `${JSON.stringify(본문)}: 400·500이 아니라 401이어야 한다`);
    assert.equal(응답.body.code, 'UNAUTHORIZED', `${JSON.stringify(본문)}: code`);
  }
});

test('C-8 탈퇴 회원의 유효한 Refresh Token은 401로 거부된다', async () => {
  // 탈퇴 회원은 로그인할 수 없으므로 Refresh Token을 직접 발급해 투입한다.
  const 응답 = await post('/api/auth/refresh', {
    refreshToken: signRefreshToken({ id: 탈퇴회원ID }),
  });
  assert.equal(응답.status, 401, '재발급을 열어두면 탈퇴 회원이 로그인 상태를 유지한다');
  assert.equal(응답.body.code, 'UNAUTHORIZED');
});

test('C-9 존재하지 않는 회원 ID의 Refresh Token은 500이 아니라 401로 거부된다', async () => {
  const 응답 = await post('/api/auth/refresh', { refreshToken: signRefreshToken({ id: 999999999 }) });
  assert.equal(응답.status, 401);
  assert.equal(응답.body.code, 'UNAUTHORIZED');
});

test('C-10 토큰 재발급은 인증 없이 호출할 수 있다', async () => {
  const 응답 = await post('/api/auth/refresh', { refreshToken: 주니어세션.refreshToken });
  assert.equal(응답.status, 200, '/refresh에 requireAuth가 붙으면 완료조건 5가 불가능해진다');
});

// ── D. POST /api/auth/logout ────────────────────────────────────────────────

test('D-1 유효 Access Token으로 로그아웃하면 204와 빈 본문을 반환한다', async () => {
  const 응답 = await post('/api/auth/logout', undefined, bearer(주니어세션.accessToken));
  assert.equal(응답.status, 204);
  assert.equal(응답.text.length, 0);
});

test('D-2 Authorization 헤더 없는 로그아웃은 401이고 본문 키가 code·message 둘뿐이다', async () => {
  const 응답 = await post('/api/auth/logout');
  assert.equal(응답.status, 401);
  assert.deepEqual(Object.keys(응답.body).sort(), ['code', 'message']);
  assert.equal(응답.body.code, 'UNAUTHORIZED');
});

test('D-3 만료 Access Token 로그아웃은 401 TOKEN_EXPIRED로 거부된다', async () => {
  const 토큰 = 만료Access토큰({
    id: 주니어세션.member.id,
    gradeLevel: 주니어세션.member.memberGrade.gradeLevel,
    isAdmin: 주니어세션.member.memberGrade.isAdmin,
  });
  const 응답 = await post('/api/auth/logout', undefined, bearer(토큰));
  assert.equal(응답.status, 401);
  assert.equal(응답.body.code, 'TOKEN_EXPIRED');
});

test('D-4 위조 토큰·Basic 스킴·토큰 없는 Bearer는 모두 401로 거부된다', async () => {
  const 헤더들 = {
    위조토큰: bearer(위조(주니어세션.accessToken)),
    Basic스킴: { Authorization: 'Basic xxx' },
    토큰없는Bearer: { Authorization: 'Bearer' },
  };
  for (const [이름, 헤더] of Object.entries(헤더들)) {
    const 응답 = await post('/api/auth/logout', undefined, 헤더);
    assert.equal(응답.status, 401, `${이름}: status`);
    assert.equal(응답.body.code, 'UNAUTHORIZED', `${이름}: code`);
  }
});

test('D-5 로그아웃 후 같은 토큰 재사용도 204다(무상태 설계상 의도된 동작)', async () => {
  // ERD §4: 서버 측 토큰 저장소가 없으므로 로그아웃이 토큰을 폐기하지 않는다.
  // 이 204는 버그가 아니라 명시적으로 포기된 설계의 결과다.
  const 첫번째 = await post('/api/auth/logout', undefined, bearer(주니어세션.accessToken));
  assert.equal(첫번째.status, 204);
  const 두번째 = await post('/api/auth/logout', undefined, bearer(주니어세션.accessToken));
  assert.equal(두번째.status, 204);
});

// ── 정리 ────────────────────────────────────────────────────────────────────

test.after(async () => {
  // 접두사가 붙은 테스트 회원만 삭제한다. 시드 계정 4개와 member_grades는 건드리지 않는다.
  // ILIKE인 이유: A-5가 대문자 이메일로 요청하므로, 정규화 버그로 행이 생기더라도 함께 지워진다.
  await query('DELETE FROM members WHERE email ILIKE $1', [`${PREFIX}%`]);
  await pool.end();
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});
