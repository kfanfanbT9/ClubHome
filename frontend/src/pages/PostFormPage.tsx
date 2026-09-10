import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Field from '../components/common/Field';
import {
  type PostInput,
  useBoard,
  useCreatePost,
  usePost,
  useUpdatePost,
} from '../features/board/useBoardQueries';

type 오류목록 = Partial<Record<keyof PostInput, string>>;

/** swagger `PostCreateRequest.title.maxLength` 와 같은 값 */
const 제목최대 = 200;

function 검증(값: PostInput): 오류목록 {
  const 오류: 오류목록 = {};
  if (!값.title.trim()) 오류.title = '제목을 입력하세요.';
  else if (값.title.length > 제목최대) 오류.title = `제목은 ${제목최대}자를 넘을 수 없습니다.`;
  if (!값.content.trim()) 오류.content = '내용을 입력하세요.';
  return 오류;
}

interface 글폼Props {
  초기값: PostInput;
  진행중: boolean;
  서버오류?: string;
  취소경로: string;
  버튼라벨: string;
  onSubmit: (값: PostInput) => void;
  onChange: () => void;
}

/** 제목·내용 입력만 담당한다. 어디로 보내는지는 부모가 정한다. */
function 글폼({
  초기값,
  진행중,
  서버오류,
  취소경로,
  버튼라벨,
  onSubmit,
  onChange,
}: 글폼Props) {
  const [값, set값] = useState<PostInput>(초기값);
  const [오류, set오류] = useState<오류목록>({});

  const 제출 = (event: FormEvent) => {
    event.preventDefault();
    const 새오류 = 검증(값);
    set오류(새오류);
    if (Object.keys(새오류).length > 0) return;
    onSubmit(값);
  };

  return (
    <form className="form" onSubmit={제출} noValidate>
      <Field
        label="제목"
        name="title"
        value={값.title}
        error={오류.title}
        onChange={(event) => {
          const 제목 = event.target.value;
          set값((이전) => ({ ...이전, title: 제목 }));
          set오류((이전) => ({ ...이전, title: undefined }));
          onChange();
        }}
      />

      <div className="field">
        <label className="field__label" htmlFor="content">
          내용
        </label>
        <textarea
          className="field__input field__textarea"
          id="content"
          name="content"
          rows={12}
          value={값.content}
          aria-invalid={오류.content ? true : undefined}
          aria-describedby={오류.content ? 'content-error' : undefined}
          onChange={(event) => {
            const 내용 = event.target.value;
            set값((이전) => ({ ...이전, content: 내용 }));
            set오류((이전) => ({ ...이전, content: undefined }));
            onChange();
          }}
        />
        {오류.content && (
          <p className="field__error" id="content-error">
            {오류.content}
          </p>
        )}
      </div>

      {서버오류 && (
        <p className="notice notice--error" role="alert">
          {서버오류}
        </p>
      )}

      <div className="form__actions">
        <button type="submit" className="button button--primary" disabled={진행중}>
          {진행중 ? '저장 중…' : 버튼라벨}
        </button>
        <Link className="button button--quiet" to={취소경로}>
          취소
        </Link>
      </div>
    </form>
  );
}

/** 새 글 (와이어프레임 8-1). 경로: `/boards/:boardId/posts/new` */
function 새글({ boardId }: { boardId: number }) {
  const { board } = useBoard(boardId);
  const create = useCreatePost(boardId);
  const navigate = useNavigate();
  const 목록경로 = `/boards/${boardId}/posts`;

  return (
    <main className="page page--form">
      <h1 className="page__title">
        <Link className="page__back" to={목록경로}>
          &lt; {board?.name ?? '게시판'}
        </Link>{' '}
        - 글쓰기
      </h1>

      <글폼
        초기값={{ title: '', content: '' }}
        진행중={create.isPending}
        서버오류={create.isError ? create.error.message : undefined}
        취소경로={목록경로}
        버튼라벨="등록"
        onChange={() => create.isError && create.reset()}
        onSubmit={(값) =>
          create.mutate(값, {
            // 작성한 글로 바로 보낸다. 목록은 캐시 무효화로 이미 갱신된다.
            onSuccess: (post) => navigate(`/posts/${post.id}`, { replace: true }),
          })
        }
      />
    </main>
  );
}

/**
 * 글 수정. 경로: `/posts/:postId/edit`
 *
 * 상세에서 넘어오면 조회 캐시가 그대로 쓰여 서버를 다시 부르지 않는다 —
 * 상세 조회는 조회수를 올리므로(usePost 주석), 수정 화면을 여는 것만으로
 * 조회수가 오르지 않게 하는 편이 맞다.
 */
function 글수정({ postId }: { postId: number }) {
  const post = usePost(postId);
  const boardId = post.data?.boardId ?? -1;
  const update = useUpdatePost(postId, boardId);
  const navigate = useNavigate();
  const 상세경로 = `/posts/${postId}`;

  return (
    <main className="page page--form">
      <h1 className="page__title">
        <Link className="page__back" to={상세경로}>
          &lt;
        </Link>{' '}
        글 수정
      </h1>

      {post.isPending && <p className="page__note">불러오는 중…</p>}
      {post.isError && (
        <p className="notice notice--error" role="alert">
          {post.error.message}
        </p>
      )}

      {post.data && (
        <글폼
          // key가 없으면 조회가 늦게 끝났을 때 빈 폼이 그대로 남는다.
          key={post.data.id}
          초기값={{ title: post.data.title, content: post.data.content }}
          진행중={update.isPending}
          서버오류={update.isError ? update.error.message : undefined}
          취소경로={상세경로}
          버튼라벨="저장"
          onChange={() => update.isError && update.reset()}
          onSubmit={(값) =>
            update.mutate(값, {
              onSuccess: () => navigate(상세경로, { replace: true }),
            })
          }
        />
      )}
    </main>
  );
}

/**
 * 작성 화면과 수정 화면을 같은 폼으로 처리한다.
 * 어느 쪽인지는 경로 파라미터가 정한다 — `boardId`가 있으면 새 글, `postId`가 있으면 수정.
 */
export default function PostFormPage() {
  const { boardId, postId } = useParams();

  if (postId !== undefined) return <글수정 postId={Number(postId)} />;
  return <새글 boardId={Number(boardId)} />;
}
