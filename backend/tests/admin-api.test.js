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
// 이 파일이 만드는 모든 회원 이메일·등급명·게시판명·연습실명·게시글 제목의 접두사.
// 생성과 정리가 이 상수 하나만 쓴다. reservations에는 접두사를 넣을 텍스트 컬럼이 없으므로
// **모든 픽스처 예약의 member_id가 be10- 회원**이라는 사실이 유일한 정리 장치다(계획서 §11-1).
const PREFIX = 'be10-';

// docs/seed-dev.sql 계정 비밀번호. 픽스처 회원 가입에도 그대로 쓴다.
const 시드비밀번호 = 'Test1234!';

// 시드 게시판 이름. id는 IDENTITY라 재실행 이력에 따라 달라지므로 **이름으로 조회한다**.
const 정회원게시판명 = '정회원 게시판'; // min 20, 활성
const 비활성게시판명 = '이전 공지(보관)'; // min 30, 비활성

// ── 날짜 센티널 ─────────────────────────────────────────────────────────────
// **2096년대만 쓴다.** 2099=BE-07, 2098=BE-09, 2097=BE-08이 이미 점유했고
// `node --test`는 파일을 **별도 프로세스로 병렬 실행**한다. 예약 슬롯은
// (연습실, 날짜, 시작시각)으로만 식별되므로 회원 접두사가 달라도 격리되지 않아
// **연도가 겹치면 실시간으로 uq_reservations_active_slot 충돌**이 난다(계획서 §11-1 항목 2).
// 과거 센티널도 같은 이유로 다른 파일(2000-01-02~04 = BE-09)과 겹치지 않게 고른다.
const 필터날짜 = '2096-12-31'; // D-2 참조 예약 · E-1(b) date 필터 대상
const 취소생존날짜 = '2096-12-30'; // F-1 — BE-09 취소 경로 생존 확인용(미래·reserved)
const 강제취소날짜 = '2000-01-05'; // E-1(d) — 타인 소유 · 이미 시작된 예약
const 완료날짜 = '2000-01-06'; // E-1(f) — completed 예약(강제취소가 덮는 대상)

// ── 응답 스키마 키(정렬본) — 테스트가 그대로 단정한다 ───────────────────────
const 등급키 = ['description', 'gradeLevel', 'id', 'isAdmin', 'name'];
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
// 관리자 게시판 목록은 canAccess를 포함하지 않는다 — 5키다(계획서 §13-4).
const 게시판키 = ['description', 'id', 'isActive', 'minGradeLevel', 'name'];
const 연습실키 = ['capacity', 'closeTime', 'id', 'isActive', 'location', 'name', 'openTime'];
const 예약키 = [
  'createdAt',
  'endTime',
  'id',
  'memberId',
  'practiceRoomId',
  'reservationDate',
  'reservationStatus',
  'startTime',
];

// ── 서버·HTTP 헬퍼 ──────────────────────────────────────────────────────────
// 케이스마다 서버를 띄우면 느리므로 파일 전체가 포트 0으로 띄운 서버 1대를 공유한다.
let server;
let base;

/** Bearer 인증 헤더. */
const bearer = (토큰) => ({ Authorization: `Bearer ${토큰}` });

/** HTTP 요청 1건. 이 파일의 유일한 요청 통로다. */
async function 요청(메서드, 경로, 본문, 헤더 = {}) {
  const 본문없음 = 본문 === undefined;
  const response = await fetch(`${base}${경로}`, {
    method: 메서드,
    headers: 본문없음 ? 헤더 : { 'Content-Type': 'application/json', ...헤더 },
    body: 본문없음 ? undefined : JSON.stringify(본문),
  });
  const text = await response.text();
  return { status: response.status, text, body: text ? JSON.parse(text) : null };
}

/** 관리자 토큰으로 /api/admin 하위를 호출한다. 경로는 '/boards' 처럼 접두사 없이 넘긴다. */
const 관리자호출 = (메서드, 경로, 본문) =>
  요청(메서드, `/api/admin${경로}`, 본문, bearer(관리자.accessToken));

/** 일반 회원(비관리자) 토큰으로 /api/admin 하위를 호출한다. */
const 회원호출 = (메서드, 경로, 본문) =>
  요청(메서드, `/api/admin${경로}`, 본문, bearer(일반회원.accessToken));

/** 접두사 규약을 지키는 유일한 이메일 생성기. */
let 이메일순번 = 0;
const 새이메일 = (구분) => `${PREFIX}${구분}-${Date.now()}-${(이메일순번 += 1)}@example.test`;

/** 만료된 Access Token을 직접 서명한다. 시크릿은 환경변수에서만 읽는다. */
const 만료Access토큰 = ({ id, gradeLevel, isAdmin }) =>
  jwt.sign({ memberId: id, gradeLevel, isAdmin, typ: 'access' }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: '-1s',
  });

/** 서명 마지막 문자를 변조한다. */
const 위조 = (토큰) => 토큰.slice(0, -1) + (토큰.slice(-1) === 'A' ? 'B' : 'A');

/** 유효한 게시판 요청 본문. 검증 케이스는 필드만 덮어쓴다(undefined는 JSON에서 빠진다). */
const 게시판본문 = (덮어쓰기 = {}) => ({
  name: `${PREFIX}검증게시판`,
  description: '검증용',
  minGradeLevel: 최저등급.gradeLevel,
  isActive: true,
  ...덮어쓰기,
});

/** 유효한 연습실 요청 본문. 검증 케이스는 필드만 덮어쓴다. */
const 연습실본문 = (덮어쓰기 = {}) => ({
  name: `${PREFIX}검증연습실`,
  location: '지하',
  capacity: 2,
  openTime: '09:00',
  closeTime: '22:00',
  isActive: true,
  ...덮어쓰기,
});

// ── DB 직접 조회·삽입 헬퍼 ──────────────────────────────────────────────────
// API 응답을 믿지 않고 실제 저장 상태를 단정하는 통로다.

/** 등급 행 1건. */
const 등급행 = async (id) =>
  (
    await query(
      'SELECT id, name, description, grade_level, is_admin FROM member_grades WHERE id = $1',
      [id],
    )
  ).rows[0];

/** 게시판 행 1건. */
const 게시판행 = async (id) =>
  (await query('SELECT id, name, min_grade_level, is_active FROM boards WHERE id = $1', [id]))
    .rows[0];

/** 연습실 행 1건. pg는 TIME을 'HH:mm:ss'로 반환한다. */
const 연습실행 = async (id) =>
  (
    await query(
      'SELECT id, name, location, capacity, open_time, close_time, is_active FROM practice_rooms WHERE id = $1',
      [id],
    )
  ).rows[0];

/** 게시글 행 1건. */
const 게시글행 = async (id) =>
  (await query('SELECT id, board_id, member_id, title FROM posts WHERE id = $1', [id])).rows[0];

/**
 * 예약 행 1건. 프로덕션 SQL과 동일하게 `to_char(reservation_date, 'YYYY-MM-DD')`로 읽는다 —
 * pg는 DATE를 JS Date로 반환하므로 Date 객체를 문자열과 비교하는 함정을 피한다.
 */
async function 예약행(id) {
  const { rows } = await query(
    `SELECT id, practice_room_id, member_id,
            to_char(reservation_date, 'YYYY-MM-DD') AS d,
            start_time, reservation_status
       FROM reservations WHERE id = $1`,
    [id],
  );
  return rows[0];
}

/**
 * 예약 행을 직접 INSERT한다. POST API로는 과거 날짜·completed·canceled를 만들 수 없다.
 * 30분 CHECK를 지키려면 분이 00 또는 30이어야 하므로 호출부는 항상 'HH:00'/'HH:30'만 넘긴다.
 */
async function 예약삽입({ roomId, memberId, date, startTime, endTime, status = 'reserved' }) {
  const { rows } = await query(
    `INSERT INTO reservations
       (practice_room_id, member_id, reservation_date, start_time, end_time, reservation_status)
     VALUES ($1, $2, $3::date, $4::time, $5::time, $6)
     RETURNING id`,
    [roomId, memberId, date, startTime, endTime, status],
  );
  return rows[0].id;
}

/** 게시글을 직접 INSERT한다. 제목에 접두사를 넣어 정리 2단계가 회수한다. */
async function 게시글삽입({ boardId, memberId, title }) {
  const { rows } = await query(
    `INSERT INTO posts (board_id, member_id, title, content)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [boardId, memberId, title, '본문'],
  );
  return rows[0].id;
}

/**
 * 픽스처 정리 6단계. **순서 필수** — FK가 전부 ON DELETE RESTRICT다(계획서 §11-1 항목 3).
 * 예약 → 게시글 → 게시판 → 연습실 → 회원 → 등급.
 * 시드 등급·게시판·연습실·회원에는 절대 손대지 않는다(접두사·소유 회원으로만 되짚는다).
 */
async function 정리() {
  // 1) 예약(자식) — be10- 회원 소유
  await query(
    'DELETE FROM reservations WHERE member_id IN (SELECT id FROM members WHERE email LIKE $1)',
    [`${PREFIX}%`],
  );
  // 2) 게시글(자식) — be10- 제목 또는 be10- 게시판 소속 또는 be10- 회원 작성
  await query(
    `DELETE FROM posts
      WHERE title LIKE $1
         OR board_id IN (SELECT id FROM boards WHERE name LIKE $1)
         OR member_id IN (SELECT id FROM members WHERE email LIKE $1)`,
    [`${PREFIX}%`],
  );
  // 3) 게시판 — min_grade_level이 be10- 등급을 참조할 수 있으므로 등급보다 먼저
  await query('DELETE FROM boards WHERE name LIKE $1', [`${PREFIX}%`]);
  // 4) 연습실
  await query('DELETE FROM practice_rooms WHERE name LIKE $1', [`${PREFIX}%`]);
  // 5) 회원 — member_grade_id가 be10- 등급을 참조할 수 있으므로 등급보다 먼저
  await query('DELETE FROM members WHERE email LIKE $1', [`${PREFIX}%`]);
  // 6) 등급 — 마지막. 3)·5)가 먼저 지워져야 참조가 사라진다
  await query('DELETE FROM member_grades WHERE name LIKE $1', [`${PREFIX}%`]);
}

/** 가입 → 로그인으로 be10- 일반 회원 1명을 만든다. 토큰은 로그인 API로만 얻는다. */
async function 픽스처회원(구분) {
  const email = 새이메일(구분);
  const 가입본문 = { name: `테스트${구분}`, email, password: 시드비밀번호, phone: '010-0000-0010' };
  const 가입 = await 요청('POST', '/api/auth/signup', 가입본문);
  assert.equal(가입.status, 201, `픽스처(${구분}) 가입 실패: ${가입.text}`);

  const 로그인 = await 요청('POST', '/api/auth/login', { email, password: 시드비밀번호 });
  assert.equal(로그인.status, 200, `픽스처(${구분}) 로그인 실패: ${로그인.text}`);

  return { email, accessToken: 로그인.body.accessToken, member: 로그인.body.member };
}

/** 로그인으로 be10- 회원의 새 토큰을 받는다(B-5의 재로그인 검증용). */
const 재로그인 = (email) => 요청('POST', '/api/auth/login', { email, password: 시드비밀번호 });

// ── 공유 픽스처 ─────────────────────────────────────────────────────────────
let 관리자; // be10-admin (직접 INSERT + signAccessToken) — 관리자 등급 회원가입 경로가 없다
let 일반회원; // be10-user (signup + login). accessToken은 B-5의 재로그인으로 교체된다
let 최저등급; // 시드 최저 등급(가입 시 자동 부여되는 등급)
let 대상등급; // 시드 정회원 게시판의 최소등급과 같은 서열의 등급(B-5 변경 목표)
let 관리자등급; // 시드 is_admin = TRUE 등급
let 정회원게시판; // 시드 '정회원 게시판' 행 — 읽기 전용 대조군
let 비활성게시판; // 시드 '이전 공지(보관)' 행 — 읽기 전용 대조군
let 시드활성실id; // 시드 활성 연습실 id — 읽기 전용 대조군
let 시드비활성실id; // 시드 비활성 연습실 id — 읽기 전용 대조군

// 케이스 간 의존 픽스처 (선언 순서 = 실행 순서가 계약이다)
let B3등급id; // B-3이 만든 gradeLevel 91 등급 → B-4·B-7·F-2가 참조
let C2게시판id; // C-2가 만든 게시판 → C-5의 PATCH 검증이 참조
let C3게시판id; // C-3이 만든 게시판 → C-4가 삭제 대상으로 참조
let C3게시글id; // C-3이 만든 게시글 → C-4가 참조
let E실id; // E-1 전용 연습실
let E예약 = {}; // E-1 픽스처 예약 id 모음 → F-2가 참조

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  // 선행 정리: member_grades의 name·grade_level UNIQUE와 예약 부분 유니크 인덱스 때문에
  // 이전 실행의 정리가 실패했으면 아래 픽스처 삽입이 제약 위반으로 터진다.
  // 행이 없으면 무연산이다. before와 after가 같은 헬퍼를 공유한다(계획서 §11-1 항목 4).
  await 정리();

  // 시드 게시판을 **이름으로** 조회한다(id 하드코딩 금지).
  for (const [이름, 대입] of [
    [정회원게시판명, (행) => (정회원게시판 = 행)],
    [비활성게시판명, (행) => (비활성게시판 = 행)],
  ]) {
    const { rows } = await query(
      'SELECT id, name, min_grade_level, is_active FROM boards WHERE name = $1',
      [이름],
    );
    assert.equal(
      rows.length,
      1,
      `시드 게시판 '${이름}'이 정확히 1건 있어야 한다(조회 ${rows.length}건). docs/seed-dev.sql 적용을 확인하라.`,
    );
    대입(rows[0]);
  }
  assert.equal(비활성게시판.is_active, false, `'${비활성게시판명}'은 비활성이어야 한다`);

  // 시드 등급 3종을 조회한다(id·grade_level 하드코딩 금지).
  const { rows: 최저행 } = await query(
    'SELECT id, name, grade_level, is_admin FROM member_grades ORDER BY grade_level ASC LIMIT 1',
  );
  assert.equal(최저행.length, 1, 'member_grades가 비어 있다. docs/seed-dev.sql 적용을 확인하라.');
  최저등급 = { id: 최저행[0].id, gradeLevel: 최저행[0].grade_level };

  const { rows: 대상행 } = await query(
    'SELECT id, grade_level FROM member_grades WHERE grade_level = $1',
    [정회원게시판.min_grade_level],
  );
  assert.equal(
    대상행.length,
    1,
    `'${정회원게시판명}'의 최소등급(${정회원게시판.min_grade_level})과 같은 서열의 등급이 있어야 한다`,
  );
  대상등급 = { id: 대상행[0].id, gradeLevel: 대상행[0].grade_level };

  const { rows: 관리자등급행 } = await query(
    'SELECT id, grade_level, is_admin FROM member_grades WHERE is_admin = TRUE ORDER BY grade_level DESC LIMIT 1',
  );
  assert.equal(
    관리자등급행.length,
    1,
    'is_admin=TRUE 등급이 최소 1건 있어야 한다. docs/seed-dev.sql 적용을 확인하라.',
  );
  관리자등급 = { id: 관리자등급행[0].id, gradeLevel: 관리자등급행[0].grade_level };
  assert.ok(
    최저등급.gradeLevel < 대상등급.gradeLevel && 대상등급.gradeLevel < 관리자등급.gradeLevel,
    '전제: 최저 < 정회원게시판 최소등급 < 관리자 등급이어야 B-5·C-2의 대조가 성립한다',
  );

  // 시드 연습실 id를 조회한다(실측 시드 id는 2·3이며 1이 아니다).
  const { rows: 활성실행 } = await query(
    'SELECT id FROM practice_rooms WHERE is_active = TRUE ORDER BY id LIMIT 1',
  );
  assert.equal(활성실행.length, 1, '활성 시드 연습실이 최소 1건 있어야 한다.');
  시드활성실id = 활성실행[0].id;

  const { rows: 비활성실행 } = await query(
    'SELECT id FROM practice_rooms WHERE is_active = FALSE ORDER BY id LIMIT 1',
  );
  assert.equal(비활성실행.length, 1, '비활성 시드 연습실이 최소 1건 있어야 한다.');
  시드비활성실id = 비활성실행[0].id;

  // 일반 회원: 가입 API가 최저 등급을 자동 부여한다(F-01).
  일반회원 = await 픽스처회원('user');
  assert.equal(
    일반회원.member.memberGrade.gradeLevel,
    최저등급.gradeLevel,
    '전제: 신규 가입 회원은 최저 등급이어야 한다',
  );
  assert.equal(일반회원.member.memberGrade.isAdmin, false, '전제: 일반 회원은 비관리자다');

  // 관리자: 관리자 등급 회원가입 경로가 없으므로 직접 INSERT하고 토큰을 직접 발급한다.
  // 시드 admin@clubhome.local로 로그인하지 않는다 — 그 회원은 be10- 접두사가 아니어서
  // 정리 규약에서 벗어나고, 이 파일이 등급을 변경할 수 있는 유일한 코드다(계획서 §11-1 항목 1·5).
  const 관리자이메일 = 새이메일('admin');
  const { rows: 관리자삽입 } = await query(
    `INSERT INTO members (email, password_hash, name, phone, member_grade_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [관리자이메일, await hashPassword(시드비밀번호), '테스트관리자', '010-0000-0011', 관리자등급.id],
  );
  관리자 = {
    email: 관리자이메일,
    id: 관리자삽입[0].id,
    accessToken: signAccessToken({
      id: 관리자삽입[0].id,
      gradeLevel: 관리자등급.gradeLevel,
      isAdmin: true,
    }),
  };
});

// ── A. 인가 (완료조건 ⑤) ───────────────────────────────────────────────────

/**
 * swagger `/api/admin/*` 15개 경로 전부. GET 5 · POST 3 · PATCH 5 · DELETE 2.
 * path id는 전부 999999를 쓴다 — 비관리자 요청이 **조회보다 먼저** 403으로 끊기는지가
 * 이 목록의 목적이고, 만약 assertAdmin이 빠져 있어도 시드 행이 파괴되지 않는다(§11-1 항목 5).
 */
const 관리자경로15 = () => [
  ['GET', '/members'],
  ['PATCH', '/members/999999/grade', { memberGradeId: 대상등급.id }],
  ['GET', '/member-grades'],
  ['POST', '/member-grades', { name: `${PREFIX}A1등급`, gradeLevel: 97 }],
  ['PATCH', '/member-grades/999999', { name: `${PREFIX}A1등급`, gradeLevel: 97 }],
  ['GET', '/boards'],
  ['POST', '/boards', 게시판본문({ name: `${PREFIX}A1게시판` })],
  ['PATCH', '/boards/999999', 게시판본문({ name: `${PREFIX}A1게시판` })],
  ['DELETE', '/boards/999999'],
  ['GET', '/practice-rooms'],
  ['POST', '/practice-rooms', 연습실본문({ name: `${PREFIX}A1연습실` })],
  ['PATCH', '/practice-rooms/999999', 연습실본문({ name: `${PREFIX}A1연습실` })],
  ['DELETE', '/practice-rooms/999999'],
  ['GET', '/reservations'],
  ['PATCH', '/reservations/999999/cancel'],
];

test('A-1 비관리자는 15개 관리자 엔드포인트 전부에서 403이다', async () => {
  // 완료조건 ⑤. 경로를 표로만 나열하지 않고 **실제로 15번 호출한다.**
  const 경로들 = 관리자경로15();
  assert.equal(경로들.length, 15, 'swagger /api/admin/* 는 정확히 15개다');

  for (const [메서드, 경로, 본문] of 경로들) {
    const 이름 = `${메서드} /api/admin${경로}`;
    const 응답 = await 회원호출(메서드, 경로, 본문);

    // 404가 아니라는 것이 **라우팅 존재 증명**이고, 401이 아니라는 것이
    // requireAuth가 정상 통과했다는 증명이다(둘 중 하나면 403 단정이 무의미해진다).
    assert.notEqual(응답.status, 404, `${이름}: 라우트가 등록되어 있어야 한다`);
    assert.notEqual(응답.status, 401, `${이름}: 유효한 토큰이므로 401이 아니다`);
    assert.notEqual(응답.status, 500, `${이름}: 인가 거부가 500으로 새면 안 된다`);
    assert.equal(응답.status, 403, `${이름}: status(${응답.text})`);
    assert.equal(응답.body.code, 'FORBIDDEN', `${이름}: code`);
    assert.equal(응답.body.message, '관리자만 접근할 수 있습니다.', `${이름}: message`);
    assert.deepEqual(Object.keys(응답.body).sort(), ['code', 'message'], `${이름}: 본문 키 2개`);
  }
});

test('A-2 인증 없이·만료·위조 토큰은 401이다', async () => {
  // 15경로 × 3토큰 전수는 하지 않는다 — 미들웨어 부착은 라우트 1줄 문제이고
  // A-1이 15경로를 실제 호출해 라우팅 존재를 이미 증명했다(계획서 §11-4).
  const 만료 = 만료Access토큰({
    id: 일반회원.member.id,
    gradeLevel: 일반회원.member.memberGrade.gradeLevel,
    isAdmin: 일반회원.member.memberGrade.isAdmin,
  });
  const 토큰들 = [
    ['헤더없음', null, 'UNAUTHORIZED'],
    ['만료토큰', 만료, 'TOKEN_EXPIRED'],
    ['위조토큰', 위조(일반회원.accessToken), 'UNAUTHORIZED'],
  ];
  const 대표경로들 = [
    ['GET', '/api/admin/members', undefined],
    ['POST', '/api/admin/boards', 게시판본문({ name: `${PREFIX}A2게시판` })],
    ['PATCH', '/api/admin/reservations/999999/cancel', undefined],
  ];

  for (const [토큰이름, 토큰, 기대코드] of 토큰들) {
    for (const [메서드, 경로, 본문] of 대표경로들) {
      const 이름 = `${토큰이름} ${메서드} ${경로}`;
      const 응답 = await 요청(메서드, 경로, 본문, 토큰 === null ? {} : bearer(토큰));
      assert.equal(응답.status, 401, `${이름}: 401이어야 한다(403·404·500 아님)`);
      assert.equal(응답.body.code, 기대코드, `${이름}: code`);
      assert.deepEqual(Object.keys(응답.body).sort(), ['code', 'message'], `${이름}: 본문 키 2개`);
    }
  }
});

test('A-3 비관리자에게는 미존재 리소스도 403이다', async () => {
  // §5-4 회귀 방어: assertAdmin이 조회보다 뒤로 가면 비관리자에게 404가 새어
  // **리소스 존재 여부가 노출된다.** 이 케이스가 유일한 순서 검출기다.
  const 케이스들 = [
    ['PATCH', '/boards/999999', 게시판본문({ name: `${PREFIX}A3게시판` })],
    ['DELETE', '/practice-rooms/999999', undefined],
    ['PATCH', '/member-grades/999999', { name: `${PREFIX}A3등급`, gradeLevel: 96 }],
  ];

  for (const [메서드, 경로, 본문] of 케이스들) {
    const 이름 = `${메서드} /api/admin${경로}`;
    const 응답 = await 회원호출(메서드, 경로, 본문);
    assert.notEqual(응답.status, 404, `${이름}: 비관리자에게 404를 주면 존재 여부가 노출된다`);
    assert.equal(응답.status, 403, `${이름}: status(${응답.text})`);
    assert.equal(응답.body.code, 'FORBIDDEN', `${이름}: code`);
    assert.equal(응답.body.message, '관리자만 접근할 수 있습니다.', `${이름}: message`);
  }
});

// ── B. 회원등급 (완료조건 ①) ────────────────────────────────────────────────

test('B-1 회원 목록 조회와 q 검색', async () => {
  const 전체 = await 관리자호출('GET', '/members');
  assert.equal(전체.status, 200, `회원 목록 조회 실패: ${전체.text}`);
  assert.ok(Array.isArray(전체.body), '응답은 래퍼 없는 맨 배열이어야 한다');
  assert.ok(전체.body.length > 0, '시드 회원이 있으므로 0건일 수 없다');

  for (const 항목 of 전체.body) {
    assert.deepEqual(Object.keys(항목).sort(), 회원키, `${항목.email}: Member는 정확히 8개 키다`);
    assert.deepEqual(
      Object.keys(항목.memberGrade).sort(),
      등급키,
      `${항목.email}: memberGrade는 정확히 5개 키다`,
    );
    for (const 금지 of ['password', 'passwordHash', 'password_hash']) {
      assert.equal(금지 in 항목, false, `${항목.email}: ${금지} 키가 응답에 있으면 안 된다`);
    }
  }
  // bcrypt 해시는 '$2b$'로 시작한다. 키 부재 단정만으로는 중첩 유출을 잡지 못한다.
  assert.equal(전체.text.includes('$2'), false, '응답 본문에 bcrypt 해시 문자열이 없어야 한다');

  const 나 = 전체.body.find((항목) => 항목.id === 일반회원.member.id);
  assert.ok(나, '방금 가입한 be10- 회원이 목록에 있어야 한다');
  assert.equal(나.email, 일반회원.email);
  assert.equal(나.accountStatus, 'active');

  // q 검색: 이름/이메일 부분일치. be10-user 접두사는 일반회원 픽스처에만 있다.
  const 검색 = await 관리자호출('GET', `/members?q=${PREFIX}user`);
  assert.equal(검색.status, 200, `q 검색 실패: ${검색.text}`);
  assert.equal(검색.body.length, 1, 'be10-user로 검색하면 그 회원만 나와야 한다');
  assert.equal(검색.body[0].id, 일반회원.member.id);

  // 형식 불량·빈 값은 400을 던지지 않고 필터를 떨어뜨린다(계획서 §13-12).
  // 다른 테스트 파일이 병렬로 회원을 만들 수 있으므로 총 건수 대신 **필터 미적용**을 단정한다.
  for (const [이름, 쿼리] of [
    ['빈 값', '?q='],
    ['공백만', '?q=%20%20'],
    ['비문자열(중복 파라미터)', '?q=a&q=b'],
  ]) {
    const 응답 = await 관리자호출('GET', `/members${쿼리}`);
    assert.notEqual(응답.status, 400, `${이름}: 이 경로에 400은 정의되어 있지 않다`);
    assert.notEqual(응답.status, 500, `${이름}: 500이 나오면 안 된다`);
    assert.equal(응답.status, 200, `${이름}: status(${응답.text})`);
    const ids = 응답.body.map((항목) => 항목.id);
    assert.ok(ids.includes(일반회원.member.id), `${이름}: 필터가 미적용되어 전체가 반환된다`);
    assert.ok(ids.includes(관리자.id), `${이름}: 관리자 회원도 포함된다`);
  }
});

test('B-2 등급 체계 조회는 gradeLevel 오름차순이다', async () => {
  const 응답 = await 관리자호출('GET', '/member-grades');
  assert.equal(응답.status, 200, `등급 목록 조회 실패: ${응답.text}`);
  assert.ok(Array.isArray(응답.body), '응답은 맨 배열이어야 한다');
  assert.ok(응답.body.length >= 3, '시드 등급 3건이 있어야 한다');

  for (const 항목 of 응답.body) {
    assert.deepEqual(Object.keys(항목).sort(), 등급키, `${항목.name}: MemberGrade는 정확히 5개 키다`);
    assert.ok(Number.isInteger(항목.gradeLevel), `${항목.name}: gradeLevel은 정수다`);
    assert.equal(typeof 항목.isAdmin, 'boolean', `${항목.name}: isAdmin은 불리언이다`);
  }

  const 서열들 = 응답.body.map((항목) => 항목.gradeLevel);
  for (let i = 1; i < 서열들.length; i += 1) {
    assert.ok(서열들[i - 1] <= 서열들[i], `ORDER BY grade_level ASC 위반: ${서열들}`);
  }

  const ids = 응답.body.map((항목) => 항목.id);
  for (const [이름, 등급] of [
    ['최저등급', 최저등급],
    ['대상등급', 대상등급],
    ['관리자등급', 관리자등급],
  ]) {
    assert.ok(ids.includes(등급.id), `${이름}이 목록에 있어야 한다`);
  }
});

test('B-3 등급 생성 201', async () => {
  const 응답 = await 관리자호출('POST', '/member-grades', {
    name: `${PREFIX}테스트등급`,
    gradeLevel: 91,
  });
  assert.equal(응답.status, 201, `등급 생성 실패: ${응답.text}`);
  assert.deepEqual(Object.keys(응답.body).sort(), 등급키, 'MemberGrade는 정확히 5개 키다');
  assert.equal(응답.body.name, `${PREFIX}테스트등급`);
  assert.equal(응답.body.gradeLevel, 91);
  assert.equal(응답.body.isAdmin, false, 'isAdmin 생략 시 swagger default false다');
  assert.equal(응답.body.description, null, 'description 생략 시 null이다');
  assert.ok(Number.isInteger(응답.body.id));
  B3등급id = 응답.body.id;

  const 행 = await 등급행(B3등급id);
  assert.ok(행, 'DB에 등급 행이 있어야 한다');
  assert.equal(행.name, `${PREFIX}테스트등급`);
  assert.equal(행.grade_level, 91);
  assert.equal(행.is_admin, false);
});

test('B-4 등급명·서열 중복은 409다', async () => {
  assert.ok(B3등급id, '전제: B-3이 등급을 생성했어야 한다');
  const 케이스들 = [
    ['등급명 중복', { name: `${PREFIX}테스트등급`, gradeLevel: 92 }],
    ['등급서열 중복', { name: `${PREFIX}다른등급명`, gradeLevel: 91 }],
  ];

  for (const [이름, 본문] of 케이스들) {
    const 응답 = await 관리자호출('POST', '/member-grades', 본문);
    // pg 23505를 그대로 흘리면 500이다 — ON CONFLICT DO NOTHING이 그것을 막는다.
    assert.notEqual(응답.status, 500, `${이름}: UNIQUE 위반이 500으로 새면 안 된다`);
    assert.equal(응답.status, 409, `${이름}: status(${응답.text})`);
    assert.equal(응답.body.code, 'MEMBER_GRADE_DUPLICATE', `${이름}: code`);
    assert.equal(
      응답.body.message,
      '이미 사용 중인 등급명 또는 등급서열입니다.',
      `${이름}: message`,
    );
    assert.deepEqual(Object.keys(응답.body).sort(), ['code', 'message'], `${이름}: 본문 키 2개`);
  }

  // 409 응답이 행을 만들지 않았음을 DB로 확인한다.
  const { rows } = await query('SELECT id FROM member_grades WHERE name LIKE $1', [`${PREFIX}%`]);
  assert.equal(rows.length, 1, `be10- 등급은 B-3이 만든 1건뿐이어야 한다(조회 ${rows.length}건)`);
});

test('B-5 회원 등급 변경은 재로그인 후 반영된다', async () => {
  // 완료조건 ①. §7 계약(JWT 무상태 → 다음 로그인·토큰 갱신 시 반영)을 한 케이스에서 고정한다.
  const 이전토큰 = 일반회원.accessToken;
  const 게시판경로 = `/api/boards/${정회원게시판.id}`;

  // ① 변경 전: 등급 미달로 403.
  const 변경전 = await 요청('GET', 게시판경로, undefined, bearer(이전토큰));
  assert.equal(변경전.status, 403, `전제: 최저 등급은 정회원 게시판에 접근할 수 없다(${변경전.text})`);
  assert.equal(변경전.body.code, 'FORBIDDEN');

  // ② 관리자가 등급을 변경한다.
  const 변경 = await 관리자호출('PATCH', `/members/${일반회원.member.id}/grade`, {
    memberGradeId: 대상등급.id,
  });
  assert.equal(변경.status, 200, `등급 변경 실패: ${변경.text}`);
  assert.deepEqual(Object.keys(변경.body).sort(), 회원키, 'Member는 정확히 8개 키다');
  assert.equal(변경.body.id, 일반회원.member.id);
  assert.equal(변경.body.memberGradeId, 대상등급.id, 'memberGradeId가 새 등급이어야 한다');
  assert.equal(변경.body.memberGrade.id, 대상등급.id, '조인된 memberGrade도 새 등급이어야 한다');
  assert.equal(변경.body.memberGrade.gradeLevel, 대상등급.gradeLevel);
  assert.equal(변경.text.includes('$2'), false, '등급 변경 응답에도 해시가 실리면 안 된다');

  const { rows } = await query('SELECT member_grade_id FROM members WHERE id = $1', [
    일반회원.member.id,
  ]);
  assert.equal(rows[0].member_grade_id, 대상등급.id, 'DB의 member_grade_id가 변경되어야 한다');

  // ③ **기존 토큰으로는 여전히 403** — 등급은 토큰 클레임에 캐시되어 있다.
  const 기존토큰재조회 = await 요청('GET', 게시판경로, undefined, bearer(이전토큰));
  assert.equal(
    기존토큰재조회.status,
    403,
    '기존 Access Token의 gradeLevel 클레임이 그대로이므로 403이어야 한다(즉시 무효화 수단을 두지 않는다)',
  );

  // ④ **재로그인하면 200** — 새 등급이 실리는 통로는 로그인·토큰 갱신뿐이다.
  const 로그인 = await 재로그인(일반회원.email);
  assert.equal(로그인.status, 200, `재로그인 실패: ${로그인.text}`);
  assert.equal(로그인.body.member.memberGrade.gradeLevel, 대상등급.gradeLevel);
  일반회원.accessToken = 로그인.body.accessToken;

  const 재조회 = await 요청('GET', 게시판경로, undefined, bearer(일반회원.accessToken));
  assert.equal(재조회.status, 200, `재로그인 후에는 접근할 수 있어야 한다: ${재조회.text}`);
  assert.equal(재조회.body.id, 정회원게시판.id);
});

test('B-6 등급 변경 실패 분기', async () => {
  // path 리소스(회원)는 404, body 값(memberGradeId)은 400으로 갈랐다(계획서 §13-9).
  const 유효등급 = { memberGradeId: 대상등급.id };
  const 회원없음 = [404, 'NOT_FOUND', '회원을 찾을 수 없습니다.'];
  const 등급없음 = [400, 'BAD_REQUEST', '존재하지 않는 회원등급입니다.'];
  const 본문불량 = [400, 'BAD_REQUEST', null]; // requireInt 문구는 구현 세부라 message를 고정하지 않는다
  const 내id = String(일반회원.member.id);

  const 케이스들 = [
    ['미존재 memberId', '999999', 유효등급, 회원없음],
    ['형식 불량 memberId', 'abc', 유효등급, 회원없음],
    ['int4 초과 memberId', '99999999999', 유효등급, 회원없음],
    ['memberGradeId 누락', 내id, {}, 본문불량],
    ['memberGradeId 비정수', 내id, { memberGradeId: 'abc' }, 본문불량],
    ['memberGradeId 소수', 내id, { memberGradeId: 1.5 }, 본문불량],
    // 사전 검사가 없으면 FK 23503이 500으로 샌다.
    ['memberGradeId 미존재', 내id, { memberGradeId: 999999 }, 등급없음],
  ];

  for (const [이름, memberId, 본문, [기대status, 기대code, 기대message]] of 케이스들) {
    const 응답 = await 관리자호출('PATCH', `/members/${memberId}/grade`, 본문);
    assert.notEqual(응답.status, 500, `${이름}: pg 오류가 500으로 새면 안 된다`);
    assert.equal(응답.status, 기대status, `${이름}: status(${응답.text})`);
    assert.equal(응답.body.code, 기대code, `${이름}: code`);
    if (기대message !== null) {
      assert.equal(응답.body.message, 기대message, `${이름}: message`);
    }
    assert.deepEqual(Object.keys(응답.body).sort(), ['code', 'message'], `${이름}: 본문 키 2개`);
  }

  // 실패 요청이 등급을 바꾸지 않았음을 확인한다(B-5의 결과가 유지되어야 한다).
  const { rows } = await query('SELECT member_grade_id FROM members WHERE id = $1', [
    일반회원.member.id,
  ]);
  assert.equal(rows[0].member_grade_id, 대상등급.id, '실패 요청으로 등급이 바뀌면 안 된다');
});

test('B-7 참조 중인 등급서열 재배치는 409다', async () => {
  assert.ok(B3등급id, '전제: B-3이 gradeLevel 91 등급을 생성했어야 한다');

  // be10- 게시판이 gradeLevel 91을 참조하게 만든다. 시드 게시판을 쓰지 않는다.
  const 생성 = await 관리자호출('POST', '/boards', {
    name: `${PREFIX}서열참조게시판`,
    description: '등급서열 참조 확인용',
    minGradeLevel: 91,
    isActive: true,
  });
  assert.equal(생성.status, 201, `서열 참조 게시판 생성 실패: ${생성.text}`);
  assert.equal(생성.body.minGradeLevel, 91);

  // boards.min_grade_level → member_grades.grade_level은 ON UPDATE NO ACTION이라
  // 참조되는 값을 바꾸면 23503이 난다 → 사전 판정으로 409를 낸다.
  const 재배치 = await 관리자호출('PATCH', `/member-grades/${B3등급id}`, {
    name: `${PREFIX}테스트등급`,
    gradeLevel: 92,
  });
  assert.notEqual(재배치.status, 500, 'FK 23503이 500으로 새면 안 된다');
  assert.equal(재배치.status, 409, `서열 재배치: status(${재배치.text})`);
  assert.equal(재배치.body.code, 'MEMBER_GRADE_LEVEL_IN_USE');
  assert.equal(
    재배치.body.message,
    '이 등급서열을 사용하는 게시판이 있어 등급서열을 변경할 수 없습니다.',
  );
  assert.deepEqual(Object.keys(재배치.body).sort(), ['code', 'message'], '본문 키 2개');
  assert.equal((await 등급행(B3등급id)).grade_level, 91, '409면 DB 서열이 불변이어야 한다');

  // 대조: 서열을 그대로 두고 이름·설명만 바꾸면 이 검사를 건너뛰어 200이다.
  const 이름변경 = await 관리자호출('PATCH', `/member-grades/${B3등급id}`, {
    name: `${PREFIX}테스트등급-수정`,
    description: '이름만 변경',
    gradeLevel: 91,
  });
  assert.equal(이름변경.status, 200, `서열 미변경 수정 실패: ${이름변경.text}`);
  assert.deepEqual(Object.keys(이름변경.body).sort(), 등급키, 'MemberGrade는 정확히 5개 키다');
  assert.equal(이름변경.body.name, `${PREFIX}테스트등급-수정`);
  assert.equal(이름변경.body.description, '이름만 변경');
  assert.equal(이름변경.body.gradeLevel, 91, '서열은 그대로여야 한다');

  const 행 = await 등급행(B3등급id);
  assert.equal(행.name, `${PREFIX}테스트등급-수정`, 'DB 이름이 변경되어야 한다');
  assert.equal(행.grade_level, 91);

  // swagger가 이 경로에 정의한 나머지 두 응답(404·409 중복)도 함께 고정한다.
  // 시드 등급명으로 바꾸려 하면 UPDATE의 NOT EXISTS 가드가 0행을 만들어 409가 된다.
  const 이름중복 = await 관리자호출('PATCH', `/member-grades/${B3등급id}`, {
    name: '정회원',
    gradeLevel: 91,
  });
  assert.notEqual(이름중복.status, 500, 'UNIQUE 23505가 500으로 새면 안 된다');
  assert.equal(이름중복.status, 409, `수정 시 등급명 중복: status(${이름중복.text})`);
  assert.equal(이름중복.body.code, 'MEMBER_GRADE_DUPLICATE');
  assert.equal(
    (await 등급행(B3등급id)).name,
    `${PREFIX}테스트등급-수정`,
    '409면 DB 이름이 불변이어야 한다',
  );

  const 미존재등급 = await 관리자호출('PATCH', '/member-grades/999999', {
    name: `${PREFIX}없는등급`,
    gradeLevel: 93,
  });
  assert.equal(미존재등급.status, 404, `미존재 등급 수정: status(${미존재등급.text})`);
  assert.equal(미존재등급.body.code, 'NOT_FOUND');
  assert.equal(미존재등급.body.message, '회원등급을 찾을 수 없습니다.');
});

// ── C. 게시판 (완료조건 ②·⑥·⑦) ────────────────────────────────────────────

test('C-1 관리자 목록은 비활성 게시판을 포함하고 canAccess가 없다', async () => {
  // 완료조건 ⑥의 양면을 한 케이스에서 단정한다.
  const 응답 = await 관리자호출('GET', '/boards');
  assert.equal(응답.status, 200, `관리자 게시판 목록 조회 실패: ${응답.text}`);
  assert.ok(Array.isArray(응답.body), '응답은 맨 배열이어야 한다');

  for (const 항목 of 응답.body) {
    assert.deepEqual(Object.keys(항목).sort(), 게시판키, `${항목.name}: 관리자 Board는 5개 키다`);
    // §13-4: 관리자 목록에는 canAccess를 붙이지 않는다(toBoard 그대로 재사용).
    assert.equal('canAccess' in 항목, false, `${항목.name}: canAccess가 있으면 안 된다`);
  }

  const 비활성 = 응답.body.find((항목) => 항목.id === 비활성게시판.id);
  assert.ok(비활성, `관리자 목록에는 비활성 게시판 '${비활성게시판명}'이 포함되어야 한다`);
  assert.equal(비활성.isActive, false);

  // 대조: 같은 토큰으로 일반 목록을 호출하면 그 게시판이 없다.
  const 일반목록 = await 요청('GET', '/api/boards', undefined, bearer(관리자.accessToken));
  assert.equal(일반목록.status, 200, `일반 게시판 목록 조회 실패: ${일반목록.text}`);
  assert.equal(
    일반목록.body.some((항목) => 항목.id === 비활성게시판.id),
    false,
    '일반 목록에는 관리자에게도 비활성 게시판이 노출되지 않는다',
  );
});

test('C-2 게시판 생성·수정이 F-10에 즉시 반영된다', async () => {
  // 완료조건 ②. **토큰을 한 번만 얻어 끝까지 쓰는 것이 이 케이스의 핵심이다** —
  // 게시판 설정은 매 요청 DB를 읽으므로 등급 변경(B-5)과 달리 재로그인이 필요 없다(§7-4 대조).
  const 토큰 = 일반회원.accessToken;

  const 생성 = await 관리자호출('POST', '/boards', {
    name: `${PREFIX}즉시반영게시판`,
    description: '즉시 반영 확인용',
    minGradeLevel: 최저등급.gradeLevel,
    isActive: true,
  });
  assert.equal(생성.status, 201, `게시판 생성 실패: ${생성.text}`);
  assert.deepEqual(Object.keys(생성.body).sort(), 게시판키, 'Board는 정확히 5개 키다');
  assert.equal(생성.body.minGradeLevel, 최저등급.gradeLevel);
  assert.equal(생성.body.isActive, true);
  C2게시판id = 생성.body.id;

  const 접근가능 = await 요청('GET', `/api/boards/${C2게시판id}`, undefined, bearer(토큰));
  assert.equal(접근가능.status, 200, `최소등급 충족 시 상세 조회는 200이다: ${접근가능.text}`);

  // 최소등급을 관리자 등급으로 올린다(일반회원의 등급은 그 아래다).
  const 등급상향 = await 관리자호출('PATCH', `/boards/${C2게시판id}`, {
    name: `${PREFIX}즉시반영게시판`,
    description: '즉시 반영 확인용',
    minGradeLevel: 관리자등급.gradeLevel,
    isActive: true,
  });
  assert.equal(등급상향.status, 200, `게시판 수정 실패: ${등급상향.text}`);
  assert.equal(등급상향.body.minGradeLevel, 관리자등급.gradeLevel);

  const 등급미달 = await 요청('GET', `/api/boards/${C2게시판id}`, undefined, bearer(토큰));
  assert.equal(등급미달.status, 403, `같은 토큰으로 즉시 403이어야 한다: ${등급미달.text}`);
  assert.equal(등급미달.body.code, 'FORBIDDEN');

  // 이어서 비활성화하면 등급과 무관하게 404다(§9).
  const 비활성화 = await 관리자호출('PATCH', `/boards/${C2게시판id}`, {
    name: `${PREFIX}즉시반영게시판`,
    description: '즉시 반영 확인용',
    minGradeLevel: 최저등급.gradeLevel,
    isActive: false,
  });
  assert.equal(비활성화.status, 200, `비활성화 실패: ${비활성화.text}`);
  assert.equal(비활성화.body.isActive, false);

  const 비활성상세 = await 요청('GET', `/api/boards/${C2게시판id}`, undefined, bearer(토큰));
  assert.equal(비활성상세.status, 404, `비활성 게시판 상세는 404다: ${비활성상세.text}`);
  assert.equal(비활성상세.body.code, 'NOT_FOUND');
});

test('C-3 게시판 비활성화가 게시글을 지우지 않는다', async () => {
  const 생성 = await 관리자호출('POST', '/boards', {
    name: `${PREFIX}보관게시판`,
    description: '게시글 보존 확인용',
    minGradeLevel: 최저등급.gradeLevel,
    isActive: true,
  });
  assert.equal(생성.status, 201, `게시판 생성 실패: ${생성.text}`);
  C3게시판id = 생성.body.id;

  C3게시글id = await 게시글삽입({
    boardId: C3게시판id,
    memberId: 일반회원.member.id,
    title: `${PREFIX}보관글`,
  });

  const 활성상세 = await 요청(
    'GET',
    `/api/posts/${C3게시글id}`,
    undefined,
    bearer(관리자.accessToken),
  );
  assert.equal(활성상세.status, 200, `전제: 활성 게시판의 게시글 상세는 200이다(${활성상세.text})`);

  const 비활성화 = await 관리자호출('PATCH', `/boards/${C3게시판id}`, {
    name: `${PREFIX}보관게시판`,
    description: '게시글 보존 확인용',
    minGradeLevel: 최저등급.gradeLevel,
    isActive: false,
  });
  assert.equal(비활성화.status, 200, `비활성화 실패: ${비활성화.text}`);
  assert.equal(비활성화.body.isActive, false);

  // §9: 어떤 사후 정리도 하지 않는다 — posts 행이 그대로 남아야 한다.
  const 글행 = await 게시글행(C3게시글id);
  assert.ok(글행, '비활성화가 게시글을 삭제하면 안 된다');
  assert.equal(글행.board_id, C3게시판id, '게시글의 소속 게시판도 불변이다');
  assert.equal(글행.title, `${PREFIX}보관글`);

  // 일반 경로에서는 소속 게시판이 비활성이므로 404다.
  const 비활성상세 = await 요청(
    'GET',
    `/api/posts/${C3게시글id}`,
    undefined,
    bearer(관리자.accessToken),
  );
  assert.equal(비활성상세.status, 404, `비활성 게시판의 게시글 상세는 404다: ${비활성상세.text}`);
  assert.equal(비활성상세.body.code, 'NOT_FOUND');
});

test('C-4 게시글이 있는 게시판 삭제는 500이 아니라 409다', async () => {
  // 완료조건 ⑦. FK RESTRICT가 500으로 새면 완료조건 위반이다.
  assert.ok(C3게시판id, '전제: C-3이 게시판과 게시글을 만들었어야 한다');
  assert.ok(C3게시글id, '전제: C-3이 게시글을 만들었어야 한다');

  const 참조중 = await 관리자호출('DELETE', `/boards/${C3게시판id}`);
  assert.notEqual(참조중.status, 500, 'FK 23503이 500으로 새면 안 된다(완료조건 ⑦)');
  assert.equal(참조중.status, 409, `참조 중 삭제: status(${참조중.text})`);
  assert.equal(참조중.body.code, 'BOARD_HAS_POSTS');
  assert.equal(참조중.body.message, '게시글이 있는 게시판은 삭제할 수 없습니다.');
  assert.deepEqual(Object.keys(참조중.body).sort(), ['code', 'message'], '본문 키 2개');
  assert.ok(await 게시판행(C3게시판id), '409면 게시판 행이 그대로 남아야 한다');

  // 참조를 제거하면 삭제된다.
  await query('DELETE FROM posts WHERE id = $1', [C3게시글id]);
  const 삭제 = await 관리자호출('DELETE', `/boards/${C3게시판id}`);
  assert.equal(삭제.status, 204, `참조 없는 게시판 삭제: status(${삭제.text})`);
  assert.equal(삭제.text.length, 0, '204는 본문이 없어야 한다');
  assert.equal(await 게시판행(C3게시판id), undefined, 'DB에서 게시판 행이 사라져야 한다');

  // 미존재 id는 409가 아니라 404다 — 존재 확인이 NOT EXISTS 가드보다 앞선다는 증명이다.
  const 미존재 = await 관리자호출('DELETE', '/boards/999999');
  assert.notEqual(미존재.status, 409, '미존재와 참조중을 같은 409로 뭉개면 안 된다');
  assert.equal(미존재.status, 404, `미존재 게시판 삭제: status(${미존재.text})`);
  assert.equal(미존재.body.code, 'NOT_FOUND');
  assert.equal(미존재.body.message, '게시판을 찾을 수 없습니다.');
});

test('C-5 게시판 생성·수정 입력 검증', async () => {
  assert.ok(C2게시판id, '전제: C-2가 게시판을 만들었어야 한다');

  const 케이스들 = [
    ['name 누락', 게시판본문({ name: undefined }), null],
    ['name 공백만', 게시판본문({ name: '   ' }), null],
    ['name 101자', 게시판본문({ name: 'a'.repeat(101) }), null],
    ['name 비문자열', 게시판본문({ name: 123 }), null],
    ['minGradeLevel 누락', 게시판본문({ minGradeLevel: undefined }), null],
    ['minGradeLevel 비정수', 게시판본문({ minGradeLevel: 'abc' }), null],
    ['minGradeLevel 소수', 게시판본문({ minGradeLevel: 1.5 }), null],
    // FK 23503 방어: 존재하지 않는 서열은 사전 검사로 400이 되어야 한다.
    ['minGradeLevel 미존재 서열', 게시판본문({ minGradeLevel: 999 }), '존재하지 않는 최소등급입니다.'],
    ['isActive 문자열', 게시판본문({ isActive: 'true' }), null],
    // description은 선택 필드지만 타입은 지킨다(문자열 아니면 400, 빈 값은 null).
    ['description 비문자열', 게시판본문({ description: 123 }), null],
  ];

  for (const [이름, 본문, 기대message] of 케이스들) {
    const 응답 = await 관리자호출('POST', '/boards', 본문);
    assert.notEqual(응답.status, 500, `POST ${이름}: pg 22001·23503이 500으로 새면 안 된다`);
    assert.equal(응답.status, 400, `POST ${이름}: status(${응답.text})`);
    assert.equal(응답.body.code, 'BAD_REQUEST', `POST ${이름}: code`);
    if (기대message !== null) {
      assert.equal(응답.body.message, 기대message, `POST ${이름}: message`);
    }
    assert.deepEqual(Object.keys(응답.body).sort(), ['code', 'message'], `POST ${이름}: 본문 키 2개`);
  }

  // 검증 실패가 행을 만들지 않았음을 확인한다(be10- 게시판은 B-7·C-2가 만든 2건뿐).
  const { rows } = await query('SELECT id, name FROM boards WHERE name LIKE $1 ORDER BY id', [
    `${PREFIX}%`,
  ]);
  assert.deepEqual(
    rows.map((행) => 행.name),
    [`${PREFIX}서열참조게시판`, `${PREFIX}즉시반영게시판`],
    '400 요청이 게시판을 만들면 안 된다',
  );

  // PATCH도 동일한 본문 검증을 수행한다(전체 교체 semantics).
  const 수정검증 = await 관리자호출(
    'PATCH',
    `/boards/${C2게시판id}`,
    게시판본문({ name: `${PREFIX}즉시반영게시판`, minGradeLevel: 999 }),
  );
  assert.notEqual(수정검증.status, 500, 'PATCH 미존재 서열이 500으로 새면 안 된다');
  assert.equal(수정검증.status, 400, `PATCH 미존재 서열: status(${수정검증.text})`);
  assert.equal(수정검증.body.code, 'BAD_REQUEST');
  assert.equal(수정검증.body.message, '존재하지 않는 최소등급입니다.');
  assert.equal(
    (await 게시판행(C2게시판id)).min_grade_level,
    최저등급.gradeLevel,
    '400 요청으로 게시판이 변경되면 안 된다',
  );

  // 미존재 게시판 수정은 swagger가 정의한 404다(존재 확인이 서열 검사보다 앞선다).
  const 미존재게시판 = await 관리자호출(
    'PATCH',
    '/boards/999999',
    게시판본문({ name: `${PREFIX}없는게시판` }),
  );
  assert.equal(미존재게시판.status, 404, `미존재 게시판 수정: status(${미존재게시판.text})`);
  assert.equal(미존재게시판.body.code, 'NOT_FOUND');
  assert.equal(미존재게시판.body.message, '게시판을 찾을 수 없습니다.');

  // 공백만 있는 선택 필드는 400이 아니라 null로 저장된다.
  const 빈설명 = await 관리자호출(
    'PATCH',
    `/boards/${C2게시판id}`,
    게시판본문({ name: `${PREFIX}즉시반영게시판`, description: '   ' }),
  );
  assert.equal(빈설명.status, 200, `공백 설명 수정 실패: ${빈설명.text}`);
  assert.equal(빈설명.body.description, null, '공백만 있는 설명은 null이 된다');
});

// ── D. 연습실 (완료조건 ③·⑥·⑦) ────────────────────────────────────────────

test('D-1 연습실 등록·수정·비활성화가 반영되고 관리자 목록에 비활성이 포함된다', async () => {
  // 완료조건 ③·⑥.
  const 생성 = await 관리자호출('POST', '/practice-rooms', {
    name: `${PREFIX}연습실`,
    location: '지하1층',
    capacity: 3,
    openTime: '09:00',
    closeTime: '22:00',
    isActive: true,
  });
  assert.equal(생성.status, 201, `연습실 생성 실패: ${생성.text}`);
  assert.deepEqual(Object.keys(생성.body).sort(), 연습실키, 'PracticeRoom은 정확히 7개 키다');
  // 매퍼의 .slice(0, 5)가 빠지면 '09:00:00'이 실린다.
  assert.equal(생성.body.openTime, '09:00', "openTime은 5자 'HH:mm'이다('09:00:00'이면 실패)");
  assert.equal(생성.body.closeTime, '22:00', "closeTime은 5자 'HH:mm'이다('22:00:00'이면 실패)");
  assert.equal(생성.body.openTime.length, 5);
  assert.equal(생성.body.closeTime.length, 5);
  assert.equal(생성.body.capacity, 3);
  assert.equal(생성.body.location, '지하1층');
  assert.equal(생성.body.isActive, true);
  const D1연습실id = 생성.body.id;

  // 수정: 수용인원 변경 + 비활성화(PATCH는 전체 교체다).
  const 수정 = await 관리자호출('PATCH', `/practice-rooms/${D1연습실id}`, {
    name: `${PREFIX}연습실`,
    location: '지하1층',
    capacity: 5,
    openTime: '09:00',
    closeTime: '22:00',
    isActive: false,
  });
  assert.equal(수정.status, 200, `연습실 수정 실패: ${수정.text}`);
  assert.equal(수정.body.capacity, 5, '수용인원 변경이 반영되어야 한다');
  assert.equal(수정.body.isActive, false, '사용여부 변경이 반영되어야 한다');
  assert.equal(수정.body.openTime, '09:00');

  const 행 = await 연습실행(D1연습실id);
  assert.equal(행.capacity, 5, 'DB의 capacity가 변경되어야 한다');
  assert.equal(행.is_active, false, 'DB의 is_active가 변경되어야 한다');

  // 관리자 목록에는 비활성 연습실이 포함된다(be10- 픽스처 + 시드 비활성 둘 다).
  const 관리자목록 = await 관리자호출('GET', '/practice-rooms');
  assert.equal(관리자목록.status, 200, `관리자 연습실 목록 조회 실패: ${관리자목록.text}`);
  for (const 항목 of 관리자목록.body) {
    assert.deepEqual(Object.keys(항목).sort(), 연습실키, `${항목.name}: 7개 키다`);
  }
  const 관리자ids = 관리자목록.body.map((항목) => 항목.id);
  assert.ok(관리자ids.includes(D1연습실id), '방금 비활성화한 연습실이 관리자 목록에 있어야 한다');
  assert.ok(관리자ids.includes(시드비활성실id), '시드 비활성 연습실도 관리자 목록에 포함된다');
  assert.ok(관리자ids.includes(시드활성실id), '활성 연습실도 당연히 포함된다');

  // 대조: 일반 목록에는 비활성이 없다(완료조건 ⑥).
  const 일반목록 = await 요청(
    'GET',
    '/api/practice-rooms',
    undefined,
    bearer(일반회원.accessToken),
  );
  assert.equal(일반목록.status, 200, `일반 연습실 목록 조회 실패: ${일반목록.text}`);
  const 일반ids = 일반목록.body.map((항목) => 항목.id);
  assert.equal(일반ids.includes(D1연습실id), false, '비활성 연습실이 일반 목록에 노출되면 안 된다');
  assert.equal(일반ids.includes(시드비활성실id), false, '시드 비활성 연습실도 노출되지 않는다');
  assert.ok(일반ids.includes(시드활성실id), '활성 연습실은 일반 목록에 있어야 한다');
});

test('D-2 연습실 입력 검증과 참조 중 삭제 409', async () => {
  // 완료조건 ⑦. DB CHECK 제약 전부를 사전 검증으로 막는다.
  const 검증케이스들 = [
    ['name 누락', 연습실본문({ name: undefined })],
    ['name 101자', 연습실본문({ name: 'a'.repeat(101) })],
    // location은 swagger에 maxLength가 없다 — VARCHAR(100)이 유일한 근거다(22001 방어).
    ['location 101자', 연습실본문({ location: 'a'.repeat(101) })],
    ['capacity 0', 연습실본문({ capacity: 0 })],
    ['capacity 음수', 연습실본문({ capacity: -1 })],
    ['capacity 비정수', 연습실본문({ capacity: '3' })],
    ['capacity 소수', 연습실본문({ capacity: 1.5 })],
    ['capacity 누락', 연습실본문({ capacity: undefined })],
    ['openTime 한자리 시', 연습실본문({ openTime: '9:00' })],
    ['openTime 24시', 연습실본문({ openTime: '24:00' })],
    ['openTime 초 포함', 연습실본문({ openTime: '09:00:00' })],
    ['closeTime 형식 불량', 연습실본문({ closeTime: '22시' })],
    ['openTime 누락', 연습실본문({ openTime: undefined })],
    // operating_hours_check(open_time < close_time) 방어 — 없으면 23514 → 500.
    ['운영시간 역순', 연습실본문({ openTime: '22:00', closeTime: '09:00' })],
    ['운영시간 동일', 연습실본문({ openTime: '10:00', closeTime: '10:00' })],
    ['isActive 문자열', 연습실본문({ isActive: 'true' })],
  ];

  for (const [이름, 본문] of 검증케이스들) {
    const 응답 = await 관리자호출('POST', '/practice-rooms', 본문);
    assert.notEqual(응답.status, 500, `${이름}: pg 22001·23514가 500으로 새면 안 된다`);
    assert.equal(응답.status, 400, `${이름}: status(${응답.text})`);
    assert.equal(응답.body.code, 'BAD_REQUEST', `${이름}: code`);
    assert.deepEqual(Object.keys(응답.body).sort(), ['code', 'message'], `${이름}: 본문 키 2개`);
  }

  // 검증 실패가 행을 만들지 않았음을 확인한다(D-1이 만든 1건뿐이어야 한다).
  const { rows: 검증후 } = await query('SELECT id FROM practice_rooms WHERE name LIKE $1', [
    `${PREFIX}%`,
  ]);
  assert.equal(검증후.length, 1, `400 요청이 연습실을 만들면 안 된다(조회 ${검증후.length}건)`);

  // 참조 중 삭제 → 409.
  const 생성 = await 관리자호출('POST', '/practice-rooms', {
    name: `${PREFIX}삭제대상연습실`,
    location: '4층',
    capacity: 2,
    openTime: '09:00',
    closeTime: '22:00',
    isActive: true,
  });
  assert.equal(생성.status, 201, `삭제 대상 연습실 생성 실패: ${생성.text}`);
  const 대상실id = 생성.body.id;

  const 예약id = await 예약삽입({
    roomId: 대상실id,
    memberId: 일반회원.member.id,
    date: 필터날짜,
    startTime: '09:00',
    endTime: '10:00',
  });

  const 참조중 = await 관리자호출('DELETE', `/practice-rooms/${대상실id}`);
  assert.notEqual(참조중.status, 500, 'FK 23503이 500으로 새면 안 된다(완료조건 ⑦)');
  assert.equal(참조중.status, 409, `참조 중 삭제: status(${참조중.text})`);
  assert.equal(참조중.body.code, 'PRACTICE_ROOM_HAS_RESERVATIONS');
  assert.equal(참조중.body.message, '예약 이력이 있는 연습실은 삭제할 수 없습니다.');
  assert.deepEqual(Object.keys(참조중.body).sort(), ['code', 'message'], '본문 키 2개');
  assert.ok(await 연습실행(대상실id), '409면 연습실 행이 그대로 남아야 한다');

  // **canceled로 바꿔도 여전히 409다** — FK RESTRICT는 상태를 보지 않는다.
  // 가드에 상태 필터를 넣으면 가드는 통과하고 DB가 거부해 23503 → 500이 된다(§4-13).
  await query("UPDATE reservations SET reservation_status = 'canceled' WHERE id = $1", [예약id]);
  const 취소후 = await 관리자호출('DELETE', `/practice-rooms/${대상실id}`);
  assert.notEqual(취소후.status, 500, '취소된 예약 이력도 500이 아니라 409다');
  assert.notEqual(취소후.status, 204, '취소된 예약도 이력이므로 삭제를 허용하면 안 된다');
  assert.equal(취소후.status, 409, `canceled 예약 참조: status(${취소후.text})`);
  assert.equal(취소후.body.code, 'PRACTICE_ROOM_HAS_RESERVATIONS');
  assert.ok(await 연습실행(대상실id), '409면 연습실 행이 그대로 남아야 한다');

  // 운영시간을 좁혀도 범위 밖 기존 예약은 그대로 남는다(§9 — 사후 정리를 하지 않는다).
  const 시간축소 = await 관리자호출('PATCH', `/practice-rooms/${대상실id}`, {
    name: `${PREFIX}삭제대상연습실`,
    location: '4층',
    capacity: 2,
    openTime: '13:00',
    closeTime: '14:00',
    isActive: true,
  });
  assert.equal(시간축소.status, 200, `운영시간 축소 실패: ${시간축소.text}`);
  assert.equal(시간축소.body.openTime, '13:00');
  const 잔존 = await 예약행(예약id);
  assert.ok(잔존, '운영시간 축소가 기존 예약을 지우면 안 된다');
  assert.equal(잔존.start_time, '09:00:00', '범위 밖 예약의 시각도 불변이다');

  // 참조를 제거하면 삭제된다.
  await query('DELETE FROM reservations WHERE id = $1', [예약id]);
  const 삭제 = await 관리자호출('DELETE', `/practice-rooms/${대상실id}`);
  assert.equal(삭제.status, 204, `참조 없는 연습실 삭제: status(${삭제.text})`);
  assert.equal(삭제.text.length, 0, '204는 본문이 없어야 한다');
  assert.equal(await 연습실행(대상실id), undefined, 'DB에서 연습실 행이 사라져야 한다');

  // 미존재 id는 409가 아니라 404다(존재 확인 선행 증명).
  const 미존재 = await 관리자호출('DELETE', '/practice-rooms/999999');
  assert.notEqual(미존재.status, 409, '미존재와 참조중을 같은 409로 뭉개면 안 된다');
  assert.equal(미존재.status, 404, `미존재 연습실 삭제: status(${미존재.text})`);
  assert.equal(미존재.body.code, 'PRACTICE_ROOM_NOT_FOUND');
  assert.equal(미존재.body.message, '연습실을 찾을 수 없습니다.');

  // 미존재 연습실 수정도 swagger가 정의한 404다(게시판 PATCH와 대칭).
  const 미존재수정 = await 관리자호출('PATCH', '/practice-rooms/999999', {
    name: `${PREFIX}없는연습실`,
    capacity: 2,
    openTime: '09:00',
    closeTime: '22:00',
  });
  assert.equal(미존재수정.status, 404, `미존재 연습실 수정: status(${미존재수정.text})`);
  assert.equal(미존재수정.body.code, 'PRACTICE_ROOM_NOT_FOUND');
  assert.equal(미존재수정.body.message, '연습실을 찾을 수 없습니다.');
});

// ── E. 예약 강제취소 (완료조건 ④) ──────────────────────────────────────────

test('E-1 관리자는 임의 예약을 강제 취소할 수 있다', async () => {
  // 픽스처 예약은 **전용 be10- 연습실**에 넣는다 — roomId 필터 건수가 결정적이 되고
  // 다른 테스트 파일의 예약과 슬롯이 겹치지 않는다.
  const 실생성 = await 관리자호출('POST', '/practice-rooms', {
    name: `${PREFIX}예약관리연습실`,
    location: '5층',
    capacity: 2,
    openTime: '09:00',
    closeTime: '22:00',
    isActive: true,
  });
  assert.equal(실생성.status, 201, `예약관리 연습실 생성 실패: ${실생성.text}`);
  E실id = 실생성.body.id;

  // 강제취소 대상은 **관리자 본인이 아닌 회원**의 **이미 시작된(과거)** 예약이다.
  E예약 = {
    강제취소: await 예약삽입({
      roomId: E실id,
      memberId: 일반회원.member.id,
      date: 강제취소날짜,
      startTime: '09:00',
      endTime: '10:00',
    }),
    완료: await 예약삽입({
      roomId: E실id,
      memberId: 일반회원.member.id,
      date: 완료날짜,
      startTime: '09:00',
      endTime: '10:00',
      status: 'completed',
    }),
    필터: await 예약삽입({
      roomId: E실id,
      memberId: 일반회원.member.id,
      date: 필터날짜,
      startTime: '09:00',
      endTime: '10:00',
    }),
  };

  // (a) 전체 목록 — 스키마 단정.
  const 전체 = await 관리자호출('GET', '/reservations');
  assert.equal(전체.status, 200, `예약 목록 조회 실패: ${전체.text}`);
  assert.ok(Array.isArray(전체.body), '응답은 맨 배열이어야 한다');
  const 대상 = 전체.body.find((항목) => 항목.id === E예약.강제취소);
  assert.ok(대상, '픽스처 예약이 전체 목록에 있어야 한다');
  assert.deepEqual(Object.keys(대상).sort(), 예약키, 'Reservation은 정확히 8개 키다');
  // to_char 누락 시 하루 어긋난 ISO 문자열('2000-01-04T15:00:00.000Z')이 실린다.
  assert.equal(대상.reservationDate, 강제취소날짜, "reservationDate는 'YYYY-MM-DD' 문자열이다");
  assert.equal(대상.reservationDate.length, 10, 'ISO 문자열이 아니라 10자여야 한다');
  assert.equal(대상.startTime.length, 5, "startTime은 5자 'HH:mm'이다");
  assert.equal(대상.endTime.length, 5, "endTime은 5자 'HH:mm'이다");
  for (const 금지 of ['memberName', 'practiceRoomName', 'hasStarted', 'canCancel']) {
    assert.equal(금지 in 대상, false, `${금지}는 swagger 미정의 필드다`);
  }

  // (b) 필터 적용.
  const 실필터 = await 관리자호출('GET', `/reservations?roomId=${E실id}`);
  assert.equal(실필터.status, 200, `roomId 필터: status(${실필터.text})`);
  assert.equal(실필터.body.length, 3, '이 연습실의 픽스처 3건만 반환되어야 한다');
  assert.deepEqual(
    실필터.body.map((항목) => 항목.id).sort((a, b) => a - b),
    Object.values(E예약).sort((a, b) => a - b),
    '상태 필터가 없으므로 completed·reserved가 모두 조회된다',
  );
  for (const 항목 of 실필터.body) {
    assert.equal(항목.practiceRoomId, E실id, '필터한 연습실의 예약만 있어야 한다');
  }

  const 날짜필터 = await 관리자호출('GET', `/reservations?date=${필터날짜}`);
  assert.equal(날짜필터.status, 200, `date 필터: status(${날짜필터.text})`);
  assert.ok(
    날짜필터.body.some((항목) => 항목.id === E예약.필터),
    'date 필터 결과에 그 날짜의 픽스처가 있어야 한다',
  );
  for (const 항목 of 날짜필터.body) {
    assert.equal(항목.reservationDate, 필터날짜, 'date 필터 결과는 모두 그 날짜여야 한다');
  }

  const 둘다 = await 관리자호출('GET', `/reservations?roomId=${E실id}&date=${필터날짜}`);
  assert.equal(둘다.status, 200, `두 필터 동시 적용: status(${둘다.text})`);
  assert.equal(둘다.body.length, 1, '두 필터는 AND로 결합된다');
  assert.equal(둘다.body[0].id, E예약.필터);

  const 미존재실 = await 관리자호출('GET', '/reservations?roomId=999999');
  assert.notEqual(미존재실.status, 404, '미존재 roomId는 404가 아니라 200 + 빈 배열이다');
  assert.equal(미존재실.status, 200, `미존재 roomId: status(${미존재실.text})`);
  assert.deepEqual(미존재실.body, [], '미존재 roomId 필터 결과는 빈 배열이다');

  // (c) 형식 불량 필터 — 이 경로에 400이 정의되어 있지 않으므로 필터를 떨어뜨린다.
  // date를 검증 없이 $2::date에 넘기면 pg 22007 → 500이 된다.
  const 픽스처ids = Object.values(E예약);
  for (const 쿼리 of [
    '?roomId=abc',
    '?roomId=0',
    '?roomId=-1',
    '?roomId=1.5',
    '?roomId=99999999999',
    '?roomId=',
    `?date=2096-13-45`,
    '?date=abc',
    '?date=20961231',
    '?date=',
  ]) {
    const 응답 = await 관리자호출('GET', `/reservations${쿼리}`);
    assert.notEqual(응답.status, 500, `${쿼리}: pg 22P02·22003·22007이 500으로 새면 안 된다`);
    assert.notEqual(응답.status, 400, `${쿼리}: 이 경로에 400은 정의되어 있지 않다`);
    assert.equal(응답.status, 200, `${쿼리}: status(${응답.text})`);
    const ids = 응답.body.map((항목) => 항목.id);
    for (const id of 픽스처ids) {
      assert.ok(ids.includes(id), `${쿼리}: 필터가 미적용되어 픽스처 ${id}가 포함되어야 한다`);
    }
  }

  // (d) 타인 소유·이미 시작된 예약 강제취소 → 200.
  const 강제취소 = await 관리자호출('PATCH', `/reservations/${E예약.강제취소}/cancel`);
  assert.equal(강제취소.status, 200, `강제취소 실패: ${강제취소.text}`);
  assert.deepEqual(Object.keys(강제취소.body).sort(), 예약키, 'Reservation은 정확히 8개 키다');
  assert.equal(강제취소.body.reservationStatus, 'canceled');
  assert.equal(강제취소.body.memberId, 일반회원.member.id, '강제취소가 예약자를 바꾸면 안 된다');
  assert.equal(강제취소.body.practiceRoomId, E실id);
  assert.equal(강제취소.body.reservationDate, 강제취소날짜);
  assert.equal(강제취소.body.startTime, '09:00');

  const 행 = await 예약행(E예약.강제취소);
  assert.ok(행, '강제취소는 행 삭제가 아니다 — 이력이 남아야 한다');
  assert.equal(행.reservation_status, 'canceled', 'DB 상태가 canceled여야 한다');
  assert.equal(행.member_id, 일반회원.member.id, 'DB의 예약자도 불변이다');

  // (e) 같은 예약 재요청 → 200 멱등(상태 가드가 없으므로 400·409가 아니다).
  const 재요청 = await 관리자호출('PATCH', `/reservations/${E예약.강제취소}/cancel`);
  assert.notEqual(재요청.status, 400, '이 경로에 400은 정의되어 있지 않다(§8-3)');
  assert.notEqual(재요청.status, 409, '이 경로에 409는 정의되어 있지 않다(§8-3)');
  assert.equal(재요청.status, 200, `재요청 멱등: status(${재요청.text})`);
  assert.equal(재요청.body.reservationStatus, 'canceled');

  // (f) completed 예약도 canceled로 덮는다(§8-3 채택 결정 고정).
  // 일반 경로(BE-09)는 같은 대상에 400을 내며, 이 공존이 "판정 비공유"의 증거다.
  const 완료강제취소 = await 관리자호출('PATCH', `/reservations/${E예약.완료}/cancel`);
  assert.equal(완료강제취소.status, 200, `completed 강제취소: status(${완료강제취소.text})`);
  assert.equal(완료강제취소.body.reservationStatus, 'canceled');
  assert.equal(
    (await 예약행(E예약.완료)).reservation_status,
    'canceled',
    'DB에서도 canceled로 덮인다',
  );

  // (g) 미존재·형식 불량 reservationId → 404.
  for (const id of [999999, 'abc', '0', '-1', '1.5', '99999999999']) {
    const 응답 = await 관리자호출('PATCH', `/reservations/${id}/cancel`);
    assert.notEqual(응답.status, 500, `id=${id}: pg 22P02·22003이 500으로 새면 안 된다`);
    assert.notEqual(응답.status, 400, `id=${id}: 이 경로에 400은 정의되어 있지 않다`);
    assert.equal(응답.status, 404, `id=${id}: status(${응답.text})`);
    assert.equal(응답.body.code, 'NOT_FOUND', `id=${id}: code`);
    assert.equal(응답.body.message, '예약을 찾을 수 없습니다.', `id=${id}: message`);
  }
});

// ── F. 회귀 ─────────────────────────────────────────────────────────────────

test('F-1 라우터 마운트가 기존 경로를 깨지 않는다', async () => {
  const 헬스 = await 요청('GET', '/health');
  assert.equal(헬스.status, 200, '/health를 router.use 아래로 옮기면 깨진다');
  assert.deepEqual(헬스.body, { status: 'ok', db: 'ok' });

  const 없는경로 = await 요청('GET', '/없는-경로');
  assert.equal(없는경로.status, 404);
  assert.equal(없는경로.body.code, 'NOT_FOUND');

  const 로그인 = await 요청('POST', '/api/auth/login', {
    email: 일반회원.email,
    password: 시드비밀번호,
  });
  assert.equal(로그인.status, 200, 'admin 라우터 추가가 기존 auth 라우트를 가리면 안 된다');
  assert.equal(typeof 로그인.body.accessToken, 'string');

  const 게시판목록 = await 요청('GET', '/api/boards', undefined, bearer(일반회원.accessToken));
  assert.equal(게시판목록.status, 200, `GET /api/boards가 살아 있어야 한다: ${게시판목록.text}`);
  assert.ok(Array.isArray(게시판목록.body));

  const 연습실목록 = await 요청(
    'GET',
    '/api/practice-rooms',
    undefined,
    bearer(일반회원.accessToken),
  );
  assert.equal(연습실목록.status, 200, `GET /api/practice-rooms가 살아 있어야 한다: ${연습실목록.text}`);
  assert.ok(Array.isArray(연습실목록.body));

  // **BE-09의 일반 취소 경로가 /api/admin/reservations에 가려지지 않는지** 실제로 호출해 확인한다.
  const 취소대상 = await 예약삽입({
    roomId: 시드활성실id,
    memberId: 일반회원.member.id,
    date: 취소생존날짜,
    startTime: '09:00',
    endTime: '10:00',
  });
  const 일반취소 = await 요청(
    'PATCH',
    `/api/reservations/${취소대상}/cancel`,
    undefined,
    bearer(일반회원.accessToken),
  );
  assert.notEqual(일반취소.status, 404, 'BE-09 취소 경로가 살아 있어야 한다');
  assert.equal(일반취소.status, 200, `일반 회원 취소: status(${일반취소.text})`);
  assert.equal(일반취소.body.reservationStatus, 'canceled');
  assert.equal((await 예약행(취소대상)).reservation_status, 'canceled');
});

test('F-2 swagger에 없는 관리자 경로·메서드는 404다', async () => {
  // 발명 금지 목록의 회귀 방어(계획서 §2-1·§12-2). 등급 삭제 API 미생성이 최우선이다(기술고려 7).
  assert.ok(B3등급id, '전제: B-3 등급이 있어야 한다');
  assert.ok(E예약.필터, '전제: E-1 예약이 있어야 한다');

  const 경로들 = [
    ['DELETE', `/api/admin/member-grades/${B3등급id}`, undefined],
    ['GET', `/api/admin/boards/${정회원게시판.id}`, undefined],
    ['GET', `/api/admin/practice-rooms/${시드활성실id}`, undefined],
    ['DELETE', `/api/admin/members/${일반회원.member.id}`, undefined],
    ['PATCH', `/api/admin/members/${일반회원.member.id}`, { name: '만들면안됨' }],
    ['POST', '/api/admin/reservations', { practiceRoomId: 시드활성실id }],
    ['GET', `/api/admin/reservations/${E예약.필터}`, undefined],
  ];

  for (const [메서드, 경로, 본문] of 경로들) {
    const 이름 = `${메서드} ${경로}`;
    // **관리자 토큰으로** 호출한다 — 403이면 라우트가 존재한다는 뜻이므로 그것이 실패 신호다.
    const 응답 = await 요청(메서드, 경로, 본문, bearer(관리자.accessToken));
    assert.notEqual(응답.status, 403, `${이름}: 403이면 라우트가 존재하는 것이다`);
    assert.notEqual(응답.status, 405, `${이름}: Express는 405를 쓰지 않는다`);
    assert.notEqual(응답.status, 500, `${이름}: 500이 나오면 안 된다`);
    assert.equal(응답.status, 404, `${이름}: status(${응답.text})`);
    assert.equal(응답.body.code, 'NOT_FOUND', `${이름}: code`);
    assert.equal(
      응답.body.message,
      '요청한 경로를 찾을 수 없습니다.',
      `${이름}: 라우트 미존재(notFoundHandler)의 문구여야 한다`,
    );
  }

  // 등급 삭제 API가 없으므로 등급 행은 그대로 남아 있어야 한다.
  assert.ok(await 등급행(B3등급id), 'DELETE 요청으로 등급이 삭제되면 안 된다');
});

// ── 정리 ────────────────────────────────────────────────────────────────────

test.after(async () => {
  await 정리();
  await pool.end();
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});
