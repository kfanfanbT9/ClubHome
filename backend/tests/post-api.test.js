'use strict';

require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const app = require('../src/app');
const { pool, query } = require('../src/db/pool');
const { signAccessToken } = require('../src/utils/jwt');
const { hashPassword } = require('../src/utils/password');
const postService = require('../src/services/post-service');

// ── 상수 ────────────────────────────────────────────────────────────────────
// 이 파일이 만드는 모든 게시글 제목과 회원 이메일의 접두사. 정리 훅이 이 상수 하나만 쓴다.
// **PATCH로 바꾸는 새 제목도 반드시 이 접두사로 시작해야 한다** — 접두사를 잃은 행은
// 정리 훅이 놓치고 posts.member_id의 FK RESTRICT 때문에 픽스처 회원 삭제가 실패한다
// (계획서 §10-1, §11 위험 8). 제목은 새제목() 헬퍼만으로 만든다.
const PREFIX = 'be06-';

// posts.id·boards.id는 INTEGER다. 초과 값이 SQL에 도달하면 22003 → 500이 된다.
const MAX_INT4 = 2147483647;

// docs/seed-dev.sql 계정. 읽기 전용으로만 쓴다(UPDATE·DELETE 금지, 계획서 §10-1).
const 시드비밀번호 = 'Test1234!';
const 준회원계정 = 'junior1@clubhome.local'; // grade_level 10
const 정회원계정 = 'senior@clubhome.local'; // grade_level 20
const 관리자계정 = 'admin@clubhome.local'; // grade_level 30, is_admin

// 시드 게시판 이름. id는 IDENTITY이고 seed-dev.sql이 NOT EXISTS 가드를 쓰므로
// 재실행 이력에 따라 값이 달라진다 → **id를 하드코딩하지 않고 이름으로 조회한다**.
const 자유게시판명 = '자유게시판'; // min 10, 활성
const 정회원게시판명 = '정회원 게시판'; // min 20, 활성
const 운영진게시판명 = '운영진 전용'; // min 30, 활성
const 비활성게시판명 = '이전 공지(보관)'; // min 30, 비활성

// swagger Post 스키마의 키 집합(정렬본).
// 상세·작성 응답은 8개, 목록 원소는 content가 없어 7개다(계획서 §6-4).
const 상세키 = [
  'authorName',
  'boardId',
  'content',
  'createdAt',
  'id',
  'memberId',
  'title',
  'viewCount',
];
const 목록원소키 = ['authorName', 'boardId', 'createdAt', 'id', 'memberId', 'title', 'viewCount'];
const 목록응답키 = ['items', 'page', 'pageSize', 'totalCount'];

// ── 서버·HTTP 헬퍼 ──────────────────────────────────────────────────────────
// 케이스마다 서버를 띄우면 느리므로 파일 전체가 포트 0으로 띄운 서버 1대를 공유한다.
let server;
let base;

/** Bearer 인증 헤더. */
const bearer = (토큰) => ({ Authorization: `Bearer ${토큰}` });

/**
 * HTTP 요청 1건. 이 파일의 유일한 요청 통로다.
 * 본문이 undefined면 Content-Type과 body를 아예 붙이지 않는다(`req.body === undefined` 경로).
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

/** 접두사 규약을 지키는 유일한 제목 생성기. PATCH의 새 제목도 반드시 이것을 쓴다. */
let 제목순번 = 0;
const 새제목 = (구분) => `${PREFIX}${구분}-${Date.now()}-${(제목순번 += 1)}`;

/** 접두사 규약을 지키는 유일한 이메일 생성기. */
const 새이메일 = (구분) => `${PREFIX}${구분}-${Date.now()}@example.test`;

/** 만료된 Access Token을 직접 서명한다. 시크릿은 환경변수에서만 읽는다. */
const 만료Access토큰 = ({ id, gradeLevel, isAdmin }) =>
  jwt.sign({ memberId: id, gradeLevel, isAdmin, typ: 'access' }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: '-1s',
  });

/** 서명 마지막 문자를 변조한다. */
const 위조 = (토큰) => 토큰.slice(0, -1) + (토큰.slice(-1) === 'A' ? 'B' : 'A');

// ── 게시글 헬퍼 ─────────────────────────────────────────────────────────────
// 작성 응답의 id를 모두 모은다. 제목이 변형된 행(PATCH)이나 헬퍼를 우회한 행도
// 이 배열로 회수된다(계획서 §10-1 식별 방법 2).
const 만든게시글ID = [];

/** 목록 조회. */
const 목록 = (토큰, boardId, 쿼리 = '') =>
  요청('GET', `/api/boards/${boardId}/posts${쿼리}`, undefined, bearer(토큰));

/** 상세 조회. */
const 상세 = (토큰, postId) => 요청('GET', `/api/posts/${postId}`, undefined, bearer(토큰));

/** 작성. 201이면 id를 회수 배열에 즉시 push한다. */
async function 작성(토큰, boardId, 본문) {
  const 응답 = await 요청('POST', `/api/boards/${boardId}/posts`, 본문, bearer(토큰));
  if (응답.status === 201 && 응답.body && Number.isInteger(응답.body.id)) {
    만든게시글ID.push(응답.body.id);
  }
  return 응답;
}

/** 성공을 전제한 작성. 픽스처 준비용이며 실패하면 원인을 즉시 드러낸다. */
async function 게시글준비(토큰, boardId, 구분) {
  const 본문 = { title: 새제목(구분), content: `${구분} 본문` };
  const 응답 = await 작성(토큰, boardId, 본문);
  assert.equal(응답.status, 201, `게시글 준비(${구분}) 실패: ${응답.text}`);
  return { ...응답.body, 요청본문: 본문 };
}

/** 게시글 행을 DB에서 직접 읽는다. API 응답을 믿지 않고 실제 저장 상태를 단정하는 통로다. */
async function 게시글행(id) {
  const { rows } = await query(
    'SELECT id, board_id, member_id, title, content, view_count, created_at FROM posts WHERE id = $1',
    [id],
  );
  return rows[0];
}

/** 게시판의 게시글 수. "행이 생기지 않았다"를 단정하는 데 쓴다. */
async function 게시판게시글수(boardId) {
  const { rows } = await query('SELECT COUNT(*) AS count FROM posts WHERE board_id = $1', [boardId]);
  return Number(rows[0].count);
}

/** 가입 → 로그인으로 be06- 회원 1명(준회원)을 만든다. */
async function 픽스처회원(구분) {
  const email = 새이메일(구분);
  const 가입본문 = { name: `테스트${구분}`, email, password: 시드비밀번호, phone: '010-0000-0000' };
  const 가입 = await 요청('POST', '/api/auth/signup', 가입본문);
  assert.equal(가입.status, 201, `픽스처(${구분}) 가입 실패: ${가입.text}`);

  const 로그인 = await 요청('POST', '/api/auth/login', { email, password: 시드비밀번호 });
  assert.equal(로그인.status, 200, `픽스처(${구분}) 로그인 실패: ${로그인.text}`);

  return { email, 이름: 가입본문.name, accessToken: 로그인.body.accessToken, member: 로그인.body.member };
}

/** 시드 계정 로그인. 토큰은 반드시 로그인으로만 얻는다(계획서 §10-1). */
async function 세션(email) {
  const 응답 = await 요청('POST', '/api/auth/login', { email, password: 시드비밀번호 });
  assert.equal(응답.status, 200, `시드 계정 ${email} 로그인 실패(seed-dev.sql 적용 확인): ${응답.text}`);
  return 응답.body;
}

// ── 공유 픽스처 ─────────────────────────────────────────────────────────────
let 준회원; // 시드 junior1 (gradeLevel 10)
let 정회원; // 시드 senior (gradeLevel 20)
let 관리자; // 시드 admin (gradeLevel 30, isAdmin)
let 작성자; // be06-author (준회원)
let 타인; // be06-other (준회원)
let 탈퇴회원; // be06-withdrawn (직접 INSERT)
let 시드게시판; // { [name]: { id, name, min_grade_level, is_active } }
let A3총건수; // A-3이 수집하고 A-5가 비교한다

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
      `시드 게시판 '${이름}'이 정확히 1건 있어야 한다(조회 ${rows.length}건). docs/seed-dev.sql이 적용되었는지 확인하라.`,
    );
    시드게시판[이름] = rows[0];
  }

  // 시드 전제 가드: 등급·활성 여부가 계획서 §10-1 표와 일치해야 이후 기대값이 성립한다.
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
  assert.equal(관리자.member.memberGrade.isAdmin, true, '시드 admin은 is_admin이어야 한다');

  작성자 = await 픽스처회원('author');
  타인 = await 픽스처회원('other');
  assert.notEqual(작성자.member.id, 타인.member.id, '작성자와 타인은 서로 다른 회원이어야 한다');

  // 탈퇴 회원은 로그인할 수 없으므로(BE-03 403) 직접 INSERT하고 토큰을 직접 발급한다.
  const { rows: 등급 } = await query(
    'SELECT id, grade_level, is_admin FROM member_grades ORDER BY grade_level ASC LIMIT 1',
  );
  const 삽입 = await query(
    `INSERT INTO members (email, password_hash, name, phone, member_grade_id, account_status)
     VALUES ($1, $2, $3, $4, $5, 'withdrawn')
     RETURNING id`,
    [새이메일('withdrawn'), await hashPassword(시드비밀번호), '탈퇴회원', '010-0000-0009', 등급[0].id],
  );
  탈퇴회원 = {
    id: 삽입.rows[0].id,
    accessToken: signAccessToken({
      id: 삽입.rows[0].id,
      gradeLevel: 등급[0].grade_level,
      isAdmin: 등급[0].is_admin,
    }),
  };

  // A-1·A-2가 비지 않은 목록을 보려면 자유게시판에 최소 1건이 있어야 한다.
  await 게시글준비(작성자.accessToken, 시드게시판[자유게시판명].id, 'seed');
});

// ── A. GET /api/boards/{boardId}/posts — 목록·페이지네이션 (완료조건 1) ─────

test('A-1 준회원이 자유게시판 목록을 조회하면 200이고 응답 키가 4개다', async () => {
  const 응답 = await 목록(준회원.accessToken, 시드게시판[자유게시판명].id);
  assert.equal(응답.status, 200, `목록 조회 실패: ${응답.text}`);
  assert.deepEqual(
    Object.keys(응답.body).sort(),
    목록응답키,
    'PostListResponse는 정확히 4개 키다(hasNext·totalPages·board 금지)',
  );
  assert.ok(Array.isArray(응답.body.items), 'items는 배열이어야 한다');
  assert.equal(응답.body.page, 1, '미지정 page의 기본값은 1이다');
  assert.equal(응답.body.pageSize, 20, '미지정 pageSize의 기본값은 20이다');
  // COUNT(*)는 bigint → pg가 문자열로 반환한다. Number() 변환을 빠뜨리면 여기서 깨진다(§11 위험 4).
  assert.equal(typeof 응답.body.totalCount, 'number', 'totalCount는 문자열이 아니라 number다');
  assert.ok(Number.isInteger(응답.body.totalCount));
  assert.ok(응답.body.totalCount >= 1, '준비된 게시글이 최소 1건 있어야 한다');
});

test('A-2 목록 원소에는 content가 없고 키가 7개다', async () => {
  // §6-4 결정 고정: 목록 SQL이 p.content를 SELECT하지 않아 키가 응답에서 제외된다.
  const 응답 = await 목록(준회원.accessToken, 시드게시판[자유게시판명].id);
  assert.equal(응답.status, 200);
  assert.ok(응답.body.items.length > 0, '단정할 원소가 있어야 한다');
  for (const item of 응답.body.items) {
    assert.deepEqual(Object.keys(item).sort(), 목록원소키, '목록 원소는 정확히 7개 키다');
    assert.equal('content' in item, false, '목록에 본문을 실어 보내지 않는다');
    assert.ok(Number.isInteger(item.id));
    assert.equal(typeof item.title, 'string');
    assert.equal(typeof item.authorName, 'string');
    assert.equal(typeof item.viewCount, 'number');
    assert.equal(typeof item.createdAt, 'string');
  }
});

test('A-3 페이지 경계가 정확하다(pageSize=2로 3건을 두 페이지에 나눈다)', async () => {
  const boardId = 시드게시판[자유게시판명].id;
  // 최신순 정렬이므로 방금 만든 3건이 목록 선두에 온다.
  const 첫째 = await 게시글준비(작성자.accessToken, boardId, 'page1');
  const 둘째 = await 게시글준비(작성자.accessToken, boardId, 'page2');
  const 셋째 = await 게시글준비(작성자.accessToken, boardId, 'page3');

  const p1 = await 목록(준회원.accessToken, boardId, '?page=1&pageSize=2');
  const p2 = await 목록(준회원.accessToken, boardId, '?page=2&pageSize=2');
  assert.equal(p1.status, 200);
  assert.equal(p2.status, 200);
  assert.equal(p1.body.items.length, 2, 'pageSize=2이므로 1페이지는 2건이다');
  assert.ok(p2.body.items.length >= 1, '2페이지에 남은 1건이 있어야 한다');
  assert.equal(p1.body.pageSize, 2, '요청한 pageSize를 echo해야 한다');
  assert.equal(p2.body.page, 2);
  assert.equal(p1.body.totalCount, p2.body.totalCount, '두 응답의 totalCount가 같아야 한다');
  assert.ok(p1.body.totalCount >= 3);

  const p1아이디 = p1.body.items.map((item) => item.id);
  const p2아이디 = p2.body.items.map((item) => item.id);
  for (const id of p1아이디) {
    assert.equal(p2아이디.includes(id), false, `id ${id}가 두 페이지에 중복 노출되면 안 된다`);
  }
  // 타이브레이커(p.id DESC)가 없으면 created_at 동값에서 이 순서가 흔들린다(§11 위험 5).
  assert.deepEqual(p1아이디, [셋째.id, 둘째.id], '1페이지는 최신 2건이다');
  assert.equal(p2아이디[0], 첫째.id, '2페이지 선두는 그 다음 1건이다');

  A3총건수 = p1.body.totalCount;
});

test('A-4 최신순 정렬이 결정적이다(createdAt 비증가, 2회 호출 순서 동일)', async () => {
  const boardId = 시드게시판[자유게시판명].id;
  const 첫번째 = await 목록(준회원.accessToken, boardId);
  const 두번째 = await 목록(준회원.accessToken, boardId);
  assert.equal(첫번째.status, 200);
  assert.equal(두번째.status, 200);

  const 시각들 = 첫번째.body.items.map((item) => Date.parse(item.createdAt));
  for (let i = 1; i < 시각들.length; i += 1) {
    assert.ok(시각들[i - 1] >= 시각들[i], `ORDER BY created_at DESC 위반: ${시각들}`);
  }
  assert.deepEqual(
    두번째.body.items.map((item) => item.id),
    첫번째.body.items.map((item) => item.id),
    '타이브레이커가 없으면 요청마다 순서가 흔들린다',
  );
});

test('A-5 범위를 벗어난 page는 404가 아니라 200 + 빈 items다', async () => {
  const 응답 = await 목록(준회원.accessToken, 시드게시판[자유게시판명].id, '?page=99999');
  assert.equal(응답.status, 200, '게시판은 실재하고 접근도 허용되었으므로 정상 결과다(§6-5)');
  assert.deepEqual(응답.body.items, [], '범위 밖 page는 0건이다');
  assert.equal(응답.body.page, 99999, '요청한 page를 그대로 echo한다');
  assert.equal(응답.body.totalCount, A3총건수, 'totalCount는 A-3과 동일해야 한다(0이 아님)');
});

test('A-6 page·pageSize 불량은 400·500이 아니라 기본값/클램프로 처리된다', async () => {
  const boardId = 시드게시판[자유게시판명].id;
  // 형식 불량·하한 미달은 기본값으로 떨어진다(§6-2). 이 경로에 400은 정의되어 있지 않다.
  // 같은 파라미터를 두 번 보내면 Express가 배열로 넘긴다. Number(['1','2'])는 NaN이라
  // 기본값으로 떨어져야 하며, 배열이 SQL 바인딩까지 흘러가 500이 되면 안 된다.
  const 기본값케이스 = [
    '?page=abc',
    '?page=0',
    '?page=-1',
    '?page=1.5',
    '?pageSize=0',
    '?page=1&page=2',
    '?pageSize=5&pageSize=7',
  ];
  for (const 쿼리 of 기본값케이스) {
    const 응답 = await 목록(준회원.accessToken, boardId, 쿼리);
    assert.equal(응답.status, 200, `${쿼리}: 400·500이 아니라 200이다`);
    assert.equal(응답.body.page, 1, `${쿼리}: page 기본값 1`);
    assert.equal(응답.body.pageSize, 20, `${쿼리}: pageSize 기본값 20`);
  }

  // pageSize 상한 초과는 swagger maximum(100)으로 클램프한다.
  const 상한 = await 목록(준회원.accessToken, boardId, '?pageSize=999');
  assert.equal(상한.status, 200);
  assert.equal(상한.body.pageSize, 100, 'pageSize=999는 100으로 클램프된다');

  // page 상한 초과는 OFFSET 22003(500)을 막기 위해 INTEGER 최댓값으로 클램프한다.
  const page초과 = await 목록(준회원.accessToken, boardId, '?page=99999999999');
  assert.equal(page초과.status, 200, 'OFFSET 범위 초과가 500으로 새면 안 된다');
  assert.ok(Number.isInteger(page초과.body.page));
  assert.ok(page초과.body.page <= MAX_INT4, 'page는 INTEGER 최댓값 이하로 클램프된다');
  assert.deepEqual(page초과.body.items, []);
});

test('A-7 준회원이 정회원 게시판 목록을 조회하면 403 FORBIDDEN이다', async () => {
  const 응답 = await 목록(준회원.accessToken, 시드게시판[정회원게시판명].id);
  assert.equal(응답.status, 403);
  assert.equal(응답.body.code, 'FORBIDDEN');
  assert.equal(응답.body.message, '이용 권한이 없는 게시판입니다.');
  assert.deepEqual(Object.keys(응답.body).sort(), ['code', 'message']);
});

test('A-8 비활성·미존재·비정수·범위 초과 boardId는 500이 아니라 404다', async () => {
  const 대상들 = [
    ['비활성 게시판', 시드게시판[비활성게시판명].id],
    ['미존재', 999999],
    ['비정수', 'abc'],
    ['INTEGER 초과', 9999999999],
  ];
  for (const [이름, boardId] of 대상들) {
    const 응답 = await 목록(관리자.accessToken, boardId);
    assert.notEqual(응답.status, 500, `${이름}: DB 오류(22P02·22003)가 500으로 새면 안 된다`);
    assert.equal(응답.status, 404, `${이름}: status`);
    assert.equal(응답.body.code, 'NOT_FOUND', `${이름}: code`);
    assert.equal(응답.body.message, '게시판을 찾을 수 없습니다.', `${이름}: message`);
  }
});

test('A-9 Authorization 헤더 없는 목록 조회는 401이고 본문 키가 2개다', async () => {
  const 응답 = await 요청('GET', `/api/boards/${시드게시판[자유게시판명].id}/posts`);
  assert.equal(응답.status, 401);
  assert.deepEqual(Object.keys(응답.body).sort(), ['code', 'message']);
  assert.equal(응답.body.code, 'UNAUTHORIZED');
});

// ── B. POST /api/boards/{boardId}/posts — 작성 (완료조건 3) ─────────────────

test('B-1 준회원이 자유게시판에 작성하면 201이고 응답 키가 8개다', async () => {
  const boardId = 시드게시판[자유게시판명].id;
  const 본문 = { title: 새제목('create'), content: '작성 본문입니다.' };
  const 응답 = await 작성(작성자.accessToken, boardId, 본문);

  assert.equal(응답.status, 201, `작성 실패: ${응답.text}`);
  assert.deepEqual(Object.keys(응답.body).sort(), 상세키, 'Post는 정확히 8개 키다');
  assert.ok(Number.isInteger(응답.body.id));
  assert.equal(응답.body.boardId, boardId);
  assert.equal(응답.body.memberId, 작성자.member.id);
  assert.equal(응답.body.authorName, 작성자.이름, 'authorName은 members 조인 결과다');
  assert.equal(응답.body.title, 본문.title);
  assert.equal(응답.body.content, 본문.content);
  assert.equal(응답.body.viewCount, 0, '작성 직후 조회수는 DB 기본값 0이다');
  assert.equal(typeof 응답.body.createdAt, 'string');
  assert.ok(!Number.isNaN(Date.parse(응답.body.createdAt)), 'createdAt이 파싱 가능해야 한다');

  const 행 = await 게시글행(응답.body.id);
  assert.equal(행.title, 본문.title);
  assert.equal(행.content, 본문.content);
  assert.equal(행.view_count, 0);
});

test('B-2 준회원이 정회원 게시판에 작성하면 403이고 행이 생기지 않는다', async () => {
  // 완료조건 3.
  const boardId = 시드게시판[정회원게시판명].id;
  const 이전건수 = await 게시판게시글수(boardId);
  const 본문 = { title: 새제목('forbidden'), content: '등급 미달 작성 시도' };
  const 응답 = await 작성(작성자.accessToken, boardId, 본문);

  assert.equal(응답.status, 403);
  assert.equal(응답.body.code, 'FORBIDDEN');
  assert.equal(응답.body.message, '이용 권한이 없는 게시판입니다.');
  assert.equal(await 게시판게시글수(boardId), 이전건수, '거부된 요청으로 행이 생기면 안 된다');
});

test('B-3 입력 오류는 500이 아니라 모두 400 BAD_REQUEST다', async () => {
  const boardId = 시드게시판[자유게시판명].id;
  const 이전건수 = await 게시판게시글수(boardId);
  const 유효제목 = 새제목('invalid');
  const 본문들 = [
    ['title 누락', { content: '본문' }],
    ['title 빈문자열', { title: '', content: '본문' }],
    ['title 공백만', { title: '   ', content: '본문' }],
    ['title null', { title: null, content: '본문' }],
    ['title 비문자열', { title: 123, content: '본문' }],
    // 201자는 PostgreSQL 22001 → 500이 되기 전에 400으로 막혀야 한다.
    ['title 201자', { title: `${PREFIX}${'가'.repeat(201)}`, content: '본문' }],
    ['content 누락', { title: 유효제목 }],
    ['content 빈문자열', { title: 유효제목, content: '' }],
    ['content 공백만', { title: 유효제목, content: '  ' }],
    ['content null', { title: 유효제목, content: null }],
    ['빈 객체', {}],
    ['본문 없음', undefined],
  ];
  for (const [이름, 본문] of 본문들) {
    const 응답 = await 작성(작성자.accessToken, boardId, 본문);
    assert.notEqual(응답.status, 500, `${이름}: DB 제약 위반이 500으로 새면 안 된다`);
    assert.equal(응답.status, 400, `${이름}: status`);
    assert.equal(응답.body.code, 'BAD_REQUEST', `${이름}: code`);
  }
  assert.equal(await 게시판게시글수(boardId), 이전건수, '400 요청으로 행이 생기면 안 된다');
});

test('B-4 탈퇴 회원의 작성 요청은 403 ACCOUNT_WITHDRAWN이다', async () => {
  // §5 결정 고정: 도메인 §6의 "글쓰기 불가"는 POST에만 적용한다.
  const boardId = 시드게시판[자유게시판명].id;
  const 이전건수 = await 게시판게시글수(boardId);
  const 응답 = await 작성(탈퇴회원.accessToken, boardId, {
    title: 새제목('withdrawn'),
    content: '탈퇴 회원 작성 시도',
  });

  assert.equal(응답.status, 403);
  assert.equal(응답.body.code, 'ACCOUNT_WITHDRAWN');
  assert.equal(응답.body.message, '탈퇴한 계정입니다.');
  assert.equal(await 게시판게시글수(boardId), 이전건수, '탈퇴 회원의 글이 생기면 안 된다');
});

test('B-5 비활성·미존재 게시판 작성은 404 NOT_FOUND다', async () => {
  const 대상들 = [
    ['비활성 게시판', 시드게시판[비활성게시판명].id],
    ['미존재 게시판', 999999],
  ];
  for (const [이름, boardId] of 대상들) {
    // 관리자 토큰으로 시도한다 — 등급은 충족(30 >= 30)이므로 404가 나와야 비활성 판정이 먼저임이 증명된다.
    const 응답 = await 작성(관리자.accessToken, boardId, {
      title: 새제목('notfound'),
      content: '본문',
    });
    assert.equal(응답.status, 404, `${이름}: status`);
    assert.equal(응답.body.code, 'NOT_FOUND', `${이름}: code`);
    assert.equal(응답.body.message, '게시판을 찾을 수 없습니다.', `${이름}: message`);
  }
});

test('B-6 본문의 미허용 필드는 무시되고 DB에 반영되지 않는다', async () => {
  // §11 위험 10 방어: {...body}나 Object.keys(body) 순회로 INSERT를 만들면
  // 게시판 이동·작성자 위조·조회수 조작이 동시에 성립한다.
  const boardId = 시드게시판[자유게시판명].id;
  const 본문 = {
    title: 새제목('whitelist'),
    content: '화이트리스트 확인 본문',
    boardId: 시드게시판[운영진게시판명].id, // 다른 게시판으로 이동 시도
    memberId: 타인.member.id, // 작성자 위조 시도
    viewCount: 999, // 조회수 조작 시도
    id: 1, // 대상 행 지목 시도
    createdAt: '2000-01-01T00:00:00.000Z',
  };
  const 응답 = await 작성(작성자.accessToken, boardId, 본문);

  assert.equal(응답.status, 201, '미허용 필드는 400이 아니라 무시다');
  assert.equal(응답.body.boardId, boardId, '경로의 boardId가 이겨야 한다');
  assert.equal(응답.body.memberId, 작성자.member.id, '토큰의 회원이 작성자여야 한다');
  assert.equal(응답.body.viewCount, 0);
  assert.notEqual(응답.body.id, 1, 'id는 IDENTITY가 결정한다');

  const 행 = await 게시글행(응답.body.id);
  assert.equal(행.board_id, boardId, 'DB의 board_id는 경로의 boardId다');
  assert.equal(행.member_id, 작성자.member.id, 'DB의 member_id는 토큰의 회원이다');
  assert.equal(행.view_count, 0, 'DB의 view_count는 0이다');
});

// ── C. GET /api/posts/{postId} — 상세·조회수 (완료조건 2) ───────────────────

test('C-1 상세 조회는 200이고 content를 포함한 8개 키를 반환한다', async () => {
  const 글 = await 게시글준비(작성자.accessToken, 시드게시판[자유게시판명].id, 'detail');
  const 응답 = await 상세(준회원.accessToken, 글.id);

  assert.equal(응답.status, 200, `상세 조회 실패: ${응답.text}`);
  assert.deepEqual(Object.keys(응답.body).sort(), 상세키, '상세 Post는 정확히 8개 키다');
  assert.equal(응답.body.id, 글.id);
  assert.equal(응답.body.boardId, 글.boardId);
  assert.equal(응답.body.memberId, 작성자.member.id);
  assert.equal(응답.body.authorName, 작성자.이름);
  assert.equal(응답.body.title, 글.요청본문.title);
  assert.equal(응답.body.content, 글.요청본문.content, '상세에는 본문이 있어야 한다');
});

test('C-2 상세 조회마다 조회수가 1씩 증가한다', async () => {
  // 완료조건 2.
  const 글 = await 게시글준비(작성자.accessToken, 시드게시판[자유게시판명].id, 'view');
  assert.equal(글.viewCount, 0, '작성 직후 조회수는 0이다');

  const 첫번째 = await 상세(준회원.accessToken, 글.id);
  assert.equal(첫번째.status, 200);
  assert.equal(첫번째.body.viewCount, 1, '응답에는 증가 후 값이 실려야 한다');

  const 두번째 = await 상세(준회원.accessToken, 글.id);
  assert.equal(두번째.body.viewCount, 2);

  const 행 = await 게시글행(글.id);
  assert.equal(행.view_count, 2, 'DB에도 2가 저장되어야 한다');
});

test('C-3 본인 글 조회에도 조회수가 증가한다', async () => {
  // S-04 원문 "본인 글의 조회수가 증가함을 확인한다" 결정 고정.
  // 작성자 제외·세션/IP 중복 방지를 구현하면 여기서 깨진다(§7-4).
  const 글 = await 게시글준비(작성자.accessToken, 시드게시판[자유게시판명].id, 'selfview');
  const 응답 = await 상세(작성자.accessToken, 글.id);
  assert.equal(응답.status, 200);
  assert.equal(응답.body.viewCount, 1, '작성자 본인 조회도 카운트된다');
  assert.equal((await 게시글행(글.id)).view_count, 1);
});

test('C-4 등급 미달 조회는 403이고 조회수가 증가하지 않는다', async () => {
  // §7-2 순서 회귀 방어의 **유일한** 케이스다(삭제 금지, §11 위험 2).
  // 조회수 증가를 게시판 인가보다 먼저 하면 등급 미달 회원이 403을 받으면서 카운터를 올릴 수 있다.
  const 글 = await 게시글준비(정회원.accessToken, 시드게시판[정회원게시판명].id, 'senioronly');
  const 이전 = await 게시글행(글.id);
  assert.equal(이전.view_count, 0, '전제: 준비된 글의 조회수는 0이다');

  const 응답 = await 상세(준회원.accessToken, 글.id);
  assert.equal(응답.status, 403);
  assert.equal(응답.body.code, 'FORBIDDEN');
  assert.equal(응답.body.message, '이용 권한이 없는 게시판입니다.');

  const 이후 = await 게시글행(글.id);
  assert.equal(이후.view_count, 이전.view_count, '403인데 조회수가 올라가면 인가보다 증가가 먼저다');
});

test('C-5 미존재·비정수·범위 초과 postId는 500이 아니라 404다', async () => {
  for (const postId of [999999, 'abc', 0, 9999999999]) {
    const 응답 = await 상세(준회원.accessToken, postId);
    assert.notEqual(응답.status, 500, `${postId}: DB 오류가 500으로 새면 안 된다`);
    assert.equal(응답.status, 404, `${postId}: status`);
    assert.equal(응답.body.code, 'NOT_FOUND', `${postId}: code`);
    assert.equal(응답.body.message, '게시글을 찾을 수 없습니다.', `${postId}: message`);
  }
});

// ── D. PATCH / DELETE /api/posts/{postId} — 소유권 (완료조건 4·5) ───────────

test('D-1 작성자 본인이 수정하면 200이고 DB에 반영된다', async () => {
  // 완료조건 5. 가드를 `||`로 잘못 쓰면 본인도 403이 되어 여기서 깨진다.
  const 글 = await 게시글준비(작성자.accessToken, 시드게시판[자유게시판명].id, 'mine');
  // 새 제목도 반드시 be06- 접두사를 유지한다(§10-1 — 접두사를 잃으면 정리 훅이 놓친다).
  const 수정본문 = { title: 새제목('mine-updated'), content: '본인이 수정한 본문' };
  const 응답 = await 요청('PATCH', `/api/posts/${글.id}`, 수정본문, bearer(작성자.accessToken));

  assert.equal(응답.status, 200, `본인 수정 실패: ${응답.text}`);
  assert.deepEqual(Object.keys(응답.body).sort(), 상세키, 'PATCH 응답도 Post 8개 키다');
  assert.equal(응답.body.title, 수정본문.title);
  assert.equal(응답.body.content, 수정본문.content);

  const 행 = await 게시글행(글.id);
  assert.equal(행.title, 수정본문.title);
  assert.equal(행.content, 수정본문.content);
});

test('D-2 타인이 수정하면 403이고 DB가 불변이다', async () => {
  // 완료조건 4. 가드를 빠뜨리면 누구나 타인 글을 수정할 수 있다.
  const 글 = await 게시글준비(작성자.accessToken, 시드게시판[자유게시판명].id, 'theirs');
  const 이전 = await 게시글행(글.id);
  const 응답 = await 요청(
    'PATCH',
    `/api/posts/${글.id}`,
    { title: 새제목('hijack'), content: '타인이 덮어쓴 본문' },
    bearer(타인.accessToken),
  );

  assert.equal(응답.status, 403);
  assert.equal(응답.body.code, 'FORBIDDEN');
  assert.equal(응답.body.message, '본인 또는 관리자만 수정·삭제할 수 있습니다.');

  const 이후 = await 게시글행(글.id);
  assert.equal(이후.title, 이전.title, '거부된 요청으로 제목이 바뀌면 안 된다');
  assert.equal(이후.content, 이전.content, '거부된 요청으로 본문이 바뀌면 안 된다');
});

test('D-3 관리자는 타인 글을 수정할 수 있다', async () => {
  // 완료조건 5 + `&&`→`||` 오타 방어(D-1·D-2와 셋이 함께여야 방어가 성립한다).
  const 글 = await 게시글준비(작성자.accessToken, 시드게시판[자유게시판명].id, 'adminedit');
  const 수정본문 = { title: 새제목('adminedit-updated'), content: '관리자가 수정한 본문' };
  const 응답 = await 요청('PATCH', `/api/posts/${글.id}`, 수정본문, bearer(관리자.accessToken));

  assert.equal(응답.status, 200, `관리자 수정 실패: ${응답.text}`);
  assert.equal(응답.body.title, 수정본문.title);
  assert.equal(응답.body.memberId, 작성자.member.id, '작성자는 바뀌지 않는다');

  const 행 = await 게시글행(글.id);
  assert.equal(행.title, 수정본문.title);
  assert.equal(행.content, 수정본문.content);
  assert.equal(행.member_id, 작성자.member.id);
});

test('D-4 부분 수정은 나머지 필드를 유지하고 빈 요청은 400이다', async () => {
  // $n 번호를 상수로 고정한 구현은 "content만 수정"에서 500이 된다(§11 위험 참조).
  const 글 = await 게시글준비(작성자.accessToken, 시드게시판[자유게시판명].id, 'partial');

  const 새타이틀 = 새제목('partial-title');
  const 제목만 = await 요청(
    'PATCH',
    `/api/posts/${글.id}`,
    { title: 새타이틀 },
    bearer(작성자.accessToken),
  );
  assert.equal(제목만.status, 200, `title만 수정 실패: ${제목만.text}`);
  assert.equal(제목만.body.title, 새타이틀);
  assert.equal(제목만.body.content, 글.요청본문.content, 'SET 절에 없는 content가 덮어써지면 안 된다');

  const 본문만 = await 요청(
    'PATCH',
    `/api/posts/${글.id}`,
    { content: '본문만 수정' },
    bearer(작성자.accessToken),
  );
  assert.equal(본문만.status, 200, '파라미터 번호 시프트로 500이 나면 안 된다');
  assert.equal(본문만.body.content, '본문만 수정');
  assert.equal(본문만.body.title, 새타이틀, 'SET 절에 없는 title이 덮어써지면 안 된다');

  const 행 = await 게시글행(글.id);
  assert.equal(행.title, 새타이틀);
  assert.equal(행.content, '본문만 수정');

  // 수정 항목이 0건이면 400이다. 화이트리스트 외 필드만 담긴 요청도 0건으로 취급된다.
  const 빈요청들 = [
    ['빈 객체', {}],
    ['본문 없음', undefined],
    ['미허용 필드만', { boardId: 시드게시판[운영진게시판명].id, viewCount: 999 }],
  ];
  for (const [이름, 본문] of 빈요청들) {
    const 응답 = await 요청('PATCH', `/api/posts/${글.id}`, 본문, bearer(작성자.accessToken));
    assert.equal(응답.status, 400, `${이름}: status`);
    assert.equal(응답.body.code, 'BAD_REQUEST', `${이름}: code`);
    assert.equal(응답.body.message, '수정할 항목이 없습니다.', `${이름}: message`);
  }
  assert.equal((await 게시글행(글.id)).board_id, 글.boardId, '본문의 boardId로 게시판이 바뀌면 안 된다');
});

test('D-5 작성자 본인이 삭제하면 204이고 본문이 없다', async () => {
  // 완료조건 5.
  const 글 = await 게시글준비(작성자.accessToken, 시드게시판[자유게시판명].id, 'mydelete');
  const 응답 = await 요청('DELETE', `/api/posts/${글.id}`, undefined, bearer(작성자.accessToken));

  assert.equal(응답.status, 204, `본인 삭제 실패: ${응답.text}`);
  assert.equal(응답.text.length, 0, '204에는 본문이 없어야 한다');
  assert.equal(응답.body, null);

  const 재조회 = await 상세(작성자.accessToken, 글.id);
  assert.equal(재조회.status, 404, '삭제된 글은 404여야 한다');
  assert.equal(재조회.body.message, '게시글을 찾을 수 없습니다.');
  assert.equal(await 게시글행(글.id), undefined, 'DB에서 행이 사라져야 한다(하드 삭제)');
});

test('D-6 타인이 삭제하면 403이고 행이 그대로 존재한다', async () => {
  // 완료조건 4.
  const 글 = await 게시글준비(작성자.accessToken, 시드게시판[자유게시판명].id, 'theirdelete');
  const 응답 = await 요청('DELETE', `/api/posts/${글.id}`, undefined, bearer(타인.accessToken));

  assert.equal(응답.status, 403);
  assert.equal(응답.body.code, 'FORBIDDEN');
  assert.equal(응답.body.message, '본인 또는 관리자만 수정·삭제할 수 있습니다.');
  assert.ok(await 게시글행(글.id), '거부된 요청으로 행이 지워지면 안 된다');
});

test('D-7 관리자는 타인 글을 삭제할 수 있다', async () => {
  // 완료조건 5.
  const 글 = await 게시글준비(작성자.accessToken, 시드게시판[자유게시판명].id, 'admindelete');
  const 응답 = await 요청('DELETE', `/api/posts/${글.id}`, undefined, bearer(관리자.accessToken));

  assert.equal(응답.status, 204, `관리자 삭제 실패: ${응답.text}`);
  assert.equal(응답.text.length, 0);
  assert.equal(await 게시글행(글.id), undefined, '행이 삭제되어야 한다');
});

test('D-8 등급 미달 회원의 수정·삭제는 게시판 메시지로 403이다', async () => {
  // §8-2 증명: 게시판 인가가 소유권 판정보다 **먼저** 실행된다.
  // 순서가 뒤집히면 message가 소유권 메시지로 바뀌어 여기서 깨진다.
  const 글 = await 게시글준비(정회원.accessToken, 시드게시판[정회원게시판명].id, 'gradegate');
  const 이전 = await 게시글행(글.id);

  const 수정 = await 요청(
    'PATCH',
    `/api/posts/${글.id}`,
    { title: 새제목('gradegate-try'), content: '등급 미달 수정 시도' },
    bearer(준회원.accessToken),
  );
  assert.equal(수정.status, 403);
  assert.equal(수정.body.code, 'FORBIDDEN');
  assert.equal(수정.body.message, '이용 권한이 없는 게시판입니다.', '게시판 메시지여야 한다');

  const 삭제 = await 요청('DELETE', `/api/posts/${글.id}`, undefined, bearer(준회원.accessToken));
  assert.equal(삭제.status, 403);
  assert.equal(삭제.body.code, 'FORBIDDEN');
  assert.equal(삭제.body.message, '이용 권한이 없는 게시판입니다.', '게시판 메시지여야 한다');

  const 이후 = await 게시글행(글.id);
  assert.ok(이후, '행이 지워지면 안 된다');
  assert.equal(이후.title, 이전.title, '제목이 바뀌면 안 된다');
  assert.equal(이후.content, 이전.content, '본문이 바뀌면 안 된다');
});

test('D-9 인증 실패 3종의 수정·삭제는 모두 401이고 DB가 불변이다', async () => {
  const 글 = await 게시글준비(작성자.accessToken, 시드게시판[자유게시판명].id, 'noauth');
  const 이전 = await 게시글행(글.id);
  const 만료 = 만료Access토큰({
    id: 작성자.member.id,
    gradeLevel: 작성자.member.memberGrade.gradeLevel,
    isAdmin: 작성자.member.memberGrade.isAdmin,
  });
  const 헤더들 = [
    ['헤더없음', {}, 'UNAUTHORIZED'],
    ['만료토큰', bearer(만료), 'TOKEN_EXPIRED'],
    ['위조토큰', bearer(위조(작성자.accessToken)), 'UNAUTHORIZED'],
  ];

  for (const [이름, 헤더, 기대코드] of 헤더들) {
    const 수정 = await 요청(
      'PATCH',
      `/api/posts/${글.id}`,
      { title: 새제목('noauth-try'), content: '미인증 수정 시도' },
      헤더,
    );
    assert.equal(수정.status, 401, `${이름} PATCH: 401이어야 한다(403·404·500 아님)`);
    assert.equal(수정.body.code, 기대코드, `${이름} PATCH: code`);

    const 삭제 = await 요청('DELETE', `/api/posts/${글.id}`, undefined, 헤더);
    assert.equal(삭제.status, 401, `${이름} DELETE: 401이어야 한다`);
    assert.equal(삭제.body.code, 기대코드, `${이름} DELETE: code`);

    const 이후 = await 게시글행(글.id);
    assert.ok(이후, `${이름}: 행이 지워지면 안 된다`);
    assert.equal(이후.title, 이전.title, `${이름}: 제목이 바뀌면 안 된다`);
    assert.equal(이후.content, 이전.content, `${이름}: 본문이 바뀌면 안 된다`);
  }
});

test('D-10 미존재·비정수 postId의 수정·삭제는 500이 아니라 404다', async () => {
  // C-5가 GET만 덮으므로 PATCH·DELETE의 게시글 부재 404 분기를 여기서 검증한다.
  const 잘못된값 = ['999999', 'abc', '0', '-1', '1.5', String(MAX_INT4 + 1)];

  for (const 값 of 잘못된값) {
    const 수정 = await 요청(
      'PATCH',
      `/api/posts/${값}`,
      { title: 새제목('nopost'), content: '없는 글 수정 시도' },
      bearer(작성자.accessToken),
    );
    assert.equal(수정.status, 404, `PATCH postId=${값}: 404여야 한다(500 아님)`);
    assert.equal(수정.body.code, 'NOT_FOUND', `PATCH postId=${값}: code`);
    assert.equal(수정.body.message, '게시글을 찾을 수 없습니다.', `PATCH postId=${값}: message`);

    const 삭제 = await 요청('DELETE', `/api/posts/${값}`, undefined, bearer(작성자.accessToken));
    assert.equal(삭제.status, 404, `DELETE postId=${값}: 404여야 한다(500 아님)`);
    assert.equal(삭제.body.code, 'NOT_FOUND', `DELETE postId=${값}: code`);
    assert.equal(삭제.body.message, '게시글을 찾을 수 없습니다.', `DELETE postId=${값}: message`);
  }
});

// ── E. 인가 위치·재사용 ─────────────────────────────────────────────────────

test('E-1 service 직접 호출로 소유권 403이 재현되고 isAdmin은 통과한다', async () => {
  // HTTP·미들웨어·라우터·컨트롤러를 거치지 않고 소유권 판정이 service에 있음을 증명한다.
  // 인자 순서 규약: (리소스 id, [본문 patch], memberId, gradeLevel, isAdmin)
  const 글 = await 게시글준비(작성자.accessToken, 시드게시판[자유게시판명].id, 'service');

  await assert.rejects(
    () => postService.updatePost(글.id, { title: 새제목('service-try') }, 타인.member.id, 10, false),
    (error) => {
      assert.equal(error.status, 403, '타인 수정은 403이다');
      assert.equal(error.code, 'FORBIDDEN');
      assert.equal(error.message, '본인 또는 관리자만 수정·삭제할 수 있습니다.');
      return true;
    },
  );

  await assert.rejects(
    () => postService.deletePost(글.id, 타인.member.id, 10, false),
    (error) => {
      assert.equal(error.status, 403, '타인 삭제도 403이다');
      assert.equal(error.code, 'FORBIDDEN');
      return true;
    },
  );
  assert.ok(await 게시글행(글.id), 'service 레벨 거부에서도 행이 남아야 한다');

  // isAdmin=true면 같은 호출이 성공한다.
  const 새타이틀 = 새제목('service-admin');
  const 수정됨 = await postService.updatePost(
    글.id,
    { title: 새타이틀 },
    타인.member.id,
    10,
    true,
  );
  assert.equal(수정됨.title, 새타이틀);
  assert.deepEqual(Object.keys(수정됨).sort(), 상세키, 'service 반환값도 Post 8개 키다');

  await postService.deletePost(글.id, 타인.member.id, 10, true);
  assert.equal(await 게시글행(글.id), undefined, 'isAdmin은 타인 글도 삭제할 수 있다');

  // 조회 계열도 HTTP 없이 동작한다.
  const 목록결과 = await postService.getPosts(시드게시판[자유게시판명].id, 1, 5, 10);
  assert.deepEqual(Object.keys(목록결과).sort(), 목록응답키);
  assert.equal(typeof 목록결과.totalCount, 'number');
});

test('E-2 post-service 소스에 등급 인가가 복제되지 않았다', async () => {
  // §8 계약. getAccessibleBoard 재사용을 그만두고 등급 판정을 직접 쓰면 여기서 깨진다.
  // **삭제하면 안 되는 케이스다.**
  const 소스 = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'post-service.js'),
    'utf8',
  );
  for (const 금지 of ['min_grade_level', 'minGradeLevel', 'is_active', 'isActive']) {
    assert.equal(
      소스.includes(금지),
      false,
      `post-service.js에 '${금지}'가 있으면 게시판 인가 규칙이 복제된 것이다`,
    );
  }
  assert.ok(
    소스.includes('getAccessibleBoard'),
    'post-service.js는 board-service의 getAccessibleBoard를 재사용해야 한다',
  );
});

test('E-3 post-repository 소스는 등급·권한을 알지 못한다', async () => {
  // 인가가 SQL 레이어로 내려가는 회귀 방어(§2.5·§8).
  const 소스 = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'repositories', 'post-repository.js'),
    'utf8',
  );
  for (const 금지 of ['gradeLevel', 'min_grade_level', 'is_admin', 'isAdmin']) {
    assert.equal(
      소스.includes(금지),
      false,
      `post-repository.js에 '${금지}'가 있으면 인가 판정이 repository로 내려간 것이다`,
    );
  }
});

// ── F. 회귀 ─────────────────────────────────────────────────────────────────

test('F-2 라우터 겹침 마운트가 기존 경로를 깨지 않는다', async () => {
  // /api/boards 프리픽스를 board-routes.js와 공유하므로 BE-05 경로가 가려지면 안 된다(§11 위험 14).
  const 헬스 = await 요청('GET', '/health');
  assert.equal(헬스.status, 200, '/health를 router.use 아래로 옮기면 깨진다');
  assert.deepEqual(헬스.body, { status: 'ok', db: 'ok' });

  const 게시판목록 = await 요청('GET', '/api/boards', undefined, bearer(준회원.accessToken));
  assert.equal(게시판목록.status, 200, 'GET /api/boards가 살아 있어야 한다');
  assert.ok(Array.isArray(게시판목록.body));

  const 게시판상세 = await 요청(
    'GET',
    `/api/boards/${시드게시판[자유게시판명].id}`,
    undefined,
    bearer(준회원.accessToken),
  );
  assert.equal(게시판상세.status, 200, 'GET /api/boards/{id}가 posts 라우트에 가려지면 안 된다');
  assert.equal(게시판상세.body.id, 시드게시판[자유게시판명].id);

  const 없는경로 = await 요청('GET', '/없는-경로');
  assert.equal(없는경로.status, 404);
  assert.equal(없는경로.body.code, 'NOT_FOUND');
});

test('F-3 swagger에 없는 메서드·경로는 404다', async () => {
  const 글 = await 게시글준비(작성자.accessToken, 시드게시판[자유게시판명].id, 'undefined-route');
  const 경로들 = [
    ['PUT', `/api/posts/${글.id}`],
    ['POST', '/api/posts'],
    ['DELETE', `/api/boards/${시드게시판[자유게시판명].id}/posts`],
    ['GET', '/api/posts'],
  ];
  for (const [메서드, 경로] of 경로들) {
    // GET에는 본문을 붙이지 않는다(fetch가 GET+body를 거부한다).
    const 본문 = 메서드 === 'GET' ? undefined : { title: 새제목('nope'), content: '만들면안됨' };
    const 응답 = await 요청(메서드, 경로, 본문, bearer(관리자.accessToken));
    assert.equal(응답.status, 404, `${메서드} ${경로}: swagger 미정의 경로다`);
    assert.equal(응답.body.code, 'NOT_FOUND', `${메서드} ${경로}: code`);
  }
  assert.ok(await 게시글행(글.id), '미정의 경로 요청으로 행이 지워지면 안 된다');
});

// ── 정리 ────────────────────────────────────────────────────────────────────

test.after(async () => {
  // 삭제 순서가 중요하다 — posts.member_id가 ON DELETE RESTRICT이므로 게시글이 먼저다.
  // 1) 회수한 id로 삭제한다(PATCH로 제목이 변형된 행까지 확실히 잡는다).
  // 2) be06- 제목으로 한 번 더 훑는다(헬퍼를 우회한 행 방어).
  // 3) 그 다음에야 be06- 회원을 삭제할 수 있다.
  await query('DELETE FROM posts WHERE id = ANY($1::int[])', [만든게시글ID]);
  await query('DELETE FROM posts WHERE title LIKE $1', [`${PREFIX}%`]);
  await query('DELETE FROM members WHERE email LIKE $1', [`${PREFIX}%`]);
  await pool.end();
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});
