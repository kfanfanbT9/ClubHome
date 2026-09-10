import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { endpoints } from '../../api/endpoints';
import type {
  Board,
  Member,
  MemberGrade,
  PracticeRoom,
  Reservation,
} from '../../types';
import { boardKeys } from '../board/useBoardQueries';
import { roomKeys } from '../practiceRoom/useReservationQueries';

/**
 * 관리자 화면 3종이 쓰는 조회·변경을 한 파일에 모은다(원칙 §6, 이슈 FE-09).
 * 도메인별로 쪼개지 않는다 — 관리자 화면끼리 서로를 무효화하는 일이 많아
 * 키와 무효화 규칙을 한눈에 봐야 한다.
 *
 * 목록은 일반 회원용이 아니라 관리자용 엔드포인트를 쓴다. 그래야 비활성 항목이 보인다.
 */

export const adminKeys = {
  members: (q?: string) => ['admin', 'members', { q }] as const,
  membersAll: ['admin', 'members'] as const,
  grades: ['admin', 'grades'] as const,
  boards: ['admin', 'boards'] as const,
  rooms: ['admin', 'rooms'] as const,
  reservations: (roomId?: number, date?: string) =>
    ['admin', 'reservations', { roomId, date }] as const,
  reservationsAll: ['admin', 'reservations'] as const,
};

/* ── 회원 등급 관리 (화면 12) ─────────────────────────────── */

export function useAdminMembers(q?: string) {
  return useQuery({
    queryKey: adminKeys.members(q),
    // 검색어가 없으면 파라미터를 붙이지 않는다 — 전체 목록을 받아 프론트에서 걸러내지 않는다.
    queryFn: () => api.get<Member[]>(endpoints.admin.members, { query: { q } }),
  });
}

export function useMemberGrades() {
  return useQuery({
    queryKey: adminKeys.grades,
    queryFn: () => api.get<MemberGrade[]>(endpoints.admin.memberGrades),
  });
}

export function useChangeMemberGrade() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ memberId, memberGradeId }: { memberId: number; memberGradeId: number }) =>
      api.patch<Member>(endpoints.admin.memberGrade(memberId), { memberGradeId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.membersAll });
      /**
       * 게시판 목록도 무효화한다. 등급이 바뀌면 `canAccess`가 달라지므로
       * "등급을 변경하면 대상 회원의 게시판 접근 권한이 달라진다"(S-07)를
       * 관리자 자신이 자기 등급을 바꾼 경우에도 화면에서 확인할 수 있다.
       */
      queryClient.invalidateQueries({ queryKey: boardKeys.list });
    },
  });
}

export interface MemberGradeInput {
  name: string;
  description?: string;
  gradeLevel: number;
  isAdmin: boolean;
}

export function useCreateMemberGrade() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: MemberGradeInput) =>
      api.post<MemberGrade>(endpoints.admin.memberGrades, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.grades });
    },
  });
}

/**
 * 등급 수정 화면은 만들지 않았다. 와이어프레임 12번의 등급 체계 관리 영역은
 * 등급 배지 목록과 "+ 등급추가"만 보여주고, 이슈 FE-09도 등급 체계 관리를
 * 축소 가능 항목(백로그 BL-03)으로 둔다. 필요해지면
 * `endpoints.admin.memberGradeItem`에 PATCH를 붙이면 된다 —
 * 다만 등급서열을 바꾸면 참조 중인 게시판 때문에 409가 나는 경로가 있다(ERD §3).
 */

/* ── 게시판 관리 (화면 13) ────────────────────────────────── */

/** 일반 회원용 `GET /api/boards`와 달리 비활성 게시판까지 준다. */
export function useAdminBoards() {
  return useQuery({
    queryKey: adminKeys.boards,
    queryFn: () => api.get<Board[]>(endpoints.admin.boards),
  });
}

export interface BoardInput {
  name: string;
  description?: string;
  minGradeLevel: number;
  isActive: boolean;
}

/** 게시판을 만들고 고치고 지우는 세 가지가 무효화 대상이 같아 함께 둔다. */
function 게시판변경무효화(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: adminKeys.boards });
  // 최소등급·사용여부 변경은 일반 회원 화면에 즉시 반영되어야 한다(S-08).
  queryClient.invalidateQueries({ queryKey: boardKeys.list });
}

export function useCreateBoard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BoardInput) => api.post<Board>(endpoints.admin.boards, input),
    onSuccess: () => 게시판변경무효화(queryClient),
  });
}

export function useUpdateBoard(boardId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BoardInput) => api.patch<Board>(endpoints.admin.board(boardId), input),
    onSuccess: () => 게시판변경무효화(queryClient),
  });
}

export function useDeleteBoard() {
  const queryClient = useQueryClient();
  return useMutation({
    // 삭제는 204(본문 없음)로 응답한다. 참조 중인 게시글이 있으면 409다(FK RESTRICT).
    mutationFn: (boardId: number) => api.delete<void>(endpoints.admin.board(boardId)),
    onSuccess: () => 게시판변경무효화(queryClient),
  });
}

/* ── 연습실 관리 (화면 14) ────────────────────────────────── */

/** 일반 회원용 `GET /api/practice-rooms`와 달리 비활성 연습실까지 준다. */
export function useAdminPracticeRooms() {
  return useQuery({
    queryKey: adminKeys.rooms,
    queryFn: () => api.get<PracticeRoom[]>(endpoints.admin.practiceRooms),
  });
}

export interface PracticeRoomInput {
  name: string;
  location?: string;
  capacity: number;
  openTime: string;
  closeTime: string;
  isActive: boolean;
}

function 연습실변경무효화(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: adminKeys.rooms });
  // 사용여부·운영시간 변경은 예약 화면에 반영되어야 한다.
  queryClient.invalidateQueries({ queryKey: roomKeys.list });
}

export function useCreatePracticeRoom() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PracticeRoomInput) =>
      api.post<PracticeRoom>(endpoints.admin.practiceRooms, input),
    onSuccess: () => 연습실변경무효화(queryClient),
  });
}

export function useUpdatePracticeRoom(roomId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PracticeRoomInput) =>
      api.patch<PracticeRoom>(endpoints.admin.practiceRoom(roomId), input),
    onSuccess: () => 연습실변경무효화(queryClient),
  });
}

export function useDeletePracticeRoom() {
  const queryClient = useQueryClient();
  return useMutation({
    // 참조 중인 예약 이력이 있으면 409다(FK RESTRICT).
    mutationFn: (roomId: number) => api.delete<void>(endpoints.admin.practiceRoom(roomId)),
    onSuccess: () => 연습실변경무효화(queryClient),
  });
}

/* ── 예약 현황·강제 취소 (화면 14 하단) ───────────────────── */

export function useAdminReservations(roomId?: number, date?: string) {
  return useQuery({
    queryKey: adminKeys.reservations(roomId, date),
    queryFn: () =>
      api.get<Reservation[]>(endpoints.admin.reservations, { query: { roomId, date } }),
  });
}

/**
 * 예약 강제 취소.
 * 관리자는 시작 여부와 무관하게 취소할 수 있다(도메인 정의서 §6, 운영 목적 예외).
 */
export function useForceCancelReservation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (reservation: Reservation) =>
      api.patch<Reservation>(endpoints.admin.cancelReservation(reservation.id)),
    onSuccess: (_결과, reservation) => {
      queryClient.invalidateQueries({ queryKey: adminKeys.reservationsAll });
      // 취소한 시간대가 예약 화면에서 다시 예약가능으로 보여야 한다.
      queryClient.invalidateQueries({ queryKey: roomKeys.slotsOf(reservation.practiceRoomId) });
    },
  });
}
