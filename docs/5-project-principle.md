# 색연필 색소폰 동호회 홈페이지 - 프로젝트 구조 설계 원칙

## 0. 문서 개요
본 문서는 도메인 정의서(`1-domain-definition.md`)와 PRD(`2-PRD.md`)에서 확정된 기술 스택·일정·규모(1인 개발, 2일, 회원 500명 이하/동시접속 20명)를 기준으로, 실제 코드 작성 시 따를 프로젝트 구조·레이어·네이밍·테스트·보안/운영 원칙을 정의한다. 오버엔지니어링을 배제하고 실무에서 바로 적용 가능한 수준으로 작성한다.

## 변경 이력
| Version | Date | Changes | Author |
|---|---|---|---|
| 0.1 | 2026-09-09 | 최초 작성 | Kang SangSoo |
| 0.2 | 2026-09-09 | §1 최상위 원칙에 단일 책임 원칙(SRP) 추가 | Kang SangSoo |
| 0.3 | 2026-09-09 | §3 도메인 용어 ↔ 코드 용어 매핑표에 ERD(7-erd.md v0.2)가 도입한 용어(등급서열 `grade_level`, 관리자 권한 여부 `is_admin`, 비밀번호 해시 `password_hash`, 가입일 `joined_at`, 작성일 `created_at`, 조회수 `view_count`) 추가 | Kang SangSoo |
| 0.4 | 2026-09-09 | §0의 PRD 참조 버전 표기(v0.6→v0.7)를 최신 버전으로 정정. 원칙 본문 변경 없음 | Kang SangSoo |
| 0.5 | 2026-09-10 | 백엔드 구현(BE-01~BE-11) 결과와 어긋난 항목 정정: §7 디렉토리 구조에서 `migrations/`를 제거하고 DDL 단일 소스를 `docs/schema.sql`로 명시, `tests/` 목록을 실제 파일 구성으로 갱신, `swagger.yaml` 추가. §4 테스트 프레임워크를 `node --test`로 확정(기존 "예: Jest"는 예시였음). §3에 `roomId` 허용 범위를 명시(경로·쿼리 파라미터와 이를 받는 지역 인자명까지 허용, repository 인자·SQL 컬럼·응답 필드는 `practiceRoomId`로 고정 — 동의어 금지 조항과 엔드포인트 예시 `:roomId`가 서로 충돌하던 문제 해소) | Kang SangSoo |
| 0.6 | 2026-09-10 | §5 환경변수 목록에 선택 키 절 추가(`LOG_LEVEL`, `ENABLE_API_DOCS`). 기존 목록이 필수 키만 열거해 실제 구현이 읽는 선택 키가 문서에 없었다. 새 선택 키의 기본값은 "가장 닫힌 상태"여야 한다는 판단 기준도 함께 명시 | Kang SangSoo |
| 0.7 | 2026-09-10 | §5 선택 키에 `CORS_ORIGIN` 추가(정확 일치·와일드카드 미지원·미설정 시 전부 차단). "CORS/HTTPS" 항목이 요구하던 환경변수의 실제 키 이름을 명시하고, Bearer 토큰 인증이므로 `Access-Control-Allow-Credentials`를 열지 않는다는 결정도 함께 기록 | Kang SangSoo |
| 0.8 | 2026-09-10 | §8 문서 관리 원칙 신설: 문서 간 참조에 버전 번호를 쓰지 않기로 결정. 종전에는 §0 참조에 버전을 박아, 문서 하나를 고치면 그 문서를 가리키는 모든 문서의 표기와 버전이 연쇄로 올라갔다(선택 키 한 줄 추가에 문서 6개가 움직인 사례). 이 문서 §0의 참조에서도 버전 표기를 제거 | Kang SangSoo |
| 0.9 | 2026-09-10 | 코드베이스 실측 결과 반영: §7 트리에 누락돼 있던 `middlewares/cors.js`·`utils/logger.js`·`tests/e2e-scenarios.sh` 추가. §5의 "로그는 콘솔 출력 수준으로 충분"을 실제 구현대로 **로깅** 항목으로 분리(네 지점, stdout/stderr 분리, 본문·인증 헤더 미기록 기준)하고, **헬스체크** 항목을 분리해 DB 실패 시 503 응답을 명시 | Kang SangSoo |
| 0.12 | 2026-09-10 | FE-02 구현 반영. §6의 "스타일은 `styles/tokens.css` 파일 하나로 끝낸다"를 **`styles/` 아래 두 파일**(`tokens.css` 값 + `app.css` 적용)로 고쳤다 — 인라인 `style` 속성으로는 미디어쿼리와 `:hover`를 쓸 수 없어, 반응형 전환(768px)과 hover가 요구사항에 있는 이상 일반 CSS 파일이 반드시 필요했다. 값과 사용처를 나눠 두면 값을 고칠 때와 화면을 고칠 때 건드릴 파일이 섞이지 않는다. 파일을 더 늘리지 않고 화면이 늘어도 `app.css`에 절을 추가한다는 단서도 함께 명시. §6 트리에 `components/layout/`의 실제 파일 3개 추가 | Kang SangSoo |
| 0.11 | 2026-09-10 | FE-01 착수 결정 반영. §4에서 "테스트 러너는 `node --test` 하나만 쓴다 … 별도 프레임워크를 추가하지 않는다"를 **스택별로 하나씩**으로 고쳤다 — Node 내장 러너에는 DOM과 컴포넌트 렌더링 수단이 없어 프론트엔드 로직을 검증할 방법이 없었고, 그 결과 이 조항이 "프론트는 테스트하지 않는다"와 같은 뜻이 되어 있었다. 프론트엔드는 Vitest + React Testing Library를 쓰고 `src/` 커버리지 80%를 `vite.config.ts`의 `coverage.thresholds`로 강제한다. 자동화 대상도 "UI 세부 스타일 제외"에서 "눈으로 보기 어려운 로직(토큰 재발급·슬롯 판정·권한별 노출·오류 매핑)"으로 구체화했다. 함께 발견한 오류 정정: §4가 "E2E는 범위 외"라고 단정하고 있었으나 `backend/tests/e2e-scenarios.sh`가 이미 S-01~S-08을 자동화하고 있어, API E2E는 있고 브라우저 UI E2E만 범위 외임을 명시했다. §6 트리에 `lib/queryClient.ts`·`tests/`·`vite.config.ts`·`.env.example`을 추가하고 `client.ts` 설명의 "axios/fetch"를 실제 구현대로 fetch로 정정 | Kang SangSoo |
| 0.10 | 2026-09-10 | §6 프론트엔드 구조에 `styles/tokens.css` 추가. 스타일 가이드(`9-style.md`)가 토큰 파일 하나를 전제하는데 이 문서의 트리에 그 자리가 없어, FE-01 착수 시 놓일 위치가 불명확했다. 스타일을 파일 하나로 끝내는 원칙(CSS 변수, CSS-in-JS·Tailwind 미도입)과 `components/common/`을 미리 채우지 않는다는 단서도 함께 명시 | Kang SangSoo |

## 1. 최상위 원칙 (모든 스택 공통)
- **YAGNI**: 지금 PRD의 P0/P1 요구사항에 없는 기능·확장 포인트는 만들지 않는다. "나중에 필요할 것 같아서" 만드는 코드는 금지한다.
- **단순함 우선**: 같은 문제를 해결하는 두 방법이 있으면 코드가 적고 이해하기 쉬운 쪽을 택한다. 클래스/인터페이스/추상화 계층은 실제로 구현체가 2개 이상 필요해질 때만 도입한다.
- **조기 추상화 금지**: 공통화는 동일 패턴이 3회 이상 반복된 뒤에 한다. 회원/게시판/연습실처럼 도메인이 명확히 다른 것을 억지로 하나의 제네릭 구조로 묶지 않는다.
- **요구사항 기준 설계**: 모든 엔티티/필드/API는 도메인 정의서 §2(회원, 회원등급, 게시판/게시글, 연습실, 예약)와 PRD §4 기능 목록에 근거해야 한다. 근거 없는 필드·엔드포인트·테이블을 추가하지 않는다.
- **규모에 맞는 결정**: 마이크로서비스, 이벤트 버스, 별도 캐시 서버, 복잡한 CI/CD 파이프라인 등은 이 프로젝트(1인/2일/동시접속 20명) 범위 밖이다. 단일 Express 서버 + 단일 PostgreSQL 인스턴스로 충분하다.
- **P0 우선, P1은 자리만 남긴다**: 계정상태 자동전이(F-04), 예약 자동완료(F-23) 같은 P1 배치 로직은 스키마/상태값만 반영하고, 실행 코드(스케줄러 등)는 시간이 남을 때만 작성한다.
- **단일 책임 원칙(SRP)**: 함수/모듈/컴포넌트는 "변경될 이유가 하나"만 갖도록 나눈다. 예를 들어 백엔드 service 함수는 하나의 유스케이스(예약 신청, 등급 변경)만 책임지고 그 안에서 인증/응답 포맷팅 같은 다른 관심사를 처리하지 않으며, 프론트 컴포넌트는 화면 조립 또는 데이터 조회 중 하나의 역할만 맡는다. 다만 이 원칙도 §1의 다른 원칙(조기 추상화 금지, 단순함 우선)보다 우선하지 않는다 — 책임을 억지로 잘게 쪼개 파일 수만 늘리지 않는다.

## 2. 의존성/레이어 원칙
공통 원칙: **의존성은 항상 바깥(입력) → 안쪽(데이터) 방향의 단방향으로 흐른다.** 안쪽 레이어는 바깥 레이어를 알지 못한다(역참조 금지).

### 2.1 프론트엔드 레이어
```
페이지/화면 컴포넌트 (pages)
  → UI 컴포넌트 (components) — props로만 데이터 수신, 상태/API 직접 접근 금지
  → 서버 상태 훅 (TanStack Query: features/*/queries.ts, mutations.ts)
  → API 클라이언트 (api/client.ts, api/*.ts) — fetch/axios 래핑, 인증 헤더 처리
  → 클라이언트 상태 (Zustand store) — 로그인 사용자 정보, UI 전역 상태 등 서버 상태가 아닌 것만
```
- 컴포넌트는 TanStack Query 훅을 통해서만 서버 데이터를 가져오고, fetch를 직접 호출하지 않는다.
- Zustand는 "서버에서 온 캐시 데이터"가 아니라 "클라이언트 전용 상태"(로그인 여부, 토큰, 모달 열림 등)만 담당한다. 서버 데이터의 이중 저장(Query 캐시 + Zustand)을 피한다.
- API 클라이언트 레이어는 도메인 지식이 없다. 등급 체크, 예약 규칙 등 비즈니스 판단은 백엔드 응답 기준으로만 하고 프론트는 표시만 한다(단, 즉각적인 UX를 위한 최소한의 클라이언트 검증은 허용).

### 2.2 백엔드 레이어
```
routes (URL·메서드 정의, 인증/인가 미들웨어 부착)
  → controller (요청 파싱, 응답 형식 결정, 입력 유효성 검증 호출)
  → service (비즈니스 로직: 등급 검사, 예약 중복 검사, 트랜잭션 경계)
  → repository/query (pg 기반 SQL 실행 — 이 레이어에만 SQL 문자열이 존재)
  → PostgreSQL
```
- **SQL은 repository(또는 `db/queries/*.js`) 레이어에만 둔다.** controller나 service에서 직접 `pool.query`를 호출하지 않는다. 이렇게 해야 쿼리 재사용과 파라미터 바인딩(SQL 인젝션 방지)이 한 곳에서 관리된다.
- 인가(등급 체크, 본인 소유 여부 체크)는 **service 레이어에서 최종 판단**한다. 라우터의 미들웨어는 "로그인 여부"까지만 걸러주고, "이 게시판 접근 가능한 등급인가", "이 예약이 본인 것인가" 같은 도메인 규칙은 서비스 코드가 책임진다.
- 트랜잭션(예: 예약 신청 시 중복 슬롯 검사 + INSERT를 원자적으로 처리)은 service 레이어에서 `BEGIN/COMMIT`을 명시적으로 연다.
- 레이어를 5개 이상으로 쪼개거나(DTO 변환 레이어, 도메인 모델 레이어 등) DDD 스타일 애그리거트를 도입하지 않는다.

## 3. 코드/네이밍 원칙
- **파일명**: kebab-case 사용 (예: `member-service.js`, `practice-room-routes.js`, `MemberList.tsx`는 React 컴포넌트만 PascalCase 예외로 허용).
- **변수/함수명**: camelCase. 불리언은 `is/has` 접두사 (`isActive`, `hasReservation`).
- **DB 테이블/컬럼**: snake_case (PostgreSQL 관례). 테이블명은 복수형 (`members`, `member_grades`, `boards`, `posts`, `practice_rooms`, `reservations`).
- **도메인 용어 일관성**: 도메인 정의서의 한글 용어를 코드의 영문 용어로 1:1 매핑해 전 레이어(DB 컬럼 - SQL - service - API 응답 필드 - 프론트 타입)에서 동일하게 사용한다.

| 도메인 용어 | 코드 용어 |
|---|---|
| 회원 | `member` |
| 회원등급 | `memberGrade` / `member_grade` |
| 계정상태 | `accountStatus` (`active`/`dormant`/`withdrawn`) |
| 등급서열 | `gradeLevel` / `grade_level` (정수, 높을수록 상위 등급) |
| 관리자 권한 여부 | `isAdmin` / `is_admin` (최상위 등급 = 관리자, 도메인 정의서 §2.2) |
| 비밀번호(해시) | `passwordHash` / `password_hash` (평문 저장 금지) |
| 가입일 | `joinedAt` / `joined_at` |
| 게시판 | `board` |
| 게시글 | `post` |
| 이용가능 최소등급 | `minGradeLevel` / `min_grade_level` |
| 작성일 | `createdAt` / `created_at` |
| 조회수 | `viewCount` / `view_count` |
| 사용여부 | `isActive` / `is_active` |
| 연습실 | `practiceRoom` / `practice_room` |
| 예약 | `reservation` |
| 예약상태 | `reservationStatus` (`reserved`/`completed`/`canceled`) |

- 위 매핑을 벗어나는 동의어(예: `room`, `member_level`, `article` 등)는 사용하지 않는다. 새 용어가 필요하면 이 표와 도메인 정의서를 함께 갱신한다.
- API 엔드포인트는 리소스 복수형 기준 REST 경로를 쓴다: `/api/members`, `/api/boards/:boardId/posts`, `/api/practice-rooms/:roomId/reservations`.
- 위 경로의 `:roomId`와 목록 필터 `?roomId=`는 **경로 파라미터·쿼리 파라미터 이름으로만 허용하는 축약 표기**다(경로에 `practice-rooms`가 이미 있어 `:practiceRoomId`는 중복이다). 이 값을 그대로 받는 controller·service 함수의 지역 인자명까지는 `roomId`로 두어도 되지만, **외부에 고정되는 이름 — repository 인자·SQL 컬럼·API 응답 필드 — 에는 예외 없이 `practiceRoomId` / `practice_room_id`를 쓴다.** 동의어 금지 조항이 지키려는 것은 저장·공개되는 어휘의 일관성이므로, 경계를 여기에 둔다.

## 4. 테스트/품질 원칙
**PRD §9에 명시된 P0 핵심 시나리오**를 자동화 테스트의 중심에 둔다. 커버리지 목표는 스택별로 다르다 — 백엔드는 수치 목표 없이 아래 "우선 테스트 대상"만 덮고, 프론트엔드는 `src/` 기준 80%를 목표로 한다(`frontend/vite.config.ts`의 `coverage.thresholds`에 박아 CI 없이도 강제된다).

우선 테스트 대상 (자동화):
- 로그인/인증: JWT 발급, 만료된 Access Token으로 접근 시 거부, Refresh Token 재발급
- 등급별 게시판 접근 제어: 등급 미달 회원의 열람/작성 차단
- 예약 중복 방지: 동일 연습실·중복 슬롯 예약 시도 거부, 연속 슬롯 정상 예약
- 게시글/예약 소유권 검사: 본인 또는 관리자만 수정/삭제/취소 가능

- 위 항목은 service 레이어 단위로 최소 1개의 성공 케이스 + 1개의 실패(거부) 케이스만 작성한다.
- **러너는 스택별로 하나씩만 쓴다.** 백엔드는 Node 내장 `node --test`(신규 의존성 0개), 프론트엔드는 Vitest + React Testing Library다. 프론트엔드에 별도 러너가 필요한 이유는 Node 내장 러너에 브라우저 DOM과 컴포넌트 렌더링 수단이 없기 때문이고, Vitest는 이미 쓰는 Vite의 설정·변환을 그대로 재사용하므로 빌드 설정이 두 벌로 갈라지지 않는다. 각 스택 안에서 러너를 또 늘리지는 않는다.
- 백엔드 테스트는 개발 DB를 쓰지 않고 별도 테스트 DB(`.env.test`의 `DATABASE_URL`)에서 실행한다 — 준비 절차는 `backend/README.md`를 따른다.
- 단순 CRUD(게시판 목록 조회 등)와 **UI의 시각적 세부(색·여백·정렬)는 자동화 테스트를 만들지 않고 눈으로 확인한다.** 프론트엔드에서 자동화하는 대상은 눈으로 보기 어려운 로직 — 토큰 재발급 분기, 연속 슬롯 선택 판정, 권한에 따른 메뉴·버튼 노출, 서버 오류코드 → 안내문 매핑 — 이다.
- 성능/부하 테스트와 접근성 테스트는 범위 외 (PRD §3 Out of Scope, §9 가정사항과 일치). 시나리오 E2E는 백엔드 API에 한해 `backend/tests/e2e-scenarios.sh`로 자동화돼 있고(S-01~S-08), 브라우저를 구동하는 UI E2E는 범위 외다.

## 5. 설정/보안/운영 원칙
- **환경변수**: `.env` 파일(git 미포함, `.gitignore` 등록)로 관리. 최소 다음 키를 포함한다.
  - `DATABASE_URL` (또는 `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE`)
  - `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
  - `JWT_ACCESS_EXPIRES_IN`(예: `1h`), `JWT_REFRESH_EXPIRES_IN`(예: `14d`)
  - `PORT`

  선택 키(미설정이어도 서버가 기동되며, 각각 안전한 기본값을 갖는다):
  - `LOG_LEVEL` — 콘솔 로그 레벨(`silent`/`error`/`warn`/`info`, 기본 `info`). 운영에서 요청 로그를 줄이려면 `warn`으로 낮춘다.
  - `CORS_ORIGIN` — CORS 허용 origin을 쉼표로 구분해 나열한다(예: `http://localhost:5173`). **정확히 일치하는 origin만** 허용하며 와일드카드 `*`는 지원하지 않고, **미설정이면 교차 출처 요청을 전혀 허용하지 않는다.** `Origin` 헤더가 없는 요청(curl·서버 간 호출·동일 출처)은 CORS 판정을 거치지 않으므로 미설정 상태가 기존 동작을 바꾸지 않는다. 아래 "CORS/HTTPS" 항목이 요구하는 환경변수 관리가 이 키다.
  - `ENABLE_API_DOCS` — `'true'`일 때만 `GET /api-docs`(Swagger UI)와 `GET /swagger.yaml`을 등록한다. **기본값은 끔**이며 그 외 모든 값(`1`·`TRUE`·`yes`·빈 값 포함)도 끔으로 취급한다. 두 경로에 인증이 없으므로 켜면 API 표면 전체가 공개되기 때문에, "명시적으로 켜야 열린다"를 기본값으로 삼는다.

  선택 키는 값이 아니라 **동작 범위**를 정하므로 `.env.example`에도 키 이름을 남긴다. 새 선택 키를 추가할 때는 기본값이 "가장 닫힌 상태"인지 먼저 확인한다.
- **시크릿 관리**: JWT Secret은 코드/저장소에 절대 하드코딩하지 않는다. `.env.example`에는 키 이름만 남기고 값은 비워둔다.
- **비밀번호**: bcrypt(또는 동급 라이브러리)로 해시 저장. 평문 비교/저장 금지.
- **인가 체크 위치**: §2.2 원칙대로 service 레이어에서 최종 검사한다. 라우터 미들웨어는 JWT 검증(로그인 여부, 회원ID 추출)만 담당하고, "관리자 전용", "본인 소유 확인", "등급 기준 충족" 판단은 각 service 함수 내부에서 매번 명시적으로 수행한다(공통 미들웨어 하나로 모든 인가를 처리하려 하지 않는다 — 리소스별 규칙이 다르기 때문).
- **입력 검증**: controller 진입 시점에 필수값/타입/길이를 검증한다(간단한 수작업 검증 또는 가벼운 라이브러리 1개, 예: `zod`/`express-validator` 중 택1 — 신규 검증 프레임워크를 여러 개 들이지 않는다).
- **SQL 인젝션 방지**: 모든 쿼리는 `pg`의 파라미터 바인딩(`$1, $2...`)만 사용한다. 문자열 concat으로 쿼리를 조립하지 않는다.
- **배포/운영**: 단일 서버(예: 단일 VM/컨테이너)에 Express 앱 + PostgreSQL을 구성한다. 별도 로드밸런서/이중화는 두지 않는다(PRD §5 가용성 요구사항과 일치). 별도 로그 수집 인프라(ELK 등)는 두지 않는다.
- **로깅**: 콘솔 출력(+파일 리다이렉트)만 쓴다. `utils/logger.js`가 `console`만 감싸며 신규 의존성이 없다. 한 이벤트 = 한 줄이고 `info`는 stdout, `warn`·`error`는 stderr로 나가 파일 단위로 분리할 수 있다. 남기는 지점은 네 곳이다.
  - `server.js` 기동 / `app.js` 모든 요청·응답(메서드·경로·상태·소요시간·회원ID) / `errorHandler` 거부 사유(4xx는 사유만, 5xx는 스택) / `db/pool.js` 트랜잭션 롤백.
  - **요청 본문과 인증 헤더는 남기지 않는다.** 회원가입·로그인 본문에 비밀번호가, `Authorization`에 Access Token이 들어 있다. 로그에 남길 값을 늘릴 때는 이 기준을 먼저 통과시킨다.
- **헬스체크**: `GET /health` 하나로 DB 연결(`SELECT 1`)까지 확인한다. **DB 연결이 실패하면 200이 아니라 503으로 응답한다** — 상태코드만 보는 프로브가 대부분이므로 200을 주면서 본문에만 실패를 담으면 장애가 감지되지 않는다.
- **CORS/HTTPS**: 프론트/백엔드 도메인이 다르면 CORS 허용 origin을 환경변수(`CORS_ORIGIN`, 위 선택 키 참고)로 관리하고, 운영 환경은 HTTPS로만 서비스한다. 쿠키 세션이 아니라 `Authorization` 헤더의 Bearer 토큰으로 인증하므로(ERD §4 무상태 설계) `Access-Control-Allow-Credentials`는 열지 않는다.

## 6. 프론트엔드 디렉토리 구조
```
frontend/
├── src/
│   ├── main.tsx
│   ├── App.tsx                 # 라우팅 정의
│   ├── pages/                  # 화면 단위 (URL과 1:1)
│   │   ├── LoginPage.tsx
│   │   ├── BoardListPage.tsx
│   │   ├── PostDetailPage.tsx
│   │   ├── PracticeRoomReservationPage.tsx
│   │   └── admin/
│   │       ├── MemberGradeAdminPage.tsx
│   │       ├── BoardAdminPage.tsx
│   │       └── PracticeRoomAdminPage.tsx
│   ├── components/              # 여러 페이지에서 재사용하는 UI 조각
│   │   ├── layout/
│   │   │   ├── Layout.tsx        # Header + Outlet, 모든 화면의 부모 라우트
│   │   │   ├── Header.tsx        # 상단 네비게이션, 햄버거 펼침 상태
│   │   │   └── NavMenu.tsx       # 메뉴 링크 목록 (props만 받는 UI 조각)
│   │   └── common/               # Button, Modal, Table 등
│   ├── features/                 # 도메인 단위 폴더 (API 훅 + 타입 + 스토어)
│   │   ├── auth/
│   │   │   ├── authStore.ts      # Zustand: 로그인 사용자, 토큰
│   │   │   └── useAuth.ts        # 로그인/로그아웃 mutation
│   │   ├── member/
│   │   │   └── useMemberQueries.ts
│   │   ├── board/
│   │   │   └── useBoardQueries.ts
│   │   ├── practiceRoom/
│   │   │   └── useReservationQueries.ts
│   │   └── admin/
│   │       └── useAdminQueries.ts
│   ├── api/
│   │   ├── client.ts             # fetch 래퍼, 인증 헤더 주입 + 토큰 재발급 인터셉터
│   │   └── endpoints.ts          # API 경로 상수
│   ├── styles/
│   │   ├── tokens.css            # 색상·타이포·간격 CSS 변수 (스타일 가이드 §3~§5)
│   │   └── app.css               # 그 변수를 쓰는 컴포넌트 스타일 (스타일 가이드 §6)
│   ├── types/                     # 도메인 타입 (Member, Board, Post, PracticeRoom, Reservation)
│   └── lib/                       # 날짜 포맷 등 순수 유틸
│       └── queryClient.ts        # QueryClient 생성 + 재시도 정책
├── tests/                          # Vitest. 파일명은 검증 대상과 같게 둔다(client.test.ts 등)
│   └── setup.ts                    # jest-dom 매처 등록
├── index.html
├── package.json
├── vite.config.ts                  # Vite + Vitest 설정(커버리지 임계값 포함)
├── .env.example                    # VITE_API_BASE_URL (실제 값은 .env, git 미포함)
└── tsconfig.json
```
- 테스트는 `src/` 옆에 흩지 않고 `tests/` 한 곳에 모은다 — `backend/tests/`와 같은 배치라 저장소 안에서 테스트를 찾는 방법이 스택마다 달라지지 않는다.
- `api/endpoints.ts`에는 **지금 화면이 부르는 경로만** 둔다. swagger의 24개 경로를 미리 옮겨 적지 않고, 화면을 추가하는 이슈에서 그 화면이 쓰는 경로를 함께 넣는다(§1 YAGNI).
- `features/*`는 "도메인당 하나의 폴더"만 유지하고, 그 안을 다시 세분화(entities/, hooks/, model/ 등)하지 않는다.
- **스타일은 `styles/` 아래 두 파일로 끝낸다** — `tokens.css`(값의 단일 출처)와 `app.css`(그 값을 쓰는 컴포넌트 스타일). `main.tsx`에서 순서대로 한 번 import하고, 컴포넌트는 색·크기·간격을 직접 쓰지 않고 `var(--...)`로만 참조한다. 토큰 값과 화면별 적용 규칙은 스타일 가이드(`9-style.md`)가 정의하며, 이 문서는 그 파일이 놓이는 자리만 규정한다.
  - 컴포넌트 스타일을 인라인 `style` 속성으로 두지 않는 이유는 인라인으로는 미디어쿼리와 `:hover`를 쓸 수 없기 때문이다. 반응형 전환(768px)과 hover 상태가 화면 요구사항에 들어 있으므로 일반 CSS 파일이 필요하다.
  - 파일을 더 늘리지 않는다. 화면이 늘어도 `app.css`에 절을 추가하는 쪽을 택한다 — 14개 화면 규모에서 파일을 쪼개면 어떤 클래스가 어디 있는지 찾는 비용이 더 크다.
  - CSS-in-JS, Tailwind, 별도 테마 프로바이더를 도입하지 않는다(PRD §7 "디자인 시스템/컴포넌트 라이브러리 신규 구축 없이"). 토큰을 CSS 변수로 두면 런타임 의존성이 0이고, 다크 모드 같은 요구가 생겨도 `:root` 재정의로 확장할 수 있다.
  - `components/common/`에 Button·Modal·Table을 **미리 만들지 않는다.** 같은 패턴이 3회 반복된 뒤에 공통화한다(§1 조기 추상화 금지). 위 트리의 해당 항목은 그때 만들 자리를 표시한 것이다.

## 7. 백엔드 디렉토리 구조
```
backend/
├── src/
│   ├── app.js                   # Express 앱 생성, 미들웨어 등록
│   ├── server.js                 # 서버 실행 진입점 (app.listen)
│   ├── db/
│   │   └── pool.js               # pg Pool 인스턴스 (커넥션 풀링)
│   ├── middlewares/
│   │   ├── auth.js               # JWT 검증 (로그인 여부만 확인)
│   │   ├── cors.js               # 허용 목록 기반 CORS (CORS_ORIGIN)
│   │   ├── errorHandler.js       # 표준화된 에러 응답
│   │   └── validate.js           # 입력 유효성 검증 헬퍼
│   ├── routes/
│   │   ├── index.js
│   │   ├── auth-routes.js
│   │   ├── member-routes.js
│   │   ├── board-routes.js
│   │   ├── post-routes.js
│   │   ├── practice-room-routes.js
│   │   ├── reservation-routes.js
│   │   └── admin-routes.js
│   ├── controllers/
│   │   ├── auth-controller.js
│   │   ├── member-controller.js
│   │   ├── board-controller.js
│   │   ├── post-controller.js
│   │   ├── practice-room-controller.js
│   │   ├── reservation-controller.js
│   │   └── admin-controller.js
│   ├── services/                 # 비즈니스 로직 + 인가 판단 + 트랜잭션
│   │   ├── auth-service.js
│   │   ├── member-service.js
│   │   ├── board-service.js
│   │   ├── post-service.js
│   │   ├── practice-room-service.js
│   │   └── reservation-service.js
│   ├── repositories/              # SQL 전용 (pg 파라미터 바인딩)
│   │   ├── member-repository.js
│   │   ├── member-grade-repository.js
│   │   ├── board-repository.js
│   │   ├── post-repository.js
│   │   ├── practice-room-repository.js
│   │   └── reservation-repository.js
│   └── utils/
│       ├── jwt.js                # 토큰 발급/검증 헬퍼
│       ├── logger.js             # 콘솔 로거 (LOG_LEVEL, §5 참고)
│       └── password.js           # bcrypt 해시/비교
├── tests/                         # node --test 대상 (파일명 *.test.js)
│   ├── setup-test-db.js               # 테스트 DB·스키마·시드·.env.test 준비
│   │                                  #   (러너 발견 패턴에 걸리지 않는 파일명을 의도적으로 사용)
│   ├── auth-service.test.js           # 원칙 §4 항목 1: 인증
│   ├── board-api.test.js              # 원칙 §4 항목 2: 등급 기반 게시판 접근 제어
│   ├── reservation-service.test.js    # 원칙 §4 항목 3: 예약 중복 방지
│   ├── post-api.test.js               # 원칙 §4 항목 4: 소유권 검사
│   ├── (그 외 엔드포인트별 *-api.test.js)
│   └── e2e-scenarios.sh               # 사용자 시나리오 S-01~S-08 curl E2E
│                                      #   (`npm test`에 포함되지 않는다 - 별도 실행)
├── .env.example
├── swagger.yaml                   # OpenAPI 3.0.3 API 명세
├── package.json
└── README.md
```
- **DB 스키마 파일은 `backend/` 아래 두지 않는다.** DDL의 단일 소스는 `docs/schema.sql`(개발용 초기 데이터는 `docs/seed-dev.sql`)이며, ERD 문서와 같은 위치에서 함께 갱신한다. 2일 일정·1인 개발 규모에서 스키마 변경은 "문서와 DDL을 함께 고쳐 다시 적용"으로 충분하므로 순번 마이그레이션 체계는 두지 않는다.
- `repositories/`와 `services/`를 더 잘게 쪼개지 않는다(도메인당 파일 1개 원칙). 관리자 기능(F-30~32)은 기존 도메인 서비스에 관리자용 함수를 추가하는 방식으로 처리하고 별도 `admin-service.js`를 만들지 않는다. 다만 관리자 엔드포인트는 요청 파싱·응답 형식이 일반 회원용과 다르므로 `admin-controller.js`·`admin-routes.js`는 별도로 둔다(위 구조 참고).
- `tests/`는 원칙 §4의 4개 항목을 service 레이어에서 직접 검증하는 파일을 기준으로 삼되, 그 항목이 이미 엔드포인트 테스트에 포함되어 있으면 같은 내용을 service 전용 파일로 다시 만들지 않는다(§1 YAGNI).

## 8. 문서 관리 원칙

- **문서 간 참조에는 버전 번호를 쓰지 않는다.** 다른 문서를 가리킬 때는 문서명과 경로만 적는다(예: "도메인 정의서(`1-domain-definition.md`)"). `docs/`의 문서는 항상 최신본 하나만 존재하므로 참조가 가리키는 대상에 모호함이 없다.
  - 이유: 참조에 버전을 박으면 문서 하나를 고칠 때마다 그 문서를 가리키는 모든 문서의 표기를 고쳐야 하고, 그 표기 수정이 다시 각 문서의 버전을 올려 연쇄를 일으킨다. 실제로 선택 키 한 줄을 추가하는 변경에 문서 6개가 함께 움직였다. 연쇄된 수정은 내용 변경이 아니어서 이력만 늘리고 리뷰 가치는 없다.
  - **변경 이력 표의 과거 기록은 그대로 둔다.** "ERD v0.5→v0.6 정정"처럼 그 시점의 사실을 남긴 문장은 역사이며, 소급해 고치면 이력의 의미가 사라진다.
  - 특정 시점의 내용을 가리켜야 할 때만 예외적으로 버전을 적고, 왜 그 버전인지 함께 쓴다.
- **각 문서는 수정될 때마다 자기 변경 이력 표에 한 줄을 추가하고 자기 버전을 올린다.** 다른 문서의 변경 때문에 올리는 일은 위 규칙에 따라 더 이상 발생하지 않는다.
- **`docs/`의 문서와 그 문서가 규정하는 산출물은 함께 갱신한다.** ERD ↔ `schema.sql`, 와이어프레임 ↔ `docs/wireframes/*.svg`, API 명세 ↔ `backend/swagger.yaml`이 각각 한 쌍이다.
