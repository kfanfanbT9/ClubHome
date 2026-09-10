import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useBoard, usePosts } from '../features/board/useBoardQueries';
import { formatMonthDay } from '../lib/format';
import type { Post, PostListResponse } from '../types';

/** 페이지 번호는 주소에 둔다 — 새로고침·뒤로가기·링크 공유가 그대로 동작한다. */
function 페이지읽기(값: string | null): number {
  const 숫자 = Number(값);
  return Number.isInteger(숫자) && 숫자 >= 1 ? 숫자 : 1;
}

/**
 * 목록에 보이는 "번호". 게시글 id를 그대로 쓰지 않는 이유는 id가 전체 게시판에서
 * 하나씩 올라가는 값이라, 글이 3개인 게시판에서도 1066 같은 수가 찍히기 때문이다.
 * 와이어프레임 7번의 번호는 게시판 안에서의 순번이다.
 *
 * 서버가 `created_at DESC, id DESC`로 정렬해 최신 글을 먼저 주므로(post-repository)
 * 전체 건수에서 내려오는 방향으로 세면 순번이 맞는다.
 */
function 번호매기기({ totalCount, page, pageSize }: PostListResponse, 순서: number): number {
  return totalCount - (page - 1) * pageSize - 순서;
}

function 게시글줄({ post, 번호 }: { post: Post; 번호: number }) {
  return (
    <li className="post-row">
      <span className="post-row__no">{번호}</span>
      <Link className="post-row__title" to={`/posts/${post.id}`}>
        {post.title}
      </Link>
      <span className="post-row__author">{post.authorName}</span>
      <span className="post-row__date">{formatMonthDay(post.createdAt)}</span>
      <span className="post-row__views">
        {/* 모바일 카드에서는 "조회 34"로 읽히고, PC 표에서는 열 제목이 있어 라벨을 감춘다 */}
        <span className="post-row__views-label">조회 </span>
        {post.viewCount}
      </span>
    </li>
  );
}

/**
 * 게시글 목록 (와이어프레임 7번, S-04).
 *
 * PC는 열 제목이 붙은 표 모양, 모바일은 카드 리스트로 바뀐다. DOM은 하나만 두고
 * CSS로 배치를 바꾼다 — 같은 내용을 두 벌 렌더하면 한쪽만 고치는 일이 생긴다.
 */
export default function PostListPage() {
  const { boardId: 경로파라미터 } = useParams();
  const boardId = Number(경로파라미터);
  const [searchParams, setSearchParams] = useSearchParams();
  const page = 페이지읽기(searchParams.get('page'));

  const { board } = useBoard(boardId);
  const posts = usePosts(boardId, page);

  /**
   * 글쓰기 버튼은 게시판 최소등급을 충족할 때만 노출한다. 읽기와 쓰기의 기준이 같은
   * 최소등급이므로(swagger `POST /api/boards/{boardId}/posts`: "이용가능 최소등급을
   * 충족하는 회원만 작성") 목록이 준 canAccess를 그대로 쓴다.
   * 숨김은 어디까지나 UX이고 실제 차단은 서버 403이다.
   */
  const 작성가능 = board?.canAccess !== false;

  const 마지막페이지 = posts.data
    ? Math.max(1, Math.ceil(posts.data.totalCount / posts.data.pageSize))
    : 1;

  const 페이지이동 = (다음: number) => {
    const 갱신 = new URLSearchParams(searchParams);
    갱신.set('page', String(다음));
    setSearchParams(갱신);
  };

  return (
    <main className="page">
      <div className="page__header">
        <h1 className="page__title">
          <Link className="page__back" to="/boards">
            &lt;
          </Link>{' '}
          {board?.name ?? '게시글 목록'}
        </h1>
        {작성가능 && board && (
          <Link className="button button--primary" to={`/boards/${board.id}/posts/new`}>
            글쓰기
          </Link>
        )}
      </div>

      {posts.isPending && <p className="page__note">불러오는 중…</p>}

      {/* 등급 미달이면 서버가 403과 함께 사용자에게 보여줄 문구를 준다(9-style.md §6). */}
      {posts.isError && (
        <p className="notice notice--error" role="alert">
          {posts.error.message}
        </p>
      )}

      {/* 정말로 글이 없는 게시판 */}
      {posts.data && posts.data.totalCount === 0 && (
        <p className="empty">아직 등록된 게시글이 없습니다.</p>
      )}

      {/**
       * 글은 있는데 이 페이지에만 없는 경우 — `?page=99`를 직접 열거나, 북마크해 둔
       * 3페이지에서 그 사이에 글이 지워지면 여기로 온다. 이때 "글이 없습니다"라고 하면
       * 글이 있는 게시판을 비었다고 알려주는 셈이라, 상황을 그대로 말하고 돌아갈 길을 준다.
       */}
      {posts.data && posts.data.totalCount > 0 && posts.data.items.length === 0 && (
        <p className="empty">
          {page}페이지에는 게시글이 없습니다.{' '}
          <Link className="link" to={`/boards/${boardId}/posts`}>
            첫 페이지로
          </Link>
        </p>
      )}

      {posts.data && posts.data.items.length > 0 && (
        <>
          <div className="post-list">
            {/* PC에서만 보이는 열 제목. 모바일 카드에서는 감춘다. */}
            <div className="post-list__head">
              <span>번호</span>
              <span>제목</span>
              <span>작성자</span>
              <span>작성일</span>
              <span>조회</span>
            </div>
            <ul className="post-list__body">
              {posts.data.items.map((post, 순서) => (
                <게시글줄 post={post} 번호={번호매기기(posts.data, 순서)} key={post.id} />
              ))}
            </ul>
          </div>

          <nav className="pager" aria-label="페이지">
            <button
              type="button"
              className="button button--quiet"
              onClick={() => 페이지이동(page - 1)}
              disabled={page <= 1}
            >
              이전
            </button>
            <span className="pager__now">
              {page} / {마지막페이지}
            </span>
            <button
              type="button"
              className="button button--quiet"
              onClick={() => 페이지이동(page + 1)}
              disabled={page >= 마지막페이지}
            >
              다음
            </button>
          </nav>
        </>
      )}
    </main>
  );
}
