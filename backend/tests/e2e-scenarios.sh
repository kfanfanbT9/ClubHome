#!/usr/bin/env bash
#
# 사용자 시나리오(docs/3-user-scenario.md) S-01~S-08 기반 백엔드 API E2E 테스트.
# curl로 실제 HTTP 요청을 보내며, node --test와 달리 앱을 require하지 않고
# 기동된 서버를 외부에서 두드린다.
#
# 사용법:
#   1) 테스트 DB로 서버를 띄운다 (개발 DB를 오염시키지 않기 위해 필수):
#        PORT=3009 node --env-file=.env.test src/server.js &
#   2) bash tests/e2e-scenarios.sh
#
# BASE 환경변수로 대상 서버를 바꿀 수 있다 (기본 http://127.0.0.1:3009).
#
# 격리 규약: 이메일 접두사 `e2e-`, 예약 날짜 2094-06-01~03을 쓴다.
#   기존 13개 테스트 파일이 쓰는 접두사(be03-~be11r-)와 날짜(2000-01-01~08,
#   2095~2099년대)와 겹치지 않는다. 다음 작업은 2093년대를 쓸 것.

set -uo pipefail

BASE="${BASE:-http://127.0.0.1:3009}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
FAILED_LABELS=()

# 이 실행에서만 쓰는 고유 이메일 — 재실행 시 409로 막히지 않게 한다.
STAMP="$(date +%H%M%S)"
NEW_EMAIL="e2e-${STAMP}@clubhome.local"
SEED_PW='Test1234!'
DATE_A='2094-06-01'
DATE_B='2094-06-02'

# ---------------------------------------------------------------------------
# 헬퍼
# ---------------------------------------------------------------------------

# call METHOD PATH [TOKEN] [JSON_BODY]
#   응답 본문은 $TMP/body 에, 상태코드는 전역 STATUS 에 담긴다.
#   본문은 --data-binary @파일 로 넘긴다 — 한글이 셸 인자를 거치면 깨진다.
call() {
  local method="$1" path="$2" token="${3:-}" body="${4:-}"
  local -a args=(-s -o "$TMP/body" -w '%{http_code}' -X "$method" "$BASE$path")

  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  if [ -n "$body" ]; then
    printf '%s' "$body" > "$TMP/req.json"
    args+=(-H 'Content-Type: application/json' --data-binary "@$TMP/req.json")
  fi

  STATUS="$(curl "${args[@]}")"
}

# json DOTTED_PATH  — $TMP/body 에서 값을 꺼낸다. 없으면 빈 문자열.
# jq가 없는 환경이라 node로 파싱한다. 인자는 ASCII 경로뿐이므로 인코딩 문제가 없다.
json() {
  node -e '
    const fs = require("node:fs");
    let d;
    try { d = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { process.exit(0); }
    const v = process.argv[2].split(".").reduce((o, k) => (o == null ? o : o[k]), d);
    process.stdout.write(v === undefined || v === null ? "" : String(v));
  ' "$TMP/body" "$1"
}

# jsonlen DOTTED_PATH — 배열 길이
jsonlen() {
  node -e '
    const fs = require("node:fs");
    let d;
    try { d = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { process.exit(0); }
    const p = process.argv[2];
    const v = p === "." ? d : p.split(".").reduce((o, k) => (o == null ? o : o[k]), d);
    process.stdout.write(Array.isArray(v) ? String(v.length) : "");
  ' "$TMP/body" "$1"
}

# find_id_by_name JSON_PATH_TO_ARRAY NAME — 배열에서 name이 일치하는 항목의 id
find_id_by_name() {
  node -e '
    const fs = require("node:fs");
    const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const p = process.argv[2];
    const arr = p === "." ? d : p.split(".").reduce((o, k) => (o == null ? o : o[k]), d);
    const hit = (arr || []).find((x) => x.name === process.argv[3]);
    process.stdout.write(hit ? String(hit.id) : "");
  ' "$TMP/body" "$1" "$2"
}

check() { # check LABEL EXPECTED ACTUAL
  if [ "$2" = "$3" ]; then
    PASS=$((PASS + 1))
    printf '  [OK]   %s\n' "$1"
  else
    FAIL=$((FAIL + 1))
    FAILED_LABELS+=("$1")
    printf '  [FAIL] %s  (기대=%s 실제=%s)\n' "$1" "$2" "$3"
  fi
}

login() { # login EMAIL PASSWORD -> stdout: accessToken (실패 시 빈 문자열)
  call POST /api/auth/login '' "{\"email\":\"$1\",\"password\":\"$2\"}"
  [ "$STATUS" = "200" ] && json accessToken
}

section() { printf '\n=== %s ===\n' "$1"; }

# ---------------------------------------------------------------------------
# 사전 확인
# ---------------------------------------------------------------------------
printf '대상 서버: %s\n' "$BASE"
call GET /health
if [ "$STATUS" != "200" ]; then
  printf '서버에 접속할 수 없습니다(status=%s). 먼저 아래로 띄우십시오:\n' "$STATUS"
  printf '  PORT=3009 node --env-file=.env.test src/server.js &\n'
  exit 1
fi
printf '헬스체크: %s %s\n' "$STATUS" "$(cat "$TMP/body")"

ADMIN_T="$(login admin@clubhome.local "$SEED_PW")"
SENIOR_T="$(login senior@clubhome.local "$SEED_PW")"
if [ -z "$ADMIN_T" ] || [ -z "$SENIOR_T" ]; then
  printf '시드 계정 로그인 실패. 테스트 DB에 docs/seed-dev.sql이 적용되어 있어야 합니다.\n'
  printf '  npm run test:db 를 먼저 실행하십시오.\n'
  exit 1
fi

# ---------------------------------------------------------------------------
section 'S-01 신규 회원가입 및 로그인 (F-01, F-02)'
# ---------------------------------------------------------------------------
call POST /api/auth/signup '' \
  "{\"name\":\"E2E 신입\",\"email\":\"$NEW_EMAIL\",\"password\":\"$SEED_PW\",\"phone\":\"010-9999-0001\"}"
check '1. 회원가입이 201로 성공한다' 201 "$STATUS"
NEW_ID="$(json id)"

# 3. 시스템은 신규 회원에게 기본 등급(최저 grade_level = 준회원)을 부여한다
NEW_T="$(login "$NEW_EMAIL" "$SEED_PW")"
check '2. 가입한 계정으로 로그인해 Access Token을 받는다' 0 "$([ -n "$NEW_T" ] && echo 0 || echo 1)"
check '3. 로그인 응답에 Refresh Token도 함께 온다' 0 "$([ -n "$(json refreshToken)" ] && echo 0 || echo 1)"
REFRESH_T="$(json refreshToken)"

call GET /api/members/me "$NEW_T"
check '4. 신규 회원의 기본 등급이 준회원이다' '준회원' "$(json memberGrade.name)"
check '5. 응답에 password_hash가 없다' '' "$(json passwordHash)"

# 결과/예외: 이메일 중복 가입 시 실패
call POST /api/auth/signup '' \
  "{\"name\":\"E2E 중복\",\"email\":\"$NEW_EMAIL\",\"password\":\"$SEED_PW\",\"phone\":\"010-9999-0002\"}"
check '6. 이메일 중복 가입은 409로 거부된다' 409 "$STATUS"

# 결과/예외: 비밀번호 불일치 시 로그인 실패
call POST /api/auth/login '' "{\"email\":\"$NEW_EMAIL\",\"password\":\"WrongPw123!\"}"
check '7. 비밀번호 불일치 로그인은 401이다' 401 "$STATUS"

# 6. Access Token 만료 시 Refresh Token으로 재발급
call POST /api/auth/refresh '' "{\"refreshToken\":\"$REFRESH_T\"}"
check '8. Refresh Token으로 Access Token을 재발급받는다' 200 "$STATUS"
check '9. 재발급 응답에 accessToken이 있다' 0 "$([ -n "$(json accessToken)" ] && echo 0 || echo 1)"

call POST /api/auth/refresh '' '{"refreshToken":"not.a.real.token"}'
check '10. 위조 Refresh Token은 401이다' 401 "$STATUS"

# ---------------------------------------------------------------------------
section 'S-02 본인 정보 수정 (F-03)'
# ---------------------------------------------------------------------------
call PATCH /api/members/me "$NEW_T" '{"name":"E2E 수정됨","phone":"010-9999-1234"}'
check '11. 이름·연락처 수정이 200으로 저장된다' 200 "$STATUS"

call GET /api/members/me "$NEW_T"
check '12. 재조회 시 수정된 이름이 반영되어 있다' 'E2E 수정됨' "$(json name)"
check '13. 재조회 시 수정된 연락처가 반영되어 있다' '010-9999-1234' "$(json phone)"

# 결과/예외: 이메일(로그인ID) 등 변경이 허용되지 않는 항목은 수정할 수 없다
call PATCH /api/members/me "$NEW_T" \
  "{\"name\":\"E2E 수정됨\",\"phone\":\"010-9999-1234\",\"email\":\"hijack@evil.com\",\"memberGradeId\":3}"
call GET /api/members/me "$NEW_T"
check '14. 이메일 변경 요청은 무시된다' "$NEW_EMAIL" "$(json email)"
check '15. 등급 상승 요청은 무시된다(권한 상승 차단)' '준회원' "$(json memberGrade.name)"

call GET /api/members/me ''
check '16. 비로그인 조회는 401이다' 401 "$STATUS"

# ---------------------------------------------------------------------------
section 'S-03 등급에 따른 게시판 접근 제한 (F-10, F-11)'
# ---------------------------------------------------------------------------
call GET /api/boards "$NEW_T"
BOARD_COUNT="$(jsonlen .)"
FREE_BOARD="$(find_id_by_name . '자유게시판')"
SENIOR_BOARD="$(find_id_by_name . '정회원 게시판')"
ARCHIVED_BOARD="$(find_id_by_name . '이전 공지(보관)')"
check '17. 게시판 목록이 조회된다' 0 "$([ "${BOARD_COUNT:-0}" -ge 3 ] && echo 0 || echo 1)"
check '18. 비활성 게시판은 일반 회원 목록에 없다' '' "$ARCHIVED_BOARD"

# 1. 자신의 등급으로 접근 가능한 게시판만 노출되거나, 목록은 보이되 진입 시 제한된다
call GET "/api/boards/$FREE_BOARD" "$NEW_T"
check '19. 등급 충족 게시판(자유게시판)은 200이다' 200 "$STATUS"

# 3. 시스템은 회원 등급과 게시판 최소등급을 비교해 접근을 거부한다
call GET "/api/boards/$SENIOR_BOARD" "$NEW_T"
check '20. 등급 미달 게시판 진입은 403이다' 403 "$STATUS"

call GET "/api/boards/$SENIOR_BOARD" "$SENIOR_T"
check '21. 정회원은 같은 게시판에 200으로 접근한다' 200 "$STATUS"

# ---------------------------------------------------------------------------
section 'S-04 게시글 작성 및 본인 글 수정/삭제 (F-11, F-12)'
# ---------------------------------------------------------------------------
call POST "/api/boards/$FREE_BOARD/posts" "$NEW_T" \
  '{"title":"E2E 연습실 문의","content":"E2E 시나리오가 작성한 본문입니다."}'
check '22. 등급 충족 회원의 글 작성이 201이다' 201 "$STATUS"
POST_ID="$(json id)"

# 2. 목록에서 본인 글의 조회수가 증가함을 확인한다
call GET "/api/posts/$POST_ID" "$NEW_T"
VIEW_1="$(json viewCount)"
call GET "/api/posts/$POST_ID" "$NEW_T"
VIEW_2="$(json viewCount)"
check '23. 상세 조회 시 조회수가 1 증가한다' "$((VIEW_1 + 1))" "$VIEW_2"

call GET "/api/boards/$FREE_BOARD/posts" "$NEW_T"
check '24. 게시글 목록이 페이지네이션과 함께 온다' 0 \
  "$([ -n "$(json totalCount)" ] && [ -n "$(json page)" ] && echo 0 || echo 1)"

# 결과/예외: 등급 조건 미충족 상태에서 작성 API를 직접 호출해도 서버에서 거부된다
call POST "/api/boards/$SENIOR_BOARD/posts" "$NEW_T" \
  '{"title":"E2E 권한없는 작성","content":"거부되어야 합니다."}'
check '25. 등급 미달 게시판 작성은 403이다' 403 "$STATUS"

# 결과/예외: 타인이 작성한 글은 수정/삭제 시도 시 거부된다
call PATCH "/api/posts/$POST_ID" "$SENIOR_T" '{"title":"타인이 고친 제목"}'
check '26. 타인의 게시글 수정은 403이다' 403 "$STATUS"

call DELETE "/api/posts/$POST_ID" "$SENIOR_T"
check '27. 타인의 게시글 삭제는 403이다' 403 "$STATUS"

# 3. 본인이 작성한 글에서 수정 버튼으로 내용을 변경한다
call PATCH "/api/posts/$POST_ID" "$NEW_T" '{"title":"E2E 수정한 제목"}'
check '28. 본인 게시글 수정은 200이다' 200 "$STATUS"
check '29. 수정한 제목이 응답에 반영된다' 'E2E 수정한 제목' "$(json title)"

# 관리자도 타인 글을 수정·삭제할 수 있다 (F-12)
call PATCH "/api/posts/$POST_ID" "$ADMIN_T" '{"title":"관리자가 수정한 제목"}'
check '30. 관리자는 타인 게시글도 수정할 수 있다' 200 "$STATUS"

# 4. 필요 시 삭제 버튼으로 글을 삭제한다
call DELETE "/api/posts/$POST_ID" "$NEW_T"
check '31. 본인 게시글 삭제가 성공한다' 0 \
  "$([ "$STATUS" = "204" ] || [ "$STATUS" = "200" ] && echo 0 || echo 1)"

call GET "/api/posts/$POST_ID" "$NEW_T"
check '32. 삭제한 게시글 조회는 404다' 404 "$STATUS"

# ---------------------------------------------------------------------------
section 'S-05 예약현황 조회 및 신청, 중복예약 거부 (F-20, F-21)'
# ---------------------------------------------------------------------------
call GET /api/practice-rooms "$NEW_T"
ROOM_COUNT="$(jsonlen .)"
ROOM_ID="$(json 0.id)"
INACTIVE_ROOM="$(find_id_by_name . '2연습실')"
check '33. 활성 연습실 목록이 조회된다' 0 "$([ "${ROOM_COUNT:-0}" -ge 1 ] && echo 0 || echo 1)"
check '34. 비활성 연습실(2연습실)은 목록에서 제외된다' '' "$INACTIVE_ROOM"

# 1. 하루(운영시간) 전체의 예약현황이 30분 단위 시간대로 표시된다
call GET "/api/practice-rooms/$ROOM_ID/reservations?date=$DATE_A" "$NEW_T"
check '35. 하루 예약현황이 200으로 조회된다' 200 "$STATUS"
SLOT_COUNT="$(jsonlen slots)"
# 09:00~22:00 = 13시간 = 30분 슬롯 26개
check '36. 운영시간 09:00-22:00이 30분 슬롯 26개로 전개된다' 26 "$SLOT_COUNT"

# 2. 연속된 여러 슬롯(09:00~10:30, 3개 슬롯)을 하나의 예약으로 신청한다
call POST "/api/practice-rooms/$ROOM_ID/reservations" "$NEW_T" \
  "{\"reservationDate\":\"$DATE_A\",\"startTime\":\"09:00\",\"endTime\":\"10:30\"}"
check '37. 연속 슬롯 예약(09:00~10:30)이 201로 확정된다' 201 "$STATUS"
RES_ID="$(json id)"
check '38. 예약 상태가 reserved다' 'reserved' "$(json reservationStatus)"

# 4~5. 겹치는 시간대 재예약 시도 -> 거부
call POST "/api/practice-rooms/$ROOM_ID/reservations" "$SENIOR_T" \
  "{\"reservationDate\":\"$DATE_A\",\"startTime\":\"10:00\",\"endTime\":\"11:00\"}"
check '39. 부분만 겹치는 예약은 409로 거부된다' 409 "$STATUS"

call POST "/api/practice-rooms/$ROOM_ID/reservations" "$SENIOR_T" \
  "{\"reservationDate\":\"$DATE_A\",\"startTime\":\"09:00\",\"endTime\":\"10:30\"}"
check '40. 완전히 같은 시간대 예약도 409다' 409 "$STATUS"

# 경계 맞닿음은 겹침이 아니다
call POST "/api/practice-rooms/$ROOM_ID/reservations" "$SENIOR_T" \
  "{\"reservationDate\":\"$DATE_A\",\"startTime\":\"10:30\",\"endTime\":\"11:00\"}"
check '41. 경계가 맞닿는 예약(10:30~11:00)은 201로 허용된다' 201 "$STATUS"
SENIOR_RES_ID="$(json id)"

# 결과/예외: 운영시간 외 / 30분 경계 위반
call POST "/api/practice-rooms/$ROOM_ID/reservations" "$NEW_T" \
  "{\"reservationDate\":\"$DATE_B\",\"startTime\":\"09:17\",\"endTime\":\"10:00\"}"
check '42. 30분 경계를 벗어난 시각은 400이다' 400 "$STATUS"

call POST "/api/practice-rooms/$ROOM_ID/reservations" "$NEW_T" \
  "{\"reservationDate\":\"$DATE_B\",\"startTime\":\"07:00\",\"endTime\":\"08:00\"}"
check '43. 운영시간 외 예약은 400이다' 400 "$STATUS"

# ---------------------------------------------------------------------------
section 'S-06 예약 취소 (시작 전 vs 타인) (F-22)'
# ---------------------------------------------------------------------------
# 진행 흐름(연습실별 필터링)
call GET /api/members/me/reservations "$NEW_T"
MY_ALL="$(jsonlen .)"
check '44. 내 예약 내역이 조회된다' 0 "$([ "${MY_ALL:-0}" -ge 1 ] && echo 0 || echo 1)"

call GET "/api/members/me/reservations?roomId=$ROOM_ID" "$NEW_T"
MY_FILTERED="$(jsonlen .)"
check '45. roomId 필터가 적용된다' 0 "$([ "${MY_FILTERED:-0}" -ge 1 ] && echo 0 || echo 1)"

call GET "/api/members/me/reservations?roomId=99999" "$NEW_T"
check '46. 없는 연습실로 필터하면 빈 목록이다' 0 "$(jsonlen .)"

# 결과/예외: 타인 예약 취소 거부
call PATCH "/api/reservations/$RES_ID/cancel" "$SENIOR_T"
check '47. 타인의 예약 취소는 403이다' 403 "$STATUS"

# 진행 흐름(시작 전 취소 - 정상)
call PATCH "/api/reservations/$RES_ID/cancel" "$NEW_T"
check '48. 시작 전 본인 예약 취소는 200이다' 200 "$STATUS"
check '49. 취소된 예약의 상태가 canceled다' 'canceled' "$(json reservationStatus)"

call PATCH "/api/reservations/$RES_ID/cancel" "$NEW_T"
check '50. 이미 취소된 예약의 재취소는 400이다' 400 "$STATUS"

# 결과/예외: 취소된 시간대는 타 회원이 재예약 가능
call POST "/api/practice-rooms/$ROOM_ID/reservations" "$SENIOR_T" \
  "{\"reservationDate\":\"$DATE_A\",\"startTime\":\"09:00\",\"endTime\":\"10:30\"}"
check '51. 취소된 시간대를 다른 회원이 재예약할 수 있다' 201 "$STATUS"
REBOOKED_ID="$(json id)"

# ---------------------------------------------------------------------------
section 'S-07 회원 등급 변경 (F-30)'
# ---------------------------------------------------------------------------
# 결과/예외: 관리자가 아닌 계정은 이 메뉴 자체에 접근할 수 없다
call GET /api/admin/members "$NEW_T"
check '52. 비관리자의 관리자 API 접근은 403이다' 403 "$STATUS"

call GET /api/admin/member-grades "$ADMIN_T"
check '53. 관리자는 등급 체계를 조회할 수 있다' 200 "$STATUS"
GRADE_SENIOR_ID="$(find_id_by_name . '정회원')"

# 1~3. 회원을 선택해 새 등급으로 변경한다
call PATCH "/api/admin/members/$NEW_ID/grade" "$ADMIN_T" "{\"memberGradeId\":$GRADE_SENIOR_ID}"
check '54. 관리자의 회원 등급 변경이 200이다' 200 "$STATUS"
check '55. 변경된 등급이 응답에 반영된다' '정회원' "$(json memberGrade.name)"

# 결과/예외: 변경 즉시(또는 다음 로그인/토큰 갱신 시) 새 등급 기준이 적용된다
UPGRADED_T="$(login "$NEW_EMAIL" "$SEED_PW")"
call GET "/api/boards/$SENIOR_BOARD" "$UPGRADED_T"
check '56. 등급 상향 후 정회원 게시판에 접근할 수 있다(S-03에서 403이던 곳)' 200 "$STATUS"

# ---------------------------------------------------------------------------
section 'S-08 게시판/연습실 관리 (F-31, F-32)'
# ---------------------------------------------------------------------------
# 진행 흐름(게시판 관리): 신규 생성 -> 설정 -> 즉시 접근 제어에 반영
call POST /api/admin/boards "$ADMIN_T" \
  '{"name":"E2E 임시 게시판","description":"E2E가 만든 게시판","minGradeLevel":10,"isActive":true}'
check '57. 관리자의 게시판 생성이 201이다' 201 "$STATUS"
E2E_BOARD="$(json id)"

call GET /api/boards "$NEW_T"
check '58. 생성한 활성 게시판이 일반 회원 목록에 보인다' "$E2E_BOARD" \
  "$(find_id_by_name . 'E2E 임시 게시판')"

# 결과/예외: 사용여부를 "비활성"으로 바꾸면 일반 회원에게 숨겨진다
call PATCH "/api/admin/boards/$E2E_BOARD" "$ADMIN_T" \
  '{"name":"E2E 임시 게시판","description":"비활성으로 전환","minGradeLevel":10,"isActive":false}'
check '59. 게시판 사용여부 변경이 200이다' 200 "$STATUS"

call GET /api/boards "$NEW_T"
check '60. 비활성으로 바꾼 게시판이 일반 회원 목록에서 사라진다' '' \
  "$(find_id_by_name . 'E2E 임시 게시판')"

call GET "/api/boards/$E2E_BOARD" "$NEW_T"
check '61. 비활성 게시판 직접 접근은 404다(존재 노출 방지)' 404 "$STATUS"

call GET /api/admin/boards "$ADMIN_T"
check '62. 관리자 목록에는 비활성 게시판이 표시된다' "$E2E_BOARD" \
  "$(find_id_by_name . 'E2E 임시 게시판')"

# 진행 흐름(연습실 관리): 등록 -> 예약 화면에 반영
call POST /api/admin/practice-rooms "$ADMIN_T" \
  '{"name":"E2E 임시연습실","location":"지하1층","capacity":3,"openTime":"10:00","closeTime":"12:00","isActive":true}'
check '63. 관리자의 연습실 등록이 201이다' 201 "$STATUS"
E2E_ROOM="$(json id)"

call GET "/api/practice-rooms/$E2E_ROOM/reservations?date=$DATE_B" "$NEW_T"
check '64. 등록한 연습실의 운영시간(10:00-12:00)이 슬롯 4개로 반영된다' 4 "$(jsonlen slots)"

call PATCH "/api/admin/practice-rooms/$E2E_ROOM" "$ADMIN_T" \
  '{"name":"E2E 임시연습실","location":"지하1층","capacity":3,"openTime":"10:00","closeTime":"12:00","isActive":false}'
check '65. 연습실 사용여부 변경이 200이다' 200 "$STATUS"

call GET /api/practice-rooms "$NEW_T"
check '66. 비활성 연습실이 일반 회원 목록에서 사라진다' '' \
  "$(find_id_by_name . 'E2E 임시연습실')"

# 결과/예외: 관리자의 예약 취소는 시작 여부와 무관하게 허용된다
call GET "/api/admin/reservations?roomId=$ROOM_ID&date=$DATE_A" "$ADMIN_T"
check '67. 관리자가 예약 현황·내역을 조회할 수 있다' 200 "$STATUS"

call PATCH "/api/admin/reservations/$REBOOKED_ID/cancel" "$ADMIN_T"
check '68. 관리자가 타인 예약을 강제 취소할 수 있다' 200 "$STATUS"
check '69. 강제 취소된 예약의 상태가 canceled다' 'canceled' "$(json reservationStatus)"

# 참조 중인 게시판·연습실 삭제는 500이 아닌 의미 있는 4xx (8-plan BE-10)
call DELETE "/api/admin/practice-rooms/$ROOM_ID" "$ADMIN_T"
check '70. 예약 이력이 있는 연습실 삭제는 409다(500 아님)' 409 "$STATUS"

# ---------------------------------------------------------------------------
# 정리 — E2E가 만든 부수 리소스를 되돌린다(취소된 예약 행은 이력이므로 남긴다)
# ---------------------------------------------------------------------------
call PATCH "/api/reservations/$SENIOR_RES_ID/cancel" "$SENIOR_T" >/dev/null 2>&1 || true
call DELETE "/api/admin/boards/$E2E_BOARD" "$ADMIN_T" >/dev/null 2>&1 || true
call DELETE "/api/admin/practice-rooms/$E2E_ROOM" "$ADMIN_T" >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
printf '\n=============================================\n'
printf '  통과 %d / 실패 %d / 전체 %d\n' "$PASS" "$FAIL" "$((PASS + FAIL))"
printf '=============================================\n'
if [ "$FAIL" -gt 0 ]; then
  printf '실패 항목:\n'
  for label in "${FAILED_LABELS[@]}"; do printf '  - %s\n' "$label"; done
  exit 1
fi
printf '사용자 시나리오 S-01~S-08 전체 통과\n'
