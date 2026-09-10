import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../../features/auth/authStore';

/**
 * 관리자만 들어갈 수 있는 경로를 감싸는 부모 라우트.
 *
 * **클라이언트 가드일 뿐이다.** 우회해도 데이터가 새지 않는 이유는 모든
 * `/api/admin/*` 엔드포인트가 서버에서 `is_admin`을 검사해 403으로 막기 때문이고
 * (원칙 §2.1·§2.2), 이 컴포넌트가 막는 것은 "관리자 화면을 열었는데 403만 잔뜩
 * 받는" 경험이다.
 *
 * `RequireAuth` 안쪽에 두므로 여기서 로그인 여부는 다시 보지 않는다.
 */
export default function RequireAdmin() {
  const isAdmin = useAuthStore((state) => state.isAdmin);

  // 로그인은 되어 있으므로 로그인 화면이 아니라 홈으로 보낸다.
  if (!isAdmin) return <Navigate to="/" replace />;

  return <Outlet />;
}
