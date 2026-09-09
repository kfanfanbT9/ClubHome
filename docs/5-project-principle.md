# 색연필 색소폰 동호회 홈페이지 - 프로젝트 구조 설계 원칙

## 0. 문서 개요
본 문서는 도메인 정의서(`1-domain-definition.md`, v0.6)와 PRD(`2-PRD.md`, v0.7)에서 확정된 기술 스택·일정·규모(1인 개발, 2일, 회원 500명 이하/동시접속 20명)를 기준으로, 실제 코드 작성 시 따를 프로젝트 구조·레이어·네이밍·테스트·보안/운영 원칙을 정의한다. 오버엔지니어링을 배제하고 실무에서 바로 적용 가능한 수준으로 작성한다.

## 변경 이력
| Version | Date | Changes | Author |
|---|---|---|---|
| 0.1 | 2026-09-09 | 최초 작성 | Kang SangSoo |
| 0.2 | 2026-09-09 | §1 최상위 원칙에 단일 책임 원칙(SRP) 추가 | Kang SangSoo |
| 0.3 | 2026-09-09 | §3 도메인 용어 ↔ 코드 용어 매핑표에 ERD(7-erd.md v0.2)가 도입한 용어(등급서열 `grade_level`, 관리자 권한 여부 `is_admin`, 비밀번호 해시 `password_hash`, 가입일 `joined_at`, 작성일 `created_at`, 조회수 `view_count`) 추가 | Kang SangSoo |
| 0.4 | 2026-09-09 | §0의 PRD 참조 버전 표기(v0.6→v0.7)를 최신 버전으로 정정. 원칙 본문 변경 없음 | Kang SangSoo |

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

## 4. 테스트/품질 원칙
1인 개발·2일 일정에서 전체 커버리지 목표는 세우지 않는다. **PRD §9에 명시된 P0 핵심 시나리오**를 중심으로 최소한의 자동화 테스트만 작성하고, 나머지는 수동 확인으로 대체한다.

우선 테스트 대상 (자동화):
- 로그인/인증: JWT 발급, 만료된 Access Token으로 접근 시 거부, Refresh Token 재발급
- 등급별 게시판 접근 제어: 등급 미달 회원의 열람/작성 차단
- 예약 중복 방지: 동일 연습실·중복 슬롯 예약 시도 거부, 연속 슬롯 정상 예약
- 게시글/예약 소유권 검사: 본인 또는 관리자만 수정/삭제/취소 가능

- 위 항목은 service 레이어 단위로 최소 1개의 성공 케이스 + 1개의 실패(거부) 케이스만 작성한다(테스트 프레임워크는 이미 익숙한 것, 예: Jest, 하나만 선택).
- 단순 CRUD(게시판 목록 조회 등)나 프론트 UI 세부 스타일은 자동화 테스트를 만들지 않고 눈으로 확인한다.
- E2E, 성능/부하 테스트, 접근성 테스트는 범위 외 (PRD §3 Out of Scope, §9 가정사항과 일치).

## 5. 설정/보안/운영 원칙
- **환경변수**: `.env` 파일(git 미포함, `.gitignore` 등록)로 관리. 최소 다음 키를 포함한다.
  - `DATABASE_URL` (또는 `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE`)
  - `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
  - `JWT_ACCESS_EXPIRES_IN`(예: `1h`), `JWT_REFRESH_EXPIRES_IN`(예: `14d`)
  - `PORT`
- **시크릿 관리**: JWT Secret은 코드/저장소에 절대 하드코딩하지 않는다. `.env.example`에는 키 이름만 남기고 값은 비워둔다.
- **비밀번호**: bcrypt(또는 동급 라이브러리)로 해시 저장. 평문 비교/저장 금지.
- **인가 체크 위치**: §2.2 원칙대로 service 레이어에서 최종 검사한다. 라우터 미들웨어는 JWT 검증(로그인 여부, 회원ID 추출)만 담당하고, "관리자 전용", "본인 소유 확인", "등급 기준 충족" 판단은 각 service 함수 내부에서 매번 명시적으로 수행한다(공통 미들웨어 하나로 모든 인가를 처리하려 하지 않는다 — 리소스별 규칙이 다르기 때문).
- **입력 검증**: controller 진입 시점에 필수값/타입/길이를 검증한다(간단한 수작업 검증 또는 가벼운 라이브러리 1개, 예: `zod`/`express-validator` 중 택1 — 신규 검증 프레임워크를 여러 개 들이지 않는다).
- **SQL 인젝션 방지**: 모든 쿼리는 `pg`의 파라미터 바인딩(`$1, $2...`)만 사용한다. 문자열 concat으로 쿼리를 조립하지 않는다.
- **배포/운영**: 단일 서버(예: 단일 VM/컨테이너)에 Express 앱 + PostgreSQL을 구성한다. 별도 로드밸런서/이중화는 두지 않는다(PRD §5 가용성 요구사항과 일치). 로그는 콘솔 출력(+파일 리다이렉트) 수준으로 충분하며, 별도 로그 수집 인프라(ELK 등)는 두지 않는다. 헬스체크는 `GET /health` 하나로 DB 연결 확인 정도만 응답한다.
- **CORS/HTTPS**: 프론트/백엔드 도메인이 다르면 CORS 허용 origin을 환경변수로 관리하고, 운영 환경은 HTTPS로만 서비스한다.

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
│   │   ├── layout/              # Header, Nav 등
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
│   │   ├── client.ts             # axios/fetch 인스턴스, 인증 헤더/토큰 재발급 인터셉터
│   │   └── endpoints.ts          # API 경로 상수
│   ├── types/                     # 도메인 타입 (Member, Board, Post, PracticeRoom, Reservation)
│   └── lib/                       # 날짜 포맷 등 순수 유틸
├── index.html
├── package.json
└── tsconfig.json
```
- `features/*`는 "도메인당 하나의 폴더"만 유지하고, 그 안을 다시 세분화(entities/, hooks/, model/ 등)하지 않는다.

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
│       └── password.js           # bcrypt 해시/비교
├── migrations/                    # SQL 마이그레이션 파일 (순번 접두사)
│   ├── 001_create_members.sql
│   ├── 002_create_member_grades.sql
│   ├── 003_create_boards_posts.sql
│   └── 004_create_practice_rooms_reservations.sql
├── tests/
│   ├── auth-service.test.js
│   ├── board-service.test.js
│   └── reservation-service.test.js
├── .env.example
├── package.json
└── README.md
```
- `repositories/`와 `services/`를 더 잘게 쪼개지 않는다(도메인당 파일 1개 원칙). 컨트롤러 없이 서비스만 있는 관리자 기능(F-30~32)은 기존 도메인 서비스에 관리자용 함수를 추가하는 방식으로 처리하고 별도 "admin domain"을 새로 만들지 않는다.
