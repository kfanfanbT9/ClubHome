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
// be09- 회원**이라는 사실이 유일한 정리 장치다(계획서 §13-1).
const PREFIX = 'be09-';

// docs/seed-dev.sql 계정 비밀번호. 픽스처 회원 가입에도 그대로 쓴다.
const 시드비밀번호 = 'Test1234!';

// swagger Reservation 프로퍼티 8개(정렬본).
// practiceRoomName·memberName·hasStarted·canCancel은 스펙에 없다(계획서 §11-2, §14-17).
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

// 날짜 센티널. **케이스 간에 절대 공유하지 않는다** — 공유하면 uq_reservations_active_slot
// 위반으로 픽스처 삽입이 터지거나 서로의 예약이 결과를 흔든다(계획서 §13-1 항목 4, §14-24).
//
// **테스트 파일 간에도 공유하지 않는다.** node --test는 파일을 별도 프로세스로 병렬 실행하므로
// 같은 (연습실, 날짜, 시작시각)을 쓰는 다른 파일과 실시간으로 충돌한다. 회원 접두사(be08-/be09-)가
// 달라도 예약 슬롯은 연습실·날짜로만 식별되므로 격리되지 않는다.
// reservation-api.test.js(BE-08)가 2099-12-28~31을 점유하므로 이 파일은 2098년대를 쓴다.
const 목록날짜 = '2098-12-30'; // A-1·A-2·A-3 목록 픽스처(직접 INSERT)
const 취소날짜 = '2098-12-31'; // B-1(POST로 생성 후 취소)·B-2(재예약)
const 타인미래날짜 = '2098-12-29'; // C-1 전용 — 타인 소유 **미래** 예약(소유권 단독 검증)
const 먼과거날짜 = '2000-01-02'; // C-2① 전용 — 시작된 본인 예약
const 상태날짜 = '2000-01-03'; // C-3 전용 — completed/canceled 공존(부분 인덱스 제외 대상)
const 관리자날짜 = '2000-01-04'; // B-3 전용 — 관리자가 취소할 타인 소유 과거 예약

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
    body: 본문없음 ? undefined : typeof 본문 === 'string' ? 본문 : JSON.stringify(본문),
  });
  const text = await response.text();
  return { status: response.status, text, body: text ? JSON.parse(text) : null };
}

/** 검증 대상 ①: 내 예약 목록. `쿼리`는 '?roomId=3' 같은 문자열이거나 빈 문자열이다. */
const 내예약목록 = (토큰, 쿼리 = '') =>
  요청('GET', `/api/members/me/reservations${쿼리}`, undefined, 토큰 === null ? {} : bearer(토큰));

/** 검증 대상 ②: 예약 취소. requestBody가 없는 엔드포인트라 본문을 보내지 않는다(계획서 §6-1). */
const 취소 = (토큰, reservationId) =>
  요청(
    'PATCH',
    `/api/reservations/${reservationId}/cancel`,
    undefined,
    토큰 === null ? {} : bearer(토큰),
  );

/** 예약 신청(BE-08). B-1·B-2에서만 쓴다. */
const 신청 = (토큰, roomId, 본문) =>
  요청('POST', `/api/practice-rooms/${roomId}/reservations`, 본문, bearer(토큰));

/** 예약현황 조회(BE-07). B-2에서만 쓴다. */
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

// ── DB 직접 조회·삽입 헬퍼 ──────────────────────────────────────────────────
// API 응답을 믿지 않고 실제 저장 상태를 단정하는 통로다.

/**
 * 예약 행 1건. 프로덕션 SQL과 동일하게 `to_char(reservation_date, 'YYYY-MM-DD')`로 읽는다 —
 * pg는 DATE를 JS Date로 반환하므로 테스트가 Date 객체를 문자열과 비교하는 함정을 피한다
 * (계획서 §13-1 항목 7).
 */
async function 예약행(id) {
  const { rows } = await query(
    `SELECT id, practice_room_id, member_id,
            to_char(reservation_date, 'YYYY-MM-DD') AS d,
            start_time, end_time, reservation_status
       FROM reservations WHERE id = $1`,
    [id],
  );
  return rows[0];
}

/**
 * 예약 행을 직접 INSERT한다. POST API로는 과거 날짜·completed·canceled를 만들 수 없다.
 * 30분 CHECK(reservations_30min_slot_check)를 지키려면 분이 00 또는 30이어야 하므로
 * 호출부는 시각을 항상 'HH:00'/'HH:30' 형태로만 넘긴다(계획서 §13-1 항목 6, §14-23).
 * 부분 유니크 인덱스는 status='reserved'에만 적용되므로 reserved 행끼리만
 * (연습실, 날짜, 시작시각)이 겹치지 않게 배치하면 된다. completed/canceled는 제약 대상이 아니다.
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

/**
 * **오늘 날짜 + 이미 지난 정시**의 reserved 예약을 삽입한다. 날짜·시각을 JS가 아니라 SQL이
 * 계산하는 것이 핵심이다 — C-2②가 §5-3 벽시계 판정식(`AT TIME ZONE 'Asia/Seoul'`)의
 * 유일한 회귀 검출기이므로 테스트 쪽이 Node의 TZ에 의존하면 검출력이 사라진다.
 * `date_trunc('hour', ...)`는 항상 'HH:00'(30분 CHECK 통과)이고 항상 현재 시각 이하다
 * (정각에 실행되면 정확히 같아 `<=` 경계까지 검증한다).
 */
async function 오늘시작된예약삽입(roomId, memberId) {
  const { rows } = await query(
    `INSERT INTO reservations (practice_room_id, member_id, reservation_date, start_time, end_time)
     VALUES ($1, $2,
             (now() AT TIME ZONE 'Asia/Seoul')::date,
             date_trunc('hour', now() AT TIME ZONE 'Asia/Seoul')::time,
             (date_trunc('hour', now() AT TIME ZONE 'Asia/Seoul') + interval '30 min')::time)
     RETURNING id`,
    [roomId, memberId],
  );
  return rows[0].id;
}

/** 픽스처 정리. 순서 필수 — FK가 ON DELETE RESTRICT다(계획서 §13-1 항목 2, §14-22). */
async function 정리() {
  // 1) reservations: be09- 회원을 서브쿼리로 되짚어 지운다.
  //    삽입 id를 테스트가 들고 다니는 부기가 없어지고, 일부만 삽입된 실패 상황도 회수된다.
  await query(
    'DELETE FROM reservations WHERE member_id IN (SELECT id FROM members WHERE email LIKE $1)',
    [`${PREFIX}%`],
  );
  // 2) members: 예약이 남아 있으면 member_id FK RESTRICT로 실패하므로 반드시 1) 다음이다.
  await query('DELETE FROM members WHERE email LIKE $1', [`${PREFIX}%`]);
}

/** 가입 → 로그인으로 be09- 회원 1명을 만든다. 토큰은 로그인 API로만 얻는다. */
async function 픽스처회원(구분) {
  const email = 새이메일(구분);
  const 가입본문 = { name: `테스트${구분}`, email, password: 시드비밀번호, phone: '010-0000-0009' };
  const 가입 = await 요청('POST', '/api/auth/signup', 가입본문);
  assert.equal(가입.status, 201, `픽스처(${구분}) 가입 실패: ${가입.text}`);

  const 로그인 = await 요청('POST', '/api/auth/login', { email, password: 시드비밀번호 });
  assert.equal(로그인.status, 200, `픽스처(${구분}) 로그인 실패: ${로그인.text}`);

  return { email, accessToken: 로그인.body.accessToken, member: 로그인.body.member };
}

// ── 공유 픽스처 ─────────────────────────────────────────────────────────────
let 예약자; // be09-owner (가입+로그인)
let 타인; // be09-other (가입+로그인)
let 관리자; // be09-admin (직접 INSERT + signAccessToken)
let 활성실id; // 시드 활성 연습실 id
let 제2연습실id; // 시드 비활성 연습실 id — 필터 대조군으로만 쓴다
let 목록예약; // A 그룹 픽스처 id 모음

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  // 선행 정리: reservations에 부분 유니크 인덱스 uq_reservations_active_slot이 있어
  // 이전 실행의 정리가 실패했으면 아래 INSERT가 제약 위반으로 터진다.
  // 행이 없으면 무연산이다. before와 after가 같은 헬퍼를 공유한다(계획서 §13-1 항목 3).
  await 정리();

  // 시드 연습실 id를 **하드코딩하지 않고 조회한다**(실측 시드 id는 2·3이며 1이 아니다, §14-21).
  const { rows: 활성행 } = await query(
    'SELECT id FROM practice_rooms WHERE is_active = TRUE ORDER BY id LIMIT 1',
  );
  assert.equal(
    활성행.length,
    1,
    '활성 시드 연습실이 최소 1건 있어야 한다. docs/seed-dev.sql이 적용되었는지 확인하라.',
  );
  활성실id = 활성행[0].id;

  // 활성 연습실이 시드에 1개뿐이라 필터 검증에 쓸 두 번째 연습실이 없다.
  // 예약 행을 직접 INSERT하므로 활성 여부 검증을 거치지 않아 비활성 연습실을 대조군으로 쓸 수 있고,
  // 이것이 §3-5의 "비활성 연습실 예약도 이력에 남는다"까지 동시에 단정한다.
  // **practice_rooms를 UPDATE/INSERT하지 않는다**(계획서 §13-1 항목 5).
  const { rows: 비활성행 } = await query(
    'SELECT id FROM practice_rooms WHERE is_active = FALSE ORDER BY id LIMIT 1',
  );
  assert.equal(
    비활성행.length,
    1,
    '비활성 시드 연습실이 최소 1건 있어야 한다. docs/seed-dev.sql이 적용되었는지 확인하라.',
  );
  제2연습실id = 비활성행[0].id;
  assert.notEqual(활성실id, 제2연습실id, '필터 검증에는 서로 다른 연습실 2개가 필요하다');

  예약자 = await 픽스처회원('owner');
  타인 = await 픽스처회원('other');
  assert.notEqual(예약자.member.id, 타인.member.id, '예약자와 타인은 서로 다른 회원이어야 한다');

  // 관리자: 관리자 등급 회원가입 경로가 없으므로 직접 INSERT하고 토큰을 직접 발급한다.
  // 시드 admin@clubhome.local로 로그인하지 않는다 — 시드 비밀번호에 의존하고 그 회원은
  // be09- 접두사가 아니어서 정리 규약에서 벗어난다(계획서 §13-1 항목 1).
  // 등급 id는 하드코딩하지 않고 조회한다.
  const { rows: 관리자등급 } = await query(
    'SELECT id, grade_level, is_admin FROM member_grades WHERE is_admin = TRUE ORDER BY grade_level DESC LIMIT 1',
  );
  assert.equal(
    관리자등급.length,
    1,
    'is_admin=TRUE 등급이 최소 1건 있어야 한다. docs/seed-dev.sql이 적용되었는지 확인하라.',
  );
  const { rows: 관리자삽입 } = await query(
    `INSERT INTO members (email, password_hash, name, phone, member_grade_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      새이메일('admin'),
      await hashPassword(시드비밀번호),
      '테스트관리자',
      '010-0000-0099',
      관리자등급[0].id,
    ],
  );
  관리자 = {
    id: 관리자삽입[0].id,
    accessToken: signAccessToken({
      id: 관리자삽입[0].id,
      gradeLevel: 관리자등급[0].grade_level,
      isAdmin: 관리자등급[0].is_admin,
    }),
  };
  assert.equal(관리자등급[0].is_admin, true, '관리자 픽스처 토큰의 isAdmin 클레임은 true여야 한다');

  // A 그룹 목록 픽스처: 목록날짜에 활성실 3건(상태 3종) + 제2연습실 1건.
  // reserved 행은 활성실 09:00 하나뿐이므로 부분 유니크 인덱스와 충돌하지 않는다.
  목록예약 = {
    reserved: await 예약삽입({
      roomId: 활성실id,
      memberId: 예약자.member.id,
      date: 목록날짜,
      startTime: '09:00',
      endTime: '10:00',
      status: 'reserved',
    }),
    completed: await 예약삽입({
      roomId: 활성실id,
      memberId: 예약자.member.id,
      date: 목록날짜,
      startTime: '10:00',
      endTime: '11:00',
      status: 'completed',
    }),
    canceled: await 예약삽입({
      roomId: 활성실id,
      memberId: 예약자.member.id,
      date: 목록날짜,
      startTime: '11:00',
      endTime: '12:00',
      status: 'canceled',
    }),
    제2연습실: await 예약삽입({
      roomId: 제2연습실id,
      memberId: 예약자.member.id,
      date: 목록날짜,
      startTime: '13:00',
      endTime: '14:00',
      status: 'reserved',
    }),
  };
});

// ── A. 내 예약 목록 (완료조건 1·2) ──────────────────────────────────────────
// A 그룹은 B·C가 예약자 소유 행을 추가하기 **전에** 실행되어야 총 건수 단정이 성립한다.
// node:test는 파일 내 최상위 테스트를 선언 순서대로 실행하므로 이 위치가 계약이다.

test('A-1 본인 예약 내역이 상태(예약/완료/취소)와 함께 조회된다', async () => {
  const 응답 = await 내예약목록(예약자.accessToken);

  assert.equal(응답.status, 200, `내 예약 목록 조회 실패: ${응답.text}`);
  // 맨 배열이다. { items, page, ... } 래퍼를 만들지 않는다(계획서 §3-1·§3-6).
  assert.ok(Array.isArray(응답.body), '응답은 래퍼 없는 맨 배열이어야 한다');
  assert.equal(응답.body.length, 4, 'before가 삽입한 예약자 소유 4건이 모두 조회되어야 한다');

  for (const 항목 of 응답.body) {
    assert.deepEqual(Object.keys(항목).sort(), 예약키, 'Reservation은 정확히 8개 키다');
    // §14-17 회귀 방어: hasStarted를 매퍼에 넣으면 응답 전체에 새어 나간다.
    assert.equal('hasStarted' in 항목, false, 'hasStarted는 swagger 미정의 필드다');
    assert.equal('practiceRoomName' in 항목, false, 'practiceRoomName은 swagger 미정의 필드다');
    assert.equal('memberName' in 항목, false, 'memberName은 swagger 미정의 필드다');
    assert.equal(항목.memberId, 예약자.member.id, '내 목록에는 내 예약만 있어야 한다');

    // §4 회귀 방어: reservation_date를 to_char 없이 SELECT하면 pg Date → 하루 어긋난
    // ISO 문자열('2098-12-29T15:00:00.000Z')이 응답에 실린다.
    assert.equal(항목.reservationDate, 목록날짜, "reservationDate는 'YYYY-MM-DD' 문자열이다");
    assert.equal(항목.reservationDate.length, 10, "ISO 문자열이 아니라 10자여야 한다");
    // §4-4 회귀 방어: .slice(0, 5) 누락 시 '09:00:00'이 실린다.
    assert.equal(항목.startTime.length, 5, "startTime은 5자 'HH:mm'이다");
    assert.equal(항목.endTime.length, 5, "endTime은 5자 'HH:mm'이다");
    assert.equal(typeof 항목.createdAt, 'string', 'createdAt은 TIMESTAMPTZ → ISO 문자열이다');
    assert.ok(!Number.isNaN(Date.parse(항목.createdAt)), 'createdAt이 파싱 가능해야 한다');
  }

  // §14-16 회귀 방어: 목록에 reservation_status = 'reserved' 필터를 걸면
  // 완료·취소 이력이 사라져 완료조건 1과 화면 11을 위반한다.
  const 활성실항목 = 응답.body.filter((항목) => 항목.practiceRoomId === 활성실id);
  assert.equal(활성실항목.length, 3, '활성실의 픽스처 3건이 모두 조회되어야 한다');
  assert.deepEqual(
    활성실항목.map((항목) => 항목.reservationStatus).sort(),
    ['canceled', 'completed', 'reserved'],
    '예약·완료·취소 3종 상태가 모두 조회되어야 한다',
  );

  // 픽스처 시각이 매퍼를 그대로 통과했음을 개별 단정한다.
  const 예약중 = 응답.body.find((항목) => 항목.id === 목록예약.reserved);
  assert.ok(예약중, 'reserved 픽스처가 목록에 있어야 한다');
  assert.equal(예약중.startTime, '09:00', "startTime은 '09:00'이다('09:00:00'이면 실패)");
  assert.equal(예약중.endTime, '10:00', "endTime은 '10:00'이다('10:00:00'이면 실패)");
  assert.equal(예약중.reservationStatus, 'reserved');

  // 정렬: reservation_date DESC, start_time DESC, id DESC(계획서 §3-5).
  for (let i = 1; i < 응답.body.length; i += 1) {
    const 앞 = 응답.body[i - 1];
    const 뒤 = 응답.body[i];
    assert.ok(
      `${앞.reservationDate} ${앞.startTime}` >= `${뒤.reservationDate} ${뒤.startTime}`,
      `(reservationDate, startTime) 내림차순이어야 한다: ${앞.reservationDate} ${앞.startTime} → ${뒤.reservationDate} ${뒤.startTime}`,
    );
  }
});

test('A-2 roomId 필터 적용 시 해당 연습실만, 미지정 시 전체가 반환된다', async () => {
  // 필터 적용 — 활성실.
  const 활성실필터 = await 내예약목록(예약자.accessToken, `?roomId=${활성실id}`);
  assert.equal(활성실필터.status, 200, `활성실 필터: status(${활성실필터.text})`);
  assert.equal(활성실필터.body.length, 3, '활성실 예약 3건만 반환되어야 한다');
  for (const 항목 of 활성실필터.body) {
    assert.equal(항목.practiceRoomId, 활성실id, '필터한 연습실의 예약만 있어야 한다');
  }

  // 필터 적용 — 제2연습실(비활성). 비활성 연습실의 예약도 이력에 남는다(계획서 §3-5·§8).
  const 제2필터 = await 내예약목록(예약자.accessToken, `?roomId=${제2연습실id}`);
  assert.equal(제2필터.status, 200, `제2연습실 필터: status(${제2필터.text})`);
  assert.equal(제2필터.body.length, 1, '제2연습실 예약 1건만 반환되어야 한다');
  assert.equal(제2필터.body[0].practiceRoomId, 제2연습실id);
  assert.equal(제2필터.body[0].id, 목록예약.제2연습실);

  // 미지정 — 전체(완료조건 2).
  const 미지정 = await 내예약목록(예약자.accessToken);
  assert.equal(미지정.status, 200);
  assert.equal(미지정.body.length, 4, 'roomId 미지정이면 전체 연습실의 예약이 반환된다');

  // 존재하지 않는 유효 roomId — 이 경로에 404가 정의되어 있지 않다(계획서 §8).
  const 미존재 = await 내예약목록(예약자.accessToken, '?roomId=999999');
  assert.notEqual(미존재.status, 404, '미존재 roomId는 404가 아니라 200 + 빈 배열이다');
  assert.equal(미존재.status, 200, `미존재 roomId: status(${미존재.text})`);
  assert.deepEqual(미존재.body, [], '미존재 roomId 필터 결과는 빈 배열이다');

  // 형식 불량 — 400이 정의되어 있지 않으므로 필터를 떨어뜨려 전체를 반환한다(§14-11).
  // '99999999999'는 상한 검사가 없으면 pg 22003 → 500이 된다(§14-12).
  for (const roomId of ['abc', '0', '-1', '1.5', '99999999999', '']) {
    const 응답 = await 내예약목록(예약자.accessToken, `?roomId=${roomId}`);
    assert.notEqual(응답.status, 500, `roomId=${roomId}: pg 22P02·22003이 500으로 새면 안 된다`);
    assert.notEqual(응답.status, 400, `roomId=${roomId}: 이 경로에 400은 정의되어 있지 않다`);
    assert.equal(응답.status, 200, `roomId=${roomId}: status(${응답.text})`);
    assert.equal(응답.body.length, 4, `roomId=${roomId}: 필터가 미적용되어 전체가 반환된다`);
  }
});

test('A-3 타인의 예약은 내 목록에 섞이지 않는다', async () => {
  // 타인 소유 예약 1건. 활성실 목록날짜의 reserved는 09:00 하나뿐이므로 12:00은 비어 있다.
  const 타인예약id = await 예약삽입({
    roomId: 활성실id,
    memberId: 타인.member.id,
    date: 목록날짜,
    startTime: '12:00',
    endTime: '13:00',
  });

  const 타인목록 = await 내예약목록(타인.accessToken);
  assert.equal(타인목록.status, 200, `타인 목록: status(${타인목록.text})`);
  assert.equal(타인목록.body.length, 1, '타인의 목록에는 타인 예약 1건만 있어야 한다');
  for (const 항목 of 타인목록.body) {
    assert.equal(항목.memberId, 타인.member.id, '타인 목록의 모든 항목은 타인 소유다');
  }
  assert.equal(타인목록.body[0].id, 타인예약id);

  // 역방향: 예약자 목록에 타인의 예약 id가 섞이지 않는다.
  const 예약자목록 = await 내예약목록(예약자.accessToken);
  assert.equal(예약자목록.status, 200);
  const 예약자id들 = 예약자목록.body.map((항목) => 항목.id);
  assert.equal(예약자id들.includes(타인예약id), false, '내 목록에 타인 예약이 섞이면 안 된다');
  assert.equal(예약자목록.body.length, 4, '타인 예약 추가가 내 목록 건수를 바꾸면 안 된다');
  for (const 항목 of 예약자목록.body) {
    assert.equal(항목.memberId, 예약자.member.id);
  }
});

// ── B. 취소 성공 (완료조건 3·6·7) ───────────────────────────────────────────

// B-1이 취소한 예약 id. B-2(재예약)·C-3(재취소 400)이 참조한다.
let B1id;
let B1생성응답;

test('B-1 시작 전 본인 예약 취소가 200이고 상태가 canceled로 변경된다', async () => {
  // 시작 전 예약은 **POST API로** 만든다 — BE-08 경로까지 함께 회귀 검증한다(계획서 §13-1 항목 6).
  const 생성 = await 신청(예약자.accessToken, 활성실id, {
    reservationDate: 취소날짜,
    startTime: '09:00',
    endTime: '10:30',
  });
  assert.equal(생성.status, 201, `취소 대상 예약 생성 실패: ${생성.text}`);
  B1id = 생성.body.id;
  B1생성응답 = 생성.body;

  const 응답 = await 취소(예약자.accessToken, B1id);

  assert.equal(응답.status, 200, `시작 전 본인 예약 취소 실패: ${응답.text}`);
  assert.deepEqual(Object.keys(응답.body).sort(), 예약키, 'Reservation은 정확히 8개 키다');
  assert.equal('hasStarted' in 응답.body, false, '판정 전용 파생값이 응답에 새면 안 된다(§14-18)');
  assert.equal(응답.body.reservationStatus, 'canceled', '취소 후 상태는 canceled다');

  // 나머지 7필드는 생성 응답과 동일하다. createdAt은 **생성 시각**이므로 갱신되지 않는다(§6-6).
  assert.equal(응답.body.id, 생성.body.id);
  assert.equal(응답.body.practiceRoomId, 생성.body.practiceRoomId);
  assert.equal(응답.body.memberId, 생성.body.memberId);
  assert.equal(응답.body.reservationDate, 취소날짜, "reservationDate는 'YYYY-MM-DD' 10자다");
  assert.equal(응답.body.reservationDate.length, 10);
  assert.equal(응답.body.startTime, '09:00', "startTime은 5자 'HH:mm'이다(§14-6)");
  assert.equal(응답.body.endTime, '10:30', "endTime은 5자 'HH:mm'이다(§14-6)");
  assert.equal(응답.body.createdAt, 생성.body.createdAt, '취소가 createdAt을 갱신하면 안 된다');

  // §14-8 회귀 방어: 취소를 DELETE로 구현하면 이력이 사라진다(S-06 위반).
  const 행 = await 예약행(B1id);
  assert.ok(행, '취소는 행 삭제가 아니다 — DB에 행이 남아 있어야 한다');
  assert.equal(행.reservation_status, 'canceled', 'DB의 reservation_status가 canceled여야 한다');
  assert.equal(행.d, 취소날짜, '취소가 날짜를 건드리면 안 된다');
  assert.equal(행.member_id, 예약자.member.id, '취소가 예약자를 건드리면 안 된다');
  assert.equal(행.practice_room_id, 활성실id, '취소가 연습실을 건드리면 안 된다(§14-9)');
});

test('B-2 취소된 시간대가 다시 예약 가능 상태로 조회되고 재예약된다', async () => {
  // 완료조건 7. BE-07·BE-08 코드를 1줄도 수정하지 않고 성립해야 한다(계획서 §10-3).
  assert.ok(B1id, '전제: B-1이 예약을 취소했어야 한다');

  const 현황 = await 예약현황(예약자.accessToken, 활성실id, 취소날짜);
  assert.equal(현황.status, 200, `예약현황 조회 실패: ${현황.text}`);
  const 슬롯맵 = new Map(현황.body.slots.map((slot) => [slot.startTime, slot]));

  // B-1의 09:00~10:30은 30분 슬롯 3개를 덮고 있었다.
  for (const 시작 of ['09:00', '09:30', '10:00']) {
    const slot = 슬롯맵.get(시작);
    assert.ok(slot, `${시작} 슬롯이 있어야 한다`);
    assert.equal(slot.isAvailable, true, `${시작}: 취소된 시간대는 예약 가능이어야 한다`);
    assert.equal(slot.reservationId, null, `${시작}: 취소된 예약 id가 남아 있으면 안 된다`);
  }

  // 동일 구간 재예약. 부분 유니크 인덱스가 canceled 행을 제외하므로 통과한다(ERD §4).
  const 재예약 = await 신청(예약자.accessToken, 활성실id, {
    reservationDate: 취소날짜,
    startTime: '09:00',
    endTime: '10:30',
  });
  assert.equal(재예약.status, 201, `취소된 시간대 재예약은 201이어야 한다: ${재예약.text}`);
  assert.equal(재예약.body.reservationStatus, 'reserved');
  assert.notEqual(재예약.body.id, B1id, '재예약은 새 행이다');

  // 취소된 원본 행은 이력으로 그대로 남는다.
  const 원본 = await 예약행(B1id);
  assert.equal(원본.reservation_status, 'canceled', '재예약이 취소 이력을 덮으면 안 된다');
});

test('B-3 관리자는 이미 시작된 타인 예약도 취소할 수 있다', async () => {
  // 완료조건 6. 관리자 예외가 **소유권·시작여부 두 축 모두**를 넘는다는 것을 한 케이스에서 단정한다.
  const 대상id = await 예약삽입({
    roomId: 활성실id,
    memberId: 타인.member.id,
    date: 관리자날짜,
    startTime: '09:00',
    endTime: '10:00',
  });

  // 대조: 같은 예약을 일반 회원(예약자) 토큰으로 시도하면 소유권 판정에 걸려 403이다.
  const 일반회원 = await 취소(예약자.accessToken, 대상id);
  assert.equal(일반회원.status, 403, `일반 회원의 타인 예약 취소: status(${일반회원.text})`);
  assert.equal(일반회원.body.code, 'FORBIDDEN');
  assert.equal(일반회원.body.message, '본인 또는 관리자만 예약을 취소할 수 있습니다.');
  assert.equal((await 예약행(대상id)).reservation_status, 'reserved', '403이면 상태가 불변이다');

  // §14-14 회귀 방어: swagger 403 원문 "타인의 예약이거나(본인/관리자 아님)"에 따라
  // 관리자는 타인 예약에서 403에 걸리지 않고, 과거 예약이라도 시작 여부를 보지 않는다.
  const 응답 = await 취소(관리자.accessToken, 대상id);
  assert.equal(응답.status, 200, `관리자의 시작된 타인 예약 취소 실패: ${응답.text}`);
  assert.deepEqual(Object.keys(응답.body).sort(), 예약키, 'Reservation은 정확히 8개 키다');
  assert.equal(응답.body.reservationStatus, 'canceled');
  assert.equal(응답.body.memberId, 타인.member.id, '취소가 예약자를 관리자로 바꾸면 안 된다');
  assert.equal(응답.body.reservationDate, 관리자날짜);

  const 행 = await 예약행(대상id);
  assert.equal(행.reservation_status, 'canceled', 'DB 상태가 canceled여야 한다');
  assert.equal(행.member_id, 타인.member.id, 'DB의 예약자도 불변이다');
});

// ── C. 취소 거부 (완료조건 4·5, Todo 4) ─────────────────────────────────────

test('C-1 타인 예약 취소 요청은 403이다', async () => {
  // 완료조건 5. **날짜를 미래로 둔 것이 이 케이스의 핵심이다** —
  // 시작 여부가 아니라 소유권 판정이 발동했음을 분리 증명한다.
  const 대상id = await 예약삽입({
    roomId: 활성실id,
    memberId: 타인.member.id,
    date: 타인미래날짜,
    startTime: '09:00',
    endTime: '10:00',
  });

  const 응답 = await 취소(예약자.accessToken, 대상id);

  assert.equal(응답.status, 403, `타인 예약 취소: status(${응답.text})`);
  assert.equal(응답.body.code, 'FORBIDDEN', '새 코드값을 발명하지 않고 FORBIDDEN을 재사용한다');
  assert.equal(응답.body.message, '본인 또는 관리자만 예약을 취소할 수 있습니다.');
  assert.deepEqual(Object.keys(응답.body).sort(), ['code', 'message'], '본문 키 2개');

  assert.equal(
    (await 예약행(대상id)).reservation_status,
    'reserved',
    '403 요청으로 상태가 바뀌면 안 된다',
  );
});

test('C-2 이미 시작된 예약의 일반 회원 취소는 403이다', async () => {
  // 완료조건 4. swagger 403 description이 이 케이스를 명시했으므로 400이 아니라 403이다(§5-5).
  // ① 먼 과거 — 결정적이고 플레이키하지 않다.
  const 과거id = await 예약삽입({
    roomId: 활성실id,
    memberId: 예약자.member.id,
    date: 먼과거날짜,
    startTime: '09:00',
    endTime: '10:00',
  });

  const 과거 = await 취소(예약자.accessToken, 과거id);
  assert.equal(과거.status, 403, `먼 과거 예약 취소: status(${과거.text})`);
  assert.equal(과거.body.code, 'FORBIDDEN');
  assert.equal(과거.body.message, '이미 시작된 예약은 취소할 수 없습니다.');
  assert.deepEqual(Object.keys(과거.body).sort(), ['code', 'message'], '본문 키 2개');
  assert.equal((await 예약행(과거id)).reservation_status, 'reserved', '403이면 상태가 불변이다');

  // ② **오늘 + date_trunc('hour', now() AT TIME ZONE 'Asia/Seoul')**.
  // §5-3 벽시계 판정식의 **유일한 회귀 검출기다 — 삭제 금지**(§14-1).
  // 판정식에서 AT TIME ZONE을 빼면 세션 TimeZone GUC에 인가가 매달리고,
  // UTC로 뜬 DB에서 이 단정이 조용히 200으로 뒤집힌다(9시간 어긋난 취소 허용).
  const 오늘id = await 오늘시작된예약삽입(활성실id, 예약자.member.id);

  const 오늘 = await 취소(예약자.accessToken, 오늘id);
  assert.equal(
    오늘.status,
    403,
    `오늘 이미 지난 정시의 예약 취소는 403이어야 한다(AT TIME ZONE 누락 시 200이 된다): ${오늘.text}`,
  );
  assert.equal(오늘.body.code, 'FORBIDDEN');
  assert.equal(오늘.body.message, '이미 시작된 예약은 취소할 수 없습니다.');
  assert.equal((await 예약행(오늘id)).reservation_status, 'reserved', '403이면 상태가 불변이다');
});

test('C-3 이미 취소·완료된 예약의 재취소는 400이다', async () => {
  // Todo 4. 권한 문제가 아니므로 403이 아니고, 이 경로에 409는 정의되어 있지 않다(계획서 §7).
  // completed·canceled는 부분 유니크 인덱스 대상이 아니므로 같은 날짜에 공존할 수 있다.
  const 완료id = await 예약삽입({
    roomId: 활성실id,
    memberId: 예약자.member.id,
    date: 상태날짜,
    startTime: '09:00',
    endTime: '10:00',
    status: 'completed',
  });
  const 취소됨id = await 예약삽입({
    roomId: 활성실id,
    memberId: 예약자.member.id,
    date: 상태날짜,
    startTime: '10:00',
    endTime: '11:00',
    status: 'canceled',
  });

  assert.ok(B1id, '전제: B-1이 취소한 예약 id가 있어야 한다');
  const 케이스들 = [
    // completed는 정의상 이미 시작된 과거 예약이다. 판정 순서에서 상태를 시작여부보다
    // 뒤로 보내면 이 케이스가 403이 되어 swagger 400 분기가 영구히 죽는다(§6-3, §14-3).
    ['completed 예약', 완료id, 'completed'],
    ['canceled 예약', 취소됨id, 'canceled'],
    ['B-1이 방금 취소한 예약의 재취소', B1id, 'canceled'],
  ];

  for (const [이름, id, 이전상태] of 케이스들) {
    const 응답 = await 취소(예약자.accessToken, id);
    assert.notEqual(응답.status, 403, `${이름}: 권한 문제가 아니므로 403이 아니다`);
    assert.notEqual(응답.status, 409, `${이름}: 이 경로에 409는 정의되어 있지 않다`);
    assert.equal(응답.status, 400, `${이름}: status(${응답.text})`);
    assert.equal(응답.body.code, 'BAD_REQUEST', `${이름}: code`);
    assert.equal(응답.body.message, '이미 취소되었거나 완료된 예약입니다.', `${이름}: message`);
    assert.deepEqual(Object.keys(응답.body).sort(), ['code', 'message'], `${이름}: 본문 키 2개`);

    // §14-7 회귀 방어: UPDATE의 WHERE에서 reservation_status = 'reserved'를 빼면
    // completed 예약이 canceled로 덮여 이력이 훼손된다.
    assert.equal((await 예약행(id)).reservation_status, 이전상태, `${이름}: DB 상태가 불변이어야 한다`);
  }

  // §14-15 회귀 방어: 관리자 예외는 "시작 여부" 한 축뿐이며 상태 축에는 적용되지 않는다(§7-5).
  const 관리자응답 = await 취소(관리자.accessToken, 완료id);
  assert.equal(관리자응답.status, 400, `관리자의 completed 예약 취소: status(${관리자응답.text})`);
  assert.equal(관리자응답.body.code, 'BAD_REQUEST');
  assert.equal(관리자응답.body.message, '이미 취소되었거나 완료된 예약입니다.');
  assert.equal((await 예약행(완료id)).reservation_status, 'completed', '관리자 400에도 상태 불변');
});

test('C-4 미존재·형식 불량 reservationId는 500이 아니라 404다', async () => {
  // 형식 불량을 400으로 내면 FE가 "이미 취소된 예약"으로 오독한다 —
  // 이 경로의 400은 비즈니스 의미를 이미 점유하고 있다(계획서 §6-2, §14-13).
  // '99999999999'는 상한 검사가 없으면 pg 22003 → 500이 된다.
  for (const id of [999999, 'abc', '0', '-1', '1.5', '99999999999']) {
    const 응답 = await 취소(예약자.accessToken, id);
    assert.notEqual(응답.status, 500, `id=${id}: pg 22P02·22003이 500으로 새면 안 된다`);
    assert.notEqual(응답.status, 400, `id=${id}: 400은 "이미 취소·완료" 의미를 점유한다`);
    assert.equal(응답.status, 404, `id=${id}: status(${응답.text})`);
    assert.equal(응답.body.code, 'NOT_FOUND', `id=${id}: code`);
    assert.equal(응답.body.message, '예약을 찾을 수 없습니다.', `id=${id}: message`);
    assert.deepEqual(Object.keys(응답.body).sort(), ['code', 'message'], `id=${id}: 본문 키 2개`);
  }
});

// ── D. 인증 ─────────────────────────────────────────────────────────────────

test('D-1 인증 없이·만료·위조 토큰으로는 두 엔드포인트 모두 401이다', async () => {
  const 만료 = 만료Access토큰({
    id: 예약자.member.id,
    gradeLevel: 예약자.member.memberGrade.gradeLevel,
    isAdmin: 예약자.member.memberGrade.isAdmin,
  });
  const 토큰들 = [
    ['헤더없음', null, 'UNAUTHORIZED'],
    ['만료토큰', 만료, 'TOKEN_EXPIRED'],
    ['위조토큰', 위조(예약자.accessToken), 'UNAUTHORIZED'],
  ];

  // 취소 대상은 A 그룹의 예약자 소유 reserved 행이다. 401이면 끝까지 불변이어야 한다.
  const 대상id = 목록예약.reserved;
  assert.equal((await 예약행(대상id)).reservation_status, 'reserved', '전제: 대상이 reserved다');

  for (const [이름, 토큰, 기대코드] of 토큰들) {
    const 목록 = await 내예약목록(토큰, 토큰 === null ? '' : `?roomId=${활성실id}`);
    assert.equal(목록.status, 401, `${이름} 목록: 401이어야 한다(200·403·500 아님)`);
    assert.equal(목록.body.code, 기대코드, `${이름} 목록: code`);
    assert.deepEqual(Object.keys(목록.body).sort(), ['code', 'message'], `${이름} 목록: 본문 키 2개`);

    const 취소응답 = await 취소(토큰, 대상id);
    assert.equal(취소응답.status, 401, `${이름} 취소: 401이어야 한다(200·400·403·500 아님)`);
    assert.equal(취소응답.body.code, 기대코드, `${이름} 취소: code`);
    assert.deepEqual(
      Object.keys(취소응답.body).sort(),
      ['code', 'message'],
      `${이름} 취소: 본문 키 2개`,
    );
  }

  assert.equal(
    (await 예약행(대상id)).reservation_status,
    'reserved',
    '401 요청으로 DB 상태가 바뀌면 안 된다',
  );
});

// ── 정리 ────────────────────────────────────────────────────────────────────

test.after(async () => {
  await 정리();
  await pool.end();
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});
