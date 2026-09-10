interface ReadOnlyFieldProps {
  label: string;
  value: string;
  /** "(수정불가)"처럼 값 옆에 붙는 짧은 안내 */
  note?: string;
}

/**
 * 수정할 수 없는 값을 보여주는 한 줄. 입력창처럼 보이면 눌러도 안 바뀌는 칸이 되므로
 * 테두리 없이 글자로만 둔다(9-style.md §6 읽기 전용 필드).
 *
 * `<input readOnly>`를 쓰지 않는 이유: 읽기 전용 input은 포커스를 받아 탭 순서를
 * 차지하면서 아무것도 할 수 없다.
 */
export default function ReadOnlyField({ label, value, note }: ReadOnlyFieldProps) {
  return (
    <div className="field">
      <span className="field__label">{label}</span>
      <p className="field__readonly">
        {value}
        {note && <span className="field__note">{note}</span>}
      </p>
    </div>
  );
}
