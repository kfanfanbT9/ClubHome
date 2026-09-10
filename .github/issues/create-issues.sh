#!/usr/bin/env bash
#
# 색연필 색소폰 동호회 홈페이지 - WBS 이슈 일괄 등록 스크립트
# 근거 문서: docs/8-plan.md (v0.4) §2 Task 분해 개요 / §4 Task 상세 / §5 2일 실행 순서
#
# ── 사용법 ───────────────────────────────────────────────────────────────────
#   1) 선행 조건: GitHub CLI 인증이 완료되어 있어야 한다.
#        gh auth login
#        gh auth status          # 확인
#   2) 대상 저장소의 워킹 디렉토리에서 실행한다(gh가 git remote로 저장소를 판별).
#        bash .github/issues/create-issues.sh
#   3) 문법만 검사하려면(생성하지 않음):
#        bash -n .github/issues/create-issues.sh
#   4) 확인 프롬프트를 건너뛰려면: YES=1 bash .github/issues/create-issues.sh
#
# ── ⚠ 재실행 시 중복 생성 위험 경고 ─────────────────────────────────────────
#   `gh issue create`에는 멱등성이 없다. 이 스크립트를 두 번 실행하면 제목이
#   같은 이슈 24개가 그대로 한 벌 더 만들어진다(라벨만 --force로 갱신됨).
#   중간에 실패해 일부만 생성된 경우에도 그냥 재실행하지 말고,
#     gh issue list --limit 50
#   로 이미 만들어진 이슈를 확인한 뒤 아래 CREATE 목록에서 해당 줄을 주석
#   처리하고 남은 것만 생성하라. 이미 만든 이슈를 전부 지우고 다시 하려면
#     gh issue list --json number --jq '.[].number' | xargs -n1 gh issue delete --yes
#   (되돌릴 수 없으므로 직접 확인 후 수동 실행할 것)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

ISSUE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

command -v gh >/dev/null 2>&1 || {
  echo "오류: gh CLI를 찾을 수 없다. https://cli.github.com 설치 후 다시 실행하라." >&2
  exit 1
}
gh auth status >/dev/null 2>&1 || {
  echo "오류: gh가 미인증 상태다. 먼저 'gh auth login'을 실행하라." >&2
  exit 1
}

if [[ -t 0 && "${YES:-0}" != "1" ]]; then
  echo "이 스크립트는 이슈 24개를 새로 생성한다(중복 생성 방지 기능 없음)."
  read -r -p "계속하려면 y를 입력하라: " _ans
  [[ "$_ans" == "y" || "$_ans" == "Y" ]] || { echo "취소했다."; exit 0; }
fi

# ─────────────────────────────────────────────────────────────────────────────
# 1. 라벨 생성 (3축: 종류 / 영역 / 복잡도)
#    --force: 이미 존재하면 색상·설명을 덮어쓴다(실패하지 않음)
# ─────────────────────────────────────────────────────────────────────────────
label() {
  gh label create "$1" --color "$2" --description "$3" --force
}

echo "== 라벨 생성 =="

# 종류(type) — 작업 성격
label "type:feature" "1d76db" "기능 구현: PRD F-ID 또는 와이어프레임 화면에 대응하는 API/화면 작업"
label "type:setup"   "5319e7" "착수 준비: 프로젝트 골격 생성, 개발용 초기 데이터 구성 (F-ID 없음)"
label "type:test"    "0e8a16" "검증: service 레이어 자동화 테스트 및 시나리오 통합 점검"
label "type:infra"   "d93f0b" "인프라/운영: DB 스키마 적용, 환경변수·CORS·배포 준비"

# 영역(area) — Task ID 접두사와 1:1
label "area:database"    "006b75" "PostgreSQL 스키마·초기 데이터 (DB-nn)"
label "area:backend"     "1d3f8f" "Express routes/controller/service/repository (BE-nn)"
label "area:frontend"    "bf8700" "React 화면·상태관리·API 연동 (FE-nn)"
label "area:integration" "6f42c1" "통합 점검·배포 준비 (IT-nn)"

# 복잡도(complexity) — 8-plan.md §2 "예상" 시간 기준
label "complexity:S" "c2e0c6" "예상 0.5h 이하 (8-plan.md 2절 예상 시간 기준)"
label "complexity:M" "fef2c0" "예상 1.0h~1.5h (8-plan.md 2절 예상 시간 기준)"
label "complexity:L" "f9d0c4" "예상 2.0h 이상 (8-plan.md 2절 예상 시간 기준)"

# ─────────────────────────────────────────────────────────────────────────────
# 2. 이슈 생성
# ─────────────────────────────────────────────────────────────────────────────
declare -A URL=()   # Task ID -> 생성된 이슈 URL
declare -A PRE=()   # Task ID -> 선행 Task 목록 (8-plan.md §2 표 / §3 mermaid)
declare -A POST=()  # Task ID -> 후행 Task 목록

mk() { # mk <task-id> <제목> <라벨(쉼표구분)> <본문파일>
  local id="$1" title="$2" labels="$3" file="$4" url
  url="$(gh issue create --title "$title" --label "$labels" --body-file "$ISSUE_DIR/$file")"
  URL["$id"]="$url"
  echo "  [$id] $url"
}

echo "== Stage 1 (Day 1 오전) =="
mk "DB-01" "[Stage 1][DB-01] 데이터베이스 생성 및 스키마 적용" \
   "type:infra,area:database,complexity:S"   "stage1-db-01.md"
mk "DB-02" "[Stage 1][DB-02] 개발용 초기 데이터 구성" \
   "type:setup,area:database,complexity:S"   "stage1-db-02.md"
mk "BE-01" "[Stage 1][BE-01] 백엔드 프로젝트 부트스트랩" \
   "type:setup,area:backend,complexity:S"    "stage1-be-01.md"
mk "BE-02" "[Stage 1][BE-02] 인증 기반 공통 모듈 (JWT·해시·미들웨어)" \
   "type:feature,area:backend,complexity:M"  "stage1-be-02.md"
mk "BE-03" "[Stage 1][BE-03] 회원가입·로그인·로그아웃·토큰 재발급 API" \
   "type:feature,area:backend,complexity:M"  "stage1-be-03.md"
mk "FE-01" "[Stage 1][FE-01] 프론트엔드 프로젝트 부트스트랩" \
   "type:setup,area:frontend,complexity:S"   "stage1-fe-01.md"

echo "== Stage 2 (Day 1 오후) =="
mk "BE-05" "[Stage 2][BE-05] 게시판 목록·상세 API (등급 인가)" \
   "type:feature,area:backend,complexity:M"  "stage2-be-05.md"
mk "BE-06" "[Stage 2][BE-06] 게시글 목록·상세·작성·수정·삭제 API" \
   "type:feature,area:backend,complexity:M"  "stage2-be-06.md"
mk "BE-07" "[Stage 2][BE-07] 연습실 목록·하루 예약현황 조회 API" \
   "type:feature,area:backend,complexity:M"  "stage2-be-07.md"
mk "FE-02" "[Stage 2][FE-02] 공통 레이아웃·반응형 네비게이션·홈 화면" \
   "type:feature,area:frontend,complexity:M" "stage2-fe-02.md"
mk "FE-03" "[Stage 2][FE-03] 회원가입·로그인 화면 및 인증 연동" \
   "type:feature,area:frontend,complexity:M" "stage2-fe-03.md"

echo "== Stage 3 (Day 2 오전) =="
mk "BE-08" "[Stage 3][BE-08] 예약 신청 API (연속 슬롯 중복 검증)" \
   "type:feature,area:backend,complexity:M"  "stage3-be-08.md"
mk "BE-09" "[Stage 3][BE-09] 내 예약 내역·예약 취소 API" \
   "type:feature,area:backend,complexity:M"  "stage3-be-09.md"
mk "BE-04" "[Stage 3][BE-04] 본인 정보 조회·수정 API" \
   "type:feature,area:backend,complexity:S"  "stage3-be-04.md"
mk "FE-05" "[Stage 3][FE-05] 게시판 목록·게시글 목록 화면" \
   "type:feature,area:frontend,complexity:M" "stage3-fe-05.md"
mk "FE-07" "[Stage 3][FE-07] 연습실 예약현황·예약 신청 화면" \
   "type:feature,area:frontend,complexity:L" "stage3-fe-07.md"

echo "== Stage 4 (Day 2 오후) =="
mk "BE-10" "[Stage 4][BE-10] 관리자 API (회원등급·게시판·연습실 관리)" \
   "type:feature,area:backend,complexity:L"  "stage4-be-10.md"
mk "FE-06" "[Stage 4][FE-06] 게시글 작성·상세·수정·삭제 화면" \
   "type:feature,area:frontend,complexity:M" "stage4-fe-06.md"
mk "FE-08" "[Stage 4][FE-08] 내 예약 내역 화면 (필터·취소)" \
   "type:feature,area:frontend,complexity:M" "stage4-fe-08.md"
mk "FE-09" "[Stage 4][FE-09] 관리자 화면 3종" \
   "type:feature,area:frontend,complexity:L" "stage4-fe-09.md"
mk "FE-04" "[Stage 4][FE-04] 마이페이지(본인 정보 수정) 화면" \
   "type:feature,area:frontend,complexity:S" "stage4-fe-04.md"
mk "BE-11" "[Stage 4][BE-11] P0 핵심 로직 자동화 테스트" \
   "type:test,area:backend,complexity:M"     "stage4-be-11.md"
mk "IT-01" "[Stage 4][IT-01] 통합 점검 (P0 시나리오 E2E 수동 확인)" \
   "type:test,area:integration,complexity:M" "stage4-it-01.md"
mk "IT-02" "[Stage 4][IT-02] 배포 준비 (환경변수·CORS·헬스체크)" \
   "type:infra,area:integration,complexity:S" "stage4-it-02.md"

# ─────────────────────────────────────────────────────────────────────────────
# 3. DB-01·DB-02 종료 처리 (8-plan.md v0.4에서 이미 수행 완료)
# ─────────────────────────────────────────────────────────────────────────────
echo "== 완료된 Task 종료 (DB-01, DB-02) =="

gh issue comment "${URL[DB-01]}" --body "$(cat <<'EOF'
**완료 처리 사유** — 8-plan.md v0.4 시점에 이미 수행 완료되어 완료 조건 체크박스가 모두 충족된 Task다.

검증 완료 내역:
- `psql -d <db> -f docs/schema.sql` 오류 없이 완료
- `members`, `member_grades`, `boards`, `posts`, `practice_rooms`, `reservations` 6개 테이블 생성 확인
- `member_grades`에 준회원/정회원/운영진 3건 조회 확인
- `reservations` 부분 유니크 인덱스 `uq_reservations_active_slot` 생성 확인

근거: `docs/8-plan.md` 변경이력 v0.4, §4 DB-01 완료 조건. 이력 추적용으로 이슈만 남기고 종료한다.
EOF
)"
gh issue close "${URL[DB-01]}"

gh issue comment "${URL[DB-02]}" --body "$(cat <<'EOF'
**완료 처리 사유** — 8-plan.md v0.4 시점에 이미 수행 완료되어 완료 조건 체크박스가 모두 충족된 Task다.

검증 완료 내역:
- 최소등급이 서로 다른 게시판 3건 이상 확보(등급별 접근 제어 검증 가능, 비활성 1건 포함)
- 예약 검증용 활성 연습실 1건 이상 확보
- `is_admin = true` 등급의 관리자 계정으로 로그인 검증 가능
- 준회원 등급 테스트 회원 확보(등급 미달 차단 검증 가능)
- 초기 데이터는 재실행 가능한 `docs/seed-dev.sql`로 관리

근거: `docs/8-plan.md` 변경이력 v0.4, §4 DB-02 완료 조건. 이력 추적용으로 이슈만 남기고 종료한다.
EOF
)"
gh issue close "${URL[DB-02]}"

# ─────────────────────────────────────────────────────────────────────────────
# 4. 선행/후행 Task 교차 링크 코멘트 (8-plan.md §2 표 + §3 mermaid 근거)
#    CROSSLINK=0 으로 건너뛸 수 있다.
# ─────────────────────────────────────────────────────────────────────────────
PRE["DB-01"]="";                       POST["DB-01"]="DB-02 BE-01"
PRE["DB-02"]="DB-01";                  POST["DB-02"]="BE-03"
PRE["BE-01"]="DB-01";                  POST["BE-01"]="BE-02"
PRE["BE-02"]="BE-01";                  POST["BE-02"]="BE-03"
PRE["BE-03"]="BE-02 DB-02";            POST["BE-03"]="BE-04 BE-05 BE-07 FE-03"
PRE["BE-04"]="BE-03";                  POST["BE-04"]="FE-04"
PRE["BE-05"]="BE-03";                  POST["BE-05"]="BE-06 BE-10"
PRE["BE-06"]="BE-05";                  POST["BE-06"]="BE-11 FE-05"
PRE["BE-07"]="BE-03";                  POST["BE-07"]="BE-08"
PRE["BE-08"]="BE-07";                  POST["BE-08"]="BE-09 FE-07"
PRE["BE-09"]="BE-08";                  POST["BE-09"]="BE-10 BE-11 FE-08"
PRE["BE-10"]="BE-05 BE-09";            POST["BE-10"]="BE-11 FE-09"
PRE["BE-11"]="BE-06 BE-09 BE-10";      POST["BE-11"]="IT-01"
PRE["FE-01"]="";                       POST["FE-01"]="FE-02"
PRE["FE-02"]="FE-01";                  POST["FE-02"]="FE-03"
PRE["FE-03"]="FE-02 BE-03";            POST["FE-03"]="FE-04 FE-05 FE-07 FE-09"
PRE["FE-04"]="FE-03 BE-04";            POST["FE-04"]="IT-01"
PRE["FE-05"]="FE-03 BE-06";            POST["FE-05"]="FE-06 IT-01"
PRE["FE-06"]="FE-05";                  POST["FE-06"]="IT-01"
PRE["FE-07"]="FE-03 BE-08";            POST["FE-07"]="FE-08 IT-01"
PRE["FE-08"]="FE-07 BE-09";            POST["FE-08"]="IT-01"
PRE["FE-09"]="FE-03 BE-10";            POST["FE-09"]="IT-01"
PRE["IT-01"]="FE-04 FE-05 FE-06 FE-07 FE-08 FE-09 BE-11"
POST["IT-01"]="IT-02"
PRE["IT-02"]="IT-01";                  POST["IT-02"]=""

refs() { # refs "<task-id 목록>" -> "#12 (DB-01), #13 (BE-01)" / 비어 있으면 "없음"
  local out="" t u
  for t in $1; do
    u="${URL[$t]:-}"
    if [[ -n "$u" ]]; then
      out+="#$(basename "$u") ($t), "
    else
      out+="$t, "   # 부분 실행 등으로 URL을 모르는 경우 Task ID로만 표기
    fi
  done
  out="${out%, }"
  echo "${out:-없음}"
}

if [[ "${CROSSLINK:-1}" == "1" ]]; then
  echo "== 선행/후행 교차 링크 코멘트 =="
  for id in "${!URL[@]}"; do
    gh issue comment "${URL[$id]}" --body "**의존 관계 (이슈 번호 교차 링크)** — 근거: \`docs/8-plan.md\` §2 표, §3 mermaid

- 선행 작업: $(refs "${PRE[$id]:-}")
- 후행 작업: $(refs "${POST[$id]:-}")"
    echo "  [$id] 교차 링크 코멘트 완료"
  done
fi

# ─────────────────────────────────────────────────────────────────────────────
# 5. 생성 결과 매핑 저장 (재실행 시 중복 확인용)
# ─────────────────────────────────────────────────────────────────────────────
{
  echo "# Task ID -> 이슈 URL (생성 시각: $(date '+%Y-%m-%d %H:%M:%S'))"
  for id in "${!URL[@]}"; do echo "$id ${URL[$id]}"; done | sort
} > "$ISSUE_DIR/issue-map.txt"

echo
echo "완료: 이슈 24개 생성, DB-01·DB-02 종료 처리."
echo "생성 매핑: $ISSUE_DIR/issue-map.txt"
