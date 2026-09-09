# 색연필 색소폰 동호회 홈페이지 - 기술 아키텍처 다이어그램

## 0. 문서 개요
본 문서는 도메인 정의서(`1-domain-definition.md`, v0.6), PRD(`2-PRD.md`, v0.7), 프로젝트 구조 설계 원칙(`5-project-principle.md`, v0.4), 데이터베이스 ERD(`7-erd.md`, v0.5)를 기반으로 시스템 전체 구조와 주요 비즈니스 로직 흐름을 Mermaid 다이어그램으로 표현한다.

## 변경 이력
| Version | Date | Changes | Author |
|---|---|---|---|
| 0.1 | 2026-09-09 | 최초 작성 | Kang SangSoo |
| 0.2 | 2026-09-09 | 0절 참조 문서 버전 표기 정정(프로젝트 구조 설계 원칙 v0.2→v0.3) 및 ERD(7-erd.md v0.3) 참조 추가 | Kang SangSoo |
| 0.3 | 2026-09-09 | 0절 참조 문서 버전 표기 정정(PRD v0.6→v0.7, 프로젝트 구조 설계 원칙 v0.3→v0.4, ERD v0.3→v0.5). 다이어그램 변경 없음 | Kang SangSoo |

## 1. 전체 시스템 구조

1인 개발·2일 일정, 회원 500명 이하·동시접속 20명 규모에 맞춰 단일 Express 서버 + 단일 PostgreSQL로 구성한다. 별도 캐시/메시지 큐/마이크로서비스는 두지 않는다.

```mermaid
flowchart TB
    subgraph Client["브라우저"]
        FE["React 19 + TypeScript\nZustand(클라이언트 상태) / TanStack Query(서버 상태 캐싱)"]
    end

    subgraph Server["Express 서버 (Node.js, 단일 인스턴스)"]
        Routes["routes\n(JWT 인증 미들웨어)"]
        Controller["controller\n(요청 파싱/응답 형식)"]
        Service["service\n(비즈니스 로직, 인가 판단, 트랜잭션)"]
        Repository["repository\n(pg 파라미터 바인딩 SQL)"]
        Routes --> Controller --> Service --> Repository
    end

    DB[("PostgreSQL 17\nmembers / member_grades\nboards / posts\npractice_rooms / reservations")]

    FE -- "HTTPS REST API\n(JWT Access Token)" --> Routes
    Repository -- "SQL (pg Pool)" --> DB
```

프론트엔드는 TanStack Query로만 서버 데이터를 가져오고, 백엔드는 routes→controller→service→repository 순서로 단방향 의존한다.

## 2. 주요 비즈니스 로직 시퀀스 다이어그램

아래 3가지는 도메인 정의서/PRD상 여러 단계의 검증·조건 분기가 있는 로직으로, 단순 CRUD와 구분해 별도로 표현한다.

### 2.1 로그인 및 JWT Access/Refresh Token 발급·재발급 (F-02)

로그인 시 Access/Refresh Token을 함께 발급하고, Access Token 만료 시 Refresh Token으로 재발급받는 흐름이다.

```mermaid
sequenceDiagram
    actor U as 회원
    participant FE as React App
    participant API as Express API
    participant SVC as auth-service
    participant DB as PostgreSQL

    U->>FE: 이메일/비밀번호 입력
    FE->>API: POST /api/auth/login
    API->>SVC: 로그인 검증 요청
    SVC->>DB: 이메일로 회원 조회
    DB-->>SVC: 회원 정보(해시 비밀번호, 계정상태)
    alt 회원 없음 또는 비밀번호 불일치
        SVC-->>API: 인증 실패
        API-->>FE: 401 로그인 실패
    else 계정상태가 탈퇴
        SVC-->>API: 로그인 불가
        API-->>FE: 403 탈퇴 회원
    else 인증 성공
        SVC->>SVC: Access Token(단기) + Refresh Token(장기) 발급
        SVC-->>API: 토큰 반환
        API-->>FE: 200 + Access/Refresh Token
    end

    Note over FE,API: 이후 Access Token 만료 시
    FE->>API: POST /api/auth/refresh (Refresh Token)
    API->>SVC: Refresh Token 검증
    alt Refresh Token 유효
        SVC-->>API: 신규 Access Token 발급
        API-->>FE: 200 + 신규 Access Token
    else Refresh Token 만료/폐기
        SVC-->>API: 재발급 불가
        API-->>FE: 401 재로그인 필요
    end
```

### 2.2 연습실 예약 신청 - 연속 슬롯 중복 검증 (F-20, F-21)

하루 전체 예약현황 조회 후, 선택한 연속 30분 슬롯 구간에 중복이 있는지 트랜잭션으로 검증한다.

```mermaid
sequenceDiagram
    actor U as 회원
    participant FE as React App
    participant API as Express API
    participant SVC as reservation-service
    participant DB as PostgreSQL

    U->>FE: 연습실+날짜 선택
    FE->>API: GET /api/practice-rooms/:roomId/reservations?date=
    API->>SVC: 하루 예약현황 조회
    SVC->>DB: 해당 연습실·날짜의 예약 목록 조회
    DB-->>SVC: 30분 슬롯별 예약 여부
    SVC-->>API: 예약현황 반환
    API-->>FE: 200 + 슬롯별 현황

    U->>FE: 연속 슬롯 선택(예: 09:00~10:30) 후 예약 신청
    FE->>API: POST /api/practice-rooms/:roomId/reservations
    API->>SVC: 예약 신청 요청
    SVC->>DB: BEGIN
    SVC->>DB: 선택 구간 슬롯 잠금 조회(중복 확인)
    alt 구간 내 하나라도 기존 예약 존재
        SVC->>DB: ROLLBACK
        SVC-->>API: 중복 슬롯 존재
        API-->>FE: 409 이미 예약된 시간대 포함
    else 구간 전체 비어있음
        SVC->>DB: 예약 INSERT
        SVC->>DB: COMMIT
        SVC-->>API: 예약 확정
        API-->>FE: 201 예약 완료
    end
```

### 2.3 등급 기반 게시판 접근 제어 (F-10, F-11)

게시판 열람/게시글 작성 시 회원등급과 게시판의 "이용가능 최소등급"을 비교해 인가를 판단한다.

```mermaid
sequenceDiagram
    actor U as 회원
    participant FE as React App
    participant API as Express API
    participant SVC as board-service
    participant DB as PostgreSQL

    U->>FE: 게시판 진입 또는 글쓰기 요청
    FE->>API: GET /api/boards/:boardId (또는 POST .../posts)
    API->>SVC: 게시판 접근/작성 인가 확인
    SVC->>DB: 게시판의 이용가능 최소등급 + 사용여부 조회
    SVC->>DB: 요청 회원의 회원등급 조회
    DB-->>SVC: 최소등급, 사용여부, 회원등급
    alt 게시판이 비활성 상태
        SVC-->>API: 접근 불가
        API-->>FE: 404/403 비활성 게시판
    else 회원등급 < 게시판 최소등급
        SVC-->>API: 인가 실패
        API-->>FE: 403 이용 권한 없음
    else 등급 충족
        SVC->>DB: 게시판/게시글 조회 또는 게시글 저장
        DB-->>SVC: 결과
        SVC-->>API: 처리 완료
        API-->>FE: 200/201 응답
    end
```
