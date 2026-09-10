/**
 * API 경로 상수 (원칙 §6).
 * 지금 화면에서 쓰는 경로만 둔다 — 나머지 24개 경로를 미리 적어두지 않는다(§1 YAGNI).
 * 화면을 추가하는 이슈에서 그 화면이 부르는 경로를 함께 넣는다.
 */

/** 비워 두면 같은 출처로 요청한다. 개발 중에는 .env의 VITE_API_BASE_URL이 백엔드를 가리킨다. */
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '';

export const endpoints = {
  signup: '/api/auth/signup',
  login: '/api/auth/login',
  refresh: '/api/auth/refresh',
  logout: '/api/auth/logout',
  me: '/api/members/me',
  boards: '/api/boards',
  boardPosts: (boardId: number) => `/api/boards/${boardId}/posts`,
  post: (postId: number) => `/api/posts/${postId}`,
  practiceRooms: '/api/practice-rooms',
  roomReservations: (roomId: number) => `/api/practice-rooms/${roomId}/reservations`,
  myReservations: '/api/members/me/reservations',
  cancelReservation: (reservationId: number) => `/api/reservations/${reservationId}/cancel`,

  admin: {
    members: '/api/admin/members',
    memberGrade: (memberId: number) => `/api/admin/members/${memberId}/grade`,
    memberGrades: '/api/admin/member-grades',
    memberGradeItem: (gradeId: number) => `/api/admin/member-grades/${gradeId}`,
    boards: '/api/admin/boards',
    board: (boardId: number) => `/api/admin/boards/${boardId}`,
    practiceRooms: '/api/admin/practice-rooms',
    practiceRoom: (roomId: number) => `/api/admin/practice-rooms/${roomId}`,
    reservations: '/api/admin/reservations',
    cancelReservation: (reservationId: number) =>
      `/api/admin/reservations/${reservationId}/cancel`,
  },
} as const;
