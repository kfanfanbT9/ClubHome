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
// 이 파일이 만드는 모든 회원 이메일의 접두사. 생성과 정리가 이 상수 하나만 쓴다.
// reservations에는 접두사를 넣을 텍스트 컬럼이 없으므로 **모든 픽스처 예약의 member_id가
// be08- 회원**이라는 사실이 유일한 정리 장치다(member_id FK를 통한 간접 식별, 계획서 §8-1).
const PREFIX = 'be08-';

// docs/seed-dev.sql 계정 비밀번호. 픽스처 회원 가입에도 그대로 쓴다.
const 시드비밀번호 = 'Test1234!';

// swagger Reservation 프로퍼티 8개(정렬본). slots·memberName·durationMinutes 금지.
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

// 날짜 센티널. **케이스 간에 섞지 않는다** — 섞으면 서로의 예약이 겹쳐 결과가 흔들린다(계획서 §8-1).
const 주날짜 = '2099-12-31'; // A-1·A-2·B-1·B-2·C-1·C-2·C-4·D-1·D-2·D-3·E-1
const 동시성날짜 = '2099-12-30'; // B-4 전용 — 다른 케이스가 절대 쓰지 않는다
const 취소날짜 = '2099-12-29'; // B-3 전용(취소 후 재예약)
// C-3 전용. 계획서는 센티널 3개만 열거했지만 C-3의 대조 케이스(09:00~09:30·21:30~22:00)가
// 주날짜에서는 A-1(09:00~10:30)과 겹쳐 409가 되므로 운영시간 경계 검증에 전용 날짜를 하나 더 둔다.
const 운영시간날짜 = '2099-12-28';

// ── 서버·HTTP 헬퍼 ──────────────────────────────────────────────────────────
// 케이스마다 서버를 띄우면 느리므로 파일 전체가 포트 0으로 띄운 서버 1대를 공유한다.
let server;
let base;

/** Bearer 인증 헤더. */
const bearer = (토큰) => ({ Authorization: `Bearer ${토큰}` });

/**
 * HTTP 요청 1건. 이 파일의 유일한 요청 통로다.
 * 문자열 본문은 그대로 보낸다(잘못된 JSON 케이스용).
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

/** 예약 신청. 이 파일의 검증 대상 엔드포인트다. */
const 신청 = (토큰, roomId, 본문) =>
  요청('POST', `/api/practice-rooms/${roomId}/reservations`, 본문, 토큰 === null ? {} : bearer(토큰));

/** 예약현황 조회(BE-07). E-1에서만 쓴다. */
const 예약현황 = (토큰, roomId, date) =>
  요청('GET', `/api/practice-rooms/${roomId}/reservations?date=${date}`, undefined, bearer(토큰));

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

// ── DB 직접 조회 헬퍼 ───────────────────────────────────────────────────────
// API 응답을 믿지 않고 실제 저장 상태를 단정하는 통로다.

/**
 * 예약 행 1건. `reservation_date::text AS d`로 읽는다 —
 * pg는 DATE를 JS Date로 반환하므로 테스트 코드가 Date 객체를 문자열과 비교하는 함정을 피한다.
 */
async function 예약행(id) {
  const { rows } = await query(
    `SELECT id, practice_room_id, member_id, reservation_date::text AS d,
            start_time, end_time, reservation_status
       FROM reservations WHERE id = $1`,
    [id],
  );
  return rows[0];
}

/** (연습실, 날짜)의 유효 예약 수. "행이 생기지 않았다"·"정확히 1건"을 단정하는 데 쓴다. */
async function 예약수(roomId, date) {
  const { rows } = await query(
    `SELECT COUNT(*) AS count FROM reservations
      WHERE practice_room_id = $1 AND reservation_date = $2::date AND reservation_status = 'reserved'`,
    [roomId, date],
  );
  return Number(rows[0].count);
}

/** 특정 회원의 전체 예약 수. 탈퇴 회원의 행이 0건임을 단정한다(D-3). */
async function 회원예약수(memberId) {
  const { rows } = await query('SELECT COUNT(*) AS count FROM reservations WHERE member_id = $1', [
    memberId,
  ]);
  return Number(rows[0].count);
}

/** 픽스처 정리. 순서 필수 — FK가 ON DELETE RESTRICT다(계획서 §8-1). */
async function 정리() {
  // 1) reservations: be08- 회원을 서브쿼리로 되짚어 지운다.
  //    삽입 id를 테스트가 들고 다니는 부기가 없어지고, 일부만 삽입된 실패 상황도 회수된다.
  await query('DELETE FROM reservations WHERE member_id IN (SELECT id FROM members WHERE email LIKE $1)', [
    `${PREFIX}%`,
  ]);
  // 2) members: 예약이 남아 있으면 member_id FK RESTRICT로 실패하므로 반드시 1) 다음이다.
  await query('DELETE FROM members WHERE email LIKE $1', [`${PREFIX}%`]);
}

/** 가입 → 로그인으로 be08- 회원 1명을 만든다. 토큰은 로그인 API로만 얻는다. */
async function 픽스처회원(구분) {
  const email = 새이메일(구분);
  const 가입본문 = { name: `테스트${구분}`, email, password: 시드비밀번호, phone: '010-0000-0008' };
  const 가입 = await 요청('POST', '/api/auth/signup', 가입본문);
  assert.equal(가입.status, 201, `픽스처(${구분}) 가입 실패: ${가입.text}`);

  const 로그인 = await 요청('POST', '/api/auth/login', { email, password: 시드비밀번호 });
  assert.equal(로그인.status, 200, `픽스처(${구분}) 로그인 실패: ${로그인.text}`);

  return { email, 이름: 가입본문.name, accessToken: 로그인.body.accessToken, member: 로그인.body.member };
}

// ── 공유 픽스처 ─────────────────────────────────────────────────────────────
let 신청자; // be08-req (가입+로그인)
let 타인; // be08-other (가입+로그인)
let 탈퇴회원; // be08-withdrawn (직접 INSERT + signAccessToken)
let 활성실; // 시드 활성 연습실 { id, open_time, close_time }
let 비활성실id; // 시드 비활성 연습실 id
let A1id; // A-1이 만든 예약 id. E-1이 참조한다.

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  // 선행 정리: reservations에 부분 유니크 인덱스 uq_reservations_active_slot이 있어
  // 이전 실행의 정리가 실패했으면 아래 신청·INSERT가 제약 위반으로 터진다.
  // 행이 없으면 무연산이다(계획서 §8-1 항목 3). before와 after가 같은 헬퍼를 공유한다.
  await 정리();

  // 시드 연습실 id를 **하드코딩하지 않고 조회한다**(실측 시드 id는 2·3이며 1이 아니다).
  const { rows: 활성행 } = await query(
    'SELECT id, open_time, close_time FROM practice_rooms WHERE is_active = TRUE ORDER BY id LIMIT 1',
  );
  assert.equal(
    활성행.length,
    1,
    '활성 시드 연습실이 최소 1건 있어야 한다. docs/seed-dev.sql이 적용되었는지 확인하라.',
  );
  활성실 = 활성행[0];

  const { rows: 비활성행 } = await query(
    'SELECT id FROM practice_rooms WHERE is_active = FALSE ORDER BY id LIMIT 1',
  );
  assert.equal(
    비활성행.length,
    1,
    '비활성 시드 연습실이 최소 1건 있어야 한다. docs/seed-dev.sql이 적용되었는지 확인하라.',
  );
  비활성실id = 비활성행[0].id;

  // 시드 전제 가드: 운영시간이 09:00~22:00이어야 C-3의 기대 메시지·경계값이 성립한다.
  // pg는 TIME을 'HH:mm:ss' 문자열로 반환한다.
  assert.equal(활성실.open_time, '09:00:00', '활성 시드 연습실 open_time은 09:00:00이어야 한다');
  assert.equal(활성실.close_time, '22:00:00', '활성 시드 연습실 close_time은 22:00:00이어야 한다');

  신청자 = await 픽스처회원('req');
  타인 = await 픽스처회원('other');
  assert.notEqual(신청자.member.id, 타인.member.id, '신청자와 타인은 서로 다른 회원이어야 한다');

  // 탈퇴 회원은 로그인할 수 없으므로(BE-03 403) 직접 INSERT하고 토큰을 직접 발급한다.
  // 등급 id는 하드코딩하지 않고 최하위 등급을 조회한다.
  const { rows: 등급 } = await query(
    'SELECT id, grade_level, is_admin FROM member_grades ORDER BY grade_level ASC LIMIT 1',
  );
  assert.equal(등급.length, 1, 'member_grades가 비어 있다. docs/seed-dev.sql이 적용되었는지 확인하라.');
  const { rows: 삽입 } = await query(
    `INSERT INTO members (email, password_hash, name, phone, member_grade_id, account_status)
     VALUES ($1, $2, $3, $4, $5, 'withdrawn')
     RETURNING id`,
    [새이메일('withdrawn'), await hashPassword(시드비밀번호), '탈퇴회원', '010-0000-0009', 등급[0].id],
  );
  탈퇴회원 = {
    id: 삽입[0].id,
    accessToken: signAccessToken({
      id: 삽입[0].id,
      gradeLevel: 등급[0].grade_level,
      isAdmin: 등급[0].is_admin,
    }),
  };
});

// ── A. 성공 (완료조건 1) ────────────────────────────────────────────────────

test('A-1 비어 있는 연속 슬롯 구간(09:00~10:30) 예약이 201로 확정된다', async () => {
  // 본문 위조 필드를 함께 실어 화이트리스트(계획서 §3-3)까지 한 번에 단정한다.
  const 응답 = await 신청(신청자.accessToken, 활성실.id, {
    reservationDate: 주날짜,
    startTime: '09:00',
    endTime: '10:30',
    memberId: 타인.member.id, // 예약자 위조 시도
    practiceRoomId: 비활성실id, // 연습실 이동 시도
    reservationStatus: 'completed', // 상태 조작 시도
    id: 1, // 대상 행 지목 시도
  });

  assert.equal(응답.status, 201, `예약 신청 실패: ${응답.text}`);
  assert.deepEqual(Object.keys(응답.body).sort(), 예약키, 'Reservation은 정확히 8개 키다');

  // §9-1-5 회귀 방어: reservation_date(DATE)를 RETURNING해 응답에 실으면
  // KST에서 '2099-12-30T15:00:00.000Z'가 나가 하루 어긋난다. 요청 문자열을 그대로 되돌려야 한다.
  assert.equal(응답.body.reservationDate, 주날짜, '응답 reservationDate는 요청 문자열과 정확히 같아야 한다');
  assert.equal(응답.body.reservationDate.length, 10, "ISO 문자열이 아니라 'YYYY-MM-DD' 10자다");

  // §9-1-7 회귀 방어: TIME을 RETURNING해 '09:00:00'을 그대로 내리면 swagger HH:mm 위반이다.
  assert.equal(응답.body.startTime, '09:00', "startTime은 5자 'HH:mm'이다('09:00:00'이면 실패)");
  assert.equal(응답.body.endTime, '10:30', "endTime은 5자 'HH:mm'이다('10:30:00'이면 실패)");
  assert.equal(응답.body.startTime.length, 5);
  assert.equal(응답.body.endTime.length, 5);

  assert.equal(응답.body.reservationStatus, 'reserved', '신규 예약 상태는 DB 기본값 reserved다');
  assert.equal(응답.body.memberId, 신청자.member.id, '예약자는 토큰의 회원이어야 한다');
  assert.equal(응답.body.practiceRoomId, 활성실.id, '연습실은 경로의 roomId여야 한다');
  assert.ok(Number.isInteger(응답.body.id));
  assert.notEqual(응답.body.id, 1, 'id는 IDENTITY가 결정한다');
  assert.equal(typeof 응답.body.createdAt, 'string');
  assert.ok(!Number.isNaN(Date.parse(응답.body.createdAt)), 'createdAt이 파싱 가능해야 한다');

  // DB 실제 저장 상태 단정.
  const 행 = await 예약행(응답.body.id);
  assert.ok(행, 'DB에 예약 행이 있어야 한다');
  assert.equal(행.d, 주날짜, 'DB의 reservation_date가 하루 어긋나면 안 된다(문자열 바인딩)');
  assert.equal(행.start_time, '09:00:00');
  assert.equal(행.end_time, '10:30:00');
  assert.equal(행.reservation_status, 'reserved');
  assert.equal(행.member_id, 신청자.member.id, 'DB의 member_id는 토큰의 회원이다');
  assert.equal(행.practice_room_id, 활성실.id, 'DB의 practice_room_id는 경로의 roomId다');

  A1id = 응답.body.id;
});

// ── E. 회귀 (실행 순서 의존 — A-1 직후에 두어야 한다) ───────────────────────
// A-2가 주날짜의 10:30~11:00을 점유하므로 "10:30 슬롯이 예약가능"은 A-1 직후에만 성립한다.
// node:test는 파일 내 최상위 테스트를 선언 순서대로 실행하므로 이 위치가 계약이다.

test('E-1 신청 결과가 BE-07 예약현황 조회에 즉시 반영된다', async () => {
  // POST 라우트 추가로 같은 경로의 GET이 가려지지 않았음도 함께 증명한다(200).
  const 응답 = await 예약현황(신청자.accessToken, 활성실.id, 주날짜);
  assert.equal(응답.status, 200, `예약현황 조회 실패(GET이 POST에 가려졌는가): ${응답.text}`);
  assert.equal(응답.body.date, 주날짜);

  const 슬롯맵 = new Map(응답.body.slots.map((slot) => [slot.startTime, slot]));

  // A-1은 09:00~10:30 → 30분 슬롯 3개를 덮는다.
  for (const 시작 of ['09:00', '09:30', '10:00']) {
    const slot = 슬롯맵.get(시작);
    assert.ok(slot, `${시작} 슬롯이 있어야 한다`);
    assert.equal(slot.isAvailable, false, `${시작}: A-1 예약이 걸친 슬롯은 예약불가다`);
    assert.equal(slot.reservationId, A1id, `${시작}: reservationId는 A-1의 예약 id다`);
  }

  // 경계에서 한 칸 더 막지 않는다 — 10:30 슬롯은 A-1의 종료 시각과 맞닿을 뿐이다.
  const 경계 = 슬롯맵.get('10:30');
  assert.ok(경계, '10:30 슬롯이 있어야 한다');
  assert.equal(경계.isAvailable, true, '예약 종료시각과 맞닿은 슬롯은 예약가능이다');
  assert.equal(경계.reservationId, null);
});

// ── A. 성공 (이어서) ────────────────────────────────────────────────────────

test('A-2 경계가 맞닿은 인접 구간은 겹침이 아니다', async () => {
  // §4-7 회귀 방어: 겹침 판정에 등호(`>=`/`<=`)를 넣으면 이 케이스가 409로 깨진다.
  // (1) 위쪽 접촉 — 신청 시작 시각이 기존 예약 A-1의 종료 시각과 같다.
  const 위 = await 신청(신청자.accessToken, 활성실.id, {
    reservationDate: 주날짜,
    startTime: '10:30',
    endTime: '11:00',
  });
  assert.equal(위.status, 201, `10:30~11:00(A-1 종료와 접촉)은 201이어야 한다: ${위.text}`);

  // (2) 아래쪽 접촉 — 신청 종료 시각이 기존 예약의 시작 시각과 같다.
  //     계획서는 '08:00~09:00'을 예시로 들지만 개관 시각이 09:00이라 그 구간은
  //     운영시간 검증(C-3)에 먼저 걸린다. 같은 등호 회귀를 운영시간 안에서 검증한다.
  const 기준 = await 신청(신청자.accessToken, 활성실.id, {
    reservationDate: 주날짜,
    startTime: '12:00',
    endTime: '13:00',
  });
  assert.equal(기준.status, 201, `12:00~13:00(빈 구간)은 201이어야 한다: ${기준.text}`);

  const 아래 = await 신청(신청자.accessToken, 활성실.id, {
    reservationDate: 주날짜,
    startTime: '11:30',
    endTime: '12:00',
  });
  assert.equal(아래.status, 201, `11:30~12:00(12:00 시작 예약과 접촉)은 201이어야 한다: ${아래.text}`);

  // 세 행 모두 DB에 존재한다.
  for (const 응답 of [위, 기준, 아래]) {
    const 행 = await 예약행(응답.body.id);
    assert.ok(행, `예약 ${응답.body.id} 행이 DB에 있어야 한다`);
    assert.equal(행.reservation_status, 'reserved');
    assert.equal(행.d, 주날짜);
  }
});

// ── B. 중복 예약 금지 (완료조건 2 — 이 프로젝트 최상위 규칙) ────────────────

test('B-1 구간 일부만 겹치면 409로 거부되고 부분 저장이 없다', async () => {
  // **삭제 금지**: 기존 09:00~10:30과 시작점이 다른 부분 겹침은 부분 유니크 인덱스로 막히지
  // 않는다. 애플리케이션 겹침 검사(§4-7)의 유일한 증명이다(§9-1-4).
  const 이전건수 = await 예약수(활성실.id, 주날짜);

  const 응답 = await 신청(신청자.accessToken, 활성실.id, {
    reservationDate: 주날짜,
    startTime: '10:00',
    endTime: '11:00',
  });

  assert.equal(응답.status, 409, `부분 겹침은 409여야 한다: ${응답.text}`);
  assert.equal(응답.body.code, 'RESERVATION_SLOT_CONFLICT', 'FE-07이 코드로 식별하는 유일한 분기다');
  assert.equal(응답.body.message, '이미 예약된 시간대가 포함되어 있습니다.');
  assert.deepEqual(Object.keys(응답.body).sort(), ['code', 'message'], '본문 키 2개');

  assert.equal(
    await 예약수(활성실.id, 주날짜),
    이전건수,
    '거부된 요청으로 행이 생기면 안 된다(부분 저장 없음)',
  );
});

test('B-2 포함·감싸기·동일 구간과 타인 신청도 모두 409다', async () => {
  const 이전건수 = await 예약수(활성실.id, 주날짜);
  const 케이스들 = [
    ['포함(09:30~10:00)', 신청자.accessToken, '09:30', '10:00'],
    ['감싸기+동일 시작점(09:00~11:00)', 신청자.accessToken, '09:00', '11:00'],
    ['완전 동일(09:00~10:30)', 신청자.accessToken, '09:00', '10:30'],
    // 도메인 §6: 회원이 달라도 같은 시간대는 1건만 유효하다.
    ['타인 신청(10:00~10:30)', 타인.accessToken, '10:00', '10:30'],
  ];

  for (const [이름, 토큰, startTime, endTime] of 케이스들) {
    const 응답 = await 신청(토큰, 활성실.id, { reservationDate: 주날짜, startTime, endTime });
    assert.equal(응답.status, 409, `${이름}: status(${응답.text})`);
    assert.equal(응답.body.code, 'RESERVATION_SLOT_CONFLICT', `${이름}: code`);
    assert.equal(응답.body.message, '이미 예약된 시간대가 포함되어 있습니다.', `${이름}: message`);
    assert.equal(await 예약수(활성실.id, 주날짜), 이전건수, `${이름}: 행 수가 변하면 안 된다`);
  }
});

test('B-3 취소된 예약이 있던 시간대는 재예약된다', async () => {
  // §9-1-9의 유일한 방어 케이스: WHERE reservation_status = 'reserved'를 빠뜨리면
  // 취소된 예약이 시간대를 영구 점유한다. 부분 유니크 인덱스와의 정합성도 함께 증명한다.
  await query(
    `INSERT INTO reservations (practice_room_id, member_id, reservation_date, start_time, end_time, reservation_status)
     VALUES ($1, $2, $3::date, $4::time, $5::time, 'canceled')`,
    [활성실.id, 타인.member.id, 취소날짜, '13:00', '14:00'],
  );
  assert.equal(await 예약수(활성실.id, 취소날짜), 0, '전제: 취소 예약은 유효 예약 수에 들어가지 않는다');

  const 응답 = await 신청(신청자.accessToken, 활성실.id, {
    reservationDate: 취소날짜,
    startTime: '13:00',
    endTime: '14:00',
  });

  assert.equal(응답.status, 201, `취소된 시간대 재예약은 201이어야 한다: ${응답.text}`);
  assert.equal(응답.body.reservationStatus, 'reserved');
  const 행 = await 예약행(응답.body.id);
  assert.equal(행.d, 취소날짜);
  assert.equal(행.start_time, '13:00:00');
  assert.equal(await 예약수(활성실.id, 취소날짜), 1, '재예약된 유효 예약이 1건이어야 한다');
});

test('B-4 동시 신청 중 하나만 201이고 하나는 409다(구간 부분 겹침)', async () => {
  // **이 Task 최우선 케이스이며 삭제 금지**(§9-1-1). 연습실 행 FOR UPDATE 잠금이 없으면
  // 두 트랜잭션이 모두 0행을 보고 각각 INSERT하며, **시작점이 달라 부분 유니크 인덱스도
  // 통과**해 [201, 201] + 행 수 2가 된다. 시작점을 다르게(부분만 겹치게) 고른 것이 검출력의 핵심이다.
  const 이전건수 = await 예약수(활성실.id, 동시성날짜);
  assert.equal(이전건수, 0, '동시성 전용 날짜에는 다른 케이스의 예약이 없어야 한다');

  const [첫, 둘] = await Promise.all([
    신청(신청자.accessToken, 활성실.id, {
      reservationDate: 동시성날짜,
      startTime: '09:00',
      endTime: '10:00',
    }),
    신청(타인.accessToken, 활성실.id, {
      reservationDate: 동시성날짜,
      startTime: '09:30',
      endTime: '10:30',
    }),
  ]);

  // 어느 쪽이 이기는지는 비결정적이다. "정확히 하나만 201"만 결정적이므로 그것만 단정한다.
  assert.deepEqual(
    [첫.status, 둘.status].sort((a, b) => a - b),
    [201, 409],
    `동시 신청 결과가 [201, 409]여야 한다(둘 다 201이면 연습실 행 잠금이 없다): ${첫.text} / ${둘.text}`,
  );

  const 성공 = [첫, 둘].find((응답) => 응답.status === 201);
  const 실패 = [첫, 둘].find((응답) => 응답.status === 409);
  assert.equal(실패.body.code, 'RESERVATION_SLOT_CONFLICT', '패배한 요청의 code');
  assert.equal(실패.body.message, '이미 예약된 시간대가 포함되어 있습니다.');

  assert.equal(
    await 예약수(활성실.id, 동시성날짜),
    1,
    '해당 (연습실, 날짜)의 유효 예약이 정확히 1건이어야 한다',
  );

  const 행 = await 예약행(성공.body.id);
  assert.ok(행, '201 응답의 id에 해당하는 행이 DB에 있어야 한다');
  assert.equal(행.d, 동시성날짜);
  assert.equal(행.reservation_status, 'reserved');
});

// ── C. 입력 검증 400 (완료조건 3·4) ─────────────────────────────────────────

test('C-1 30분 경계를 벗어난 시각은 500이 아니라 400이다', async () => {
  // 완료조건 3. DB CHECK(reservations_30min_slot_check, pg 23514)에 의존하면 500이 된다.
  const 이전건수 = await 예약수(활성실.id, 주날짜);
  // undefined는 JSON.stringify가 키를 지우므로 "필드 누락" 케이스가 된다.
  const 불량값들 = [
    ['30분 경계 위반(09:17)', '09:17'], // 완료조건 3 원문 예시
    ['초 포함', '09:00:00'],
    ['한자리 시', '9:00'],
    ['구분자 없음', '0900'],
    ['분 60', '09:60'],
    ['25시', '25:00'],
    ['24시', '24:00'],
    ['빈 문자열', ''],
    ['null', null],
    ['숫자', 9],
    ['누락', undefined],
  ];

  for (const [이름, 값] of 불량값들) {
    // startTime 쪽. endTime은 정상값으로 두어 순서 검증이 먼저 걸리지 않게 한다.
    const 시작 = await 신청(신청자.accessToken, 활성실.id, {
      reservationDate: 주날짜,
      startTime: 값,
      endTime: '20:00',
    });
    assert.notEqual(시작.status, 500, `startTime ${이름}: pg 23514가 500으로 새면 안 된다`);
    assert.equal(시작.status, 400, `startTime ${이름}: status(${시작.text})`);
    assert.equal(시작.body.code, 'BAD_REQUEST', `startTime ${이름}: code`);
    assert.ok(
      시작.body.message.includes('30분 단위'),
      `startTime ${이름}: 30분 경계 메시지여야 한다(${시작.body.message})`,
    );

    // endTime 쪽.
    const 종료 = await 신청(신청자.accessToken, 활성실.id, {
      reservationDate: 주날짜,
      startTime: '20:00',
      endTime: 값,
    });
    assert.notEqual(종료.status, 500, `endTime ${이름}: pg 23514가 500으로 새면 안 된다`);
    assert.equal(종료.status, 400, `endTime ${이름}: status(${종료.text})`);
    assert.equal(종료.body.code, 'BAD_REQUEST', `endTime ${이름}: code`);
    assert.ok(
      종료.body.message.includes('30분 단위'),
      `endTime ${이름}: 30분 경계 메시지여야 한다(${종료.body.message})`,
    );
  }

  assert.equal(await 예약수(활성실.id, 주날짜), 이전건수, '400 요청으로 행이 생기면 안 된다');
});

test('C-2 시간 순서 위반은 400이다', async () => {
  const 이전건수 = await 예약수(활성실.id, 주날짜);
  const 케이스들 = [
    ['동일(20:00~20:00)', '20:00', '20:00'],
    ['역순(21:00~20:00)', '21:00', '20:00'],
  ];

  for (const [이름, startTime, endTime] of 케이스들) {
    const 응답 = await 신청(신청자.accessToken, 활성실.id, {
      reservationDate: 주날짜,
      startTime,
      endTime,
    });
    assert.equal(응답.status, 400, `${이름}: status(${응답.text})`);
    assert.equal(응답.body.code, 'BAD_REQUEST', `${이름}: code`);
    assert.equal(응답.body.message, '종료 시각은 시작 시각보다 뒤여야 합니다.', `${이름}: message`);
  }

  // 역순을 서버가 swap해 저장하면 행 수가 늘어난다(§5-3: 자동 교정 금지).
  assert.equal(await 예약수(활성실.id, 주날짜), 이전건수, '400 요청으로 행이 생기면 안 된다');
});

test('C-3 운영시간을 벗어난 요청은 400이다', async () => {
  // 완료조건 4. 대조 케이스가 겹치지 않도록 운영시간 전용 날짜를 쓴다.
  assert.equal(await 예약수(활성실.id, 운영시간날짜), 0, '전제: 운영시간 전용 날짜는 비어 있다');

  const 밖 = [
    ['개관 전 시작(08:30~09:30)', '08:30', '09:30'],
    ['폐관 후 종료(21:30~22:30)', '21:30', '22:30'],
    ['폐관 이후(22:00~22:30)', '22:00', '22:30'],
    ['개관 전 전체(08:00~08:30)', '08:00', '08:30'],
  ];
  for (const [이름, startTime, endTime] of 밖) {
    const 응답 = await 신청(신청자.accessToken, 활성실.id, {
      reservationDate: 운영시간날짜,
      startTime,
      endTime,
    });
    assert.equal(응답.status, 400, `${이름}: status(${응답.text})`);
    assert.equal(응답.body.code, 'BAD_REQUEST', `${이름}: code`);
    assert.equal(
      응답.body.message,
      '연습실 운영시간(09:00~22:00) 내에서만 예약할 수 있습니다.',
      `${이름}: message`,
    );
  }
  assert.equal(await 예약수(활성실.id, 운영시간날짜), 0, '400 요청으로 행이 생기면 안 된다');

  // 대조: 판정식은 **양끝 포함**이다(§5-4). 개관 직후·폐관 직전 구간은 정상 예약이다.
  for (const [이름, startTime, endTime] of [
    ['개관 직후(09:00~09:30)', '09:00', '09:30'],
    ['폐관 직전(21:30~22:00)', '21:30', '22:00'],
  ]) {
    const 응답 = await 신청(신청자.accessToken, 활성실.id, {
      reservationDate: 운영시간날짜,
      startTime,
      endTime,
    });
    assert.equal(응답.status, 201, `${이름}: 경계 포함이므로 201이어야 한다(${응답.text})`);
    assert.equal(응답.body.startTime, startTime);
    assert.equal(응답.body.endTime, endTime);
  }
  assert.equal(await 예약수(활성실.id, 운영시간날짜), 2, '대조 케이스 2건이 저장되어야 한다');
});

test('C-4 reservationDate·roomId 형식 불량은 500이 아니라 400이다', async () => {
  const 이전건수 = await 예약수(활성실.id, 주날짜);

  const 날짜들 = [
    ['누락', undefined],
    ['빈 문자열', ''],
    ['구분자 없음', '20991231'],
    ['한자리 월·일', '2099-9-1'],
    ['13월', '2099-13-01'],
    ['2월 30일(pg 22008)', '2099-02-30'],
    ['날짜+시각', '2099-12-31T00:00:00'],
    ['null', null],
  ];
  for (const [이름, reservationDate] of 날짜들) {
    const 응답 = await 신청(신청자.accessToken, 활성실.id, {
      reservationDate,
      startTime: '20:00',
      endTime: '21:00',
    });
    assert.notEqual(응답.status, 500, `reservationDate ${이름}: pg 22008이 500으로 새면 안 된다`);
    assert.equal(응답.status, 400, `reservationDate ${이름}: status(${응답.text})`);
    assert.equal(응답.body.code, 'BAD_REQUEST', `reservationDate ${이름}: code`);
    assert.equal(
      응답.body.message,
      'reservationDate는 YYYY-MM-DD 형식이어야 합니다.',
      `reservationDate ${이름}: message`,
    );
  }

  // roomId: 'abc'는 pg 22P02, '99999999999'는 22003 → 방어가 없으면 500이 된다.
  for (const roomId of ['abc', '0', '-1', '1.5', '99999999999']) {
    const 응답 = await 신청(신청자.accessToken, roomId, {
      reservationDate: 주날짜,
      startTime: '20:00',
      endTime: '21:00',
    });
    assert.notEqual(응답.status, 500, `roomId=${roomId}: pg 22P02·22003이 500으로 새면 안 된다`);
    assert.equal(응답.status, 400, `roomId=${roomId}: status(${응답.text})`);
    assert.equal(응답.body.code, 'BAD_REQUEST', `roomId=${roomId}: code`);
    assert.equal(응답.body.message, '연습실 ID가 올바르지 않습니다.', `roomId=${roomId}: message`);
  }

  // 잘못된 JSON 본문은 express.json이 400으로 거른다(errorHandler가 4xx를 BAD_REQUEST로 표기).
  const 깨진JSON = await 요청(
    'POST',
    `/api/practice-rooms/${활성실.id}/reservations`,
    '{"reservationDate":',
    bearer(신청자.accessToken),
  );
  assert.notEqual(깨진JSON.status, 500, '잘못된 JSON이 500으로 새면 안 된다');
  assert.equal(깨진JSON.status, 400, `잘못된 JSON: status(${깨진JSON.text})`);

  assert.equal(await 예약수(활성실.id, 주날짜), 이전건수, '400 요청으로 행이 생기면 안 된다');
});

// ── D. 인가 (완료조건 5) ────────────────────────────────────────────────────

test('D-1 인증 없이/만료·위조 토큰으로 신청하면 401이고 행이 없다', async () => {
  const 이전건수 = await 예약수(활성실.id, 주날짜);
  const 만료 = 만료Access토큰({
    id: 신청자.member.id,
    gradeLevel: 신청자.member.memberGrade.gradeLevel,
    isAdmin: 신청자.member.memberGrade.isAdmin,
  });
  const 토큰들 = [
    ['헤더없음', null, 'UNAUTHORIZED'],
    ['만료토큰', 만료, 'TOKEN_EXPIRED'],
    ['위조토큰', 위조(신청자.accessToken), 'UNAUTHORIZED'],
  ];

  for (const [이름, 토큰, 기대코드] of 토큰들) {
    const 응답 = await 신청(토큰, 활성실.id, {
      reservationDate: 주날짜,
      startTime: '16:00',
      endTime: '17:00',
    });
    assert.equal(응답.status, 401, `${이름}: 401이어야 한다(201·400·403·500 아님)`);
    assert.equal(응답.body.code, 기대코드, `${이름}: code`);
    assert.deepEqual(Object.keys(응답.body).sort(), ['code', 'message'], `${이름}: 본문 키 2개`);
  }

  assert.equal(await 예약수(활성실.id, 주날짜), 이전건수, '401 요청으로 행이 생기면 안 된다');
});

test('D-2 비활성 연습실은 403, 존재하지 않는 연습실은 404다', async () => {
  // §6-1: GET은 비활성도 404지만 POST는 403이다. **의도된 스펙 차이이며 통일하지 않는다.**
  const 이전비활성 = await 예약수(비활성실id, 주날짜);
  const 본문 = { reservationDate: 주날짜, startTime: '16:00', endTime: '17:00' };

  const 비활성 = await 신청(신청자.accessToken, 비활성실id, 본문);
  assert.notEqual(비활성.status, 404, '비활성 연습실 신청은 404가 아니라 403이다(GET과 다르다)');
  assert.equal(비활성.status, 403, `비활성 연습실: status(${비활성.text})`);
  assert.equal(비활성.body.code, 'FORBIDDEN', '새 코드값을 발명하지 않고 FORBIDDEN을 재사용한다');
  assert.equal(비활성.body.message, '현재 사용할 수 없는 연습실입니다.');
  assert.equal(await 예약수(비활성실id, 주날짜), 이전비활성, '비활성 연습실에 행이 생기면 안 된다');

  const 미존재 = await 신청(신청자.accessToken, 999999, 본문);
  assert.equal(미존재.status, 404, `미존재 연습실: status(${미존재.text})`);
  assert.equal(미존재.body.code, 'PRACTICE_ROOM_NOT_FOUND');
  assert.equal(미존재.body.message, '연습실을 찾을 수 없습니다.');
  assert.equal(await 예약수(999999, 주날짜), 0, '미존재 연습실에 행이 생기면 안 된다');
});

test('D-3 탈퇴 회원의 예약 신청은 403 ACCOUNT_WITHDRAWN이다', async () => {
  // 완료조건 5. account_status 검사가 유일한 차단 지점이다(토큰은 유효하다).
  // 실재·활성 연습실의 비어 있는 구간으로 신청하므로 §3-4의 판정 순서와 무관하게 403이다.
  const 이전건수 = await 예약수(활성실.id, 주날짜);

  const 응답 = await 신청(탈퇴회원.accessToken, 활성실.id, {
    reservationDate: 주날짜,
    startTime: '17:00',
    endTime: '18:00',
  });

  assert.equal(응답.status, 403, `탈퇴 회원 신청: status(${응답.text})`);
  assert.equal(응답.body.code, 'ACCOUNT_WITHDRAWN');
  assert.equal(응답.body.message, '탈퇴한 계정입니다.');
  assert.equal(await 회원예약수(탈퇴회원.id), 0, '탈퇴 회원의 예약 행이 0건이어야 한다');
  assert.equal(await 예약수(활성실.id, 주날짜), 이전건수, '403 요청으로 행이 생기면 안 된다');
});

// ── 정리 ────────────────────────────────────────────────────────────────────

test.after(async () => {
  await 정리();
  await pool.end();
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});
