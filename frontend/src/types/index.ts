/**
 * 도메인 타입 — 필드명은 프로젝트 구조 설계 원칙 §3 용어 매핑표와 1:1로 맞춘다.
 * `room`, `article`, `member_level` 같은 동의어는 쓰지 않는다.
 * 값의 출처는 backend/swagger.yaml `components.schemas` 이며, 서버 응답 형태를 그대로 옮긴 것이다.
 */

export type AccountStatus = 'active' | 'dormant' | 'withdrawn';

export type ReservationStatus = 'reserved' | 'completed' | 'canceled';

export interface MemberGrade {
  id: number;
  name: string;
  description: string | null;
  /** 등급서열 — 높을수록 상위 등급 (member_grades.grade_level) */
  gradeLevel: number;
  /** 관리자 권한 여부 (member_grades.is_admin) */
  isAdmin: boolean;
}

/** password_hash는 서버가 응답에 포함하지 않으므로 이 타입에도 자리를 두지 않는다. */
export interface Member {
  id: number;
  email: string;
  name: string;
  phone: string | null;
  memberGradeId: number;
  memberGrade: MemberGrade;
  accountStatus: AccountStatus;
  joinedAt: string;
}

export interface Board {
  id: number;
  name: string;
  description: string | null;
  /** 이용가능 최소등급 (boards.min_grade_level) */
  minGradeLevel: number;
  isActive: boolean;
  /**
   * 요청 회원의 접근 가능 여부. 목록 조회 응답에만 포함된다.
   * 서버가 등급서열을 비교해 내려주는 값이며 프론트에서 다시 계산하지 않는다(원칙 §2.1).
   */
  canAccess?: boolean;
}

export interface Post {
  id: number;
  boardId: number;
  /** 작성자 회원ID (posts.member_id) */
  memberId: number;
  /** 작성자 이름 — 응답 편의용 파생 필드이고 DB 컬럼이 아니다 */
  authorName: string;
  title: string;
  content: string;
  viewCount: number;
  createdAt: string;
}

export interface PostListResponse {
  items: Post[];
  page: number;
  pageSize: number;
  totalCount: number;
}

export interface PracticeRoom {
  id: number;
  name: string;
  location: string | null;
  capacity: number;
  /** 운영 시작시간 (HH:mm) */
  openTime: string;
  /** 운영 종료시간 (HH:mm) */
  closeTime: string;
  isActive: boolean;
}

/** 30분 단위 슬롯 하나. 서버가 운영시간 내로 전개해 내려주므로 프론트에서 만들지 않는다. */
export interface ReservationSlot {
  startTime: string;
  endTime: string;
  isAvailable: boolean;
  reservationId: number | null;
  /** 해당 슬롯 예약자 이름 — 와이어프레임 9번 "예약불가 (김OO)" 표기용 */
  memberName: string | null;
}

export interface RoomReservationsResponse {
  practiceRoomId: number;
  date: string;
  slots: ReservationSlot[];
}

/** 예약은 슬롯 단위 행이 아니라 연속 구간 한 행으로 저장된다(ERD §4). */
export interface Reservation {
  id: number;
  practiceRoomId: number;
  memberId: number;
  reservationDate: string;
  startTime: string;
  endTime: string;
  reservationStatus: ReservationStatus;
  createdAt: string;
}

export interface TokenPairResponse {
  accessToken: string;
  refreshToken: string;
  member: Member;
}

export interface ErrorResponse {
  code?: string;
  message: string;
}
