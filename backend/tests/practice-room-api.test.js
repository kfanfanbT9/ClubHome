'use strict';

require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const app = require('../src/app');
const { pool, query } = require('../src/db/pool');
const { hashPassword } = require('../src/utils/password');

// ── 상수 ────────────────────────────────────────────────────────────────────
// 이 파일이 만드는 모든 회원 이메일과 연습실 이름의 접두사. 생성과 정리가 이 상수 하나만 쓴다.
// reservations에는 이메일·이름 같은 식별 컬럼이 없으므로 **모든 픽스처 예약의 member_id를
// be07-owner 회원으로 고정**해 member_id FK를 통해 접두사로 간접 식별한다(계획서 §8-2).
const PREFIX = 'be07-';

const 소유자이메일 = `${PREFIX}owner@example.test`;
const 소유자이름 = '칠공칠';
const 경계연습실명 = `${PREFIX}경계연습실`;

// docs/seed-dev.sql 계정. 읽기 전용으로만 쓴다(UPDATE·DELETE 금지).
const 시드비밀번호 = 'Test1234!';
const 준회원계정 = 'junior1@clubhome.local'; // grade_level 10

// 날짜 센티널. 실 데이터·수동 검증 데이터와 충돌할 수 없는 값으로 고정한다(계획서 §8-2).
const 예약있는날 = '2099-12-31';
const 예약없는날 = '2099-12-30';

// swagger PracticeRoom 프로퍼티 7개(정렬본).
const 연습실키 = ['capacity', 'closeTime', 'id', 'isActive', 'location', 'name', 'openTime'];
// swagger ReservationSlot 프로퍼티 5개(정렬본). capacity·memberId·reservationStatus·isMine 금지.
const 슬롯키 = ['endTime', 'isAvailable', 'memberName', 'reservationId', 'startTime'];

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

/** 연습실 목록 조회. */
const 목록 = (헤더) => 요청('GET', '/api/practice-rooms', undefined, 헤더);

/** 하루 예약현황 조회. 쿼리 문자열을 그대로 붙여 date 누락 케이스도 표현할 수 있게 한다. */
const 예약현황 = (헤더, roomId, 쿼리) =>
  요청('GET', `/api/practice-rooms/${roomId}/reservations${쿼리}`, undefined, 헤더);

/** 정상 조회용 단축 헬퍼(로그인 토큰 + date 지정). */
const 조회 = (roomId, date) => 예약현황(bearer(준회원.accessToken), roomId, `?date=${date}`);

/** 'HH:mm' → 분. 슬롯 폭·연속성 단정에만 쓰는 순수 함수다(날짜 라이브러리 금지). */
function 분(hhmm) {
  const [시, 분자리] = hhmm.split(':');
  return Number(시) * 60 + Number(분자리);
}

/** 만료된 Access Token을 직접 서명한다. 시크릿은 환경변수에서만 읽는다. */
const 만료Access토큰 = ({ id, gradeLevel, isAdmin }) =>
  jwt.sign({ memberId: id, gradeLevel, isAdmin, typ: 'access' }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: '-1s',
  });

/** 서명 마지막 문자를 변조한다. */
const 위조 = (토큰) => 토큰.slice(0, -1) + (토큰.slice(-1) === 'A' ? 'B' : 'A');

/** 픽스처 정리. 순서 필수 — FK가 ON DELETE RESTRICT다(계획서 §8-2). */
async function 정리() {
  // 1) reservations: 소유자 회원(be07-)을 서브쿼리로 되짚어 지운다.
  //    삽입 id를 테스트가 들고 다니는 부기가 없어지고, 일부만 삽입된 실패 상황도 회수된다.
  await query('DELETE FROM reservations WHERE member_id IN (SELECT id FROM members WHERE email LIKE $1)', [
    `${PREFIX}%`,
  ]);
  // 2) practice_rooms: 예약이 남아 있으면 practice_room_id FK RESTRICT로 실패하므로 1) 다음이다.
  await query('DELETE FROM practice_rooms WHERE name LIKE $1', [`${PREFIX}%`]);
  // 3) members: 예약이 남아 있으면 member_id FK RESTRICT로 실패하므로 마지막이다.
  await query('DELETE FROM members WHERE email LIKE $1', [`${PREFIX}%`]);
}

// ── 공유 픽스처 ─────────────────────────────────────────────────────────────
let 준회원; // 시드 junior1 로그인 결과(토큰 1회 획득 후 공유)
let 활성실; // 시드 활성 연습실 { id, open_time, close_time, capacity }
let 비활성실id; // 시드 비활성 연습실 id
let 경계실id; // be07-경계연습실 id (09:15~22:15)
let R1id; // 2099-12-31 09:00~10:30 reserved
let R2id; // 2099-12-31 13:00~13:30 canceled

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  // 선행 정리: reservations에 부분 유니크 인덱스 uq_reservations_active_slot이 있어
  // 이전 실행의 정리가 실패했으면 아래 INSERT가 제약 위반으로 터진다. 또 practice_rooms.name에
  // UNIQUE가 없어 재실행 시 중복 행이 생긴다. 행이 없으면 무연산이다(계획서 §8-2 항목 3).
  await 정리();

  // 시드 연습실 id를 **하드코딩하지 않고 조회한다**(실측 id는 2·3이며 1이 아니다).
  const { rows: 활성행 } = await query(
    'SELECT id, open_time, close_time, capacity FROM practice_rooms WHERE is_active = TRUE ORDER BY id LIMIT 1',
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

  // 시드 전제 가드: 운영시간·정원이 아래 기대값이어야 26슬롯·capacity 4 단정이 성립한다.
  // pg는 TIME을 'HH:mm:ss' 문자열로 반환한다(§4-6 실측).
  assert.equal(활성실.open_time, '09:00:00', '활성 시드 연습실 open_time은 09:00:00이어야 한다');
  assert.equal(활성실.close_time, '22:00:00', '활성 시드 연습실 close_time은 22:00:00이어야 한다');
  assert.equal(활성실.capacity, 4, '활성 시드 연습실 capacity는 4여야 한다');

  // 토큰은 로그인 1회로 얻어 공유한다.
  준회원 = (await 요청('POST', '/api/auth/login', { email: 준회원계정, password: 시드비밀번호 })).body;
  assert.ok(
    준회원 && 준회원.accessToken,
    `시드 계정 ${준회원계정} 로그인 실패. docs/seed-dev.sql이 적용되었는지 확인하라.`,
  );

  // 픽스처 예약의 소유자 회원. 등급 id는 하드코딩하지 않고 최하위 등급을 조회한다.
  const { rows: 등급 } = await query(
    'SELECT id FROM member_grades ORDER BY grade_level ASC LIMIT 1',
  );
  assert.equal(등급.length, 1, 'member_grades가 비어 있다. docs/seed-dev.sql이 적용되었는지 확인하라.');
  const { rows: 소유자 } = await query(
    `INSERT INTO members (email, password_hash, name, phone, member_grade_id, account_status)
     VALUES ($1, $2, $3, $4, $5, 'active')
     RETURNING id`,
    [소유자이메일, await hashPassword(시드비밀번호), 소유자이름, '010-0000-0007', 등급[0].id],
  );
  const 소유자id = 소유자[0].id;

  // R1: 3슬롯(09:00·09:30·10:00) 점유 검증용. 날짜는 문자열로 바인딩한다(Date를 넘기면 하루 어긋난다).
  const { rows: r1 } = await query(
    `INSERT INTO reservations (practice_room_id, member_id, reservation_date, start_time, end_time, reservation_status)
     VALUES ($1, $2, $3::date, $4::time, $5::time, 'reserved')
     RETURNING id`,
    [활성실.id, 소유자id, 예약있는날, '09:00', '10:30'],
  );
  R1id = r1[0].id;

  // R2: 취소 예약이 슬롯을 점유하지 않음을 검증하는 픽스처(B-4 전용).
  const { rows: r2 } = await query(
    `INSERT INTO reservations (practice_room_id, member_id, reservation_date, start_time, end_time, reservation_status)
     VALUES ($1, $2, $3::date, $4::time, $5::time, 'canceled')
     RETURNING id`,
    [활성실.id, 소유자id, 예약있는날, '13:00', '13:30'],
  );
  R2id = r2[0].id;

  // ROOM-B: 30분 경계를 벗어난 운영시간 절단 검증 전용(§4-3). 시드 연습실을 UPDATE하지 않기 위해 새로 만든다.
  const { rows: roomB } = await query(
    `INSERT INTO practice_rooms (name, location, capacity, open_time, close_time, is_active)
     VALUES ($1, $2, $3, $4::time, $5::time, TRUE)
     RETURNING id`,
    [경계연습실명, '지하', 1, '09:15', '22:15'],
  );
  경계실id = roomB[0].id;
});

// ── A. GET /api/practice-rooms ──────────────────────────────────────────────

test('A-1 활성 연습실 목록은 200이고 PracticeRoom 키가 7개다', async () => {
  const 응답 = await 목록(bearer(준회원.accessToken));
  assert.equal(응답.status, 200, `목록 조회 실패: ${응답.text}`);
  assert.ok(Array.isArray(응답.body), '배열을 { items: [...] }로 감싸지 않는다');

  const 시드실 = 응답.body.find((room) => room.id === 활성실.id);
  assert.ok(시드실, '활성 시드 연습실이 목록에 있어야 한다');
  assert.deepEqual(Object.keys(시드실).sort(), 연습실키, 'PracticeRoom은 정확히 7개 키다');

  // §4-6 회귀 방어: pg가 주는 '09:00:00'을 그대로 내리면 swagger HH:mm 위반이다.
  assert.equal(시드실.openTime, '09:00', "openTime은 5자 'HH:mm'이다('09:00:00'이면 실패)");
  assert.equal(시드실.closeTime, '22:00', "closeTime은 5자 'HH:mm'이다('22:00:00'이면 실패)");
  assert.equal(시드실.openTime.length, 5);
  assert.equal(시드실.closeTime.length, 5);

  assert.equal(시드실.capacity, 4, '수용인원이 응답에 실려야 한다');
  assert.equal(시드실.isActive, true, 'isActive는 정의된 프로퍼티이며 이 경로에서는 항상 true다');
  assert.equal(typeof 시드실.name, 'string');
});

test('A-2 비활성 연습실은 목록에서 제외된다', async () => {
  // 완료조건 4.
  const 응답 = await 목록(bearer(준회원.accessToken));
  assert.equal(응답.status, 200);

  const 아이디들 = 응답.body.map((room) => room.id);
  assert.equal(
    아이디들.includes(비활성실id),
    false,
    `비활성 연습실 id ${비활성실id}가 목록에 노출되면 안 된다`,
  );
  assert.equal(아이디들.includes(활성실.id), true, '활성 연습실은 목록에 있어야 한다');
  assert.equal(
    응답.body.every((room) => room.isActive === true),
    true,
    '목록의 모든 원소가 활성이어야 한다',
  );
});

test('A-3 인증 없이 목록을 호출하면 401이고 본문 키가 2개다', async () => {
  // §9-1-14 방어: security: []가 아니므로 requireAuth를 빼면 명세 위반이다.
  const 응답 = await 목록({});
  assert.equal(응답.status, 401);
  assert.equal(응답.body.code, 'UNAUTHORIZED');
  assert.deepEqual(Object.keys(응답.body).sort(), ['code', 'message']);
});

// ── B. GET /api/practice-rooms/{roomId}/reservations — 슬롯 전개 ────────────

test('B-1 09:00~22:00 30분 슬롯이 빠짐없이 반환된다', async () => {
  // 완료조건 1.
  const 응답 = await 조회(활성실.id, 예약있는날);
  assert.equal(응답.status, 200, `예약현황 조회 실패: ${응답.text}`);
  assert.deepEqual(Object.keys(응답.body).sort(), ['date', 'practiceRoomId', 'slots']);
  assert.equal(응답.body.practiceRoomId, 활성실.id);

  // §9-1-1·2 회귀 방어: pg가 DATE를 JS Date로 반환하므로 응답에 실으면
  // KST에서 '2099-12-30T15:00:00.000Z'가 나가 하루 어긋난다.
  // 응답 date는 검증된 요청 문자열을 그대로 되돌려주어야 한다.
  assert.equal(응답.body.date, 예약있는날, '응답 date는 요청 문자열과 정확히 같아야 한다');

  const slots = 응답.body.slots;
  assert.equal(slots.length, 26, '09:00~22:00은 30분 × 26슬롯이다');
  assert.equal(slots[0].startTime, '09:00');
  assert.equal(slots[0].endTime, '09:30');
  assert.equal(slots[25].endTime, '22:00', '마지막 슬롯은 21:30~22:00이다');
  assert.equal(slots[25].startTime, '21:30');

  for (let i = 0; i < slots.length; i += 1) {
    assert.equal(분(slots[i].endTime) - 분(slots[i].startTime), 30, `슬롯 ${i}의 폭은 30분이다`);
    if (i + 1 < slots.length) {
      assert.equal(
        slots[i].endTime,
        slots[i + 1].startTime,
        `슬롯 ${i}와 ${i + 1} 사이에 빈틈·중복이 있으면 안 된다`,
      );
    }
  }
});

test('B-2 운영시간 외 시간대는 응답에 포함되지 않는다', async () => {
  // 완료조건 5. §9-1-3 방어: 루프 조건을 m < closeMin으로 쓰면 22:00~22:30이 생긴다.
  const 응답 = await 조회(활성실.id, 예약있는날);
  assert.equal(응답.status, 200);

  const 시작들 = 응답.body.slots.map((slot) => slot.startTime);
  for (const 금지 of ['08:00', '08:30', '22:00', '22:30']) {
    assert.equal(시작들.includes(금지), false, `운영시간 외 슬롯 ${금지}이 포함되면 안 된다`);
  }
  // HH:mm 고정폭이라 문자열 사전순 비교로 충분하다.
  for (const slot of 응답.body.slots) {
    assert.ok(slot.startTime >= '09:00', `startTime ${slot.startTime}이 open_time보다 이르다`);
    assert.ok(slot.endTime <= '22:00', `endTime ${slot.endTime}이 close_time을 넘는다`);
  }
});

test('B-3 기존 예약이 걸친 모든 슬롯이 예약불가로 표시된다', async () => {
  // 완료조건 2 + §4-4 겹침 판정 회귀 방어.
  const 응답 = await 조회(활성실.id, 예약있는날);
  assert.equal(응답.status, 200);

  const 슬롯맵 = new Map(응답.body.slots.map((slot) => [slot.startTime, slot]));

  // R1은 09:00~10:30 → 3슬롯을 모두 덮는다.
  for (const 시작 of ['09:00', '09:30', '10:00']) {
    const slot = 슬롯맵.get(시작);
    assert.ok(slot, `${시작} 슬롯이 있어야 한다`);
    assert.deepEqual(Object.keys(slot).sort(), 슬롯키, `${시작}: ReservationSlot은 정확히 5개 키다`);
    assert.equal(slot.isAvailable, false, `${시작}: 예약이 걸친 슬롯은 예약불가다`);
    assert.equal(slot.reservationId, R1id, `${시작}: reservationId는 R1이다`);
    assert.equal(slot.memberName, 소유자이름, `${시작}: 예약자 이름(마스킹 없음)이 실린다`);
  }

  // 경계에서 한 칸 더 막지 않는다 — 10:30 슬롯(630)은 R1의 end_time(630)과 겹치지 않는다.
  const 경계 = 슬롯맵.get('10:30');
  assert.ok(경계, '10:30 슬롯이 있어야 한다');
  assert.equal(경계.isAvailable, true, '예약 종료시각과 맞닿은 슬롯은 예약가능이다');
  assert.equal(경계.reservationId, null);
  assert.equal(경계.memberName, null);

  assert.equal(슬롯맵.has('08:30'), false, '운영시간 전 슬롯은 애초에 없다');
});

test('B-4 취소 상태 예약의 시간대는 예약가능으로 표시된다', async () => {
  // 완료조건 3. **이 규칙의 유일한 방어 케이스이므로 삭제하면 안 된다**(§9-1-5).
  const 응답 = await 조회(활성실.id, 예약있는날);
  assert.equal(응답.status, 200);

  const slot = 응답.body.slots.find((s) => s.startTime === '13:00');
  assert.ok(slot, '13:00 슬롯이 있어야 한다');
  assert.equal(slot.isAvailable, true, `취소 예약(id ${R2id})은 슬롯을 점유하지 않는다`);
  assert.equal(slot.reservationId, null, '취소 예약의 id가 노출되면 안 된다');
  assert.equal(slot.memberName, null, '취소 예약의 예약자 이름이 노출되면 안 된다');
});

test('B-5 예약이 없는 날짜는 전 슬롯이 예약가능이다', async () => {
  const 응답 = await 조회(활성실.id, 예약없는날);
  assert.equal(응답.status, 200, `예약 없는 날 조회 실패: ${응답.text}`);
  assert.equal(응답.body.date, 예약없는날, '응답 date는 요청 문자열과 정확히 같아야 한다');
  assert.equal(응답.body.slots.length, 26);
  assert.equal(
    응답.body.slots.every(
      (slot) => slot.isAvailable === true && slot.reservationId === null && slot.memberName === null,
    ),
    true,
    '예약 0건인 날은 전 슬롯이 예약가능이고 파생 필드가 null이다',
  );
});

test('B-6 운영시간이 30분 경계로 나뉘지 않는 연습실은 경계로 올림·절단된다', async () => {
  // §4-3: be07-경계연습실은 09:15~22:15. 09:15 시작 슬롯을 내려보내면
  // reservations_30min_slot_check가 거부할 예약을 FE가 신청하게 된다.
  const 응답 = await 조회(경계실id, 예약없는날);
  assert.equal(응답.status, 200, `경계 연습실 조회 실패: ${응답.text}`);
  assert.equal(응답.body.practiceRoomId, 경계실id);

  const slots = 응답.body.slots;
  assert.equal(slots.length, 25, '09:15~22:15은 09:30부터 22:00까지 25슬롯이다');
  assert.equal(slots[0].startTime, '09:30', '시작은 다음 30분 경계로 올림한다');
  assert.equal(slots[slots.length - 1].endTime, '22:00', '끝은 30분 미만 잔여 구간을 버린다');
  assert.equal(
    slots.some((slot) => slot.startTime === '09:15' || slot.endTime === '22:15'),
    false,
    '30분 경계를 벗어난 시각이 슬롯에 등장하면 안 된다',
  );
});

// ── C. 실패 분기 ────────────────────────────────────────────────────────────

test('C-1 date 누락·형식 불량·미실존 날짜는 모두 400 BAD_REQUEST다', async () => {
  // §5-1·§5-2. 정규식만 통과시키면 2099-02-30이 pg 22008로 500이 된다.
  const 쿼리들 = [
    ['date 누락', ''],
    ['빈 문자열', '?date='],
    ['구분자 없음', '?date=20991231'],
    ['한자리 월·일', '?date=2099-9-1'],
    ['날짜+시각', '?date=2099-12-31T00:00:00'],
    ['13월', '?date=2099-13-01'],
    ['2월 30일', '?date=2099-02-30'],
    ['자연어', '?date=today'],
    ['배열(중복 파라미터)', `?date=${예약있는날}&date=${예약없는날}`],
  ];
  for (const [이름, 쿼리] of 쿼리들) {
    const 응답 = await 예약현황(bearer(준회원.accessToken), 활성실.id, 쿼리);
    assert.notEqual(응답.status, 500, `${이름}: pg 22008이 500으로 새면 안 된다`);
    assert.notEqual(응답.status, 200, `${이름}: 오늘 날짜 기본값이 적용되어 200이 되면 안 된다`);
    assert.equal(응답.status, 400, `${이름}: status`);
    assert.equal(응답.body.code, 'BAD_REQUEST', `${이름}: code`);
    assert.equal(응답.body.message, 'date는 YYYY-MM-DD 형식이어야 합니다.', `${이름}: message`);
  }
});

test('C-2 미존재 roomId와 비활성 roomId는 완전히 동일한 404다', async () => {
  // §6-2: 두 사유를 한 응답으로 묶어 비활성 여부를 노출하지 않는다.
  const 미존재 = await 조회(999999999, 예약있는날);
  const 비활성 = await 조회(비활성실id, 예약있는날);

  assert.equal(미존재.status, 404, `미존재 roomId: status(${미존재.text})`);
  assert.equal(미존재.body.code, 'PRACTICE_ROOM_NOT_FOUND');
  assert.equal(미존재.body.message, '연습실을 찾을 수 없습니다.');

  // §6-4: GET은 404다. 403으로 "통일"하면 안 된다.
  assert.notEqual(비활성.status, 403, '비활성 연습실 조회는 403이 아니라 404다');
  assert.equal(비활성.status, 404, `비활성 roomId: status(${비활성.text})`);

  assert.deepEqual(비활성.status, 미존재.status, '두 응답의 status가 같아야 한다');
  assert.deepEqual(비활성.body, 미존재.body, '두 응답의 본문이 완전히 같아야 한다(비활성 여부 미노출)');
});

test('C-3 roomId가 정수 아님·범위 초과면 400 BAD_REQUEST다', async () => {
  // §9-1-8: 99999999999는 pg 22003, 'abc'는 22P02 → 방어가 없으면 500이 된다.
  for (const roomId of ['abc', '1.5', '-1', '0', '99999999999']) {
    const 응답 = await 조회(roomId, 예약있는날);
    assert.notEqual(응답.status, 500, `roomId=${roomId}: pg 22P02·22003이 500으로 새면 안 된다`);
    assert.equal(응답.status, 400, `roomId=${roomId}: status`);
    assert.equal(응답.body.code, 'BAD_REQUEST', `roomId=${roomId}: code`);
    assert.equal(응답.body.message, '연습실 ID가 올바르지 않습니다.', `roomId=${roomId}: message`);
  }
});

test('C-4 예약현황 조회도 인증이 필요하다', async () => {
  const 만료 = 만료Access토큰({
    id: 준회원.member.id,
    gradeLevel: 준회원.member.memberGrade.gradeLevel,
    isAdmin: 준회원.member.memberGrade.isAdmin,
  });
  const 헤더들 = [
    ['헤더없음', {}, 'UNAUTHORIZED'],
    ['만료토큰', bearer(만료), 'TOKEN_EXPIRED'],
    ['위조토큰', bearer(위조(준회원.accessToken)), 'UNAUTHORIZED'],
  ];
  for (const [이름, 헤더, 기대코드] of 헤더들) {
    const 응답 = await 예약현황(헤더, 활성실.id, `?date=${예약있는날}`);
    assert.equal(응답.status, 401, `${이름}: 401이어야 한다(200·400·404·500 아님)`);
    assert.equal(응답.body.code, 기대코드, `${이름}: code`);
    assert.deepEqual(Object.keys(응답.body).sort(), ['code', 'message'], `${이름}: 본문 키 2개`);
  }
});

// ── D. 회귀 ─────────────────────────────────────────────────────────────────

test('D-1 라우터 마운트가 기존 경로를 깨지 않는다', async () => {
  const 헬스 = await 요청('GET', '/health');
  assert.equal(헬스.status, 200, '/health가 살아 있어야 한다');
  assert.deepEqual(헬스.body, { status: 'ok', db: 'ok' });

  const 없는경로 = await 요청('GET', '/api/practice-rooms-없는경로');
  assert.equal(없는경로.status, 404);
  assert.equal(없는경로.body.code, 'NOT_FOUND');
});

// ── 정리 ────────────────────────────────────────────────────────────────────

test.after(async () => {
  await 정리();
  await pool.end();
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});
