# WBS 이슈 등록 세트 (색연필 색소폰 동호회 홈페이지)

`docs/8-plan.md` (v0.4)의 24개 Task를 GitHub 이슈로 등록하기 위한 페이로드와 실행 스크립트다.
Stage 구분은 8-plan.md §5 "2일 실행 순서"를 그대로 따른다.

- 이슈 본문: Task별 마크다운 24개 (`stage<N>-<task-id>.md`)
- 실행 스크립트: [`create-issues.sh`](./create-issues.sh)
- 실행 결과 매핑: `issue-map.txt` (스크립트가 생성)

---

## 1. 실행 방법

```bash
# 1) 선행 조건 - GitHub CLI 인증
gh auth login
gh auth status

# 2) 저장소 워킹 디렉토리에서 실행 (gh가 git remote로 대상 저장소 판별)
bash .github/issues/create-issues.sh

# 문법만 검사 (생성하지 않음)
bash -n .github/issues/create-issues.sh

# 확인 프롬프트 건너뛰기 / 교차 링크 코멘트 건너뛰기
YES=1 bash .github/issues/create-issues.sh
CROSSLINK=0 bash .github/issues/create-issues.sh
```

스크립트 동작 순서

1. `gh` 설치·인증 확인 (미인증이면 즉시 종료)
2. 라벨 11개 생성 (`gh label create ... --force` — 이미 있으면 색상·설명 갱신)
3. 이슈 24개 생성 (`gh issue create --title ... --label ... --body-file ...`)
4. **DB-01·DB-02**는 생성 직후 검증 완료 내역을 코멘트로 남기고 `gh issue close`
5. 각 이슈에 선행/후행 Task를 **이슈 번호로 교차 링크**하는 코멘트 추가
6. `issue-map.txt`에 Task ID → 이슈 URL 매핑 기록

> ⚠ **재실행 시 중복 생성 위험**: `gh issue create`는 멱등하지 않다. 두 번 실행하면 같은 제목의 이슈가 한 벌 더 생긴다. 중간 실패 시에는 `gh issue list --limit 50`으로 확인한 뒤 스크립트의 `mk` 호출 중 이미 생성된 줄을 주석 처리하고 남은 것만 실행하라.

---

## 2. 라벨 체계 (3축)

### 종류 (type) — 작업 성격

| 라벨 | 색상 | 설명 | 해당 Task |
|---|---|---|---|
| `type:feature` | `#1d76db` | 기능 구현: PRD F-ID 또는 와이어프레임 화면에 대응하는 API/화면 작업 | BE-02~BE-10, FE-02~FE-09 (17) |
| `type:setup` | `#5319e7` | 착수 준비: 프로젝트 골격 생성, 개발용 초기 데이터 구성 (F-ID 없음) | DB-02, BE-01, FE-01 (3) |
| `type:test` | `#0e8a16` | 검증: service 레이어 자동화 테스트 및 시나리오 통합 점검 | BE-11, IT-01 (2) |
| `type:infra` | `#d93f0b` | 인프라/운영: DB 스키마 적용, 환경변수·CORS·배포 준비 | DB-01, IT-02 (2) |

구분 기준: 8-plan.md §2 표의 "관련 F-ID / 화면" 열에 F-ID·화면이 있으면 `feature`, 없으면 성격에 따라 `setup`/`test`/`infra`.

### 영역 (area) — Task ID 접두사와 1:1

| 라벨 | 색상 | 설명 | 개수 |
|---|---|---|---|
| `area:database` | `#006b75` | PostgreSQL 스키마·초기 데이터 (DB-nn) | 2 |
| `area:backend` | `#1d3f8f` | Express routes/controller/service/repository (BE-nn) | 11 |
| `area:frontend` | `#bf8700` | React 화면·상태관리·API 연동 (FE-nn) | 9 |
| `area:integration` | `#6f42c1` | 통합 점검·배포 준비 (IT-nn) | 2 |

### 복잡도 (complexity) — 8-plan.md §2 "예상" 시간 기준

| 라벨 | 색상 | 기준 | 해당 Task |
|---|---|---|---|
| `complexity:S` | `#c2e0c6` | 예상 **0.5h 이하** | DB-01, DB-02, BE-01, BE-04, FE-01, FE-04, IT-02 (7) |
| `complexity:M` | `#fef2c0` | 예상 **1.0h~1.5h** | BE-02, BE-03, BE-05~BE-09, BE-11, FE-02, FE-03, FE-05, FE-06, FE-08, IT-01 (14) |
| `complexity:L` | `#f9d0c4` | 예상 **2.0h 이상** | BE-10, FE-07, FE-09 (3) |

### 우선순위 라벨을 두지 않은 이유

8-plan.md §1 "범위"에 따라 24개 Task 전부가 P0 대상이다. 모든 이슈에 동일한 `priority:P0`을 붙이면 필터링 가치가 없어 추가하지 않았다. P1(F-04 계정상태 자동전이, F-23 예약 자동완료)은 이슈로 만들지 않고 §5 백로그로만 남긴다. Stage 역시 제목(`[Stage N]`)으로 식별 가능해 별도 라벨을 두지 않았다 — 보드 단위 관리가 필요하면 라벨보다 GitHub Milestone(Stage 1~4)이 적절하다.

---

## 3. Stage별 이슈 목록

Stage = 8-plan.md §5 "2일 실행 순서". 표 안의 순서가 실행 순서다.

### Stage 1 — Day 1 오전 (합계 4.5h)

| Task | 제목 | 라벨 | 예상 | 선행 | 후행 |
|---|---|---|---|---|---|
| DB-01 | 데이터베이스 생성 및 스키마 적용 | `type:infra` `area:database` `complexity:S` | 0.5h | - | DB-02, BE-01 |
| DB-02 | 개발용 초기 데이터 구성 | `type:setup` `area:database` `complexity:S` | 0.5h | DB-01 | BE-03 |
| BE-01 | 백엔드 프로젝트 부트스트랩 | `type:setup` `area:backend` `complexity:S` | 0.5h | DB-01 | BE-02 |
| BE-02 | 인증 기반 공통 모듈 (JWT·해시·미들웨어) | `type:feature` `area:backend` `complexity:M` | 1.0h | BE-01 | BE-03 |
| BE-03 | 회원가입·로그인·로그아웃·토큰 재발급 API | `type:feature` `area:backend` `complexity:M` | 1.5h | BE-02, DB-02 | BE-04, BE-05, BE-07, FE-03 |
| FE-01 | 프론트엔드 프로젝트 부트스트랩 | `type:setup` `area:frontend` `complexity:S` | 0.5h | - | FE-02 |

> DB-01·DB-02는 8-plan.md v0.4 시점에 수행 완료되어 완료 조건이 `[x]`로 유지되며, 스크립트가 생성 직후 검증 내역 코멘트와 함께 close 처리한다.

### Stage 2 — Day 1 오후 (합계 6.0h)

| Task | 제목 | 라벨 | 예상 | 선행 | 후행 |
|---|---|---|---|---|---|
| BE-05 | 게시판 목록·상세 API (등급 인가) | `type:feature` `area:backend` `complexity:M` | 1.0h | BE-03 | BE-06, BE-10 |
| BE-06 | 게시글 목록·상세·작성·수정·삭제 API | `type:feature` `area:backend` `complexity:M` | 1.5h | BE-05 | BE-11, FE-05 |
| BE-07 | 연습실 목록·하루 예약현황 조회 API | `type:feature` `area:backend` `complexity:M` | 1.0h | BE-03 | BE-08 |
| FE-02 | 공통 레이아웃·반응형 네비게이션·홈 화면 | `type:feature` `area:frontend` `complexity:M` | 1.0h | FE-01 | FE-03 |
| FE-03 | 회원가입·로그인 화면 및 인증 연동 | `type:feature` `area:frontend` `complexity:M` | 1.5h | FE-02, BE-03 | FE-04, FE-05, FE-07, FE-09 |

### Stage 3 — Day 2 오전 (합계 6.5h)

| Task | 제목 | 라벨 | 예상 | 선행 | 후행 |
|---|---|---|---|---|---|
| BE-08 | 예약 신청 API (연속 슬롯 중복 검증) | `type:feature` `area:backend` `complexity:M` | 1.5h | BE-07 | BE-09, FE-07 |
| BE-09 | 내 예약 내역·예약 취소 API | `type:feature` `area:backend` `complexity:M` | 1.0h | BE-08 | BE-10, BE-11, FE-08 |
| BE-04 | 본인 정보 조회·수정 API | `type:feature` `area:backend` `complexity:S` | 0.5h | BE-03 | FE-04 |
| FE-05 | 게시판 목록·게시글 목록 화면 | `type:feature` `area:frontend` `complexity:M` | 1.5h | FE-03, BE-06 | FE-06, IT-01 |
| FE-07 | 연습실 예약현황·예약 신청 화면 | `type:feature` `area:frontend` `complexity:L` | 2.0h | FE-03, BE-08 | FE-08, IT-01 |

### Stage 4 — Day 2 오후 (합계 9.0h)

| Task | 제목 | 라벨 | 예상 | 선행 | 후행 |
|---|---|---|---|---|---|
| BE-10 | 관리자 API (회원등급·게시판·연습실 관리) | `type:feature` `area:backend` `complexity:L` | 2.0h | BE-05, BE-09 | BE-11, FE-09 |
| FE-06 | 게시글 작성·상세·수정·삭제 화면 | `type:feature` `area:frontend` `complexity:M` | 1.0h | FE-05 | IT-01 |
| FE-08 | 내 예약 내역 화면 (필터·취소) | `type:feature` `area:frontend` `complexity:M` | 1.0h | FE-07, BE-09 | IT-01 |
| FE-09 | 관리자 화면 3종 | `type:feature` `area:frontend` `complexity:L` | 2.0h | FE-03, BE-10 | IT-01 |
| FE-04 | 마이페이지(본인 정보 수정) 화면 | `type:feature` `area:frontend` `complexity:S` | 0.5h | FE-03, BE-04 | IT-01 |
| BE-11 | P0 핵심 로직 자동화 테스트 | `type:test` `area:backend` `complexity:M` | 1.0h | BE-06, BE-09, BE-10 | IT-01 |
| IT-01 | 통합 점검 (P0 시나리오 E2E 수동 확인) | `type:test` `area:integration` `complexity:M` | 1.0h | FE-04~FE-09, BE-11 | IT-02 |
| IT-02 | 배포 준비 (환경변수·CORS·헬스체크) | `type:infra` `area:integration` `complexity:S` | 0.5h | IT-01 | - |

**총 24개 Task / 예상 26.0h** — 8-plan.md §6에 따르면 가용 시간(약 16h)을 초과하므로 축소 순서(BE-11 축소 → FE-09 최소화 → 페이지네이션 단순화 → FE-04 후순위 → 관리자 기능 Day 3 이월)를 함께 적용한다. 단 **중복 예약 금지·등급 접근 제어·취소 제약** 관련 로직은 어떤 경우에도 축소 대상이 아니다.

---

## 4. 이슈 본문 구성

각 본문 파일은 아래 섹션을 갖는다.

| 섹션 | 근거 |
|---|---|
| Todo (해야 할 일) | 8-plan.md §4 "수행 작업" + `backend/swagger.yaml` (v0.2.0)의 실제 엔드포인트·상태코드 |
| 완료 조건 | 8-plan.md §4 "완료 조건" 체크박스 **원문 그대로** (DB-01·DB-02는 `[x]` 유지) |
| 기술적 고려사항 | 도메인 정의서 v0.6 / PRD v0.7 / 프로젝트 구조 설계 원칙 v0.4 / ERD v0.5 등 절 번호 표기 |
| 의존성 | 관련 F-ID, 화면 번호, 시나리오 ID(S-xx), 참조 문서 |
| 선행 작업 / 후행 작업 | 8-plan.md §2 표 + §3 mermaid 기준 양방향 |

### 파일 목록

```
stage1-db-01.md  stage2-be-05.md  stage3-be-08.md  stage4-be-10.md
stage1-db-02.md  stage2-be-06.md  stage3-be-09.md  stage4-fe-06.md
stage1-be-01.md  stage2-be-07.md  stage3-be-04.md  stage4-fe-08.md
stage1-be-02.md  stage2-fe-02.md  stage3-fe-05.md  stage4-fe-09.md
stage1-be-03.md  stage2-fe-03.md  stage3-fe-07.md  stage4-fe-04.md
stage1-fe-01.md                                    stage4-be-11.md
                                                   stage4-it-01.md
                                                   stage4-it-02.md
```

---

## 5. 이슈로 만들지 않은 범위 (참고)

이슈 대상은 8-plan.md의 P0 Task 24개뿐이다. 아래는 **이슈를 만들지 않았다**.

- **자료실**: 도메인 정의서 v0.2에서 범위 제외 확정 (도메인 정의서 §1, PRD §3 Out of Scope)
- **P1 백로그** (8-plan.md §7): `BL-01` 계정상태 자동 전이 배치(F-04), `BL-02` 예약 상태 자동 완료 전환 배치(F-23), `BL-03` 관리자 화면 잔여 기능(§6에서 축소한 경우에만 발생), `BL-04` 게시글 페이지네이션 고도화(동일)
- **범위 외**: 네이티브 앱, 알림/결제, 접근성 대응 (PRD §3)
- **등급 삭제 API**: F-30 범위는 등급 생성/수정이며 해당 API·화면이 없다 (8-plan.md 변경이력 v0.3)

---

## 6. 문서 근거가 애매해 판단으로 결정한 부분

| 항목 | 판단 |
|---|---|
| IT-01 선행 Task | §2 표·§4 상세는 `FE-04~FE-09, BE-11`인데 §3 mermaid는 FE-05·FE-07 간선이 없다. 전이 의존으로 커버되는 생략이라 보고 **§4 상세(FE-04~FE-09 + BE-11)를 채택**하고 이슈 본문에 차이를 명기했다. |
| BE-02의 `type` | §2 표에 F-02가 달려 있어 `type:feature`로 분류했다(공통 모듈이지만 F-ID 기준 규칙을 일관 적용). |
| `migrations/` 디렉토리 | 원칙 §7에는 있으나 DB-01이 `docs/schema.sql`로 스키마를 적용했다. DDL 이중 관리를 피하도록 `docs/schema.sql`을 단일 소스로 두자는 메모를 BE-01 본문에 남겼다(문서 간 충돌 지점). |
| 우선순위·Stage 라벨 | 24개 전부 P0이고 Stage는 제목에 있어 라벨을 추가하지 않았다(§2 마지막 항목 참고). |
