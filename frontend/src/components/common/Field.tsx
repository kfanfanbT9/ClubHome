import type { ChangeEvent } from 'react';

interface FieldProps {
  label: string;
  name: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  type?: 'text' | 'email' | 'password' | 'tel';
  /** 입력창 바로 아래에 표시할 오류 문구 (9-style.md §6) */
  error?: string;
  autoComplete?: string;
}

/**
 * 라벨 + 입력창 + 오류 문구 한 벌. 가입·로그인 폼에서 일곱 번 반복되어 분리했다
 * (원칙 §1: 같은 패턴이 3회 이상 반복된 뒤에 공통화).
 *
 * 오류를 `aria-describedby`로 입력창에 묶어두면 보조기기가 "이 입력의 오류"로 읽는다.
 * 문구를 입력창 아래에 두는 것만으로는 시각적으로만 연결된다.
 */
export default function Field({
  label,
  name,
  value,
  onChange,
  type = 'text',
  error,
  autoComplete,
}: FieldProps) {
  const 오류id = `${name}-error`;

  return (
    <div className="field">
      <label className="field__label" htmlFor={name}>
        {label}
      </label>
      <input
        className="field__input"
        id={name}
        name={name}
        type={type}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 오류id : undefined}
      />
      {error && (
        <p className="field__error" id={오류id}>
          {error}
        </p>
      )}
    </div>
  );
}
