'use strict';

require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const app = require('../src/app');
const { pool, query } = require('../src/db/pool');
const boardService = require('../src/services/board-service');

// ── 상수 ────────────────────────────────────────────────────────────────────
// 이 파일은 게시판·회원 데이터를 **하나도 만들지 않는다**. docs/seed-dev.sql이 넣은 행을
// 읽기 전용으로만 사용하며 INSERT·UPDATE·DELETE를 한 줄도 실행하지 않는다(계획서 §9-2).
// 그래서 정리 훅도 없다 — test.after는 pool.end()와 서버 close만 한다.
const 시드비밀번호 = 'Test1234!';

const 준회원계정 = 'junior1@clubhome.local'; // grade_level 10
const 정회원계정 = 'senior@clubhome.local'; // grade_level 20
const 관리자계정 = 'admin@clubhome.local'; // grade_level 30, is_admin

// 시드 게시판 이름. id는 IDENTITY이고 seed-dev.sql이 NOT EXISTS 가드를 쓰므로
// 재실행 이력에 따라 값이 달라진다 → **id를 하드코딩하지 않고 이름으로 조회한다**(계획서 §9-2).
const 자유게시판명 = '자유게시판'; // min 10, 활성
const 정회원게시판명 = '정회원 게시판'; // min 20, 활성
const 운영진게시판명 = '운영진 전용'; // min 30, 활성
const 비활성게시판명 = '이전 공지(보관)'; // min 30, 비활성

// swagger Board 스키마의 키 집합(정렬본).
// 목록은 canAccess를 포함해 6개, 상세는 canAccess가 없어 5개다(계획서 §3.2-e).
const 목록키 = ['canAccess', 'description', 'id', 'isActive', 'minGradeLevel', 'name'];
const 상세키 = ['description', 'id', 'isActive', 'minGradeLevel', 'name'];

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

/**
 * 로그인으로 세션을 얻는다. signAccessToken을 직접 호출하지 않는 이유:
 * BE-05의 실제 통합 위험은 "로그인이 실어 준 gradeLevel 클레임이
 * requireAuth → controller → service까지 온전히 전달되는가"이며,
 * 토큰을 손으로 만들면 그 경로가 검증되지 않는다(계획서 §9-1).
 */
async function 세션(email) {
  const 응답 = await 요청('POST', '/api/auth/login', { email, password: 시드비밀번호 });
  assert.equal(응답.status, 200, `시드 계정 ${email} 로그인 실패(seed-dev.sql 적용 확인): ${응답.text}`);
  return 응답.body; // { accessToken, refreshToken, member }
}

/** 만료·위조 토큰만 직접 서명한다. 시크릿은 환경변수에서만 읽는다. */
const 만료Access토큰 = ({ memberId, gradeLevel, isAdmin }) =>
  jwt.sign({ memberId, gradeLevel, isAdmin, typ: 'access' }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: '-1s',
  });

/** 서명 마지막 문자를 변조한다. */
const 위조 = (토큰) => 토큰.slice(0, -1) + (토큰.slice(-1) === 'A' ? 'B' : 'A');

/** 게시판 목록 조회 단축 헬퍼. */
const 목록 = (토큰) => 요청('GET', '/api/boards', undefined, bearer(토큰));

/** 게시판 상세 조회 단축 헬퍼. boardId는 URL에 그대로 이어 붙인다. */
const 상세 = (토큰, boardId) => 요청('GET', `/api/boards/${boardId}`, undefined, bearer(토큰));

/** 목록 응답에서 이름으로 원소 1건을 찾는다. */
const 찾기 = (body, 이름) => body.find((board) => board.name === 이름);

// ── 공유 픽스처 ─────────────────────────────────────────────────────────────
let 준회원; // 세션 (gradeLevel 10)
let 정회원; // 세션 (gradeLevel 20)
let 관리자; // 세션 (gradeLevel 30, isAdmin)
let 시드게시판; // { [name]: { id, name, min_grade_level, is_active } }
let D6수집상태 = []; // D-6이 수집하고 E-5가 검증한다

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  // 시드 게시판 4건을 이름으로 조회한다. 여기서 실패하면 원인이 명확해야 한다.
  시드게시판 = {};
  for (const 이름 of [자유게시판명, 정회원게시판명, 운영진게시판명, 비활성게시판명]) {
    const { rows } = await query(
      'SELECT id, name, min_grade_level, is_active FROM boards WHERE name = $1',
      [이름],
    );
    assert.equal(
      rows.length,
      1,
      `시드 게시판 '${이름}'이 정확히 1건 있어야 한다(조회 ${rows.length}건). docs/seed-dev.sql이 clubhome DB에 적용되었는지 확인하라.`,
    );
    시드게시판[이름] = rows[0];
  }

  // 시드 전제 가드: 등급·활성 여부가 계획서 §9-2 표와 일치해야 이후 기대값이 성립한다.
  const 기대 = {
    [자유게시판명]: { min_grade_level: 10, is_active: true },
    [정회원게시판명]: { min_grade_level: 20, is_active: true },
    [운영진게시판명]: { min_grade_level: 30, is_active: true },
    [비활성게시판명]: { min_grade_level: 30, is_active: false },
  };
  for (const [이름, 값] of Object.entries(기대)) {
    assert.equal(시드게시판[이름].min_grade_level, 값.min_grade_level, `${이름}: min_grade_level`);
    assert.equal(시드게시판[이름].is_active, 값.is_active, `${이름}: is_active`);
  }

  준회원 = await 세션(준회원계정);
  정회원 = await 세션(정회원계정);
  관리자 = await 세션(관리자계정);

  assert.equal(준회원.member.memberGrade.gradeLevel, 10, '시드 junior1은 준회원(10)이어야 한다');
  assert.equal(정회원.member.memberGrade.gradeLevel, 20, '시드 senior는 정회원(20)이어야 한다');
  assert.equal(관리자.member.memberGrade.gradeLevel, 30, '시드 admin은 운영진(30)이어야 한다');
});

// ── A. GET /api/boards — 인증·기본 동작 ─────────────────────────────────────

test('A-1 준회원 목록 조회는 200과 Board[] 를 반환하고 각 원소 키가 6개다', async () => {
  const 응답 = await 목록(준회원.accessToken);
  assert.equal(응답.status, 200);
  assert.ok(Array.isArray(응답.body), '응답은 배열이어야 한다({boards: [...]} 래퍼 금지)');
  assert.ok(응답.body.length > 0, '시드 활성 게시판 3건이 있어야 한다');
  for (const board of 응답.body) {
    assert.deepEqual(Object.keys(board).sort(), 목록키, `${board.name}: Board는 정확히 6개 키다`);
    assert.ok(Number.isInteger(board.id));
    assert.equal(typeof board.name, 'string');
    assert.equal(typeof board.minGradeLevel, 'number');
    assert.equal(typeof board.isActive, 'boolean');
    assert.equal(typeof board.canAccess, 'boolean');
  }
});

test('A-2 비활성 게시판은 목록에 노출되지 않는다', async () => {
  // 완료조건 3 전반. 건수를 상수로 단정하지 않고 "모든 원소가 활성"임을 단정한다.
  const 응답 = await 목록(준회원.accessToken);
  assert.equal(응답.status, 200);
  for (const board of 응답.body) {
    assert.equal(board.isActive, true, `${board.name}: 목록에는 활성 게시판만 있어야 한다`);
  }
  assert.equal(찾기(응답.body, 비활성게시판명), undefined, `'${비활성게시판명}'이 노출되면 안 된다`);
});

test('A-3 관리자도 비활성 게시판을 목록에서 볼 수 없다', async () => {
  // §6-2 회귀 방어: if (isAdmin) { 비활성 포함 } 분기를 넣으면 여기서 깨진다.
  // 비활성 게시판 전체 목록은 BE-10의 GET /api/admin/boards 책임이다.
  const 응답 = await 목록(관리자.accessToken);
  assert.equal(응답.status, 200);
  for (const board of 응답.body) {
    assert.equal(board.isActive, true, `${board.name}: 관리자에게도 활성만 보여야 한다`);
  }
  assert.equal(찾기(응답.body, 비활성게시판명), undefined, '관리자에게도 특례가 없어야 한다');
});

test('A-4 목록 정렬이 결정적이다(minGradeLevel 비내림차순, 반복 호출 순서 동일)', async () => {
  const 첫번째 = await 목록(준회원.accessToken);
  const 두번째 = await 목록(준회원.accessToken);
  assert.equal(첫번째.status, 200);
  assert.equal(두번째.status, 200);

  const 등급들 = 첫번째.body.map((board) => board.minGradeLevel);
  for (let i = 1; i < 등급들.length; i += 1) {
    assert.ok(등급들[i - 1] <= 등급들[i], `ORDER BY min_grade_level ASC 위반: ${등급들}`);
  }
  assert.deepEqual(
    두번째.body.map((board) => board.id),
    첫번째.body.map((board) => board.id),
    'ORDER BY가 없으면 요청마다 순서가 흔들린다',
  );
});

test('A-5 Authorization 헤더 없는 목록 조회는 401이고 본문 키가 code·message 둘뿐이다', async () => {
  const 응답 = await 요청('GET', '/api/boards');
  assert.equal(응답.status, 401);
  assert.deepEqual(Object.keys(응답.body).sort(), ['code', 'message']);
  assert.equal(응답.body.code, 'UNAUTHORIZED');
});

test('A-6 만료 Access Token 목록 조회는 401 TOKEN_EXPIRED로 거부된다', async () => {
  const 토큰 = 만료Access토큰({
    memberId: 준회원.member.id,
    gradeLevel: 준회원.member.memberGrade.gradeLevel,
    isAdmin: 준회원.member.memberGrade.isAdmin,
  });
  const 응답 = await 목록(토큰);
  assert.equal(응답.status, 401);
  assert.equal(응답.body.code, 'TOKEN_EXPIRED');
});

test('A-7 위조 Access Token 목록 조회는 401 UNAUTHORIZED로 거부된다', async () => {
  const 응답 = await 목록(위조(준회원.accessToken));
  assert.equal(응답.status, 401);
  assert.equal(응답.body.code, 'UNAUTHORIZED');
});

// ── B. GET /api/boards — canAccess 판정 ─────────────────────────────────────

test('B-1 준회원(10)의 canAccess는 와이어프레임 화면 6과 일치한다', async () => {
  const 응답 = await 목록(준회원.accessToken);
  const 기대 = {
    [자유게시판명]: true, // 10 >= 10
    [정회원게시판명]: false, // 10 < 20 → 잠금 표시
    [운영진게시판명]: false, // 10 < 30 → 잠금 표시
  };
  for (const [이름, canAccess] of Object.entries(기대)) {
    const board = 찾기(응답.body, 이름);
    assert.ok(board, `'${이름}'이 목록에 있어야 한다(접근 불가도 잠금 표시용으로 포함)`);
    assert.equal(board.canAccess, canAccess, `${이름}: canAccess`);
  }
});

test('B-2 동일 등급 경계값은 canAccess true다(>= 검증)', async () => {
  // `>`로 잘못 구현하면 준회원이 자유게시판에 접근할 수 없어 서비스가 사실상 마비된다.
  const 응답 = await 목록(준회원.accessToken);
  const 자유 = 찾기(응답.body, 자유게시판명);
  assert.equal(자유.minGradeLevel, 준회원.member.memberGrade.gradeLevel, '경계값 전제(10 == 10)');
  assert.equal(자유.canAccess, true, '"이상"이므로 동일 등급도 통과해야 한다');
});

test('B-3 정회원(20)의 canAccess가 등급에 맞게 계산된다', async () => {
  const 응답 = await 목록(정회원.accessToken);
  assert.equal(찾기(응답.body, 자유게시판명).canAccess, true); // 20 >= 10
  assert.equal(찾기(응답.body, 정회원게시판명).canAccess, true); // 20 >= 20 (경계값)
  assert.equal(찾기(응답.body, 운영진게시판명).canAccess, false); // 20 < 30
});

test('B-4 관리자(30)는 활성 게시판 전부가 canAccess true다', async () => {
  const 응답 = await 목록(관리자.accessToken);
  for (const board of 응답.body) {
    assert.equal(board.canAccess, true, `${board.name}: 최상위 등급은 모두 접근 가능해야 한다`);
  }
});

test('B-5 목록은 등급으로 행을 걸러내지 않는다(3개 등급의 id 집합이 동일)', async () => {
  // §11-1 최우선 회귀 방어. WHERE min_grade_level <= $1 오구현을 잡는 유일한 케이스다.
  // 등급 필터가 SQL로 내려가면 canAccess가 항상 true가 되고 FE-05의 잠금 표시 데이터가 사라진다.
  const 응답들 = await Promise.all([
    목록(준회원.accessToken),
    목록(정회원.accessToken),
    목록(관리자.accessToken),
  ]);
  const [준, 정, 관] = 응답들.map((응답) => 응답.body.map((board) => board.id));
  assert.deepEqual(정, 준, '정회원 목록의 id 집합이 준회원과 같아야 한다');
  assert.deepEqual(관, 준, '관리자 목록의 id 집합이 준회원과 같아야 한다');
});

test('B-6 목록 조회는 어떤 회원에게도 403을 반환하지 않는다', async () => {
  // swagger /api/boards responses에 403이 정의되어 있지 않다.
  for (const [이름, 세션값] of [
    ['준회원', 준회원],
    ['정회원', 정회원],
    ['관리자', 관리자],
  ]) {
    const 응답 = await 목록(세션값.accessToken);
    assert.equal(응답.status, 200, `${이름}: 목록은 거부되지 않는다`);
  }
});

// ── C. GET /api/boards/{boardId} — 성공 경로 ────────────────────────────────

test('C-1 준회원이 자유게시판(10) 상세를 조회하면 200이다', async () => {
  // 완료조건 1.
  const 시드 = 시드게시판[자유게시판명];
  const 응답 = await 상세(준회원.accessToken, 시드.id);
  assert.equal(응답.status, 200, `상세 조회 실패: ${응답.text}`);
  assert.equal(응답.body.id, 시드.id);
  assert.equal(응답.body.name, 시드.name);
  assert.equal(응답.body.minGradeLevel, 시드.min_grade_level);
  assert.equal(응답.body.isActive, true);
  assert.equal(typeof 응답.body.description, 'string');
});

test('C-2 상세 응답에는 canAccess가 없다', async () => {
  // swagger Board.canAccess 원문: "목록 조회 시에만 포함".
  // 200을 받은 것 자체가 canAccess === true의 증거다.
  const 응답 = await 상세(준회원.accessToken, 시드게시판[자유게시판명].id);
  assert.equal(응답.status, 200);
  assert.deepEqual(Object.keys(응답.body).sort(), 상세키, '상세 Board는 정확히 5개 키다');
  assert.equal('canAccess' in 응답.body, false);
});

test('C-3 정회원이 정회원 게시판(20) 상세를 조회하면 200이다(경계값)', async () => {
  const 시드 = 시드게시판[정회원게시판명];
  const 응답 = await 상세(정회원.accessToken, 시드.id);
  assert.equal(응답.status, 200, '20 >= 20이므로 통과해야 한다(`>`로 구현하면 403이 된다)');
  assert.equal(응답.body.minGradeLevel, 20);
});

test('C-4 관리자가 운영진 전용(30) 상세를 조회하면 200이다', async () => {
  const 시드 = 시드게시판[운영진게시판명];
  const 응답 = await 상세(관리자.accessToken, 시드.id);
  assert.equal(응답.status, 200);
  assert.equal(응답.body.id, 시드.id);
  assert.equal(응답.body.minGradeLevel, 30);
});

test('C-5 상세 응답에 게시글 관련 필드가 없다', async () => {
  // §8, BE-06 경계 회귀 방어. posts 테이블을 참조하는 SQL이 board-repository에 없어야 한다.
  const 응답 = await 상세(준회원.accessToken, 시드게시판[자유게시판명].id);
  assert.equal(응답.status, 200);
  for (const 키 of ['posts', 'postCount', 'latestPost', 'latestPosts']) {
    assert.equal(키 in 응답.body, false, `${키} 키가 없어야 한다`);
  }
});

// ── D. GET /api/boards/{boardId} — 실패 경로 ────────────────────────────────

test('D-1 준회원이 정회원 게시판(20)에 접근하면 403 FORBIDDEN이다', async () => {
  // 완료조건 2.
  const 응답 = await 상세(준회원.accessToken, 시드게시판[정회원게시판명].id);
  assert.equal(응답.status, 403);
  assert.equal(응답.body.code, 'FORBIDDEN');
  assert.equal(응답.body.message, '이용 권한이 없는 게시판입니다.');
  assert.deepEqual(Object.keys(응답.body).sort(), ['code', 'message']);
});

test('D-2 정회원이 운영진 전용(30)에 접근하면 403 FORBIDDEN이다', async () => {
  const 응답 = await 상세(정회원.accessToken, 시드게시판[운영진게시판명].id);
  assert.equal(응답.status, 403);
  assert.equal(응답.body.code, 'FORBIDDEN');
  assert.equal(응답.body.message, '이용 권한이 없는 게시판입니다.');
});

test('D-3 준회원이 비활성 게시판에 접근하면 403이 아니라 404다', async () => {
  // §7-3: 비활성 게시판에 403을 주면 관리자가 숨긴 게시판의 존재가 확인된다.
  const 응답 = await 상세(준회원.accessToken, 시드게시판[비활성게시판명].id);
  assert.equal(응답.status, 404, '미존재와 비활성은 같은 404로 통일한다');
  assert.equal(응답.body.code, 'NOT_FOUND');
  assert.equal(응답.body.message, '게시판을 찾을 수 없습니다.');
});

test('D-4 관리자도 비활성 게시판 상세는 404다', async () => {
  // 완료조건 3 후반 + §6-2. 관리자의 등급은 충족(30 >= 30)이므로 이 케이스가 404여야만
  // "활성 검사가 등급 검사보다 먼저"임이 증명된다. 검사 순서가 뒤집히면 여기서 깨진다.
  const 시드 = 시드게시판[비활성게시판명];
  assert.ok(
    관리자.member.memberGrade.gradeLevel >= 시드.min_grade_level,
    '전제: 관리자 등급이 비활성 게시판 최소등급을 충족해야 이 케이스가 순서를 증명한다',
  );
  const 응답 = await 상세(관리자.accessToken, 시드.id);
  assert.equal(응답.status, 404, '등급이 충족되더라도 비활성이면 404다');
  assert.equal(응답.body.code, 'NOT_FOUND');
  assert.equal(응답.body.message, '게시판을 찾을 수 없습니다.');
});

test('D-5 존재하지 않는 boardId는 404 NOT_FOUND다', async () => {
  const 응답 = await 상세(관리자.accessToken, 999999);
  assert.equal(응답.status, 404);
  assert.equal(응답.body.code, 'NOT_FOUND');
  assert.equal(응답.body.message, '게시판을 찾을 수 없습니다.');
});

test('D-6 인증 실패 3종은 403·404가 아니라 모두 401이다', async () => {
  // 대상은 준회원 기준 등급 미달 게시판이다 — requireAuth가 빠지면 403/404/500이 나온다.
  const boardId = 시드게시판[정회원게시판명].id;
  const 만료 = 만료Access토큰({
    memberId: 준회원.member.id,
    gradeLevel: 준회원.member.memberGrade.gradeLevel,
    isAdmin: 준회원.member.memberGrade.isAdmin,
  });
  const 헤더들 = {
    헤더없음: {},
    만료토큰: bearer(만료),
    위조토큰: bearer(위조(준회원.accessToken)),
  };
  const 기대코드 = { 헤더없음: 'UNAUTHORIZED', 만료토큰: 'TOKEN_EXPIRED', 위조토큰: 'UNAUTHORIZED' };

  D6수집상태 = [];
  for (const [이름, 헤더] of Object.entries(헤더들)) {
    const 응답 = await 요청('GET', `/api/boards/${boardId}`, undefined, 헤더);
    D6수집상태.push(응답.status);
    assert.equal(응답.status, 401, `${이름}: 인증 실패는 401이다`);
    assert.equal(응답.body.code, 기대코드[이름], `${이름}: code`);
  }
});

test('D-7 정수가 아닌 boardId는 500이 아니라 404다', async () => {
  // 가드가 없으면 PostgreSQL 22P02(invalid_text_representation)가 500으로 새어나간다.
  // swagger가 이 경로에 400·500을 정의하지 않았으므로 404로 통일한다(§7-4).
  // '%20'(공백만인 값)은 Number(' ') === 0 경로로 parseBoardId의 빈 값 분기를 재현한다.
  // 빈 세그먼트('/api/boards/')는 Express가 목록 라우트로 매치하므로 상세 케이스가 아니다.
  for (const boardId of ['abc', '1.5', '%20', '-1', '0', 'null', '1abc']) {
    const 응답 = await 상세(관리자.accessToken, boardId);
    assert.notEqual(응답.status, 500, `'${boardId}': DB 오류가 500으로 새면 안 된다`);
    assert.equal(응답.status, 404, `'${boardId}': status`);
    assert.equal(응답.body.code, 'NOT_FOUND', `'${boardId}': code`);
    assert.equal(응답.body.message, '게시판을 찾을 수 없습니다.', `'${boardId}': message`);
  }

  const 빈세그먼트 = await 요청('GET', '/api/boards/', undefined, bearer(관리자.accessToken));
  assert.equal(빈세그먼트.status, 200, '빈 세그먼트는 목록 라우트로 매치된다(500이 아님)');
});

test('D-8 INTEGER 범위를 초과한 boardId는 500이 아니라 404다', async () => {
  // boards.id는 INTEGER다. 가드가 없으면 22003(numeric_value_out_of_range)이 500이 된다.
  for (const boardId of [9999999999, 2147483648]) {
    const 응답 = await 상세(관리자.accessToken, boardId);
    assert.notEqual(응답.status, 500, `${boardId}: 22003이 500으로 새면 안 된다`);
    assert.equal(응답.status, 404, `${boardId}: status`);
    assert.equal(응답.body.code, 'NOT_FOUND', `${boardId}: code`);
  }

  // 경계값 2147483647은 범위 안이므로 500이 아니라 정상적인 404(미존재)여야 한다.
  const 경계 = await 상세(관리자.accessToken, 2147483647);
  assert.equal(경계.status, 404, 'INTEGER 최댓값은 유효 범위이므로 미존재 404다');
});

// ── E. 인가 위치 (완료조건 4) ───────────────────────────────────────────────

test('E-1 service 직접 호출로 403이 재현된다', async () => {
  // 완료조건 4의 직접 증거: 미들웨어·라우터·컨트롤러를 거치지 않고 인가가 성립한다.
  await assert.rejects(
    () => boardService.getAccessibleBoard(시드게시판[정회원게시판명].id, 10),
    (error) => {
      assert.equal(error.status, 403, '등급 미달은 403이다');
      assert.equal(error.code, 'FORBIDDEN');
      assert.equal(error.message, '이용 권한이 없는 게시판입니다.');
      return true;
    },
  );
});

test('E-2 service 직접 호출로 404가 재현된다', async () => {
  const 케이스들 = [
    ['비활성 게시판', 시드게시판[비활성게시판명].id, 30],
    ['미존재 게시판', 999999, 30],
  ];
  for (const [이름, boardId, gradeLevel] of 케이스들) {
    await assert.rejects(
      () => boardService.getAccessibleBoard(boardId, gradeLevel),
      (error) => {
        assert.equal(error.status, 404, `${이름}: status`);
        assert.equal(error.code, 'NOT_FOUND', `${이름}: code`);
        assert.equal(error.message, '게시판을 찾을 수 없습니다.', `${이름}: message`);
        return true;
      },
    );
  }
});

test('E-3 service 직접 호출의 성공 경로가 게시판을 반환한다', async () => {
  const 시드 = 시드게시판[자유게시판명];
  const board = await boardService.getAccessibleBoard(시드.id, 10);
  assert.equal(board.id, 시드.id);
  assert.equal(board.minGradeLevel, 10);
  assert.equal(board.isActive, true);
  assert.deepEqual(Object.keys(board).sort(), 상세키, 'service 반환값에도 canAccess가 없다');

  // 목록 service는 예외를 던지지 않고 canAccess를 붙인다.
  const boards = await boardService.getBoards(10);
  assert.ok(Array.isArray(boards));
  assert.equal(찾기(boards, 자유게시판명).canAccess, true);
  assert.equal(찾기(boards, 정회원게시판명).canAccess, false);
});

test('E-4 repository 소스는 등급을 알지 못한다', async () => {
  // 인가가 SQL로 내려가는 회귀 방어(§4-3). repository가 (min_grade_level <= $1) AS can_access
  // 형태로 판정을 내려받으면 여기서 깨진다.
  //
  // BE-10에서 판정 방식을 좁혔다. 원래는 식별자 'gradeLevel'을 금지 토큰에 넣어
  // "등급 값을 인자로 받는 것" 자체를 막았지만, 등급서열 재배치 시 FK 23503을 막는
  // countBoardsByMinGradeLevel(등호 COUNT, 인가 판정 아님)에 오탐했다. 실제로 막아야 하는
  // 것은 min_grade_level을 '비교'하는 SQL이므로 비교 연산자 형태를 양방향으로 열거한다
  // (식별자 이름 검사보다 좁고, 진짜 실패 형태에는 더 강하다).
  // 공백을 전부 제거한 뒤 검사한다 — 'min_grade_level <= $1'이든 'min_grade_level<=$1'이든
  // 줄바꿈으로 나눠 썼든 같은 형태로 걸린다. 서브쿼리를 통한 간접 비교는 여전히 우회
  // 가능하지만, 그런 형태는 등호 COUNT로 오해할 여지가 없어 리뷰 단계에서 드러난다.
  const 소스 = fs
    .readFileSync(path.join(__dirname, '..', 'src', 'repositories', 'board-repository.js'), 'utf8')
    .replace(/\s+/g, '');
  for (const 금지 of [
    // 'min_grade_level<'는 '<='까지 함께 잡는다. 반대로 '<=min_grade_level'은
    // '<min_grade_level'에 걸리지 않으므로(사이에 '=') 양쪽을 따로 열거한다.
    'min_grade_level<',
    'min_grade_level>',
    '<min_grade_level',
    '<=min_grade_level',
    '>min_grade_level',
    '>=min_grade_level',
    'min_grade_levelBETWEEN',
    'canAccess',
    'can_access',
  ]) {
    assert.equal(
      소스.includes(금지),
      false,
      `board-repository.js에 '${금지}'가 있으면 인가 판정이 SQL 레이어로 내려간 것이다`,
    );
  }
});

test('E-5 미들웨어는 403을 만들지 않는다', async () => {
  // D-6이 수집한 인증 실패 status가 전부 401이어야 한다.
  // 미들웨어가 등급을 판정하면(requireGrade 류) 여기에 403이 섞인다.
  assert.equal(D6수집상태.length, 3, 'D-6이 먼저 실행되어 status 3건을 수집해야 한다');
  for (const status of D6수집상태) {
    assert.equal(status, 401, '인증 실패는 401뿐이고 403이 섞이면 안 된다');
  }
});

// ── F. 회귀 ─────────────────────────────────────────────────────────────────

test('F-1 라우터 마운트 회귀: /health·미정의 경로·로그인이 그대로 동작한다', async () => {
  const 헬스 = await 요청('GET', '/health');
  assert.equal(헬스.status, 200, '/health를 router.use 아래로 옮기면 깨진다');
  assert.deepEqual(헬스.body, { status: 'ok', db: 'ok' });

  const 없는경로 = await 요청('GET', '/없는-경로');
  assert.equal(없는경로.status, 404);
  assert.equal(없는경로.body.code, 'NOT_FOUND');

  const 로그인 = await 요청('POST', '/api/auth/login', {
    email: 준회원계정,
    password: 시드비밀번호,
  });
  assert.equal(로그인.status, 200, 'board 라우터 추가가 기존 auth 라우트를 가리면 안 된다');
  assert.equal(typeof 로그인.body.accessToken, 'string');
});

test('F-2 swagger에 없는 메서드는 404다', async () => {
  // BE-10의 POST /api/admin/boards와 혼동해 여기에 생성 라우트를 붙이는 실수 방어.
  const 경로들 = [
    ['POST', '/api/boards'],
    ['PATCH', `/api/boards/${시드게시판[자유게시판명].id}`],
    ['DELETE', `/api/boards/${시드게시판[자유게시판명].id}`],
  ];
  for (const [메서드, 경로] of 경로들) {
    const 응답 = await 요청(메서드, 경로, { name: '만들면안됨' }, bearer(관리자.accessToken));
    assert.equal(응답.status, 404, `${메서드} ${경로}: BE-05는 GET 2개만 만든다`);
    assert.equal(응답.body.code, 'NOT_FOUND', `${메서드} ${경로}: code`);
  }
});

// ── 정리 ────────────────────────────────────────────────────────────────────

test.after(async () => {
  // 이 파일은 데이터를 만들지 않으므로 삭제할 것이 없다. 커넥션 풀과 서버만 닫는다
  // (pool.end()가 없으면 테스트 프로세스가 종료되지 않는다 — 계획서 §11-9).
  await pool.end();
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});
