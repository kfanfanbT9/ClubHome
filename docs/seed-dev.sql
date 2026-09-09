-- 색연필 색소폰 동호회 홈페이지 - 개발용 초기 데이터 (DB-02)
-- 대상 DBMS: PostgreSQL 17 / 선행: docs/schema.sql 적용 완료
-- 실행 예: psql -d clubhome -f docs/seed-dev.sql
--
-- ★ 개발/테스트 전용이다. 운영 환경에 절대 적용하지 말 것.
--   아래 계정 비밀번호는 모두 'Test1234!' (bcrypt cost 10 해시로 저장).
--   운영 배포 시에는 이 파일을 실행하지 않고, 관리자 계정만 별도 생성한다.
--
-- 재실행 가능(idempotent): 같은 이름/이메일이 이미 있으면 삽입을 건너뛴다.
--   boards·practice_rooms 는 name 에 UNIQUE 제약이 없어 ON CONFLICT 를 쓸 수 없으므로
--   NOT EXISTS 가드로 중복을 막는다. members 는 email UNIQUE 가 있어 ON CONFLICT 사용.
--
-- 변경 이력
-- | Version | Date       | Changes                                          | Author       |
-- |---------|------------|--------------------------------------------------|--------------|
-- | 0.1     | 2026-09-09 | 최초 작성                                        | Kang SangSoo |
-- | 0.2     | 2026-09-09 | boards·practice_rooms 의 ON CONFLICT DO NOTHING  | Kang SangSoo |
-- |         |            | 이 UNIQUE 제약 부재로 무효였던 문제 수정          |              |
-- |         |            | (NOT EXISTS 가드로 교체, 재실행 시 중복 삽입 방지) |              |


-- ---------------------------------------------------------------------------
-- 1. 게시판 4건
--    등급별 접근 제어(F-10) 검증을 위해 최소등급을 서로 다르게 구성하고,
--    비활성 게시판 1건을 포함한다(와이어프레임 13번의 "이전 공지(보관)").
-- ---------------------------------------------------------------------------
INSERT INTO boards (name, description, min_grade_level, is_active)
SELECT v.name, v.description, v.min_grade_level, v.is_active
FROM (VALUES
    ('자유게시판',      '전체 회원이 이용하는 자유 게시판',          10, TRUE),
    ('정회원 게시판',    '정회원 이상만 이용 가능한 게시판',          20, TRUE),
    ('운영진 전용',      '운영진만 이용 가능한 게시판',               30, TRUE),
    ('이전 공지(보관)',  '보관용 비활성 게시판(회원 목록에서 숨김)',   30, FALSE)
) AS v(name, description, min_grade_level, is_active)
WHERE NOT EXISTS (SELECT 1 FROM boards b WHERE b.name = v.name);


-- ---------------------------------------------------------------------------
-- 2. 연습실 2건 (활성 1건 + 비활성 1건)
--    운영시간은 와이어프레임 9번 기준 09:00~22:00.
-- ---------------------------------------------------------------------------
INSERT INTO practice_rooms (name, location, capacity, open_time, close_time, is_active)
SELECT v.name, v.location, v.capacity, v.open_time::time, v.close_time::time, v.is_active
FROM (VALUES
    ('1연습실', '2층', 4, '09:00', '22:00', TRUE),
    ('2연습실', '3층', 2, '09:00', '22:00', FALSE)
) AS v(name, location, capacity, open_time, close_time, is_active)
WHERE NOT EXISTS (SELECT 1 FROM practice_rooms r WHERE r.name = v.name);


-- ---------------------------------------------------------------------------
-- 3. 테스트 회원 4건
--    - admin@clubhome.local : 운영진(is_admin = TRUE) — 관리자 기능 검증용
--    - senior@clubhome.local: 정회원 — 정회원 게시판 접근 검증용
--    - junior1/2@clubhome.local: 준회원 — 등급 미달 차단 검증용
--    비밀번호는 모두 'Test1234!' 의 bcrypt 해시.
-- ---------------------------------------------------------------------------
INSERT INTO members (email, password_hash, name, phone, member_grade_id, account_status) VALUES
    ('admin@clubhome.local',
     '$2b$10$eri.ukduW9fs8h9AbAj.GeWd3IDbNlUz0aYtwvBGyx3GF2v5k.z0O',
     '운영자', '010-0000-0001',
     (SELECT id FROM member_grades WHERE grade_level = 30), 'active'),
    ('senior@clubhome.local',
     '$2b$10$dDFY4Sb2l4v9Hx2/jfcNUuDnoov2fBPZlbtOxPuqRYcieDdfw2jIa',
     '김색소', '010-0000-0002',
     (SELECT id FROM member_grades WHERE grade_level = 20), 'active'),
    ('junior1@clubhome.local',
     '$2b$10$o0x.6FgbBZIhTwyqz95Sd.7GwHNIi8xnKPZfYFcd7nk25SlkUWunO',
     '이연습', '010-0000-0003',
     (SELECT id FROM member_grades WHERE grade_level = 10), 'active'),
    ('junior2@clubhome.local',
     '$2b$10$gTfKzvyzh7uYQRdakPoCH.V3TvJFTq33hq9IXyk282ts9qX1pdBQC',
     '박신입', '010-0000-0004',
     (SELECT id FROM member_grades WHERE grade_level = 10), 'active')
ON CONFLICT (email) DO NOTHING;
