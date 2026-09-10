import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { selectIsAuthenticated, useAuthStore } from '../../features/auth/authStore';

/**
 * 로그인이 필요한 경로를 감싸는 부모 라우트.
 *
 * 이건 클라이언트 가드일 뿐이다. 우회해도 데이터가 새지 않는 이유는 모든 보호 API가
 * 서버에서 토큰을 검증하기 때문이고(원칙 §2.1·§2.2), 이 컴포넌트가 막는 것은
 * "빈 화면에서 401만 잔뜩 받는" 경험이다.
 *
 * 원래 가려던 경로를 `state.from`으로 넘겨, 로그인 후 그 자리로 돌려보낸다.
 */
export default function RequireAuth() {
  const isAuthenticated = useAuthStore(selectIsAuthenticated);
  const location = useLocation();

  if (!isAuthenticated) {
    // replace를 쓰지 않으면 뒤로가기로 로그인 화면과 보호 경로 사이를 무한히 왕복한다.
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return <Outlet />;
}
