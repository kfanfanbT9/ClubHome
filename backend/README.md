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
- 테스트: `npm run test:db` (최초 1회, 테스트 DB 생성 + 스키마·시드 적용 + `.env.test` 생성) → `npm test`
  - `npm test`는 `.env.test`의 `DATABASE_URL`(테스트 DB)만 덮어쓰고 JWT 등 나머지는 `.env`에서 읽는다
    (dotenv가 이미 설정된 환경변수를 덮어쓰지 않는 성질을 이용하므로 소스는 손대지 않는다).
  - **`.env.test`가 없으면 `npm test`는 테스트를 하나도 실행하지 않고 즉시 실패한다**(`node --env-file`).
    개발 DB로 조용히 폴백해 픽스처를 쓰는 것을 막기 위한 의도된 동작이므로, 먼저 `npm run test:db`를 실행한다.
  - Node 20.6+ 필요(`--env-file`). 실측 v24.20.0.
- E2E 테스트: 사용자 시나리오(`docs/3-user-scenario.md`) S-01~S-08을 curl로 검증하는 `tests/e2e-scenarios.sh` (70개 단정). **`npm test`에 포함되지 않는다** — `node --test`의 발견 패턴은 `*.test.js`만 잡는다. 별도로 실행한다.

  ```bash
  PORT=3009 node --env-file=.env.test src/server.js &   # 테스트 DB로 띄운다
  bash tests/e2e-scenarios.sh                            # BASE로 대상 변경 가능
  ```

  개발 DB에 붙이면 회원·게시글·예약이 그대로 쌓이므로 **반드시 `--env-file=.env.test`로 띄운 서버를 대상으로 한다.** 실패 시 종료코드 1을 반환한다. 재실행 가능하다(이메일에 시각을 붙이고, 만든 예약을 끝에 모두 취소한다).
- 헬스체크: `GET /health` (인증 불필요)
  - 정상: **200** `{ "status": "ok", "db": "ok" }`
  - DB 연결 실패: **503** `{ "status": "error", "db": "error" }` — 상태코드만 보는 프로브(`curl -f`, 로드밸런서)로도 장애가 감지된다. 실패 사유는 `ERROR 헬스체크 DB 확인 실패` 로그에 스택과 함께 남는다.

## 배포

배포 형태는 **단일 서버**입니다 — 하나의 VM/컨테이너에 Express와 PostgreSQL을 둡니다. 로드밸런서·이중화·별도 로그 수집 인프라(ELK 등)와 CI/CD 파이프라인은 이 프로젝트 범위 밖입니다(원칙 §1·§5, PRD §5).

### 순서

```bash
# 1. 데이터베이스 생성
createdb clubhome                       # 또는 psql -c "CREATE DATABASE clubhome;"

# 2. 스키마 적용 (DDL 단일 소스)
psql -d clubhome -f ../docs/schema.sql

#    운영에는 개발용 시드를 넣지 않는다.
#    docs/seed-dev.sql 은 개발·테스트 편의용 계정과 데이터이며,
#    비밀번호 해시가 저장소에 들어 있으므로 운영에 적용하면 안 된다.

# 3. 환경변수
cp .env.example .env                    # 값을 채운다 (아래 "운영 환경변수" 참조)

# 4. 프론트엔드 프로덕션 빌드
cd ../frontend
npm ci
VITE_API_BASE_URL= npm run build        # dist/ 생성. 빈 값 = 같은 출처로 API 호출

# 5. 백엔드 기동 (프론트까지 함께 서빙)
cd ../backend
npm ci --omit=dev
npm start

# 6. 기동 확인
curl -f http://localhost:3000/health    # 200 {"status":"ok","db":"ok"}
```

### 운영 환경변수

`.env.example`을 복사해 채웁니다. **시크릿은 저장소에 넣지 않습니다** — `.env`는 `.gitignore`에 있고 `.env.example`에는 키 이름만 있습니다.

| 키 | 필수 | 운영 값 예시 |
|---|---|---|
| `DATABASE_URL` | ✅ | `postgresql://clubhome:***@localhost:5432/clubhome` |
| `JWT_ACCESS_SECRET` | ✅ | 충분히 긴 무작위 문자열. **Refresh와 다른 값** |
| `JWT_REFRESH_SECRET` | ✅ | 위와 다른 무작위 문자열 |
| `JWT_ACCESS_EXPIRES_IN` | ✅ | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | ✅ | `14d` |
| `PORT` | | `3000` (미설정 시 기본값) |
| `STATIC_DIR` | | `../frontend/dist` — 단일 서버 배포에서 프론트를 함께 서빙 |
| `CORS_ORIGIN` | | 프론트를 **다른 도메인**에 둘 때만. `STATIC_DIR`을 쓰면 필요 없다 |
| `ENABLE_API_DOCS` | | **운영에서는 비워 둔다.** `/api-docs`에 인증이 없다 |
| `LOG_LEVEL` | | `info` (미설정 시 기본값) |

시크릿 생성 예: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`

JWT Secret이 없으면 서버가 기동하지 않고 즉시 실패합니다(`환경변수 JWT_ACCESS_SECRET 미설정`). 하드코딩 기본값을 두지 않았기 때문입니다 — 값을 잊은 채로 뜨는 것보다 못 뜨는 편이 안전합니다.

### 배포 형태 두 가지

**(가) 단일 출처 — 권장.** `STATIC_DIR`을 프론트 빌드 결과로 지정하면 Express가 정적 파일과 API를 함께 내보냅니다. 프론트와 API가 같은 출처이므로 **CORS 설정이 아예 필요 없습니다.** 정적 서버를 하나 더 두지 않는다는 점에서 "단일 서버" 원칙에 맞습니다.

```bash
# frontend
VITE_API_BASE_URL= npm run build
# backend/.env
STATIC_DIR=../frontend/dist
```

`/boards`처럼 클라이언트 라우트를 주소창에 직접 넣거나 새로고침해도 `index.html`로 폴백해 화면이 뜹니다. `/api/*`와 `/health`는 폴백에서 제외되므로 없는 API는 HTML이 아니라 JSON 404를 받습니다.

**(나) 출처 분리.** 프론트를 별도 도메인(정적 호스팅·CDN)에 두는 경우입니다. 이때는 두 값을 서로 맞춰야 합니다.

```bash
# frontend — 빌드 결과에 이 주소가 박힌다
VITE_API_BASE_URL=https://api.clubhome.example.com npm run build
# backend/.env — 프론트 도메인을 허용 목록에 넣는다
CORS_ORIGIN=https://clubhome.example.com
```

**`VITE_API_BASE_URL`은 빌드 시점에 결과물에 박힙니다.** 런타임에 바꿀 수 없으므로, API 주소가 달라지면 프론트를 다시 빌드해야 합니다. 반대로 (가)에서 이 값을 비우지 않으면 빌드된 프론트가 개발용 주소(`http://localhost:3001`)를 계속 호출합니다 — 배포에서 가장 걸리기 쉬운 지점입니다.

운영은 HTTPS로만 서비스합니다(원칙 §5). TLS 종료는 리버스 프록시나 호스팅 계층에서 처리하며, 이 서버는 평문 HTTP로 그 뒤에 둡니다.

### 기동 확인과 무중단

```bash
curl -f http://localhost:3000/health
```

`GET /health`는 DB 연결까지 확인하고, 실패 시 **503**을 반환합니다. `curl -f`나 컨테이너 헬스체크가 상태코드만 보고도 장애를 감지합니다.

무중단 배포·프로세스 관리자(systemd·pm2 등) 설정은 이 프로젝트 범위 밖입니다. 필요해지면 `npm start`를 감싸고 `/health`를 준비 상태 확인에 쓰면 됩니다.

## CORS

프론트엔드를 다른 포트/도메인에서 띄울 때만 필요합니다. `CORS_ORIGIN`에 허용 origin을 쉼표로 적습니다. **`STATIC_DIR`로 프론트를 함께 서빙하면 같은 출처이므로 설정하지 않아도 됩니다.**

```bash
CORS_ORIGIN=http://localhost:5173,https://clubhome.example.com
```

- **정확히 일치하는 origin만** 허용합니다. 와일드카드 `*`는 지원하지 않으므로 `CORS_ORIGIN=*`로 적으면 아무것도 열리지 않습니다.
- 미설정이면 교차 출처 요청을 전혀 허용하지 않습니다. `Origin` 헤더가 없는 요청(curl, 서버 간 호출, Swagger UI의 Try it out 같은 동일 출처)은 CORS 처리를 타지 않으므로 미설정 상태에서도 그대로 동작합니다.
- 허용된 origin에는 `*`가 아니라 **요청받은 origin을 그대로** 되돌려줍니다. `Vary: Origin`을 항상 붙여 중간 캐시가 다른 origin에 응답을 재사용하지 못하게 합니다.
- preflight(`OPTIONS`)는 **204**로 끝내며 `GET, POST, PATCH, DELETE, OPTIONS` / `Content-Type, Authorization`을 허용하고 결과를 10분간 캐시합니다.
- **`Access-Control-Allow-Credentials`는 두지 않습니다.** 쿠키 세션이 아니라 `Authorization` 헤더의 Bearer 토큰으로 인증하므로(ERD §4 무상태 설계) 자격증명 전송을 열 이유가 없습니다.
- 켜져 있으면 기동 시 `INFO CORS 허용 origin origins=...` 이 남습니다. origin 오타로 막히는 경우를 이 줄로 확인하십시오.

`cors` 패키지를 쓰지 않고 `src/middlewares/cors.js`에 직접 작성했습니다(신규 의존성 0개).

## 로깅

콘솔 출력만 사용합니다(`docs/5-project-principle.md` §5 — 별도 로그 수집 인프라를 두지 않음). 한 이벤트가 한 줄이고, `info`는 stdout, `warn`·`error`는 stderr로 나가므로 파일로 분리할 수 있습니다.

```bash
npm start > app.log 2> error.log     # 정상 트래픽과 문제를 따로 모은다
LOG_LEVEL=warn npm start             # 거부·오류만 본다
```

남기는 지점은 `server.js`·`app.js`·`errorHandler`·`db/pool.js` 네 곳이고, 이벤트는 다음 다섯 가지입니다.

| 지점 | 레벨 | 내용 |
|---|---|---|
| 서버 기동 (`server.js`) | info | `서버 기동 port=3000 logLevel=info` |
| 모든 요청/응답 (`app.js`) | info | `요청 method=POST path=/api/auth/login status=200 duration=82.3ms memberId=1` |
| 의도된 거부 (`errorHandler`) | warn | `요청 거부 status=403 code=BOARD_FORBIDDEN message="..."` — 인증 실패·등급 미달·예약 겹침 등 4xx의 사유 |
| 서버 오류 (`errorHandler`) | error | 5xx는 스택까지 함께 남긴다 |
| 트랜잭션 롤백 (`db/pool.js`) | warn | `트랜잭션 롤백 reason=RESERVATION_SLOT_CONFLICT` |

**요청 본문과 인증 헤더는 로그에 남기지 않습니다.** 회원가입·로그인 본문에는 비밀번호가, `Authorization` 헤더에는 Access Token이 들어 있기 때문입니다. 남기는 값은 메서드·경로·상태코드·소요시간·회원ID뿐입니다.

레벨은 `LOG_LEVEL`(`silent`/`error`/`warn`/`info`, 기본 `info`)로 조절합니다. `npm test` 실행 중에는 231건의 요청 로그가 실패 원인을 덮지 않도록 **기본값이 `silent`** 이며(`node --test`가 설정하는 `NODE_TEST_CONTEXT`로 판별), 테스트 중 로그가 필요하면 `LOG_LEVEL=info npm test`로 켤 수 있습니다.

DB 스키마는 `docs/schema.sql`이 단일 소스이며, 개발용 초기 데이터는 `docs/seed-dev.sql`로 적용합니다.

## 환경변수

필수 키는 `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`입니다. 선택 키는 `PORT`, `STATIC_DIR`, `CORS_ORIGIN`, `ENABLE_API_DOCS`, `LOG_LEVEL`이며 미설정 시 각각 안전한 기본값(끔 또는 기본 포트)으로 동작합니다.

키별 설명과 운영 값은 [배포 → 운영 환경변수](#운영-환경변수) 표에 정리되어 있습니다. `.env.example`에는 키 이름만 있고 값은 비어 있으며, 실제 시크릿은 `.env`에만 두고 저장소에 커밋하지 않습니다.

## 디렉토리 구조

`docs/5-project-principle.md` §7을 따릅니다. 의존성은 `routes → controllers → services → repositories → PostgreSQL` 단방향으로만 흐르며, SQL은 `repositories/`에만 존재하고 인가 판단은 `services/`에서 합니다.

## API 명세

`swagger.yaml` (OpenAPI 3.0.3)이 단일 소스입니다. `.env`에 `ENABLE_API_DOCS=true`를 두고 서버를 띄우면 브라우저에서 확인할 수 있습니다.

| 경로 | 내용 |
|---|---|
| `GET /api-docs` | Swagger UI. 24개 경로·34개 operation을 태그별로 보여주고, **Try it out**으로 실제 호출까지 됩니다 |
| `GET /swagger.yaml` | 스펙 원문(YAML). UI가 브라우저에서 이 URL을 읽어 파싱합니다 |

보호된 엔드포인트(자물쇠 아이콘)를 시험할 때는 `POST /api/auth/login`을 먼저 실행해 받은 `accessToken`을 상단 **Authorize**에 넣습니다. `servers`가 `/`(동일 호스트)이므로 UI가 뜬 주소로 그대로 요청이 나가고 CORS 설정이 필요 없습니다.

### 노출 스위치 (`ENABLE_API_DOCS`)

두 경로에는 **인증이 없습니다.** 그래서 `ENABLE_API_DOCS=true`일 때만 라우터에 등록되며, **미설정·빈 값·`1`·`TRUE`·`yes` 등 그 외 모든 값은 "끔"** 입니다(`'true'` 문자열만 인정).

- 꺼져 있으면 두 경로가 아예 등록되지 않아 다른 없는 경로와 똑같은 404(`NOT_FOUND`)로 떨어집니다 — 기능이 있다는 사실 자체를 알리지 않습니다.
- 꺼져 있으면 `swagger-ui-express`를 `require`하지도 않아 `swagger-ui-dist` 정적 자산이 프로세스에 올라오지 않습니다.
- 켜져 있으면 기동 시 `WARN API 문서 공개 중 - 인증 없이 접근 가능` 이 남습니다. 운영 로그에서 이 줄이 보이면 끄십시오.

기본값을 끔으로 둔 것은 실수 비용이 한쪽으로 치우치기 때문입니다 — 켜는 것을 잊으면 개발 중 문서를 못 보는 정도지만, 끄는 것을 잊으면 운영에서 API 표면 전체가 공개됩니다.
