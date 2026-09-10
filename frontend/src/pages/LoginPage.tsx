import { type ChangeEvent, type FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Field from '../components/common/Field';
import { useLogin } from '../features/auth/useAuth';
import { isValidEmail } from '../lib/validation';

type 입력 = { email: string; password: string };
type 오류목록 = Partial<Record<keyof 입력, string>>;

function 검증(값: 입력): 오류목록 {
  const 오류: 오류목록 = {};
  if (!값.email.trim()) 오류.email = '이메일을 입력하세요.';
  else if (!isValidEmail(값.email)) 오류.email = '이메일 형식이 올바르지 않습니다.';
  if (!값.password) 오류.password = '비밀번호를 입력하세요.';
  return 오류;
}

/**
 * 로그인 화면 (와이어프레임 4번, S-01).
 *
 * 로그인 성공 후에는 원래 가려던 경로로 돌아간다. 보호 경로에서 튕겨 온 경우
 * RequireAuth가 `state.from`에 그 경로를 실어 보낸다.
 */
export default function LoginPage() {
  const [값, set값] = useState<입력>({ email: '', password: '' });
  const [오류, set오류] = useState<오류목록>({});
  const login = useLogin();
  const navigate = useNavigate();
  const location = useLocation();

  const 전달상태 = location.state as { from?: string; signedUp?: boolean } | null;
  const 돌아갈경로 = 전달상태?.from ?? '/';

  const 변경 = (키: keyof 입력) => (event: ChangeEvent<HTMLInputElement>) => {
    const 값하나 = event.target.value;
    set값((이전) => ({ ...이전, [키]: 값하나 }));
    // 고치는 중에 이전 오류가 남아 있으면 이미 해결한 문제를 계속 지적하는 셈이 된다.
    set오류((이전) => ({ ...이전, [키]: undefined }));
  };

  const 제출 = (event: FormEvent) => {
    event.preventDefault();
    const 새오류 = 검증(값);
    set오류(새오류);
    if (Object.keys(새오류).length > 0) return;

    login.mutate(값, {
      onSuccess: () => navigate(돌아갈경로, { replace: true }),
    });
  };

  return (
    <main className="page page--form">
      <h1 className="page__title">로그인</h1>

      {전달상태?.signedUp && (
        <p className="notice notice--success">가입이 완료되었습니다. 로그인해 주세요.</p>
      )}

      <form className="form" onSubmit={제출} noValidate>
        <Field
          label="이메일(ID)"
          name="email"
          type="email"
          value={값.email}
          onChange={변경('email')}
          error={오류.email}
          autoComplete="email"
        />
        <Field
          label="비밀번호"
          name="password"
          type="password"
          value={값.password}
          onChange={변경('password')}
          error={오류.password}
          autoComplete="current-password"
        />

        {/* 백엔드가 4xx에 사용자 노출 가능한 문구만 담으므로 message를 그대로 보여준다
            (9-style.md §6). 401은 비밀번호 불일치, 403은 탈퇴 계정 안내가 내려온다. */}
        {login.isError && (
          <p className="notice notice--error" role="alert">
            {login.error.message}
          </p>
        )}

        <button type="submit" className="button button--primary" disabled={login.isPending}>
          {login.isPending ? '로그인 중…' : '로그인'}
        </button>
      </form>

      <p className="form__footer">
        아직 회원이 아니신가요?{' '}
        <Link className="link" to="/signup">
          회원가입
        </Link>
      </p>
    </main>
  );
}
