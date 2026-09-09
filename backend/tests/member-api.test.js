'use strict';

require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const app = require('../src/app');
const { pool, query } = require('../src/db/pool');
const { signAccessToken } = require('../src/utils/jwt');
const { hashPassword } = require('../src/utils/password');

// ── 상수 ────────────────────────────────────────────────────────────────────
// 이 파일이 만드는 모든 회원 이메일의 접두사. 픽스처 생성과 정리 훅이 이 상수 하나만 쓴다.
// PATCH 대상도 반드시 이 접두사 회원으로 한정한다 — 시드 계정을 수정하면
// IT-01 수동 검증 픽스처가 파괴되고 정리 훅으로도 되돌릴 수 없다(계획서 §8-1, §9 위험 10).
const PREFIX = 'be04-';

// docs/seed-dev.sql 계정. B-19에서 읽기 전용으로만 쓴다(UPDATE·DELETE 금지).
const 시드비밀번호 = 'Test1234!';
const 시드타인 = 'junior2@clubhome.local';
const 시드타인이름 = '박신입';
const 시드타인연락처 = '010-0000-0004';

// swagger Member / MemberGrade 스키마의 키 집합. A-5와 B-18이 이 상수를 공유한다.
const MEMBER_KEYS = [
  'accountStatus',
  'email',
  'id',
  'joinedAt',
  'memberGrade',
  'memberGradeId',
  'name',
  'phone',
];
const GRADE_KEYS = ['description', 'gradeLevel', 'id', 'isAdmin', 'name'];

// ── 서버·HTTP 헬퍼 ──────────────────────────────────────────────────────────
// 케이스마다 서버를 띄우면 느리므로 파일 전체가 포트 0으로 띄운 서버 1대를 공유한다.
let server;
let base;

/** Bearer 인증 헤더. */
const bearer = (토큰) => ({ Authorization: `Bearer ${토큰}` });

/**
 * HTTP 요청 1건. 메서드·본문·헤더를 인자로 받는 이 파일의 유일한 요청 통로다.
 * - 본문이 undefined면 Content-Type과 body를 아예 붙이지 않는다(`req.body === undefined` 경로 재현).
 * - 본문이 문자열이면 직렬화 없이 그대로 보낸다(B-8의 깨진 JSON 케이스).
 */
async function 요청(메서드, 경로, 본문, 헤더 = {}) {
  const 본문없음 = 본문 === undefined;
  const response = await fetch(`${base}${경로}`, {
    method: 메서드,
    headers: 본문없음 ? 헤더 : { 'Content-Type': 'application/json', ...헤더 },
    body: 본문없음 ? undefined : typeof 본문 === 'string' ? 본문 : JSON.stringify(본문),
  });
  const text = await response.text();
  return { status: response.status, text, body: text ? JSON.parse(text) : null };
}

/** 접두사 규약을 지키는 유일 이메일 생성기. */
const 새이메일 = (구분) => `${PREFIX}${구분}-${Date.now()}@example.test`;

/** 만료된 Access Token을 직접 서명한다. 시크릿은 환경변수에서만 읽는다. */
const 만료Access토큰 = ({ id, gradeLevel, isAdmin }) =>
  jwt.sign({ memberId: id, gradeLevel, isAdmin, typ: 'access' }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: '-1s',
  });

/** 서명 마지막 문자를 변조한다. */
const 위조 = (토큰) => 토큰.slice(0, -1) + (토큰.slice(-1) === 'A' ? 'B' : 'A');

/**
 * 회원 행을 DB에서 직접 읽는다. API 응답을 믿지 않고 실제 저장 상태를 단정하기 위한 통로다.
 * password_hash·joined_at까지 포함해 B-5의 불변 검사에 쓴다.
 */
async function 회원행(id) {
  const { rows } = await query(
    `SELECT id, email, name, phone, member_grade_id, account_status, password_hash, joined_at
       FROM members
      WHERE id = $1`,
    [id],
  );
  return rows[0];
}

/** 가입 → 로그인으로 be04- 회원 1명을 만들고 토큰과 Member를 돌려준다. */
async function 픽스처회원(구분) {
  const email = 새이메일(구분);
  const 가입본문 = {
    name: '테스트회원',
    email,
    password: 시드비밀번호,
    phone: '010-0000-0000',
  };
  const 가입 = await 요청('POST', '/api/auth/signup', 가입본문);
  assert.equal(가입.status, 201, `픽스처(${구분}) 가입 실패: ${가입.text}`);

  const 로그인 = await 요청('POST', '/api/auth/login', { email, password: 시드비밀번호 });
  assert.equal(로그인.status, 200, `픽스처(${구분}) 로그인 실패: ${로그인.text}`);

  return {
    email,
    이름: 가입본문.name,
    연락처: 가입본문.phone,
    accessToken: 로그인.body.accessToken,
    refreshToken: 로그인.body.refreshToken,
    member: 로그인.body.member,
  };
}

// ── 공유 픽스처 ─────────────────────────────────────────────────────────────
let 최저등급; // { id, grade_level, is_admin }
let 최상위등급; // B-5의 권한 상승 시도 값으로 쓴다
let 나; // be04-me: A·B 계열의 주 대상
let 타인; // be04-other: A-11·B-5의 대조군
let 탈퇴회원; // be04-withdrawn: A-12·B-20
let 시드타인스냅샷; // B-19: 시드 junior2의 요청 전 상태

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  // 등급 ID는 하드코딩하지 않고 조회한다.
  const 등급들 = await query(
    'SELECT id, grade_level, is_admin FROM member_grades ORDER BY grade_level ASC',
  );
  최저등급 = 등급들.rows[0];
  최상위등급 = 등급들.rows[등급들.rows.length - 1];

  나 = await 픽스처회원('me');
  타인 = await 픽스처회원('other');

  // 탈퇴 회원은 로그인할 수 없으므로(BE-03 403) 직접 INSERT하고 토큰을 직접 발급한다.
  const 삽입 = await query(
    `INSERT INTO members (email, password_hash, name, phone, member_grade_id, account_status)
     VALUES ($1, $2, $3, $4, $5, 'withdrawn')
     RETURNING id`,
    [새이메일('withdrawn'), await hashPassword(시드비밀번호), '탈퇴회원', '010-0000-0009', 최저등급.id],
  );
  탈퇴회원 = {
    id: 삽입.rows[0].id,
    accessToken: signAccessToken({
      id: 삽입.rows[0].id,
      gradeLevel: 최저등급.grade_level,
      isAdmin: 최저등급.is_admin,
    }),
  };

  // B-19 기준값. 시드 계정은 이 SELECT 외에 어떤 쿼리도 걸지 않는다.
  const { rows } = await query(
    'SELECT name, phone, email, member_grade_id, account_status FROM members WHERE email = $1',
    [시드타인],
  );
  시드타인스냅샷 = rows[0];
  assert.ok(시드타인스냅샷, `시드 계정 ${시드타인}이 필요하다(docs/seed-dev.sql 적용 여부 확인)`);
});

// ── A. GET /api/members/me ──────────────────────────────────────────────────

test('A-1 유효 토큰으로 본인 정보를 조회한다', async () => {
  const 응답 = await 요청('GET', '/api/members/me', undefined, bearer(나.accessToken));
  assert.equal(응답.status, 200);
  assert.ok(Number.isInteger(응답.body.id));
  assert.equal(응답.body.id, 나.member.id);
  assert.equal(응답.body.email, 나.email);
  assert.equal(응답.body.name, 나.이름);
  assert.equal(응답.body.phone, 나.연락처);
});

test('A-2 등급 정보가 조인되어 포함된다', async () => {
  const 응답 = await 요청('GET', '/api/members/me', undefined, bearer(나.accessToken));
  const { memberGrade } = 응답.body;
  assert.equal(typeof memberGrade, 'object');
  assert.ok(memberGrade !== null);
  assert.equal(typeof memberGrade.name, 'string');
  assert.ok(memberGrade.name.length > 0, '등급명이 비어있으면 조인이 빠진 것이다');
  assert.equal(응답.body.memberGradeId, memberGrade.id);
  assert.equal(typeof memberGrade.gradeLevel, 'number');
  assert.equal(typeof memberGrade.isAdmin, 'boolean');
});

test('A-3 가입일이 ISO 8601 문자열로 포함된다', async () => {
  const 응답 = await 요청('GET', '/api/members/me', undefined, bearer(나.accessToken));
  assert.equal(typeof 응답.body.joinedAt, 'string');
  assert.ok(!Number.isNaN(Date.parse(응답.body.joinedAt)), 'joinedAt이 파싱 가능해야 한다');
});

test('A-4 password_hash는 응답에 포함되지 않는다', async () => {
  const 응답 = await 요청('GET', '/api/members/me', undefined, bearer(나.accessToken));
  assert.ok(!응답.text.includes('$2'), '응답 원문에 bcrypt 해시가 없어야 한다');
  assert.ok(!응답.text.includes(시드비밀번호), '응답 원문에 평문 비밀번호가 없어야 한다');
  for (const 키 of ['password', 'passwordHash', 'password_hash']) {
    assert.ok(!(키 in 응답.body), `${키} 키가 없어야 한다`);
  }
});

test('A-5 응답 키 집합이 swagger Member와 정확히 일치한다', async () => {
  const 응답 = await 요청('GET', '/api/members/me', undefined, bearer(나.accessToken));
  assert.deepEqual(Object.keys(응답.body).sort(), MEMBER_KEYS, 'Member는 정확히 8개 키다');
  assert.deepEqual(Object.keys(응답.body.memberGrade).sort(), GRADE_KEYS);
  // §7-2 결정 고정: accountStatus는 응답에 포함한다.
  assert.equal(응답.body.accountStatus, 'active');
});

test('A-6 Authorization 헤더 없는 조회는 401이고 본문 키가 code·message 둘뿐이다', async () => {
  const 응답 = await 요청('GET', '/api/members/me');
  assert.equal(응답.status, 401);
  assert.deepEqual(Object.keys(응답.body).sort(), ['code', 'message']);
  assert.equal(응답.body.code, 'UNAUTHORIZED');
});

test('A-7 만료 Access Token 조회는 401 TOKEN_EXPIRED로 거부된다', async () => {
  const 토큰 = 만료Access토큰({
    id: 나.member.id,
    gradeLevel: 나.member.memberGrade.gradeLevel,
    isAdmin: 나.member.memberGrade.isAdmin,
  });
  const 응답 = await 요청('GET', '/api/members/me', undefined, bearer(토큰));
  assert.equal(응답.status, 401);
  assert.equal(응답.body.code, 'TOKEN_EXPIRED');
});

test('A-8 위조·Basic·토큰 없는 Bearer는 401이고 소문자 bearer 스킴은 200이다', async () => {
  const 실패헤더들 = {
    위조토큰: bearer(위조(나.accessToken)),
    Basic스킴: { Authorization: 'Basic xxx' },
    토큰없는Bearer: { Authorization: 'Bearer' },
  };
  for (const [이름, 헤더] of Object.entries(실패헤더들)) {
    const 응답 = await 요청('GET', '/api/members/me', undefined, 헤더);
    assert.equal(응답.status, 401, `${이름}: status`);
    assert.equal(응답.body.code, 'UNAUTHORIZED', `${이름}: code`);
  }

  const 소문자 = await 요청('GET', '/api/members/me', undefined, {
    Authorization: `bearer ${나.accessToken}`,
  });
  assert.equal(소문자.status, 200, 'RFC 7235의 스킴은 대소문자를 구분하지 않는다');
});

test('A-9 Refresh Token을 Bearer로 투입하면 401로 거부된다', async () => {
  const 응답 = await 요청('GET', '/api/members/me', undefined, bearer(나.refreshToken));
  assert.equal(응답.status, 401);
  assert.equal(응답.body.code, 'UNAUTHORIZED');
});

test('A-10 존재하지 않는 회원 ID의 유효 토큰은 500이 아니라 401로 거부된다', async () => {
  const 토큰 = signAccessToken({
    id: 999999999,
    gradeLevel: 최저등급.grade_level,
    isAdmin: 최저등급.is_admin,
  });
  const 응답 = await 요청('GET', '/api/members/me', undefined, bearer(토큰));
  assert.equal(응답.status, 401, '회원 행 부재는 500이 아니라 401이어야 한다');
  assert.equal(응답.body.code, 'UNAUTHORIZED');
});

test('A-11 타인 정보에는 접근할 수 없고 쿼리 파라미터로도 우회되지 않는다', async () => {
  const 내응답 = await 요청('GET', '/api/members/me', undefined, bearer(나.accessToken));
  const 타인응답 = await 요청('GET', '/api/members/me', undefined, bearer(타인.accessToken));
  assert.equal(내응답.body.email, 나.email);
  assert.equal(타인응답.body.email, 타인.email);
  assert.notEqual(내응답.body.id, 타인응답.body.id);

  // §5-2 회귀 방어: controller가 req.query를 읽으면 여기서 타인 정보가 새어나온다.
  for (const 쿼리 of [`?id=${타인.member.id}`, `?memberId=${타인.member.id}`]) {
    const 응답 = await 요청('GET', `/api/members/me${쿼리}`, undefined, bearer(나.accessToken));
    assert.equal(응답.status, 200, `${쿼리}: status`);
    assert.equal(응답.body.id, 나.member.id, `${쿼리}: 자기 ID만 반환해야 한다`);
    assert.equal(응답.body.email, 나.email, `${쿼리}: 자기 이메일만 반환해야 한다`);
  }
});

test('A-12 탈퇴 회원 토큰으로도 본인 정보를 조회할 수 있다', async () => {
  // §5-3 결정 고정. 탈퇴 차단 정책으로 전환하려면 swagger에 403 추가가 선행되어야 한다.
  const 응답 = await 요청('GET', '/api/members/me', undefined, bearer(탈퇴회원.accessToken));
  assert.equal(응답.status, 200);
  assert.equal(응답.body.accountStatus, 'withdrawn');
});

// ── B. PATCH /api/members/me ────────────────────────────────────────────────

test('B-1 이름·연락처를 동시에 수정하면 저장되고 재조회에 반영된다', async () => {
  const 요청본문 = { name: '수정된이름', phone: '010-1111-1111' };
  const 응답 = await 요청('PATCH', '/api/members/me', 요청본문, bearer(나.accessToken));
  assert.equal(응답.status, 200);
  assert.equal(응답.body.name, 요청본문.name);
  assert.equal(응답.body.phone, 요청본문.phone);

  const 재조회 = await 요청('GET', '/api/members/me', undefined, bearer(나.accessToken));
  assert.equal(재조회.body.name, 요청본문.name);
  assert.equal(재조회.body.phone, 요청본문.phone);

  const 행 = await 회원행(나.member.id);
  assert.equal(행.name, 요청본문.name);
  assert.equal(행.phone, 요청본문.phone);
});

test('B-2 이름만 수정하면 연락처는 이전 값을 유지한다', async () => {
  const 이전 = await 회원행(나.member.id);
  const 응답 = await 요청('PATCH', '/api/members/me', { name: '이름만변경' }, bearer(나.accessToken));
  assert.equal(응답.status, 200);
  assert.equal(응답.body.name, '이름만변경');
  assert.equal(응답.body.phone, 이전.phone, 'SET 절에 없는 컬럼이 덮어써지면 안 된다');

  const 이후 = await 회원행(나.member.id);
  assert.equal(이후.phone, 이전.phone);
});

test('B-3 연락처만 수정하면 이름은 이전 값을 유지한다', async () => {
  // $n 번호를 상수로 고정한 구현은 이 케이스에서만 500이 된다(계획서 §9 위험 2).
  const 이전 = await 회원행(나.member.id);
  const 응답 = await 요청(
    'PATCH',
    '/api/members/me',
    { phone: '010-2222-2222' },
    bearer(나.accessToken),
  );
  assert.equal(응답.status, 200, '파라미터 번호 시프트로 500이 나면 안 된다');
  assert.equal(응답.body.phone, '010-2222-2222');
  assert.equal(응답.body.name, 이전.name);

  const 이후 = await 회원행(나.member.id);
  assert.equal(이후.name, 이전.name);
  assert.equal(이후.phone, '010-2222-2222');
});

test('B-4 email 변경 요청은 무시되고 허용 필드만 반영된다', async () => {
  const 이전 = await 회원행(나.member.id);
  const 응답 = await 요청(
    'PATCH',
    '/api/members/me',
    { name: '새이름', email: `${PREFIX}hack@example.test` },
    bearer(나.accessToken),
  );
  assert.equal(응답.status, 200, '화이트리스트 외 필드는 400이 아니라 무시다(§4-3)');
  assert.equal(응답.body.name, '새이름');
  assert.equal(응답.body.email, 이전.email, '이메일은 로그인 ID이므로 변경될 수 없다');

  const 이후 = await 회원행(나.member.id);
  assert.equal(이후.email, 이전.email);
  assert.equal(이후.name, '새이름');
});

test('B-5 권한 상승 시도 필드는 무시되고 DB가 불변이다', async () => {
  // 이 이슈의 최우선 케이스. {...body} 또는 Object.keys(body) 순회로 SET 절을 만들면
  // 등급·계정상태 상승과 SQL 식별자 주입이 동시에 성립한다(계획서 §9 위험 1).
  const 이전 = await 회원행(나.member.id);
  const 타인이전 = await 회원행(타인.member.id);

  const 응답 = await 요청(
    'PATCH',
    '/api/members/me',
    {
      name: '상승시도',
      memberGradeId: 최상위등급.id,
      accountStatus: 'active',
      id: 타인.member.id,
      password: 'zzzzzzzz',
      passwordHash: 'zzz',
      joinedAt: '2000-01-01',
    },
    bearer(나.accessToken),
  );
  assert.equal(응답.status, 200);
  assert.equal(응답.body.name, '상승시도');
  assert.equal(응답.body.id, 나.member.id, '본문의 id가 대상 선택에 쓰이면 안 된다');
  assert.equal(응답.body.memberGradeId, 이전.member_grade_id);

  const 이후 = await 회원행(나.member.id);
  assert.equal(이후.member_grade_id, 이전.member_grade_id, '등급이 변경되면 안 된다');
  assert.equal(이후.account_status, 이전.account_status, '계정상태가 변경되면 안 된다');
  assert.equal(이후.password_hash, 이전.password_hash, '비밀번호 해시가 변경되면 안 된다');
  assert.equal(
    new Date(이후.joined_at).getTime(),
    new Date(이전.joined_at).getTime(),
    '가입일이 변경되면 안 된다',
  );
  assert.equal(이후.email, 이전.email, '이메일이 변경되면 안 된다');

  // 본문 id로 지목된 타인 행은 어떤 컬럼도 바뀌지 않아야 한다.
  assert.deepEqual(await 회원행(타인.member.id), 타인이전, '타인 행이 수정되면 안 된다');
});

test('B-6 화이트리스트 외 필드만 담긴 요청은 400으로 거부된다', async () => {
  // §6-3: 이 400이 없으면 필드명 오타가 "저장 성공"으로 침묵한다.
  for (const 본문 of [{ email: 'a@b.c' }, { phoneNumber: '010-1111-2222' }]) {
    const 응답 = await 요청('PATCH', '/api/members/me', 본문, bearer(나.accessToken));
    assert.equal(응답.status, 400, `${JSON.stringify(본문)}: status`);
    assert.equal(응답.body.code, 'BAD_REQUEST', `${JSON.stringify(본문)}: code`);
    assert.equal(응답.body.message, '수정할 항목이 없습니다.');
  }
});

test('B-7 빈 객체 요청은 400 BAD_REQUEST로 거부된다', async () => {
  const 응답 = await 요청('PATCH', '/api/members/me', {}, bearer(나.accessToken));
  assert.equal(응답.status, 400);
  assert.equal(응답.body.code, 'BAD_REQUEST');
  assert.equal(응답.body.message, '수정할 항목이 없습니다.');
});

test('B-8 본문 없음·Content-Type 없음·깨진 JSON은 모두 500이 아니라 400이다', async () => {
  // 본문 없음: Content-Type도 붙지 않아 req.body가 undefined인 경로
  const 본문없음 = await 요청('PATCH', '/api/members/me', undefined, bearer(나.accessToken));
  assert.equal(본문없음.status, 400, 'req.body undefined 가드');
  assert.equal(본문없음.body.code, 'BAD_REQUEST');

  // Content-Type 없음: 헬퍼는 항상 Content-Type을 붙이므로 이 케이스만 직접 fetch한다.
  const response = await fetch(`${base}/api/members/me`, {
    method: 'PATCH',
    headers: bearer(나.accessToken),
    body: JSON.stringify({ name: '무시될이름' }),
  });
  assert.equal(response.status, 400, 'express.json이 파싱하지 않아 수정 항목 0건이다');
  assert.equal((await response.json()).code, 'BAD_REQUEST');

  const 깨진JSON = await 요청('PATCH', '/api/members/me', '{깨진 JSON', bearer(나.accessToken));
  assert.equal(깨진JSON.status, 400);
  assert.equal(깨진JSON.body.code, 'BAD_REQUEST');
});

test('B-9 name·phone에 null을 보내면 400으로 거부된다', async () => {
  const 기대메시지 = { name: '이름을 입력해 주세요.', phone: '연락처를 입력해 주세요.' };
  for (const 필드 of ['name', 'phone']) {
    const 응답 = await 요청('PATCH', '/api/members/me', { [필드]: null }, bearer(나.accessToken));
    assert.equal(응답.status, 400, `${필드}: null은 "변경 없음"이 아니라 400이다(§6-1)`);
    assert.equal(응답.body.code, 'BAD_REQUEST', `${필드}: code`);
    assert.equal(응답.body.message, 기대메시지[필드], `${필드}: message`);
  }
});

test('B-10 빈 문자열·공백만인 값은 400으로 거부된다', async () => {
  const 본문들 = [{ name: '' }, { name: '   ' }, { phone: '' }, { phone: '  ' }];
  for (const 본문 of 본문들) {
    const 응답 = await 요청('PATCH', '/api/members/me', 본문, bearer(나.accessToken));
    assert.equal(응답.status, 400, `${JSON.stringify(본문)}: status`);
    assert.equal(응답.body.code, 'BAD_REQUEST', `${JSON.stringify(본문)}: code`);
  }
});

test('B-11 비문자열 값은 500이 아니라 400으로 거부된다', async () => {
  const 본문들 = [{ name: 123 }, { name: [] }, { phone: {} }, { phone: true }];
  for (const 본문 of 본문들) {
    const 응답 = await 요청('PATCH', '/api/members/me', 본문, bearer(나.accessToken));
    assert.equal(응답.status, 400, `${JSON.stringify(본문)}: status`);
    assert.equal(응답.body.code, 'BAD_REQUEST', `${JSON.stringify(본문)}: code`);
  }
});

test('B-12 길이 초과 값은 500이 아니라 400으로 거부된다', async () => {
  // 상한 검사가 없으면 PostgreSQL 22001이 500으로 새어나간다(swagger에 500 미정의).
  const 초과들 = {
    'name 51자': { 본문: { name: '가'.repeat(51) }, 메시지: '이름은 50자 이하여야 합니다.' },
    'phone 21자': { 본문: { phone: '0'.repeat(21) }, 메시지: '연락처는 20자 이하여야 합니다.' },
  };
  for (const [이름, { 본문, 메시지 }] of Object.entries(초과들)) {
    const 응답 = await 요청('PATCH', '/api/members/me', 본문, bearer(나.accessToken));
    assert.equal(응답.status, 400, `${이름}: DB 22001이 500으로 새면 안 된다`);
    assert.equal(응답.body.code, 'BAD_REQUEST', `${이름}: code`);
    assert.equal(응답.body.message, 메시지, `${이름}: message`);
  }
});

test('B-13 경계값 name 50자·phone 20자는 200으로 저장된다', async () => {
  const 본문 = { name: '가'.repeat(50), phone: '0'.repeat(20) };
  const 응답 = await 요청('PATCH', '/api/members/me', 본문, bearer(나.accessToken));
  assert.equal(응답.status, 200, '경계값은 허용이다(50자 이하 / 20자 이하)');
  assert.equal(응답.body.name.length, 50);
  assert.equal(응답.body.phone.length, 20);

  const 행 = await 회원행(나.member.id);
  assert.equal(행.name.length, 50);
  assert.equal(행.phone.length, 20);
});

test('B-14 앞뒤 공백은 trim되어 저장된다', async () => {
  const 응답 = await 요청(
    'PATCH',
    '/api/members/me',
    { name: '  새이름  ' },
    bearer(나.accessToken),
  );
  assert.equal(응답.status, 200);
  assert.equal(응답.body.name, '새이름');

  const 행 = await 회원행(나.member.id);
  assert.equal(행.name, '새이름', 'trim 전 값이 저장되면 안 된다');
});

test('B-15 Authorization 헤더 없는 수정은 401이고 DB가 변경되지 않는다', async () => {
  const 이전 = await 회원행(나.member.id);
  const 응답 = await 요청('PATCH', '/api/members/me', { name: '미인증수정', phone: '010-9999-9999' });
  assert.equal(응답.status, 401);
  assert.equal(응답.body.code, 'UNAUTHORIZED');

  const 이후 = await 회원행(나.member.id);
  assert.equal(이후.name, 이전.name, '미인증 요청으로 이름이 바뀌면 안 된다');
  assert.equal(이후.phone, 이전.phone, '미인증 요청으로 연락처가 바뀌면 안 된다');
});

test('B-16 만료·위조·Refresh Token 수정은 401이고 DB가 변경되지 않는다', async () => {
  const 이전 = await 회원행(나.member.id);
  const 토큰들 = {
    만료: 만료Access토큰({
      id: 나.member.id,
      gradeLevel: 나.member.memberGrade.gradeLevel,
      isAdmin: 나.member.memberGrade.isAdmin,
    }),
    위조: 위조(나.accessToken),
    Refresh: 나.refreshToken,
  };
  for (const [이름, 토큰] of Object.entries(토큰들)) {
    const 응답 = await 요청(
      'PATCH',
      '/api/members/me',
      { name: `${이름}수정`, phone: '010-8888-8888' },
      bearer(토큰),
    );
    assert.equal(응답.status, 401, `${이름}: status`);
    assert.equal(응답.body.code, 이름 === '만료' ? 'TOKEN_EXPIRED' : 'UNAUTHORIZED', `${이름}: code`);

    const 이후 = await 회원행(나.member.id);
    assert.equal(이후.name, 이전.name, `${이름}: 이름이 바뀌면 안 된다`);
    assert.equal(이후.phone, 이전.phone, `${이름}: 연락처가 바뀌면 안 된다`);
  }
});

test('B-17 존재하지 않는 회원 ID의 유효 토큰 수정은 500이 아니라 401이다', async () => {
  const 토큰 = signAccessToken({
    id: 999999999,
    gradeLevel: 최저등급.grade_level,
    isAdmin: 최저등급.is_admin,
  });
  const 응답 = await 요청('PATCH', '/api/members/me', { name: '유령' }, bearer(토큰));
  assert.equal(응답.status, 401, 'rowCount 0 분기가 500으로 새면 안 된다');
  assert.equal(응답.body.code, 'UNAUTHORIZED');
});

test('B-18 PATCH 응답은 GET과 동일한 Member 스키마다', async () => {
  const 응답 = await 요청('PATCH', '/api/members/me', { name: '스키마확인' }, bearer(나.accessToken));
  assert.equal(응답.status, 200);
  assert.deepEqual(Object.keys(응답.body).sort(), MEMBER_KEYS, '{message} 래퍼를 씌우면 안 된다');
  assert.deepEqual(Object.keys(응답.body.memberGrade).sort(), GRADE_KEYS);
  assert.ok(!응답.text.includes('$2'), '응답 원문에 bcrypt 해시가 없어야 한다');
});

test('B-19 앞선 수정으로 타 회원(시드) 데이터가 변경되지 않았다', async () => {
  // 시드 계정은 IT-01 수동 검증 픽스처다. 여기서 UPDATE·DELETE를 걸지 않고 읽기만 한다.
  const { rows } = await query(
    'SELECT name, phone, email, member_grade_id, account_status FROM members WHERE email = $1',
    [시드타인],
  );
  assert.deepEqual(rows[0], 시드타인스냅샷, '시드 회원 행이 그대로여야 한다');
  assert.equal(rows[0].name, 시드타인이름, 'seed-dev.sql의 이름이어야 한다');
  assert.equal(rows[0].phone, 시드타인연락처, 'seed-dev.sql의 연락처여야 한다');
  assert.equal(rows[0].account_status, 'active');
});

test('B-20 탈퇴 회원 토큰으로도 이름을 수정할 수 있고 계정상태는 그대로다', async () => {
  // §5-3 결정 고정. account_status는 화이트리스트 밖이므로 스스로 되돌릴 수 없다.
  const 응답 = await 요청(
    'PATCH',
    '/api/members/me',
    { name: '탈퇴수정', accountStatus: 'active' },
    bearer(탈퇴회원.accessToken),
  );
  assert.equal(응답.status, 200);
  assert.equal(응답.body.name, '탈퇴수정');
  assert.equal(응답.body.accountStatus, 'withdrawn');

  const 행 = await 회원행(탈퇴회원.id);
  assert.equal(행.name, '탈퇴수정');
  assert.equal(행.account_status, 'withdrawn', '탈퇴 상태를 스스로 되돌릴 수 없어야 한다');
});

// ── C. 회귀 ─────────────────────────────────────────────────────────────────

test('C-1 기존 라우트가 그대로 동작한다(/health 200, 없는 경로 404)', async () => {
  const 헬스 = await 요청('GET', '/health');
  assert.equal(헬스.status, 200, '/health를 router.use 아래로 옮기면 깨진다');
  assert.deepEqual(헬스.body, { status: 'ok', db: 'ok' });

  const 없는경로 = await 요청('GET', '/없는-경로');
  assert.equal(없는경로.status, 404);
  assert.equal(없는경로.body.code, 'NOT_FOUND');
});

test('C-2 정의되지 않은 members 하위 경로는 404다', async () => {
  const 경로들 = [
    ['GET', '/api/members'],
    ['GET', `/api/members/${타인.member.id}`],
    ['DELETE', '/api/members/me'],
  ];
  for (const [메서드, 경로] of 경로들) {
    const 응답 = await 요청(메서드, 경로, undefined, bearer(나.accessToken));
    assert.equal(응답.status, 404, `${메서드} ${경로}: ID를 담는 라우트가 없어야 한다`);
    assert.equal(응답.body.code, 'NOT_FOUND', `${메서드} ${경로}: code`);
  }
});

// ── 정리 ────────────────────────────────────────────────────────────────────

test.after(async () => {
  // be04- 접두사 회원만 삭제한다. 시드 계정 4개와 member_grades는 건드리지 않는다.
  await query('DELETE FROM members WHERE email LIKE $1', [`${PREFIX}%`]);
  await pool.end();
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});
