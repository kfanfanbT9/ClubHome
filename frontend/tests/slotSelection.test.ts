import { describe, expect, it } from 'vitest';
import {
  toggleSlot,
  가운데해제안내,
  비연속안내,
} from '../src/features/practiceRoom/slotSelection';

/**
 * 예약은 슬롯 단위가 아니라 "시작~종료" 구간 한 행으로 저장되므로(ERD §4)
 * 선택도 끊기지 않은 한 구간이어야 한다. 이 Task에서 가장 틀리기 쉬운 규칙이라
 * 경우별로 확인한다.
 */
describe('연속 슬롯 선택', () => {
  it('아무것도 안 고른 상태에서는 어느 슬롯이든 고를 수 있다', () => {
    expect(toggleSlot([], 5)).toEqual({ selected: [5] });
  });

  it('바로 뒤 슬롯을 이어 고를 수 있다', () => {
    expect(toggleSlot([3], 4)).toEqual({ selected: [3, 4] });
    expect(toggleSlot([3, 4], 5)).toEqual({ selected: [3, 4, 5] });
  });

  it('바로 앞 슬롯도 이어 고를 수 있다', () => {
    expect(toggleSlot([3], 2)).toEqual({ selected: [2, 3] });
    expect(toggleSlot([2, 3], 1)).toEqual({ selected: [1, 2, 3] });
  });

  it('떨어진 슬롯을 고르면 안내하고 기존 선택을 지키지 않는다', () => {
    // 잘못 눌렀을 때 애써 고른 구간이 사라지지 않는 편이 낫다.
    expect(toggleSlot([3, 4], 7)).toEqual({ selected: [3, 4], notice: 비연속안내 });
    expect(toggleSlot([3, 4], 1)).toEqual({ selected: [3, 4], notice: 비연속안내 });
  });

  it('한 칸 건너뛴 슬롯도 거절한다', () => {
    // 3,4 를 고른 상태에서 6은 5를 건너뛴다 — 5가 예약돼 막혀 있을 때 생기는 경우다.
    expect(toggleSlot([3, 4], 6)).toEqual({ selected: [3, 4], notice: 비연속안내 });
  });
});

describe('선택 해제', () => {
  it('시작 슬롯을 다시 누르면 앞에서 줄어든다', () => {
    expect(toggleSlot([3, 4, 5], 3)).toEqual({ selected: [4, 5] });
  });

  it('끝 슬롯을 다시 누르면 뒤에서 줄어든다', () => {
    expect(toggleSlot([3, 4, 5], 5)).toEqual({ selected: [3, 4] });
  });

  it('하나만 고른 상태에서 그것을 누르면 선택이 비워진다', () => {
    expect(toggleSlot([3], 3)).toEqual({ selected: [] });
  });

  it('가운데 슬롯 해제는 안내하고 거절한다', () => {
    // 가운데를 빼면 구간이 두 조각으로 갈라져 하나의 예약으로 저장할 수 없다.
    expect(toggleSlot([3, 4, 5], 4)).toEqual({ selected: [3, 4, 5], notice: 가운데해제안내 });
  });

  it('두 칸 선택에서는 양쪽 모두 끝이라 해제할 수 있다', () => {
    expect(toggleSlot([3, 4], 3)).toEqual({ selected: [4] });
    expect(toggleSlot([3, 4], 4)).toEqual({ selected: [3] });
  });
});

describe('결과는 항상 정렬된 한 구간이다', () => {
  it('앞으로 늘려도 오름차순을 유지한다', () => {
    let 선택 = toggleSlot([], 5).selected;
    선택 = toggleSlot(선택, 4).selected;
    선택 = toggleSlot(선택, 3).selected;
    expect(선택).toEqual([3, 4, 5]);
  });

  it('입력이 정렬돼 있지 않아도 정렬해서 돌려준다', () => {
    expect(toggleSlot([5, 3, 4], 6).selected).toEqual([3, 4, 5, 6]);
  });

  it('여러 번 누른 뒤에도 구간이 끊기지 않는다', () => {
    let 선택 = [3, 4, 5, 6];
    선택 = toggleSlot(선택, 4).selected; // 가운데 → 거절
    선택 = toggleSlot(선택, 3).selected; // 시작 해제
    선택 = toggleSlot(선택, 6).selected; // 끝 해제
    expect(선택).toEqual([4, 5]);
    // 끊긴 곳이 없다
    expect(선택.every((값, i) => i === 0 || 값 === 선택[i - 1] + 1)).toBe(true);
  });
});
