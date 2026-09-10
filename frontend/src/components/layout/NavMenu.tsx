import { Link } from 'react-router-dom';

export interface NavItem {
  label: string;
  to: string;
  /** 관리자 메뉴는 강조색으로 구분한다 */
  isAdmin?: boolean;
}

interface NavMenuProps {
  items: NavItem[];
  /** 메뉴를 눌렀을 때 알림 — 모바일 펼친 메뉴를 닫는 데 쓴다 */
  onNavigate?: () => void;
}

/**
 * 메뉴 링크 목록만 그리는 UI 조각. 상태나 API에 직접 접근하지 않고 props로만 받는다(원칙 §2.1).
 * 가로 메뉴바(PC)와 펼친 메뉴(모바일) 두 곳에서 같은 목록을 쓰기 때문에 분리했다 —
 * 목록을 두 번 적으면 메뉴가 하나 늘 때 한쪽만 고치는 일이 생긴다.
 */
export default function NavMenu({ items, onNavigate }: NavMenuProps) {
  return (
    <>
      {items.map(({ label, to, isAdmin }) => (
        <Link
          key={to}
          to={to}
          className={isAdmin ? 'nav__link nav__link--admin' : 'nav__link'}
          onClick={onNavigate}
        >
          {label}
        </Link>
      ))}
    </>
  );
}
