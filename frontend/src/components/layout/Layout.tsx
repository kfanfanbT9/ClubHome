import { Outlet, useLocation } from 'react-router-dom';
import ErrorBoundary from '../common/ErrorBoundary';
import Header from './Header';

/**
 * 모든 화면이 공유하는 껍데기 (와이어프레임 §1: 상단 공통 네비게이션을 모든 화면에서 공유).
 * 라우트마다 Header를 다시 붙이지 않도록 부모 라우트로 둔다.
 */
export default function Layout() {
  const location = useLocation();

  return (
    <>
      <Header />
      {/*
        본문만 감싼다 — 화면 하나가 터져도 상단 메뉴는 남아 있어야 다른 곳으로 갈 수 있다.
        전체를 감싸면 메뉴까지 사라져 새로고침 외에는 빠져나갈 방법이 없다.

        key에 경로를 넣는 이유: 오류 경계는 한 번 오류 상태가 되면 스스로 풀리지 않는다.
        경로가 바뀔 때 remount 시켜 상태를 비우지 않으면, 메뉴를 눌러 다른 화면으로
        이동해도 오류 화면이 그대로 남는다.
      */}
      <ErrorBoundary key={location.pathname}>
        <Outlet />
      </ErrorBoundary>
    </>
  );
}
