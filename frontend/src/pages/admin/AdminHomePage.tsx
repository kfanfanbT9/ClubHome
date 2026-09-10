import { Link } from 'react-router-dom';

/** 관리자 메뉴 입구. 화면 12·13·14로 가는 길만 둔다. */
export default function AdminHomePage() {
  return (
    <main className="page">
      <h1 className="page__title">관리자</h1>

      <ul className="board-list">
        <li>
          <Link className="board-row" to="/admin/members">
            <span className="board-row__name">회원 등급 관리</span>
            <span className="board-row__desc">회원 검색, 등급 변경, 등급 체계 관리</span>
          </Link>
        </li>
        <li>
          <Link className="board-row" to="/admin/boards">
            <span className="board-row__name">게시판 관리</span>
            <span className="board-row__desc">게시판 생성·수정·삭제, 최소등급과 사용여부</span>
          </Link>
        </li>
        <li>
          <Link className="board-row" to="/admin/practice-rooms">
            <span className="board-row__name">연습실 관리</span>
            <span className="board-row__desc">연습실 등록·수정·삭제, 예약 현황과 강제 취소</span>
          </Link>
        </li>
      </ul>
    </main>
  );
}
