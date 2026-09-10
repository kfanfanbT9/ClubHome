## Todo (해야 할 일)

- [ ] 회원등급: `GET /api/admin/members`(`q` 검색), `PATCH /api/admin/members/:memberId/grade`
- [ ] 등급 체계: `GET /api/admin/member-grades`, `POST /api/admin/member-grades`(201, 등급명·`grade_level` 중복 409), `PATCH /api/admin/member-grades/:gradeId`(200 / 409)
- [ ] 게시판: `GET /api/admin/boards`(비활성 포함 전체 목록), `POST`(201), `PATCH /api/admin/boards/:boardId`, `DELETE`(204, 참조 게시글 존재 시 409) — 최소등급·사용여부 설정
- [ ] 연습실: `GET /api/admin/practice-rooms`(비활성 포함 전체 목록), `POST`(201), `PATCH /api/admin/practice-rooms/:roomId`, `DELETE`(204, 참조 예약 존재 시 409) — 운영시간·수용인원·사용여부
- [ ] 예약 관리: `GET /api/admin/reservations?roomId=&date=`(현황·내역 조회), `PATCH /api/admin/reservations/:reservationId/cancel`(강제 취소)
- [ ] 모든 관리자 엔드포인트는 service 레이어에서 `is_admin` 검증 (비관리자 403)

## 완료 조건

- [ ] 관리자 계정으로 회원 등급 변경이 성공하고 변경 후 게시판 접근 권한이 달라진다
- [ ] 게시판 생성·수정(최소등급·사용여부)이 반영되고 F-10 접근 제어에 즉시 적용된다
- [ ] 연습실 등록·수정·사용여부 변경이 반영된다
- [ ] 관리자가 임의 예약을 강제 취소할 수 있다
- [ ] 비관리자 계정의 모든 관리자 엔드포인트 접근이 403으로 거부된다
- [ ] 비활성 게시판·연습실이 관리자 목록에는 표시되고 일반 회원 목록에는 표시되지 않는다
- [ ] 참조 중인 게시판·연습실 삭제 시 FK RESTRICT로 인한 오류가 500이 아닌 의미 있는 4xx로 응답된다

## 기술적 고려사항

- `is_admin` 검증은 공통 미들웨어 하나로 처리하지 않고 각 관리자 service 함수 내부에서 명시적으로 수행한다. 리소스별 규칙이 다르기 때문이다 (프로젝트 구조 설계 원칙 §2.2, §5).
- 별도 "admin domain"을 신설하지 않고 기존 도메인 service·repository에 관리자용 함수를 추가한다. 도메인당 파일 1개 원칙을 유지한다 (원칙 §7).
- FK가 모두 `ON DELETE RESTRICT`이므로 참조 중인 게시판·연습실 삭제는 DB 오류로 튄다. 이를 잡아 409로 변환해야 하며 500으로 노출하면 완료 조건 위반이다 (ERD §3·§4, swagger `DELETE` 409).
- 등급 체계 생성·수정 시 `member_grades.name`과 `grade_level`이 모두 UNIQUE다. 두 중복 모두 409로 응답한다. `grade_level`은 `boards.min_grade_level`의 FK 대상이라 함부로 재배치하면 게시판 접근 제어가 흔들린다 (ERD §3·§4).
- 등급 변경 결과는 대상 회원의 다음 로그인·토큰 갱신 시점에 반영된다(JWT 무상태, 서버 측 세션·토큰 저장소 없음). 즉시 무효화 수단은 두지 않는다 (ERD §4, 사용자 시나리오 S-07 예외 항목).
- 관리자 강제 취소는 예약 시작 여부와 무관하게 허용되는 운영 예외다. 일반 회원 취소 경로(BE-09)와 규칙이 다르므로 판정을 공유하지 않는다 (도메인 정의서 §4.2·§6).
- 등급 **삭제** API는 만들지 않는다. F-30 범위는 생성/수정이며 해당 화면도 없다 (PRD F-30, 8-plan 변경이력 v0.3).

## 의존성

- **관련 F-ID / 화면**: F-30(회원등급 관리), F-31(게시판 관리), F-32(연습실 관리) / 화면 12·13·14의 백엔드 대응
- **시나리오**: S-07 (회원 등급 변경), S-08 (게시판/연습실 관리)
- **참조 문서**: `backend/swagger.yaml` `/api/admin/*`, `docs/1-domain-definition.md` (v0.6) §4.2·§6, `docs/7-erd.md` (v0.5) §3·§4, `docs/5-project-principle.md` (v0.4) §2.2·§7

## 선행 작업 / 후행 작업

- **선행 작업**: `BE-05`, `BE-09`
- **후행 작업**: `BE-11`, `FE-09`
