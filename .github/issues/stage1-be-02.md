## Todo (해야 할 일)

- [ ] `utils/jwt.js`: Access/Refresh Token 발급·검증 (시크릿·유효기간은 `JWT_ACCESS_SECRET`·`JWT_REFRESH_SECRET`·`JWT_ACCESS_EXPIRES_IN`·`JWT_REFRESH_EXPIRES_IN` 환경변수에서 로드)
- [ ] `utils/password.js`: bcrypt 해시·비교
- [ ] `middlewares/auth.js`: Access Token 검증 후 회원ID·등급 정보를 요청 컨텍스트에 주입(로그인 여부까지만 판단)
- [ ] 토큰 누락·만료·위조 시 401 응답 형식을 `swagger.yaml`의 `Unauthorized` 응답과 일치시킴

## 완료 조건

- [ ] 토큰 시크릿·유효기간이 코드에 하드코딩되어 있지 않다(환경변수 참조)
- [ ] 유효한 Access Token으로 보호된 라우트 접근이 통과한다
- [ ] 만료·위조 토큰은 401로 거부된다
- [ ] 인가(등급·소유권) 판단 로직이 미들웨어에 포함되지 않았다(service 책임, 원칙 §2.2)

## 기술적 고려사항

- 미들웨어는 "로그인 여부"까지만 판단한다. "이 게시판에 접근 가능한 등급인가", "이 예약이 본인 것인가" 같은 도메인 규칙은 각 service 함수가 매번 명시적으로 검사한다. 공통 미들웨어 하나로 모든 인가를 처리하려 하지 않는다 (프로젝트 구조 설계 원칙 §2.2, §5).
- Refresh Token은 별도 테이블에 저장하지 않는 무상태 설계다. 화이트/블랙리스트 테이블을 도입하지 않으며 로그아웃은 클라이언트 토큰 삭제 + 만료 기준으로 처리한다 (ERD §4, PRD F-02).
- 미들웨어가 주입할 등급 정보는 `grade_level`(정수)과 `is_admin`(불리언)이다. service는 이 값으로 단순 비교만 수행한다 (ERD §4, 원칙 §3 용어 매핑표).
- 비밀번호는 bcrypt 해시로만 저장·비교한다. 평문 저장·평문 비교는 금지다 (원칙 §5).
- Access Token은 단기(예: 15분~1시간), Refresh Token은 장기(예: 7~14일)로 두고 값은 환경변수로만 조정한다 (PRD §6).

## 의존성

- **관련 F-ID / 화면**: F-02 (로그인/로그아웃)
- **참조 문서**: `docs/5-project-principle.md` (v0.4) §2.2·§5, `docs/7-erd.md` (v0.5) §4, `docs/2-PRD.md` (v0.7) §6, `backend/swagger.yaml` `components.responses.Unauthorized`

## 선행 작업 / 후행 작업

- **선행 작업**: `BE-01`
- **후행 작업**: `BE-03`
