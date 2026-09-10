## Todo (해야 할 일)

- [ ] `POST /api/practice-rooms/:roomId/reservations`: 시작·종료 시각 수신 → 201
- [ ] 입력 검증: 30분 경계, `start_time < end_time`, 운영시간 내, 연속 구간 여부 → 위반 시 400
- [ ] service 트랜잭션: `BEGIN` → 동일 연습실·날짜 예약을 `SELECT ... FOR UPDATE`로 잠금 → 구간 겹침 검사 → `INSERT` → `COMMIT` (겹침 시 `ROLLBACK` + 409)
- [ ] 비활성 연습실·탈퇴 회원 요청 403, 존재하지 않는 연습실 404 응답

## 완료 조건

- [ ] 비어 있는 연속 슬롯 구간(예: 09:00~10:30) 예약이 201로 확정된다
- [ ] 구간 내 슬롯이 하나라도 겹치면 409로 거부되고 부분 저장이 발생하지 않는다
- [ ] 30분 경계를 벗어난 시각(예: 09:17)은 400으로 거부된다
- [ ] 운영시간을 벗어난 요청은 400으로 거부된다
- [ ] 비활성 연습실·탈퇴 회원의 예약 요청이 거부된다

## 기술적 고려사항

- 구간 겹침은 단순 UNIQUE 제약으로 표현할 수 없다(범위 겹침 판정 필요). 반드시 service에서 `BEGIN` → 같은 연습실·날짜의 `reserved` 예약을 `SELECT ... FOR UPDATE`로 잠금 → 겹침 검사 → `INSERT` → `COMMIT` 순으로 원자 처리한다 (ERD §4, 프로젝트 구조 설계 원칙 §2.2).
- DB의 부분 유니크 인덱스 `(practice_room_id, reservation_date, start_time) WHERE reservation_status='reserved'`는 동일 시작점 중복만 막는 **보조** 방어선이다. 구간 일부만 겹치는 경우는 잡지 못하므로 애플리케이션 검사를 생략할 수 없다 (ERD §3·§4).
- 30분 경계 검증은 service 입력 검증에서 수행하고 DB CHECK(분 0/30, 초 0)를 보조로 둔다. DB 제약 위반을 그대로 노출해 500이 되지 않게 controller에서 400으로 변환한다 (ERD §4, swagger 400 응답).
- 겹침 거부는 409, 입력 검증 실패는 400, 비활성 연습실·탈퇴 회원은 403으로 코드를 분리한다. 프론트가 "이미 예약된 시간대 포함" 안내(FE-07)를 409로 식별한다 (swagger `/api/practice-rooms/{roomId}/reservations` POST).
- 트랜잭션은 service가 열고, SQL 자체는 `reservation-repository.js`에만 둔다. 클라이언트(커넥션) 전달 방식으로 같은 트랜잭션 내에서 잠금과 INSERT를 수행한다 (원칙 §2.2).
- 탈퇴 회원 차단은 `account_status = 'withdrawn'` 확인이다. 회원 행은 삭제되지 않으므로 상태 검사가 유일한 차단 지점이다 (도메인 정의서 §6, ERD §4).

## 의존성

- **관련 F-ID / 화면**: F-21 (예약 신청) / 화면 10 (예약 신청)
- **시나리오**: S-05 (예약 신청 및 중복예약 거부)
- **참조 문서**: `backend/swagger.yaml` `/api/practice-rooms/{roomId}/reservations` POST, `docs/1-domain-definition.md` (v0.6) §2.5·§6, `docs/7-erd.md` (v0.5) §3·§4, `docs/5-project-principle.md` (v0.4) §2.2

## 선행 작업 / 후행 작업

- **선행 작업**: `BE-07`
- **후행 작업**: `BE-09`, `FE-07`
