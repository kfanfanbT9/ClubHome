## Todo (해야 할 일)

- [ ] `POST /api/auth/signup`: 필수값·이메일 형식 검증(400), 이메일 중복 확인(409), 비밀번호 해시 저장, 기본 등급(최저 `grade_level`) 부여 → 201
- [ ] `POST /api/auth/login`: 자격 검증 후 Access·Refresh Token 발급(200), 이메일·비밀번호 불일치 401, 탈퇴(`withdrawn`) 계정 403
- [ ] `POST /api/auth/refresh`: Refresh Token 검증 후 Access Token 재발급(200), 만료·위조 Refresh Token 401
- [ ] `POST /api/auth/logout`: 클라이언트 토큰 폐기 기준 처리 → 204 (서버 측 토큰 저장소 없음 - ERD §4)

## 완료 조건

- [ ] 신규 가입 시 기본 등급이 자동 부여되고 비밀번호가 해시로 저장된다(평문 없음)
- [ ] 중복 이메일 가입이 409(또는 400)로 거부된다
- [ ] 로그인 성공 시 Access·Refresh Token이 함께 반환된다
- [ ] 비밀번호 불일치는 401, 탈퇴 계정은 403으로 거부된다
- [ ] 만료된 Access Token + 유효한 Refresh Token으로 재발급이 성공한다
- [ ] 만료·위조 Refresh Token은 401로 거부된다

## 기술적 고려사항

- 기본 등급은 하드코딩한 등급 ID가 아니라 `member_grades` 중 최저 `grade_level` 행을 조회해 부여한다. 관리자가 등급 체계를 바꿔도(F-30) 가입 로직이 깨지지 않는다 (ERD §4, 8-plan §4 BE-03).
- 이메일 중복은 `members.email` UNIQUE 제약이 최종 방어선이지만, 사용자에게는 409로 의미 있게 응답해야 하므로 service에서 선행 조회 후 판정한다 (ERD §3, swagger `/api/auth/signup` 409).
- 탈퇴 계정 차단은 인증 실패(401)와 구분해 403으로 응답한다. 탈퇴는 행 삭제가 아닌 `account_status = 'withdrawn'` 소프트 삭제이므로 로그인 시 상태를 명시적으로 확인해야 한다 (도메인 정의서 §6, ERD §4).
- 로그아웃은 서버 상태 변경이 없다. 서버 측 토큰 저장소를 두지 않기로 결정했으므로 204만 반환하고 실제 폐기는 클라이언트(FE-03)가 수행한다 (ERD §4, PRD F-02).
- 입력 검증은 controller 진입 시점에 수행하고, 검증 라이브러리는 하나만 선택한다(`zod` 또는 `express-validator` 중 택1) (프로젝트 구조 설계 원칙 §5).
- 이메일 조회 SQL은 `email` 유니크 인덱스를 타며, 모든 쿼리는 `pg` 파라미터 바인딩(`$1`)만 사용한다 (ERD §3, 원칙 §5).

## 의존성

- **관련 F-ID / 화면**: F-01(회원가입), F-02(로그인/로그아웃) / 화면 3·4의 백엔드 대응
- **시나리오**: S-01 (신규 회원가입 및 로그인)
- **참조 문서**: `backend/swagger.yaml` `/api/auth/*`, `docs/1-domain-definition.md` (v0.6) §2.1·§6, `docs/7-erd.md` (v0.5) §4, `docs/5-project-principle.md` (v0.4) §5

## 선행 작업 / 후행 작업

- **선행 작업**: `BE-02`, `DB-02`
- **후행 작업**: `BE-04`, `BE-05`, `BE-07`, `FE-03`
