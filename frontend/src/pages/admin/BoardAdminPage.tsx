import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../api/client';
import ConfirmButton from '../../components/common/ConfirmButton';
import Field from '../../components/common/Field';
import {
  type BoardInput,
  useAdminBoards,
  useCreateBoard,
  useDeleteBoard,
  useMemberGrades,
} from '../../features/admin/useAdminQueries';
import type { Board, MemberGrade } from '../../types';
import { useUpdateBoard } from '../../features/admin/useAdminQueries';

type 오류목록 = Partial<Record<'name' | 'minGradeLevel', string>>;

function 검증(값: BoardInput): 오류목록 {
  const 오류: 오류목록 = {};
  if (!값.name.trim()) 오류.name = '게시판명을 입력하세요.';
  else if (값.name.length > 100) 오류.name = '게시판명은 100자를 넘을 수 없습니다.';
  if (!Number.isInteger(값.minGradeLevel)) 오류.minGradeLevel = '최소등급을 선택하세요.';
  return 오류;
}

/** 생성·수정 공용 폼 (와이어프레임 13번 하단). */
function 게시판폼({
  초기값,
  grades,
  진행중,
  서버오류,
  onSubmit,
  onCancel,
  onChange,
}: {
  초기값: BoardInput;
  grades: MemberGrade[];
  진행중: boolean;
  서버오류?: string;
  onSubmit: (값: BoardInput) => void;
  onCancel: () => void;
  onChange: () => void;
}) {
  const [값, set값] = useState<BoardInput>(초기값);
  const [오류, set오류] = useState<오류목록>({});

  const 제출 = (event: FormEvent) => {
    event.preventDefault();
    const 새오류 = 검증(값);
    set오류(새오류);
    if (Object.keys(새오류).length > 0) return;
    onSubmit(값);
  };

  return (
    <form className="form adm-form" onSubmit={제출} noValidate>
      <Field
        label="게시판명"
        name="boardName"
        value={값.name}
        error={오류.name}
        onChange={(event) => {
          const name = event.target.value;
          set값((이전) => ({ ...이전, name }));
          set오류((이전) => ({ ...이전, name: undefined }));
          onChange();
        }}
      />
      <Field
        label="설명"
        name="boardDescription"
        value={값.description ?? ''}
        onChange={(event) => {
          const description = event.target.value;
          set값((이전) => ({ ...이전, description }));
          onChange();
        }}
      />

      <div className="field">
        <label className="field__label" htmlFor="minGradeLevel">
          이용가능 최소등급
        </label>
        <select
          className="field__input"
          id="minGradeLevel"
          value={값.minGradeLevel}
          onChange={(event) => {
            const minGradeLevel = Number(event.target.value);
            set값((이전) => ({ ...이전, minGradeLevel }));
            onChange();
          }}
        >
          {grades
            .slice()
            .sort((a, b) => a.gradeLevel - b.gradeLevel)
            .map((grade) => (
              // 게시판이 참조하는 것은 등급 id가 아니라 등급서열이다(ERD §3).
              <option value={grade.gradeLevel} key={grade.id}>
                {grade.name} ({grade.gradeLevel}) 이상
              </option>
            ))}
        </select>
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={값.isActive}
          onChange={(event) => {
            const isActive = event.target.checked;
            set값((이전) => ({ ...이전, isActive }));
            onChange();
          }}
        />
        사용 (끄면 일반 회원 목록에서 숨는다)
      </label>

      {서버오류 && (
        <p className="notice notice--error" role="alert">
          {서버오류}
        </p>
      )}

      <div className="form__actions">
        <button type="submit" className="button button--primary" disabled={진행중}>
          {진행중 ? '저장 중…' : '저장'}
        </button>
        <button type="button" className="button button--quiet" onClick={onCancel}>
          취소
        </button>
      </div>
    </form>
  );
}

function 수정폼({
  board,
  grades,
  onClose,
}: {
  board: Board;
  grades: MemberGrade[];
  onClose: () => void;
}) {
  const update = useUpdateBoard(board.id);

  return (
    <게시판폼
      초기값={{
        name: board.name,
        description: board.description ?? '',
        minGradeLevel: board.minGradeLevel,
        isActive: board.isActive,
      }}
      grades={grades}
      진행중={update.isPending}
      서버오류={update.isError ? update.error.message : undefined}
      onChange={() => update.isError && update.reset()}
      onCancel={onClose}
      onSubmit={(값) => update.mutate(값, { onSuccess: onClose })}
    />
  );
}

function 게시판줄({ board, grades }: { board: Board; grades: MemberGrade[] }) {
  const [수정중, set수정중] = useState(false);
  const remove = useDeleteBoard();

  /**
   * 참조 중인 게시글이 있으면 서버가 409로 막는다(FK RESTRICT, ERD §4).
   * 그때는 지우는 대신 사용여부를 끄라고 안내한다 — 운영상 그게 자연스러운 경로다.
   */
  const 참조중 = remove.error instanceof ApiError && remove.error.status === 409;

  return (
    <li className="adm-row">
      <span className="adm-row__main">{board.name}</span>
      <span className="adm-row__sub">최소등급 {board.minGradeLevel} 이상</span>
      <span className={board.isActive ? 'badge' : 'badge badge--off'}>
        {board.isActive ? '활성' : '비활성'}
      </span>
      <span className="adm-row__manage">
        <button
          type="button"
          className="button button--quiet"
          onClick={() => set수정중((이전) => !이전)}
        >
          {수정중 ? '수정 닫기' : '수정'}
        </button>
        <ConfirmButton
          label="삭제"
          question="이 게시판을 삭제할까요?"
          진행중={remove.isPending && remove.variables === board.id}
          진행중라벨="삭제 중…"
          onConfirm={() => remove.mutate(board.id)}
        />
      </span>

      {remove.isError && remove.variables === board.id && (
        <p className="adm-row__error" role="alert">
          {remove.error.message}
          {참조중 && ' 대신 사용여부를 비활성으로 바꾸면 일반 회원 목록에서 숨겨집니다.'}
        </p>
      )}

      {수정중 && <수정폼 board={board} grades={grades} onClose={() => set수정중(false)} />}
    </li>
  );
}

/**
 * 게시판 관리 (와이어프레임 13번, S-08).
 *
 * 목록은 관리자용 `GET /api/admin/boards`를 쓴다 — 일반 회원용은 비활성 게시판을
 * 숨기므로 관리 화면에서 그것을 다시 켤 방법이 없어진다.
 */
export default function BoardAdminPage() {
  const boards = useAdminBoards();
  const grades = useMemberGrades();
  const create = useCreateBoard();
  const [만드는중, set만드는중] = useState(false);

  const 최저등급 = grades.data
    ? Math.min(...grades.data.map((grade) => grade.gradeLevel))
    : 0;

  return (
    <main className="page">
      <div className="page__header">
        <h1 className="page__title">
          <Link className="page__back" to="/admin">
            &lt; 관리자
          </Link>{' '}
          - 게시판 관리
        </h1>
        {!만드는중 && grades.data && (
          <button
            type="button"
            className="button button--primary"
            onClick={() => set만드는중(true)}
          >
            + 게시판 생성
          </button>
        )}
      </div>

      {만드는중 && grades.data && (
        <게시판폼
          초기값={{ name: '', description: '', minGradeLevel: 최저등급, isActive: true }}
          grades={grades.data}
          진행중={create.isPending}
          서버오류={create.isError ? create.error.message : undefined}
          onChange={() => create.isError && create.reset()}
          onCancel={() => {
            set만드는중(false);
            create.reset();
          }}
          onSubmit={(값) => create.mutate(값, { onSuccess: () => set만드는중(false) })}
        />
      )}

      {(boards.isPending || grades.isPending) && <p className="page__note">불러오는 중…</p>}

      {boards.isError && (
        <p className="notice notice--error" role="alert">
          {boards.error.message}
        </p>
      )}

      {boards.data && boards.data.length === 0 && <p className="empty">게시판이 없습니다.</p>}

      {boards.data && grades.data && boards.data.length > 0 && (
        <ul className="adm-list">
          {boards.data.map((board) => (
            <게시판줄 board={board} grades={grades.data} key={board.id} />
          ))}
        </ul>
      )}
    </main>
  );
}
