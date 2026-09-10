import { Link } from 'react-router-dom';
import { useBoards } from '../features/board/useBoardQueries';
import { useMe } from '../features/member/useMemberQueries';
import type { Board } from '../types';

/**
 * 게시판 목록 (와이어프레임 6번, S-03).
 *
 * 접근 가능 여부는 서버가 준 `canAccess`를 그대로 쓴다. 프론트에서 등급 서열을
 * 다시 계산하지 않는다(원칙 §2.1).
 *
 * 접근 불가 게시판도 링크로 둔다 — 잠금 표시는 예고일 뿐이고, 실제 거절과 그 문구는
 * 게시글 목록에서 서버 403이 내려주는 것을 보여준다(완료조건: "클릭 시 권한 없음 안내").
 */
function 게시판줄({ board }: { board: Board }) {
  const 접근가능 = board.canAccess !== false;

  return (
    <li>
      <Link
        className={접근가능 ? 'board-row' : 'board-row board-row--locked'}
        to={`/boards/${board.id}/posts`}
      >
        <span className="board-row__name">
          {/* 색만으로 구분하지 않는다 — 자물쇠와 "접근불가" 텍스트를 함께 둔다(9-style.md §6) */}
          {!접근가능 && (
            <span className="board-row__lock" aria-hidden="true">
              🔒
            </span>
          )}
          {board.name}
        </span>

        {board.description && <span className="board-row__desc">{board.description}</span>}

        <span className="board-row__grade">
          {접근가능 ? '이용 가능' : `접근불가 · 최소등급 ${board.minGradeLevel} 필요`}
        </span>
      </Link>
    </li>
  );
}

export default function BoardListPage() {
  const boards = useBoards();
  // 내 등급 표시용. 회원 정보는 마이페이지와 같은 캐시를 쓴다.
  const me = useMe();

  return (
    <main className="page">
      <h1 className="page__title">게시판 목록</h1>

      {boards.isPending && <p className="page__note">불러오는 중…</p>}
      {boards.isError && (
        <p className="notice notice--error" role="alert">
          {boards.error.message}
        </p>
      )}

      {boards.data && boards.data.length === 0 && (
        <p className="empty">이용할 수 있는 게시판이 없습니다.</p>
      )}

      {boards.data && boards.data.length > 0 && (
        <ul className="board-list">
          {boards.data.map((board) => (
            <게시판줄 board={board} key={board.id} />
          ))}
        </ul>
      )}

      {me.data && (
        <p className="page__note">
          ※ 내 등급: {me.data.memberGrade.name} (등급 {me.data.memberGrade.gradeLevel})
        </p>
      )}
    </main>
  );
}
