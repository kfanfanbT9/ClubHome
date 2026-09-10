## Todo (해야 할 일)

- [ ] `backend/` 생성, Express·pg·bcrypt·jsonwebtoken·dotenv 설치
- [ ] 프로젝트 구조 원칙 §7의 디렉토리 골격 생성(`routes`/`controllers`/`services`/`repositories`/`middlewares`/`db`/`utils`)
- [ ] `db/pool.js`(pg Pool), `app.js`, `server.js`, `middlewares/errorHandler.js` 작성
- [ ] `.env`, `.env.example` 작성(`DATABASE_URL`, `JWT_*`, `PORT`), `.gitignore`에 `.env` 등록
- [ ] `GET /health` 라우트 구현 — 200으로 상태와 DB 연결 성공 여부 응답 (swagger.yaml `/health`)

## 완료 조건

- [ ] `npm start`로 서버가 지정 포트에서 기동된다
- [ ] `GET /health`가 200과 DB 연결 성공 여부를 응답한다
- [ ] `.env.example`에 키 이름만 있고 실제 시크릿 값은 저장소에 없다
- [ ] 예외 발생 시 errorHandler를 통해 일관된 JSON 오류 형식으로 응답한다

## 기술적 고려사항

- 의존성은 `routes → controller → service → repository → PostgreSQL` 단방향으로만 흐른다. 역참조를 만들지 않고, DTO 변환·도메인 모델 같은 추가 레이어도 두지 않는다 (프로젝트 구조 설계 원칙 §2.2).
- ORM(Prisma 등)은 금지이며 `pg` 기반 순수 SQL만 사용한다. SQL은 repository 레이어에만 존재하고 controller·service에서 `pool.query`를 직접 호출하지 않는다 (PRD §6, 원칙 §2.2).
- errorHandler의 오류 응답 형식은 `swagger.yaml`의 `ErrorResponse` 스키마와 일치시킨다. 이후 모든 Task의 4xx/5xx 응답이 이 형식을 따른다.
- 헬스체크는 `GET /health` 하나로 DB 연결 확인 수준이면 충분하다. 별도 로그 수집 인프라나 이중화는 범위 밖이다 (원칙 §5).
- `.env.example`에는 키 이름만 남기고 값은 비운다. JWT Secret은 코드·저장소에 하드코딩하지 않는다 (원칙 §5).
- 원칙 §7에 `migrations/` 디렉토리가 있으나 스키마 적용은 DB-01에서 `docs/schema.sql`로 수행했다. 동일 DDL을 두 곳에서 관리하지 않도록 `docs/schema.sql`을 단일 소스로 유지한다.

## 의존성

- **관련 F-ID / 화면**: 없음 (기반 작업)
- **참조 문서**: `docs/5-project-principle.md` (v0.4) §2.2·§5·§7, `docs/2-PRD.md` (v0.7) §6, `backend/swagger.yaml` (v0.2.0) `/health`

## 선행 작업 / 후행 작업

- **선행 작업**: `DB-01`
- **후행 작업**: `BE-02`
