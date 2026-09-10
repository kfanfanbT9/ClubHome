import { useState } from 'react';

interface ConfirmButtonProps {
  /** 평소 보이는 버튼 글자 */
  label: string;
  /** 누른 뒤 묻는 말 */
  question: string;
  진행중?: boolean;
  진행중라벨?: string;
  onConfirm: () => void;
}

/**
 * 한 번 더 묻고 실행하는 버튼.
 *
 * 브라우저 `confirm` 창을 쓰지 않는다 — 9-style.md §6이 "삭제·취소는 확인 절차를
 * 먼저 거친다"고 요구하는 것을 지키면서, 모달 컴포넌트를 새로 만들지 않기 위해
 * 버튼 자리에서 묻는다.
 *
 * 게시글 삭제와 예약 취소 두 곳이 같은 동작을 필요로 해서 분리했다. 한쪽에만 확인
 * 절차가 빠지는 일이 생기지 않게 한 곳에 둔다.
 */
export default function ConfirmButton({
  label,
  question,
  진행중 = false,
  진행중라벨,
  onConfirm,
}: ConfirmButtonProps) {
  const [묻는중, set묻는중] = useState(false);

  if (!묻는중) {
    return (
      <button type="button" className="button button--danger" onClick={() => set묻는중(true)}>
        {label}
      </button>
    );
  }

  return (
    <span className="confirm">
      <span className="confirm__ask">{question}</span>
      <button
        type="button"
        className="button button--danger"
        disabled={진행중}
        onClick={onConfirm}
      >
        {진행중 ? (진행중라벨 ?? '처리 중…') : label}
      </button>
      <button type="button" className="button button--quiet" onClick={() => set묻는중(false)}>
        취소
      </button>
    </span>
  );
}
