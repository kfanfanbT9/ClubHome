# 색연필 백엔드

색소폰 동호회 홈페이지의 REST API 서버입니다.

## 기술 스택

Node.js + JavaScript(CommonJS) / Express 5 / PostgreSQL 17 (`pg` 직접 사용, ORM 미사용) / JWT(Access + Refresh) / bcrypt

## 실행 방법

```bash
npm install
cp .env.example .env   # 값을 채운다
npm start              # http://localhost:3000
```

- 개발 모드: `npm run dev` (파일 변경 시 자동 재시작)
- 테스트: `npm test`
- 헬스체크: `GET /health` → `{ "status": "ok", "db": "ok" }`

DB 스키마는 `docs/schema.sql`이 단일 소스이며, 개발용 초기 데이터는 `docs/seed-dev.sql`로 적용합니다.

## 환경변수

`.env.example`의 키를 모두 채워야 합니다. `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `PORT`.
실제 시크릿 값은 `.env`에만 두며 저장소에 커밋하지 않습니다.

## 디렉토리 구조

`docs/5-project-principle.md` §7을 따릅니다. 의존성은 `routes → controllers → services → repositories → PostgreSQL` 단방향으로만 흐르며, SQL은 `repositories/`에만 존재하고 인가 판단은 `services/`에서 합니다.

## API 명세

`swagger.yaml` (OpenAPI 3.0.3)을 참조합니다.
