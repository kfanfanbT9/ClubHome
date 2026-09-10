import { type ChangeEvent, type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import Field from '../components/common/Field';
import { useSignup } from '../features/auth/useAuth';
import { PASSWORD_MIN_LENGTH, isValidEmail } from '../lib/validation';

type 입력 = {
  name: string;
  email: string;
  password: string;
  passwordConfirm: string;
  phone: string;
};
type 오류목록 = Partial<Record<keyof 입력, string>>;

const 빈값: 입력 = { name: '', email: '', password: '', passwordConfirm: '', phone: '' };

function 검증(값: 입력): 오류목록 {
  const 오류: 오류목록 = {};

  if (!값.name.trim()) 오류.name = '이름을 입력하세요.';
  if (!값.email.trim()) 오류.email = '이메일을 입력하세요.';
  else if (!isValidEmail(값.email)) 오류.email = '이메일 형식이 올바르지 않습니다.';

  if (!값.password) 오류.password = '비밀번호를 입력하세요.';
  else if (값.password.length < PASSWORD_MIN_LENGTH) {
    오류.password = `비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`;
  }

  // 비밀번호 확인은 서버로 보내지 않는다. 오타를 알아채는 것이 목적이라 클라이언트에만 있다.
  if (!값.passwordConfirm) 오류.passwordConfirm = '비밀번호를 한 번 더 입력하세요.';
  else if (값.password !== 값.passwordConfirm) {
    오류.passwordConfirm = '비밀번호가 일치하지 않습니다.';
  }

  if (!값.phone.trim()) 오류.phone = '연락처를 입력하세요.';

  return 오류;
}

/**
 * 회원가입 화면 (와이어프레임 3번, S-01).
 *
 * 가입 응답에는 토큰이 없다(201 + Member). S-01도 가입 뒤 별도로 로그인하는 흐름이라
 * 자동 로그인을 만들지 않고 로그인 화면으로 보낸다.
 */
export default function SignupPage() {
  const [값, set값] = useState<입력>(빈값);
  const [오류, set오류] = useState<오류목록>({});
  const signup = useSignup();
  const navigate = useNavigate();

  const 변경 = (키: keyof 입력) => (event: ChangeEvent<HTMLInputElement>) => {
    const 값하나 = event.target.value;
    set값((이전) => ({ ...이전, [키]: 값하나 }));
    set오류((이전) => ({ ...이전, [키]: undefined }));
  };

  const 제출 = (event: FormEvent) => {
    event.preventDefault();
    const 새오류 = 검증(값);
    set오류(새오류);
    if (Object.keys(새오류).length > 0) return;

    // passwordConfirm은 서버 스키마에 없으므로 보내지 않는다.
    signup.mutate(
      { name: 값.name, email: 값.email, password: 값.password, phone: 값.phone },
      { onSuccess: () => navigate('/login', { state: { signedUp: true }, replace: true }) },
    );
  };

  /**
   * 이메일 중복(409)은 이메일 칸 문제이므로 그 칸 아래에 붙인다 — 와이어프레임 3번이
   * "이메일 중복/형식 오류 시 인라인 에러 메시지"를 요구한다.
   * 그 외 오류(400 등)는 어느 칸 문제인지 알 수 없어 폼 전체 안내로 보여준다.
   */
  const 중복오류 =
    signup.error instanceof ApiError && signup.error.status === 409
      ? signup.error.message
      : undefined;
  const 폼오류 = signup.isError && !중복오류 ? signup.error.message : undefined;

  return (
    <main className="page page--form">
      <h1 className="page__title">회원가입</h1>

      <form className="form" onSubmit={제출} noValidate>
        <Field
          label="이름"
          name="name"
          value={값.name}
          onChange={변경('name')}
          error={오류.name}
          autoComplete="name"
        />
        <Field
          label="이메일(ID)"
          name="email"
          type="email"
          value={값.email}
          onChange={변경('email')}
          error={오류.email ?? 중복오류}
          autoComplete="email"
        />
        <Field
          label="비밀번호"
          name="password"
          type="password"
          value={값.password}
          onChange={변경('password')}
          error={오류.password}
          autoComplete="new-password"
        />
        <Field
          label="비밀번호 확인"
          name="passwordConfirm"
          type="password"
          value={값.passwordConfirm}
          onChange={변경('passwordConfirm')}
          error={오류.passwordConfirm}
          autoComplete="new-password"
        />
        <Field
          label="연락처"
          name="phone"
          type="tel"
          value={값.phone}
          onChange={변경('phone')}
          error={오류.phone}
          autoComplete="tel"
        />

        {폼오류 && (
          <p className="notice notice--error" role="alert">
            {폼오류}
          </p>
        )}

        <button type="submit" className="button button--primary" disabled={signup.isPending}>
          {signup.isPending ? '가입 중…' : '가입하기'}
        </button>
      </form>

      <p className="form__footer">
        이미 계정이 있으신가요?{' '}
        <Link className="link" to="/login">
          로그인
        </Link>
      </p>
    </main>
  );
}
