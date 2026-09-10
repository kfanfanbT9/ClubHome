import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { endpoints } from '../../api/endpoints';
import type { PracticeRoom, Reservation, RoomReservationsResponse } from '../../types';

/** 연습실 목록·하루 예약현황·예약 신청. */

export const roomKeys = {
  list: ['practiceRooms', 'list'] as const,
  /** 한 연습실의 모든 날짜 — 예약이 생기거나 취소되면 그 날짜 현황이 달라진다. */
  slotsOf: (roomId: number) => ['practiceRooms', roomId, 'slots'] as const,
  slots: (roomId: number, date: string) => ['practiceRooms', roomId, 'slots', date] as const,
};

export const reservationKeys = {
  /** 필터와 무관하게 내 예약 전체 — 취소하면 어느 필터로 보고 있든 달라진다. */
  mine: ['reservations', 'mine'] as const,
  mineBy: (roomId?: number) => ['reservations', 'mine', { roomId }] as const,
};

/** 서버가 활성 연습실만 내려준다. */
export function usePracticeRooms() {
  return useQuery({
    queryKey: roomKeys.list,
    queryFn: () => api.get<PracticeRoom[]>(endpoints.practiceRooms),
  });
}

/**
 * 하루 예약현황. 서버가 운영시간 전체를 30분 단위로 전개해 준다 —
 * 프론트에서 운영시간을 계산해 슬롯을 만들지 않는다(8-plan BE-07).
 */
export function useDaySlots(roomId: number, date: string) {
  return useQuery({
    queryKey: roomKeys.slots(roomId, date),
    queryFn: () =>
      api.get<RoomReservationsResponse>(endpoints.roomReservations(roomId), { query: { date } }),
    /**
     * `Number.isInteger(0)`이 true라서, 연습실 목록이 도착하기 전의 roomId 0 을
     * 그냥 통과시키면 `/api/practice-rooms/0/reservations` 로 쓸모없는 404가 나간다.
     * 연습실 id는 1부터이므로 양수만 통과시킨다.
     */
    enabled: Number.isInteger(roomId) && roomId > 0 && date.length > 0,
  });
}

export interface ReservationCreateInput {
  reservationDate: string;
  /** 30분 경계의 시작 시각 (HH:mm) */
  startTime: string;
  /** 연속 슬롯 묶음의 종료 시각 (HH:mm) */
  endTime: string;
}

export function useCreateReservation(roomId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    /**
     * 선택한 슬롯 배열이 아니라 연속 구간의 시작~종료 한 쌍을 보낸다.
     * 예약이 슬롯 단위 행이 아니라 구간 한 행으로 저장되는 설계다(ERD §4).
     */
    mutationFn: (input: ReservationCreateInput) =>
      api.post<Reservation>(endpoints.roomReservations(roomId), input),
    /**
     * onSuccess가 아니라 onSettled인 이유: **409로 거절당했을 때도 현황이 낡았다.**
     * 409는 다른 회원이 그 사이에 그 시간대를 확정했다는 뜻이므로, 화면에 보이는
     * "예약가능"이 이미 사실과 다르다. 실패했으니 갱신하지 않는다는 판단은
     * 사용자를 낡은 화면에 남겨 같은 시간대를 다시 고르게 만든다
     * (사용자 시나리오 S-05, 이슈 FE-07: "안내 후 현황을 재조회해 최신 상태를 보여준다").
     */
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: roomKeys.slotsOf(roomId) });
    },
  });
}

/**
 * 내 예약 내역.
 *
 * 필터는 서버 쿼리 파라미터로 처리하고 "전체"는 파라미터를 아예 붙이지 않는다 —
 * 전체 목록을 받아 프론트에서 걸러내지 않는다(PRD F-22).
 */
export function useMyReservations(roomId?: number) {
  return useQuery({
    queryKey: reservationKeys.mineBy(roomId),
    queryFn: () => api.get<Reservation[]>(endpoints.myReservations, { query: { roomId } }),
  });
}

export function useCancelReservation() {
  const queryClient = useQueryClient();

  return useMutation({
    /** 예약 객체를 받는 이유: 취소 후 무효화할 연습실을 알아야 한다. */
    mutationFn: (reservation: Reservation) =>
      api.patch<Reservation>(endpoints.cancelReservation(reservation.id)),
    onSuccess: (_결과, reservation) => {
      queryClient.invalidateQueries({ queryKey: reservationKeys.mine });
      /**
       * 그 연습실의 예약현황도 함께 무효화한다.
       * "취소한 시간대가 예약현황에서 다시 예약가능으로 표시된다"가 완료조건이므로,
       * 내 목록만 갱신하면 조건을 절반만 만족한다.
       */
      queryClient.invalidateQueries({ queryKey: roomKeys.slotsOf(reservation.practiceRoomId) });
    },
  });
}
