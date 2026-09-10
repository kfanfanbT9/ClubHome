## Todo (해야 할 일)

- [ ] PostgreSQL 17 인스턴스에 개발용 데이터베이스 생성
- [ ] `psql -d <db> -f docs/schema.sql` 실행으로 6개 테이블·인덱스·초기 등급 데이터 생성
- [ ] 접속 정보를 백엔드 `.env` 항목(`DATABASE_URL` 또는 `PG*`)으로 정리

## 완료 조건

- [x] `psql -d <db> -f docs/schema.sql` 이 오류 없이 완료된다
- [x] `members`, `member_grades`, `boards`, `posts`, `practice_rooms`, `reservations` 6개 테이블이 존재한다
- [x] `member_grades`에 준회원/정회원/운영진 3건이 조회된다
- [x] `reservations`의 부분 유니크 인덱스(`uq_reservations_active_slot`)가 생성되어 있다

## 기술적 고려사항

- 예약 중복 방어의 DB 보조 방어선은 **부분** 유니크 인덱스 `(practice_room_id, reservation_date, start_time) WHERE reservation_status = 'reserved'`다. 일반 UNIQUE를 쓰면 취소된 예약이 남은 시간대의 재예약이 막혀 S-06 규칙과 충돌한다 (ERD §4, 변경이력 v0.2).
- 시각 컬럼 타입이 목적별로 다르다. 기록 시각(`joined_at`, `created_at`)은 `TIMESTAMPTZ`, 예약 시각(`reservation_date`/`start_time`/`end_time`)은 벽시계 기준이라 `DATE`/`TIME`이다 (ERD §1).
- 30분 경계 CHECK(분이 0 또는 30, 초가 0)와 시간 순서 CHECK(`start_time < end_time`)를 DB에 두어 서비스 레이어 검증의 보조 방어선으로 삼는다 (ERD §3, §4).
- `boards.min_grade_level`은 `member_grades(grade_level)`를 참조하는 FK다. 서비스 코드는 `member.grade_level >= board.min_grade_level` 정수 비교만으로 접근 제어를 수행한다 (ERD §4).
- `posts.member_id`·`reservations.member_id`는 `ON DELETE RESTRICT`다. 회원 탈퇴는 `account_status = 'withdrawn'` 소프트 삭제이며 이력은 보존한다 (ERD §4, PRD §5).
- `.env`는 `.gitignore`에 등록하고 저장소에 시크릿 값을 남기지 않는다 (프로젝트 구조 설계 원칙 §5).

## 의존성

- **관련 F-ID / 화면**: ERD 전체 (특정 F-ID·화면에 종속되지 않는 기반 작업)
- **참조 문서**: `docs/7-erd.md` (v0.5) §1·§3·§4, `docs/schema.sql`, `docs/5-project-principle.md` §5

## 선행 작업 / 후행 작업

- **선행 작업**: 없음
- **후행 작업**: `DB-02`, `BE-01`
