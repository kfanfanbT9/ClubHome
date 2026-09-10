## Todo (해야 할 일)

- [ ] 운영용 환경변수 정리(`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `DATABASE_URL`, `PORT`, CORS 허용 origin)
- [ ] 프론트엔드 프로덕션 빌드 및 정적 서빙 경로 확인
- [ ] `GET /health` 기반 기동 확인, 단일 서버 실행 절차를 README에 정리

## 완료 조건

- [ ] `.env.example`이 실제 필요한 키를 모두 포함하고 시크릿 값은 비어 있다
- [ ] 프론트엔드 프로덕션 빌드가 오류 없이 완료된다
- [ ] 운영 환경에서 CORS 허용 origin이 환경변수로 주입된다
- [ ] README에 DB 생성 → 스키마 적용 → 백엔드 기동 → 프론트 빌드 순서가 정리되어 있다

## 기술적 고려사항

- 배포 형태는 단일 서버(단일 VM/컨테이너)에 Express + PostgreSQL이다. 로드밸런서·이중화·별도 로그 수집 인프라(ELK 등)는 두지 않는다 (프로젝트 구조 설계 원칙 §5, PRD §5).
- JWT Secret은 코드·저장소에 하드코딩하지 않는다. `.env.example`에는 키 이름만 남기고 값은 비운다 (원칙 §5, PRD §6).
- 프론트/백엔드 도메인이 다르면 CORS 허용 origin을 환경변수로 관리하고 운영은 HTTPS로만 서비스한다 (원칙 §5).
- 헬스체크는 `GET /health` 하나로 DB 연결 확인 수준이면 충분하다 (원칙 §5, swagger `/health`).
- README의 실행 절차는 DB-01의 `docs/schema.sql` 적용과 DB-02의 `docs/seed-dev.sql`(개발용) 구분을 명확히 한다. 운영 환경에 개발 시드를 넣지 않는다 (8-plan §4 DB-01·DB-02).
- CI/CD 파이프라인 구축은 이 프로젝트 범위 밖이다 (원칙 §1 규모에 맞는 결정).

## 의존성

- **관련 F-ID / 화면**: 없음 (배포·운영 마무리)
- **참조 문서**: `docs/5-project-principle.md` (v0.4) §1·§5, `docs/2-PRD.md` (v0.7) §5·§6, `backend/swagger.yaml` `/health`

## 선행 작업 / 후행 작업

- **선행 작업**: `IT-01`
- **후행 작업**: 없음 (WBS 최종 Task)
