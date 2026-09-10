## Todo (해야 할 일)

- [ ] `GET /api/boards`: 활성 게시판 목록과 각 게시판의 최소등급, 요청 회원의 접근 가능 여부 반환 (200)
- [ ] `GET /api/boards/:boardId`: service 레이어에서 `회원.grade_level >= 게시판.min_grade_level` 및 `is_active` 검증 (200 / 등급 미달 403 / 미존재·비활성 404)
- [ ] 이후 게시글 API(BE-06)와 관리자 API(BE-10)가 재사용할 등급 인가 함수를 `board-service.js`에 단일 지점으로 노출

## 완료 조건

- [ ] 등급 충족 게시판은 정상 조회된다
- [ ] 등급 미달 게시판 진입은 403으로 거부된다
- [ ] 비활성 게시판은 일반 회원 목록에 노출되지 않고 직접 접근도 거부된다
- [ ] 인가 판단이 service 레이어에서 수행된다(원칙 §2.2)

## 기술적 고려사항

- 인가는 미들웨어가 아닌 service에서 최종 판단한다. 미들웨어는 로그인 여부만 걸러주므로 "이 게시판 접근 가능한 등급인가"는 `board-service`가 매번 명시적으로 검사한다 (프로젝트 구조 설계 원칙 §2.2, §5).
- 등급 비교는 `member.grade_level >= board.min_grade_level` 정수 비교 한 줄로 끝난다. `boards.min_grade_level`이 `member_grades(grade_level)` FK이므로 별도 등급 조인 규칙을 만들 필요가 없다 (ERD §4).
- 목록 응답은 접근 불가 게시판도 최소등급과 함께 반환해 프론트가 잠금 표시(화면 6, FE-05)를 할 수 있게 한다. 단 비활성 게시판은 일반 회원 목록에서 제외한다 (와이어프레임 6번, 8-plan §4 BE-05).
- 비활성·미존재 게시판은 존재 여부를 노출하지 않도록 404로 통일하고, 등급 미달만 403으로 구분한다 (swagger `/api/boards/{boardId}` 403·404).
- SQL은 `board-repository.js`에만 두고 파라미터 바인딩(`$1`)을 사용한다. 게시판 수가 적어 PK 인덱스만으로 충분하다 (원칙 §2.2·§5, ERD §3).

## 의존성

- **관련 F-ID / 화면**: F-10 (게시판 목록/열람) / 화면 6 (게시판 목록)
- **시나리오**: S-03 (등급에 따른 게시판 접근 제한)
- **참조 문서**: `backend/swagger.yaml` `/api/boards`, `/api/boards/{boardId}`, `docs/1-domain-definition.md` (v0.6) §5, `docs/7-erd.md` (v0.5) §4, `docs/5-project-principle.md` (v0.4) §2.2

## 선행 작업 / 후행 작업

- **선행 작업**: `BE-03`
- **후행 작업**: `BE-06`, `BE-10`
