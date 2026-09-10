-- 색연필 색소폰 동호회 홈페이지 - 데이터베이스 스키마 (DDL)
-- 대상 DBMS: PostgreSQL 17
-- 출처: docs/7-erd.md
-- 실행 예: psql -d clubhome -f docs/schema.sql
--
-- 생성 순서는 외래키 의존 관계를 따른다:
--   member_grades -> members -> boards -> posts -> practice_rooms -> reservations
-- 시간 컬럼은 예약 시각(벽시계 기준)은 DATE/TIME, 기록 시각은 TIMESTAMPTZ를 사용한다.


-- ---------------------------------------------------------------------------
-- 1. 회원등급 (member_grades)
--    등급 서열은 grade_level(정수, 높을수록 상위)로 비교한다.
--    "관리자"는 별도 액터가 아니라 is_admin = TRUE 인 최상위 등급이다.
-- ---------------------------------------------------------------------------
CREATE TABLE member_grades (
    id          INTEGER      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        VARCHAR(30)  NOT NULL UNIQUE,
    description TEXT,
    -- boards.min_grade_level 이 이 컬럼을 참조하므로 UNIQUE 필수
    grade_level INTEGER      NOT NULL UNIQUE,
    is_admin    BOOLEAN      NOT NULL DEFAULT FALSE
);


-- ---------------------------------------------------------------------------
-- 2. 회원 (members)
--    탈퇴는 행 삭제가 아니라 account_status = 'withdrawn' 소프트 삭제로 처리한다.
-- ---------------------------------------------------------------------------
CREATE TABLE members (
    id              INTEGER      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email           VARCHAR(255) NOT NULL UNIQUE,          -- 로그인 ID
    password_hash   VARCHAR(255) NOT NULL,                 -- bcrypt 해시 (평문 저장 금지)
    name            VARCHAR(50)  NOT NULL,
    phone           VARCHAR(20),
    member_grade_id INTEGER      NOT NULL
        REFERENCES member_grades (id) ON DELETE RESTRICT,   -- 사용 중인 등급 삭제 방지
    account_status  VARCHAR(20)  NOT NULL DEFAULT 'active',
    joined_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),    -- 가입일
    CONSTRAINT members_account_status_check
        CHECK (account_status IN ('active', 'dormant', 'withdrawn'))
);


-- ---------------------------------------------------------------------------
-- 3. 게시판 (boards)
--    회원 등급이 min_grade_level 이상일 때만 열람/작성이 허용된다(서비스 레이어에서 판단).
--    is_active = FALSE 인 게시판은 일반 회원 목록에서 숨긴다.
-- ---------------------------------------------------------------------------
CREATE TABLE boards (
    id              INTEGER      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    description     TEXT,
    -- ON UPDATE 미지정 = NO ACTION: 게시판이 참조 중인 grade_level 값은 변경할 수 없다.
    -- 등급 수정 API가 참조 게시판 수를 먼저 세어 409로 거부한다(ERD §4 참고).
    min_grade_level INTEGER      NOT NULL
        REFERENCES member_grades (grade_level) ON DELETE RESTRICT,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE      -- 사용여부
);


-- ---------------------------------------------------------------------------
-- 4. 게시글 (posts)
--    작성자 FK는 RESTRICT: 탈퇴 회원의 게시글 이력을 보존한다.
-- ---------------------------------------------------------------------------
CREATE TABLE posts (
    id         INTEGER      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    board_id   INTEGER      NOT NULL
        REFERENCES boards (id) ON DELETE RESTRICT,
    member_id  INTEGER      NOT NULL
        REFERENCES members (id) ON DELETE RESTRICT,          -- 작성자
    title      VARCHAR(200) NOT NULL,
    content    TEXT         NOT NULL,
    view_count INTEGER      NOT NULL DEFAULT 0,              -- 조회수
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),          -- 작성일
    CONSTRAINT posts_view_count_check CHECK (view_count >= 0)
);


-- ---------------------------------------------------------------------------
-- 5. 연습실 (practice_rooms)
-- ---------------------------------------------------------------------------
CREATE TABLE practice_rooms (
    id         INTEGER      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       VARCHAR(100) NOT NULL,
    location   VARCHAR(100),
    capacity   INTEGER      NOT NULL,                        -- 수용인원
    open_time  TIME         NOT NULL,                        -- 운영 시작시간
    close_time TIME         NOT NULL,                        -- 운영 종료시간
    is_active  BOOLEAN      NOT NULL DEFAULT TRUE,           -- 사용여부
    CONSTRAINT practice_rooms_capacity_check CHECK (capacity > 0),
    CONSTRAINT practice_rooms_operating_hours_check CHECK (open_time < close_time)
);


-- ---------------------------------------------------------------------------
-- 6. 예약 (reservations)
--    연속된 30분 슬롯을 하나의 시작~종료 구간(1행)으로 저장한다.
--    구간 겹침 검증은 service 레이어 트랜잭션(SELECT ... FOR UPDATE)에서 수행하고,
--    아래 제약/부분 유니크 인덱스는 보조 방어선이다.
-- ---------------------------------------------------------------------------
CREATE TABLE reservations (
    id                 INTEGER     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    practice_room_id   INTEGER     NOT NULL
        REFERENCES practice_rooms (id) ON DELETE RESTRICT,
    member_id          INTEGER     NOT NULL
        REFERENCES members (id) ON DELETE RESTRICT,           -- 예약자 (탈퇴 시에도 이력 보존)
    reservation_date   DATE        NOT NULL,                  -- 예약일자
    start_time         TIME        NOT NULL,                  -- 30분 단위 시작
    end_time           TIME        NOT NULL,                  -- 30분 단위 종료 (연속 슬롯 묶음)
    reservation_status VARCHAR(20) NOT NULL DEFAULT 'reserved',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT reservations_status_check
        CHECK (reservation_status IN ('reserved', 'completed', 'canceled')),
    CONSTRAINT reservations_time_order_check
        CHECK (start_time < end_time),
    -- 30분 단위 경계만 허용 (서비스 레이어 입력 검증의 DB 차원 보조 방어선)
    CONSTRAINT reservations_30min_slot_check
        CHECK (
            EXTRACT(MINUTE FROM start_time) IN (0, 30)
            AND EXTRACT(SECOND FROM start_time) = 0
            AND EXTRACT(MINUTE FROM end_time) IN (0, 30)
            AND EXTRACT(SECOND FROM end_time) = 0
        )
);


-- ---------------------------------------------------------------------------
-- 7. 인덱스
--    members.email, member_grades.name, member_grades.grade_level 은
--    UNIQUE 제약으로 이미 인덱스가 생성되므로 별도로 만들지 않는다.
-- ---------------------------------------------------------------------------

-- 게시글 목록 조회 (게시판별 최신순)
CREATE INDEX idx_posts_board_created ON posts (board_id, created_at DESC);
-- 회원별 작성글 조회
CREATE INDEX idx_posts_member ON posts (member_id);

-- 예약현황 조회 (연습실 + 날짜 기준 하루 전체)
CREATE INDEX idx_reservations_room_date ON reservations (practice_room_id, reservation_date);
-- 내 예약 내역 조회
CREATE INDEX idx_reservations_member ON reservations (member_id);

-- 유효한 예약(reserved)에 한해 동일 연습실·날짜·시작시각 중복을 차단한다.
-- 취소된(canceled) 예약이 남아 있는 시간대는 재예약이 가능해야 하므로 부분 인덱스로 둔다.
CREATE UNIQUE INDEX uq_reservations_active_slot
    ON reservations (practice_room_id, reservation_date, start_time)
    WHERE reservation_status = 'reserved';


-- ---------------------------------------------------------------------------
-- 8. 초기 데이터 (회원등급)
--    회원가입 시 기본 등급이 필요하므로(F-01) 등급 체계는 최소 1건 이상 존재해야 한다.
--    등급명/서열은 운영 정책에 따라 관리자 메뉴에서 변경할 수 있다.
-- ---------------------------------------------------------------------------
INSERT INTO member_grades (name, description, grade_level, is_admin) VALUES
    ('준회원', '신규 가입 회원의 기본 등급',        10, FALSE),
    ('정회원', '정기 활동 회원',                    20, FALSE),
    ('운영진', '관리자 메뉴 접근 권한을 가진 등급',  30, TRUE);
