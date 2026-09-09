'use strict';

require('dotenv').config();

// BE-11 (#22) — 원칙 §4 "service 레이어 단위" 요구를 충족하는 파일 계열이다.
// 이 파일은 HTTP를 거치지 않는다(서버·fetch·토큰 없음). controller 검증이 없으므로
// 시각은 항상 30분 경계('HH:00'/'HH:30')·startTime < endTime·운영시간(09:00~22:00) 안이어야 한다.
// 어기면 AppError가 아니라 DB CHECK 위반(pg 23514) → 500이 되어 테스트가 무의미해진다.
//
// 위 require('dotenv').config()가 src/** require보다 **먼저** 와야 한다 —
// src/utils/jwt.js:19-22가 모듈 로드 즉시 환경변수 4개를 fail-fast로 읽는다.
//
// 접두사: be11r- (auth-service.test.js는 be11a-). 두 파일이 접두사를 공유하면 안 된다 —
// node --test는 파일을 별도 프로세스로 병렬 실행하므로 서로의 before 정리가 상대 픽스처를 지운다.
//
// 날짜 센티널 점유 현황(연도가 겹치면 부분 유니크 인덱스 uq_reservations_active_slot으로
// 병렬 파일 간 실시간 충돌한다. reservations에는 접두사를 넣을 텍스트 컬럼이 없다):
//   2095 = 이 파일(BE-11) / 2096 = admin-api / 2097 = reservation-api /
//   2098 = reservation-cancel-api / 2099 = practice-room-api
//   과거: 2000-01-02~04 = reservation-cancel-api, 2000-01-05~06 = admin-api,
//         2000-01-07 = 이 파일 (다음 Task는 2094년대 / 2000-01-08 이후를 쓸 것)
//   (reservation-cancel-api.test.js:42의 "BE-08이 2099를 쓴다"는 주석은 틀렸다 — 실제는 2097.
//    주석이 아니라 각 파일의 상수 선언부를 신뢰할 것.)
// **케이스 간에도 날짜를 공유하지 않는다** — 아래 5개 날짜는 케이스와 1:1이다.
//
// 대상 DB: DATABASE_URL의 DB 이름이 _test로 끝나야 한다(완료조건 ③). npm run test:db 참조.

const test = require('node:test');
const assert = require('node:assert/strict');

const authService = require('../src/services/auth-service');
const reservationService = require('../src/services/reservation-service');
const { pool, query } = require('../src/db/pool');

// ── 상수 ────────────────────────────────────────────────────────────────────

/** 이 파일이 만드는 모든 회원 이메일의 접두사. 픽스처 예약은 이 회원들을 되짚어 정리한다. */
const PREFIX = 'be11r-';

/** docs/seed-dev.sql 계정 비밀번호. 픽스처 회원 가입에도 그대로 쓴다. */
const 비밀번호 = 'Test1234!';

/** swagger Reservation 프로퍼티 8개(정렬본). hasStarted는 스펙에 없다(취소 인가 판정 전용). */
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

const 연속날짜 = '2095-12-27'; // B-1 (09:00~10:00 + 10:00~11:00)
const 겹침날짜A = '2095-12-28'; // B-2① 기존 09:00~10:30 vs 신청 10:00~11:00
const 겹침날짜B = '2095-12-29'; // B-2② 기존 13:00~14:00 vs 신청 12:30~13:30
const 소유권날짜 = '2095-12-30'; // B-3 미래 reserved
const 시작된날짜 = '2000-01-07'; // B-4 이미 시작된 과거 예약

/** 접두사 규약을 지키는 유일한 이메일 생성기. */
let 이메일순번 = 0;
const 새이메일 = (구분) => `${PREFIX}${구분}-${Date.now()}-${(이메일순번 += 1)}@example.test`;

// ── DB 직접 조회·삽입 헬퍼 ──────────────────────────────────────────────────

/**
 * 예약 행을 직접 INSERT한다. service로는 과거 날짜·특정 소유자 조합을 만들 수 없다.
 * 30분 CHECK(reservations_30min_slot_check)를 지키려면 분이 00 또는 30이어야 하므로
 * 호출부는 시각을 항상 'HH:00'/'HH:30' 형태로만 넘긴다.
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

/** 특정 날짜의 reserved 행 수. 거부가 행을 만들지 않았음을 실측한다. */
async function 유효예약수(date) {
  const { rows } = await query(
    `SELECT count(*)::int AS n
       FROM reservations
      WHERE practice_room_id = $1
        AND reservation_date = $2::date
        AND reservation_status = 'reserved'`,
    [활성실id, date],
  );
  return rows[0].n;
}

/** 예약 1건의 실제 저장 상태. service 반환값을 믿지 않고 DB를 직접 읽는다. */
async function 예약상태(id) {
  const { rows } = await query('SELECT reservation_status FROM reservations WHERE id = $1', [id]);
  return rows[0].reservation_status;
}

/** 픽스처 정리. 순서 필수 — FK가 ON DELETE RESTRICT다. */
async function 정리() {
  await query(
    'DELETE FROM reservations WHERE member_id IN (SELECT id FROM members WHERE email LIKE $1)',
    [`${PREFIX}%`],
  );
  await query('DELETE FROM members WHERE email LIKE $1', [`${PREFIX}%`]);
}

// ── 공유 픽스처 ─────────────────────────────────────────────────────────────
let 활성실id; // 시드 활성 연습실 id (조회로 획득 — 하드코딩 금지)
let 예약자; // be11r-owner
let 타인; // be11r-other
let 대상; // B-3 전용: 예약자 소유 미래 reserved 예약
let 시작된; // B-4 전용: 예약자 소유 과거(이미 시작된) reserved 예약

test.before(async () => {
  // 개발 DB 실행 차단 가드(완료조건 ③). 정리()보다 반드시 앞에 둔다 —
  // 픽스처 생성 전에 죽어야 개발 DB가 조용히 오염되는 경로가 사라진다.
  const dbName = new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '');
  assert.ok(
    dbName.endsWith('_test'),
    `테스트는 별도 테스트 DB에서만 실행한다(완료조건 ③). 현재 대상=${dbName}. ` +
      '`npm run test:db` 를 먼저 실행하고 npm test 로 실행하라.',
  );

  // 선행 정리: 부분 유니크 인덱스 uq_reservations_active_slot이 있어 이전 실행의 정리가
  // 실패했으면 아래 픽스처 INSERT가 제약 위반으로 터진다. 행이 없으면 무연산이다.
  await 정리();

  // 시드 연습실 id를 **하드코딩하지 않고 조회한다.** 개발 DB에서는 2·3, 갓 만든 테스트 DB에서는
  // 1·2로 id가 달라진다 — 어느 쪽에서도 동작하려면 is_active로 찾는 수밖에 없다.
  const { rows: 활성행 } = await query(
    'SELECT id FROM practice_rooms WHERE is_active = TRUE ORDER BY id LIMIT 1',
  );
  assert.equal(
    활성행.length,
    1,
    '활성 시드 연습실이 최소 1건 있어야 한다. docs/seed-dev.sql이 적용되었는지 확인하라.',
  );
  활성실id = 활성행[0].id;

  // 픽스처 회원은 service 직접 호출로 만든다(HTTP 서버·토큰이 전부 불필요하다 —
  // service가 isAdmin을 인자로 받으므로 관리자 회원 행도 만들지 않는다).
  예약자 = await authService.signup({
    name: '테스트예약자',
    email: 새이메일('owner'),
    password: 비밀번호,
    phone: '010-0000-0012',
  });
  타인 = await authService.signup({
    name: '테스트타인',
    email: 새이메일('other'),
    password: 비밀번호,
    phone: '010-0000-0013',
  });
  assert.notEqual(예약자.id, 타인.id, '예약자와 타인은 서로 다른 회원이어야 한다');

  대상 = await 예약삽입({
    roomId: 활성실id,
    memberId: 예약자.id,
    date: 소유권날짜,
    startTime: '09:00',
    endTime: '10:00',
  });
  시작된 = await 예약삽입({
    roomId: 활성실id,
    memberId: 예약자.id,
    date: 시작된날짜,
    startTime: '09:00',
    endTime: '10:00',
  });
});

test.after(async () => {
  await 정리();
  await pool.end();
});

// ── B. 예약 중복 방지 + 취소 소유권 (원칙 §4) ───────────────────────────────

test('B-1 연속 슬롯은 겹침이 아니므로 연달아 예약된다', async () => {
  // 키 이름 규약: roomId(≠practiceRoomId), reservationDate(≠date).
  // 틀리면 roomId가 undefined가 되어 404 PRACTICE_ROOM_NOT_FOUND가 난다.
  const 앞 = await reservationService.createReservation({
    roomId: 활성실id,
    memberId: 예약자.id,
    reservationDate: 연속날짜,
    startTime: '09:00',
    endTime: '10:00',
  });
  const 뒤 = await reservationService.createReservation({
    roomId: 활성실id,
    memberId: 예약자.id,
    reservationDate: 연속날짜,
    startTime: '10:00',
    endTime: '11:00',
  });

  for (const [이름, 예약, startTime, endTime] of [
    ['앞 슬롯', 앞, '09:00', '10:00'],
    ['뒤 슬롯', 뒤, '10:00', '11:00'],
  ]) {
    assert.deepEqual(Object.keys(예약).sort(), 예약키, `${이름}: Reservation 8개 키`);
    assert.ok(Number.isInteger(예약.id), `${이름}: id`);
    assert.equal(예약.practiceRoomId, 활성실id, `${이름}: practiceRoomId`);
    assert.equal(예약.memberId, 예약자.id, `${이름}: memberId`);
    assert.equal(예약.reservationDate, 연속날짜, `${이름}: reservationDate`);
    assert.equal(예약.startTime, startTime, `${이름}: startTime`);
    assert.equal(예약.endTime, endTime, `${이름}: endTime`);
    assert.equal(예약.reservationStatus, 'reserved', `${이름}: reservationStatus`);
    assert.ok(예약.createdAt instanceof Date, `${이름}: createdAt은 TIMESTAMPTZ → Date 객체`);
    assert.equal('hasStarted' in 예약, false, `${이름}: hasStarted는 응답 스펙에 없다`);
  }
  assert.notEqual(앞.id, 뒤.id);

  // 경계가 맞닿은 구간(10:00)은 overlaps()가 겹침으로 보지 않는다:
  // a.startTime < b.endTime && a.endTime > b.startTime.
  assert.equal(await 유효예약수(연속날짜), 2, '연속 2슬롯이 모두 저장되어야 한다');
});

test('B-2 부분만 겹치는 요청은 409로 거부된다', async () => {
  // **부분 겹침의 핵심**: 신청 시작시각이 기존 시작시각과 다르므로 부분 유니크 인덱스
  // uq_reservations_active_slot (practice_room_id, reservation_date, start_time)
  // WHERE status='reserved' 로는 잡히지 않는다 →
  // reservation-service.js:14 overlaps()가 **유일한 검출기**다.
  // ①은 뒤로, ②는 앞으로 겹쳐 overlaps()의 두 비교식을 각각 흔든다.
  const 케이스들 = [
    ['① 뒤로 겹침', 겹침날짜A, '09:00', '10:30', '10:00', '11:00'],
    ['② 앞으로 겹침', 겹침날짜B, '13:00', '14:00', '12:30', '13:30'],
  ];

  for (const [이름, date, 기존시작, 기존종료, 신청시작, 신청종료] of 케이스들) {
    await 예약삽입({
      roomId: 활성실id,
      memberId: 예약자.id,
      date,
      startTime: 기존시작,
      endTime: 기존종료,
    });
    assert.notEqual(신청시작, 기존시작, `${이름}: 시작시각이 같으면 부분 겹침 검증이 아니다`);

    await assert.rejects(
      () =>
        reservationService.createReservation({
          roomId: 활성실id,
          memberId: 타인.id,
          reservationDate: date,
          startTime: 신청시작,
          endTime: 신청종료,
        }),
      (error) => {
        assert.equal(error.status, 409, `${이름}: status`);
        assert.equal(error.code, 'RESERVATION_SLOT_CONFLICT', `${이름}: code`);
        assert.equal(error.message, '이미 예약된 시간대가 포함되어 있습니다.', `${이름}: message`);
        return true;
      },
    );

    assert.equal(await 유효예약수(date), 1, `${이름}: 거부가 행을 만들지 않아야 한다`);
  }
});

test('B-3 타인은 취소할 수 없고 본인은 취소된다', async () => {
  // cancelReservation(reservationId, memberId, isAdmin) — **위치인자 3개**.
  // 2·3번을 뒤바꾸면 isAdmin이 truthy가 되어 소유권 관문을 통과한다.
  // ①과 ②는 **2번째 인자만 다르다** — 403이 다른 사유(미존재·상태·시작여부)에서
  // 온 것이 아님을 증명하는 대조쌍이다.
  await assert.rejects(
    () => reservationService.cancelReservation(대상, 타인.id, false),
    (error) => {
      assert.equal(error.status, 403, '타인 취소: status');
      assert.equal(error.code, 'FORBIDDEN', '타인 취소: code');
      assert.equal(
        error.message,
        '본인 또는 관리자만 예약을 취소할 수 있습니다.',
        '타인 취소: message',
      );
      return true;
    },
  );
  assert.equal(await 예약상태(대상), 'reserved', '거부되었으면 상태가 그대로여야 한다');

  const 취소됨 = await reservationService.cancelReservation(대상, 예약자.id, false);
  assert.deepEqual(Object.keys(취소됨).sort(), 예약키);
  assert.equal(취소됨.id, 대상);
  assert.equal(취소됨.practiceRoomId, 활성실id);
  assert.equal(취소됨.memberId, 예약자.id);
  assert.equal(취소됨.reservationDate, 소유권날짜, 'reservationDate는 문자열이다(Date 객체 아님)');
  assert.equal(취소됨.startTime, '09:00', 'to_char+slice로 초 없는 5자다');
  assert.equal(취소됨.endTime, '10:00');
  assert.equal(취소됨.reservationStatus, 'canceled');
  assert.equal('hasStarted' in 취소됨, false, 'hasStarted는 응답 스펙에 없다');
  assert.equal(await 예약상태(대상), 'canceled');
});

test('B-4 관리자는 시작된 예약도 취소하지만 상태 검사는 우회하지 못한다', async () => {
  // ①과 ②는 **같은 status(403)·같은 code(FORBIDDEN)이고 message로만 구분된다.**
  // message를 단정하지 않으면 이 두 케이스를 구별할 수 없다.

  // ① 타인 + isAdmin=false: 소유권(:91)이 시작여부(:99)보다 먼저 판정된다.
  await assert.rejects(
    () => reservationService.cancelReservation(시작된, 타인.id, false),
    (error) => {
      assert.equal(error.status, 403, '타인+시작됨: status');
      assert.equal(error.code, 'FORBIDDEN', '타인+시작됨: code');
      assert.equal(
        error.message,
        '본인 또는 관리자만 예약을 취소할 수 있습니다.',
        '타인+시작됨: message는 소유권 사유다(시작여부가 아니다)',
      );
      return true;
    },
  );

  // ② 본인 + isAdmin=false: 본인이지만 이미 시작되었다.
  await assert.rejects(
    () => reservationService.cancelReservation(시작된, 예약자.id, false),
    (error) => {
      assert.equal(error.status, 403, '본인+시작됨: status');
      assert.equal(error.code, 'FORBIDDEN', '본인+시작됨: code');
      assert.equal(
        error.message,
        '이미 시작된 예약은 취소할 수 없습니다.',
        '본인+시작됨: message는 시작여부 사유다(소유권이 아니다)',
      );
      return true;
    },
  );
  assert.equal(await 예약상태(시작된), 'reserved', '두 번의 거부가 상태를 바꾸지 않았다');

  // ③ 소유자가 아닌 회원 + isAdmin=true: 관리자는 hasStarted를 우회한다.
  const 취소됨 = await reservationService.cancelReservation(시작된, 타인.id, true);
  assert.deepEqual(Object.keys(취소됨).sort(), 예약키);
  assert.equal(취소됨.id, 시작된);
  assert.equal(취소됨.memberId, 예약자.id, '취소해도 소유자는 그대로다');
  assert.equal(취소됨.reservationDate, 시작된날짜);
  assert.equal(취소됨.reservationStatus, 'canceled');
  assert.equal(await 예약상태(시작된), 'canceled');

  // ④ 같은 호출 재실행: 관리자도 상태 검사(:94)는 우회하지 못한다(비대칭).
  await assert.rejects(
    () => reservationService.cancelReservation(시작된, 타인.id, true),
    (error) => {
      assert.equal(error.status, 400, '재취소: status');
      assert.equal(error.code, 'BAD_REQUEST', '재취소: code');
      assert.equal(error.message, '이미 취소되었거나 완료된 예약입니다.', '재취소: message');
      return true;
    },
  );
});
