import { Link, useNavigate, useParams } from 'react-router-dom';
import ConfirmButton from '../components/common/ConfirmButton';
import { useAuthStore } from '../features/auth/authStore';
import { useBoard, useDeletePost, usePost } from '../features/board/useBoardQueries';
import { formatDate } from '../lib/format';
import type { Post } from '../types';

function 삭제버튼({ post, boardId }: { post: Post; boardId: number }) {
  const remove = useDeletePost(post.id, boardId);
  const navigate = useNavigate();

  return (
    <ConfirmButton
      label="삭제"
      question="정말 삭제할까요?"
      진행중={remove.isPending}
      진행중라벨="삭제 중…"
      onConfirm={() =>
        remove.mutate(undefined, {
          // 204라 돌아올 본문이 없다. 성공하면 목록으로 보낸다.
          onSuccess: () => navigate(`/boards/${boardId}/posts`, { replace: true }),
        })
      }
    />
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
