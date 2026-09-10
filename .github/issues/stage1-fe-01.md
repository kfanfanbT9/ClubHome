## Todo (해야 할 일)

- [ ] Vite + React 19 + TypeScript 프로젝트 생성, Zustand·TanStack Query·라우터 설치
- [ ] 프로젝트 구조 원칙 §6 디렉토리 골격 생성(`pages`/`components`/`features`/`api`/`types`/`lib`)
- [ ] `api/client.ts`: 인증 헤더 주입 + Access Token 만료 시 Refresh 재발급 인터셉터
- [ ] `features/auth/authStore.ts`: Zustand로 로그인 사용자·토큰 관리(서버 데이터 이중 저장 금지)
- [ ] `types/`에 도메인 타입 정의(Member, MemberGrade, Board, Post, PracticeRoom, Reservation)

## 완료 조건

- [ ] `npm run dev`로 개발 서버가 기동되고 초기 화면이 렌더링된다
- [ ] TanStack Query Provider와 라우터가 앱 루트에 적용되어 있다
- [ ] 도메인 타입 필드명이 ERD 컬럼·용어 매핑표(원칙 §3)와 일치한다
- [ ] 컴포넌트에서 `fetch`를 직접 호출하지 않고 `api/client.ts`를 경유한다

## 기술적 고려사항

- Zustand는 클라이언트 전용 상태(로그인 여부, 토큰, UI 상태)만 담당하고 서버에서 온 데이터는 TanStack Query 캐시에만 둔다. 서버 데이터의 이중 저장을 만들지 않는다 (프로젝트 구조 설계 원칙 §2.1).
- 재발급 인터셉터는 `POST /api/auth/refresh` 200 응답으로 Access Token을 교체한 뒤 원 요청을 재개하고, Refresh Token까지 401이면 로그아웃 처리한다 (swagger `/api/auth/refresh`, PRD F-02).
- API 클라이언트 레이어는 도메인 지식을 갖지 않는다. 등급 체크·예약 규칙 판단은 백엔드 응답 기준으로만 하고 프론트는 표시만 한다(즉각적 UX용 최소 검증은 허용) (원칙 §2.1).
- 타입 필드명은 용어 매핑표를 그대로 따른다: `gradeLevel`, `isAdmin`, `minGradeLevel`, `viewCount`, `isActive`, `accountStatus`, `reservationStatus`. `room`·`article` 같은 동의어는 사용하지 않는다 (원칙 §3).
- `features/*`는 도메인당 폴더 하나만 유지하고 내부를 다시 세분화(entities/, model/ 등)하지 않는다 (원칙 §6).

## 의존성

- **관련 F-ID / 화면**: 없음 (기반 작업, 이후 화면 2~14 전체의 전제)
- **참조 문서**: `docs/5-project-principle.md` (v0.4) §2.1·§3·§6, `docs/2-PRD.md` (v0.7) §6, `docs/7-erd.md` (v0.5) §2, `backend/swagger.yaml` `components.schemas`

## 선행 작업 / 후행 작업

- **선행 작업**: 없음
- **후행 작업**: `FE-02`
