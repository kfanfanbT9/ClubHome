/**
 * 연속 슬롯 선택 규칙.
 *
 * 예약은 슬롯 하나씩 저장되지 않고 "시작~종료" 구간 한 행으로 저장된다(ERD §4).
 * 그래서 선택도 **끊기지 않은 한 구간**이어야 한다.
 *
 * 이건 즉각적인 UX를 위한 클라이언트 검증이고, 최종 판정(중복·경계·운영시간)은 서버가 한다.
 * 이 규칙을 통과했다는 것이 예약 성공을 뜻하지 않는다(원칙 §2.1).
 *
 * 화면과 떼어 순수 함수로 둔 이유: 규칙 자체가 이 Task에서 가장 틀리기 쉬운 부분이라
 * 렌더링과 섞지 않고 경우별로 확인하려는 것이다.
 */

export interface SlotSelection {
  /** 오름차순으로 정렬된 슬롯 인덱스. 항상 빈 배열이거나 끊기지 않은 구간이다. */
  selected: number[];
  /** 요청을 거절했을 때 사용자에게 보여줄 이유 */
  notice?: string;
}

export const 비연속안내 = '연속된 시간대만 함께 예약할 수 있습니다.';
export const 가운데해제안내 = '선택은 시작이나 끝 시간대에서만 해제할 수 있습니다.';

/**
 * 슬롯 하나를 켜거나 끈다.
 *
 * 인덱스 인접만 보면 되는 이유: 서버가 운영시간 전체를 빈틈없이 전개해 주므로
 * 인덱스가 이어져 있으면 시간도 이어져 있다. 예약된 슬롯은 화면에서 고를 수 없게
 * 막으므로, 인접 규칙만 지키면 "선택 구간 안에 예약된 슬롯이 끼는" 경우가 생기지 않는다.
 */
export function toggleSlot(selected: number[], index: number): SlotSelection {
  if (selected.length === 0) return { selected: [index] };

  const 정렬 = [...selected].sort((a, b) => a - b);
  const 처음 = 정렬[0];
  const 마지막 = 정렬[정렬.length - 1];

  if (정렬.includes(index)) {
    // 양쪽 끝에서만 줄인다. 가운데를 빼면 구간이 두 조각으로 갈라진다.
    if (index === 처음) return { selected: 정렬.slice(1) };
    if (index === 마지막) return { selected: 정렬.slice(0, -1) };
    return { selected: 정렬, notice: 가운데해제안내 };
  }

  if (index === 처음 - 1) return { selected: [index, ...정렬] };
  if (index === 마지막 + 1) return { selected: [...정렬, index] };

  // 떨어진 슬롯을 누르면 기존 선택을 지우지 않고 거절한다 —
  // 잘못 눌렀을 때 애써 고른 구간이 사라지지 않는 편이 낫다(와이어프레임 9번 "안내 후 재선택 유도").
  return { selected: 정렬, notice: 비연속안내 };
}
