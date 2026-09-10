import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '../features/auth/authStore';
import { useBoard, useDeletePost, usePost } from '../features/board/useBoardQueries';
import { formatDate } from '../lib/format';
import type { Post } from '../types';

/**
 * 삭제 확인. 브라우저 confirm 창을 쓰지 않고 버튼 자리에서 한 번 더 묻는다 —
 * 9-style.md §6이 "삭제·취소는 확인 절차를 먼저 거친다"고 요구하는 것을 지키면서,
 * 모달 컴포넌트를 미리 만들지 않는다(원칙 §1 조기 추상화 금지).
 */
function 삭제버튼({ post, boardId }: { post: Post; boardId: number }) {
  const [묻는중, set묻는중] = useState(false);
  const remove = useDeletePost(post.id, boardId);
  const navigate = useNavigate();

  if (!묻는중) {
    return (
      <button type="button" className="button button--danger" onClick={() => set묻는중(true)}>
        삭제
      </button>
    );
  }

  return (
    <span className="confirm">
      <span className="confirm__ask">정말 삭제할까요?</span>
      <button
        type="button"
        className="button button--danger"
        disabled={remove.isPending}
        onClick={() =>
          remove.mutate(undefined, {
            // 204라 돌아올 본문이 없다. 성공하면 목록으로 보낸다.
            onSuccess: () => navigate(`/boards/${boardId}/posts`, { replace: true }),
          })
        }
      >
        {remove.isPending ? '삭제 중…' : '삭제'}
      </button>
      <button type="button" className="button button--quiet" onClick={() => set묻는중(false)}>
        취소
      </button>
    </span>
  );
}

/**
 * 게시글 상세 (와이어프레임 8-2, S-04).
 *
 * 조회수는 서버가 이 조회에서 올린다. 프론트에서 증가 요청을 따로 보내지 않는다.
 */
export default function PostDetailPage() {
  const { postId: 경로파라미터 } = useParams();
  const postId = Number(경로파라미터);
  const post = usePost(postId);
  const { board } = useBoard(post.data?.boardId ?? -1);

  const memberId = useAuthStore((state) => state.memberId);
  const isAdmin = useAuthStore((state) => state.isAdmin);

  /**
   * 수정·삭제 버튼 노출 판정 (도메인 정의서 §6).
   * 표시 제어일 뿐이고 실제 차단은 서버의 403이다 — 버튼을 감췄다는 이유로
   * 서버 검증에 기대지 않는다.
   */
  const 고칠수있다 = post.data ? post.data.memberId === memberId || isAdmin : false;

  const 목록경로 = post.data ? `/boards/${post.data.boardId}/posts` : '/boards';

  return (
    <main className="page">
      {post.isPending && <p className="page__note">불러오는 중…</p>}

      {post.isError && (
        <p className="notice notice--error" role="alert">
          {post.error.message}
        </p>
      )}

      {post.data && (
        <article className="post">
          <p className="post__board">
            <Link className="page__back" to={목록경로}>
              &lt; {board?.name ?? '목록'}
            </Link>
          </p>

          <h1 className="page__title">{post.data.title}</h1>

          <p className="post__meta">
            <span>작성자: {post.data.authorName}</span>
            <span>작성일: {formatDate(post.data.createdAt)}</span>
            <span>조회수: {post.data.viewCount}</span>
          </p>

          {/* 본문의 줄바꿈을 그대로 살린다. HTML로 해석하지 않으므로 입력이 태그를 담아도 글자로만 보인다. */}
          <div className="post__content">{post.data.content}</div>

          <div className="post__actions">
            <Link className="button button--quiet" to={목록경로}>
              목록
            </Link>

            {고칠수있다 && (
              <span className="post__owner-actions">
                <Link className="button button--quiet" to={`/posts/${post.data.id}/edit`}>
                  수정
                </Link>
                <삭제버튼 post={post.data} boardId={post.data.boardId} />
              </span>
            )}
          </div>
        </article>
      )}
    </main>
  );
}
