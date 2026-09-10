import { Outlet } from 'react-router-dom';
import Header from './Header';

/**
 * 모든 화면이 공유하는 껍데기 (와이어프레임 §1: 상단 공통 네비게이션을 모든 화면에서 공유).
 * 라우트마다 Header를 다시 붙이지 않도록 부모 라우트로 둔다.
 */
export default function Layout() {
  return (
    <>
      <Header />
      <Outlet />
    </>
  );
}
