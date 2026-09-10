import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { selectIsAuthenticated, useAuthStore } from '../../features/auth/authStore';
import NavMenu, { type NavItem } from './NavMenu';

const 기본메뉴: NavItem[] = [
  { label: '게시판', to: '/boards' },
  { label: '연습실예약', to: '/practice-rooms' },
  { label: '마이페이지', to: '/me' },
];

const 관리자메뉴: NavItem = { label: '관리자', to: '/admin', isAdmin: true };

/**
 * 상단 공통 네비게이션 (와이어프레임 §1). 모든 화면이 공유한다.
 *
 * [관리자] 노출과 로그인·로그아웃 표시는 authStore의 클라이언트 상태만 보고 결정한다.
 * 메뉴를 그리기 위해 서버 데이터를 따로 조회하지 않는다(원칙 §2.1).
 * 이건 어디까지나 표시 제어이고 실제 차단은 서버가 403으로 한다 — 가드를 우회해도
 * 데이터가 새지 않는 구조를 전제한다.
 */
export default function Header() {
  const isAuthenticated = useAuthStore(selectIsAuthenticated);
  const isAdmin = useAuthStore((state) => state.isAdmin);
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const navigate = useNavigate();
  const [열림, set열림] = useState(false);

  const items = isAdmin ? [...기본메뉴, 관리자메뉴] : 기본메뉴;

  const 닫기 = () => set열림(false);

  const 로그아웃 = () => {
    닫기();
    // 서버에 토큰 저장소가 없으므로 실제 폐기는 클라이언트 토큰 삭제다(PRD F-02, ERD §4).
    // 확인 응답용 POST /api/auth/logout 호출은 FE-03에서 붙인다.
    clearAuth();
    navigate('/');
  };

  const 인증항목 = isAuthenticated ? (
    <button type="button" className="nav__link" onClick={로그아웃}>
      로그아웃
    </button>
  ) : (
    <Link to="/login" className="nav__link" onClick={닫기}>
      로그인
    </Link>
  );

  return (
    <nav className="nav">
      <div className="nav__bar">
        <Link to="/" className="nav__mark" onClick={닫기}>
          색연필
        </Link>

        {/* 가로 메뉴와 인증 항목은 768px 이상에서만 보인다.
            모바일 바에는 로고와 햄버거만 두고 메뉴는 펼친 시트로 내린다(와이어프레임 §1). */}
        <span className="nav__menu">
          <NavMenu items={items} />
        </span>

        <span className="nav__auth">{인증항목}</span>

        {/* 아이콘만 있는 버튼이라 aria-label로 이름을 준다. 시각적으로 숨긴 텍스트를
            hidden으로 두면 보조기기에서도 사라져 이름 없는 버튼이 된다. */}
        <button
          type="button"
          className="nav__burger"
          aria-label={열림 ? '메뉴 닫기' : '메뉴'}
          aria-expanded={열림}
          aria-controls="navSheet"
          onClick={() => set열림((이전) => !이전)}
        >
          <span aria-hidden="true">{열림 ? '✕' : '≡'}</span>
        </button>
      </div>

      {열림 && (
        <div className="nav__sheet" id="navSheet">
          <NavMenu items={items} onNavigate={닫기} />
          {인증항목}
        </div>
      )}
    </nav>
  );
}
