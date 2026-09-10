import { type FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import Field from '../../components/common/Field';
import {
  type MemberGradeInput,
  useAdminMembers,
  useChangeMemberGrade,
  useCreateMemberGrade,
  useMemberGrades,
} from '../../features/admin/useAdminQueries';
import type { Member, MemberGrade } from '../../types';

/** 회원 한 줄: 현재 등급을 보여주고 드롭다운으로 바꿔 저장한다. */
function 회원줄({ member, grades }: { member: Member; grades: MemberGrade[] }) {
  const [고른등급, set고른등급] = useState(member.memberGradeId);
  const change = useChangeMemberGrade();
  const 바뀐게있다 = 고른등급 !== member.memberGradeId;

  return (
    <li className="adm-row">
      <span className="adm-row__main">{member.name}</span>
      <span className="adm-row__sub">{member.email}</span>
      <span className="adm-row__sub">현재등급: {member.memberGrade.name}</span>
      <span className="adm-row__manage">
        <select
          className="field__input"
          aria-label={`${member.name} 등급`}
          value={고른등급}
          onChange={(event) => {
            set고른등급(Number(event.target.value));
            if (!change.isIdle) change.reset();
          }}
        >
          {grades.map((grade) => (
            <option value={grade.id} key={grade.id}>
              {grade.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="button button--primary"
          // 바꾸지 않았으면 저장할 것이 없다.
          disabled={!바뀐게있다 || change.isPending}
          onClick={() => change.mutate({ memberId: member.id, memberGradeId: 고른등급 })}
        >
          {change.isPending ? '저장 중…' : '저장'}
        </button>
      </span>

      {change.isSuccess && (
        <p className="adm-row__ok" role="status">
          등급을 변경했습니다.
        </p>
      )}
      {change.isError && (
        <p className="adm-row__error" role="alert">
          {change.error.message}
        </p>
      )}
    </li>
  );
}

/** 등급 체계 관리 영역 (와이어프레임 12번 하단). */
function 등급체계({ grades }: { grades: MemberGrade[] }) {
  const [열림, set열림] = useState(false);
  const [값, set값] = useState<MemberGradeInput>({ name: '', gradeLevel: 0, isAdmin: false });
  const [오류, set오류] = useState<Partial<Record<'name' | 'gradeLevel', string>>>({});
  const create = useCreateMemberGrade();

  const 제출 = (event: FormEvent) => {
    event.preventDefault();
    const 새오류: typeof 오류 = {};
    if (!값.name.trim()) 새오류.name = '등급명을 입력하세요.';
    if (!Number.isInteger(값.gradeLevel) || 값.gradeLevel <= 0) {
      새오류.gradeLevel = '등급서열은 1 이상의 정수여야 합니다.';
    }
    set오류(새오류);
    if (Object.keys(새오류).length > 0) return;

    create.mutate(값, {
      onSuccess: () => {
        set열림(false);
        set값({ name: '', gradeLevel: 0, isAdmin: false });
      },
    });
  };

  /** 등급명·서열 중복은 409로 온다. 어느 칸 문제인지 서버가 구분해 주지 않아 폼 오류로 보여준다. */
  const 중복 = create.error instanceof ApiError && create.error.status === 409;

  return (
    <section className="adm-section">
      <h2 className="adm-section__title">등급 체계 관리</h2>

      <p className="adm-grades">
        {grades
          .slice()
          .sort((a, b) => a.gradeLevel - b.gradeLevel)
          .map((grade) => (
            <span className="badge" key={grade.id}>
              {grade.name} ({grade.gradeLevel}){grade.isAdmin && ' · 관리자'}
            </span>
          ))}
        {!열림 && (
          <button type="button" className="button button--quiet" onClick={() => set열림(true)}>
            + 등급 추가
          </button>
        )}
      </p>

      {열림 && (
        <form className="form" onSubmit={제출} noValidate>
          <Field
            label="등급명"
            name="gradeName"
            value={값.name}
            error={오류.name}
            onChange={(event) => {
              const name = event.target.value;
              set값((이전) => ({ ...이전, name }));
              set오류((이전) => ({ ...이전, name: undefined }));
              if (create.isError) create.reset();
            }}
          />
          <Field
            label="등급서열 (높을수록 상위)"
            name="gradeLevel"
            value={값.gradeLevel ? String(값.gradeLevel) : ''}
            error={오류.gradeLevel}
            onChange={(event) => {
              const gradeLevel = Number(event.target.value);
              set값((이전) => ({ ...이전, gradeLevel }));
              set오류((이전) => ({ ...이전, gradeLevel: undefined }));
              if (create.isError) create.reset();
            }}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={값.isAdmin}
              onChange={(event) => set값((이전) => ({ ...이전, isAdmin: event.target.checked }))}
            />
            관리자 권한 등급
          </label>

          {create.isError && (
            <p className="notice notice--error" role="alert">
              {create.error.message}
              {중복 && ' 등급명과 등급서열은 서로 겹칠 수 없습니다.'}
            </p>
          )}

          <div className="form__actions">
            <button type="submit" className="button button--primary" disabled={create.isPending}>
              {create.isPending ? '저장 중…' : '저장'}
            </button>
            <button
              type="button"
              className="button button--quiet"
              onClick={() => {
                set열림(false);
                set오류({});
                create.reset();
              }}
            >
              취소
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/**
 * 회원 등급 관리 (와이어프레임 12번, S-07).
 *
 * 검색어를 주소에 둬서 새로고침·링크 공유가 그대로 동작한다.
 */
export default function MemberGradeAdminPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const 검색어 = searchParams.get('q') ?? '';
  const [입력, set입력] = useState(검색어);

  const members = useAdminMembers(검색어 || undefined);
  const grades = useMemberGrades();

  const 검색 = (event: FormEvent) => {
    event.preventDefault();
    const 갱신 = new URLSearchParams(searchParams);
    if (입력.trim()) 갱신.set('q', 입력.trim());
    else 갱신.delete('q');
    setSearchParams(갱신);
  };

  return (
    <main className="page">
      <h1 className="page__title">
        <Link className="page__back" to="/admin">
          &lt; 관리자
        </Link>{' '}
        - 회원 등급 관리
      </h1>

      <form className="search" onSubmit={검색}>
        <label className="picker__field">
          <span className="field__label">검색 (이름 또는 이메일)</span>
          <span className="search__row">
            <input
              className="field__input"
              id="q"
              name="q"
              value={입력}
              onChange={(event) => set입력(event.target.value)}
            />
            <button type="submit" className="button button--quiet">
              검색
            </button>
          </span>
        </label>
      </form>

      {(members.isPending || grades.isPending) && <p className="page__note">불러오는 중…</p>}

      {members.isError && (
        <p className="notice notice--error" role="alert">
          {members.error.message}
        </p>
      )}

      {members.data && members.data.length === 0 && (
        <p className="empty">
          {검색어 ? `"${검색어}"에 해당하는 회원이 없습니다.` : '회원이 없습니다.'}
        </p>
      )}

      {members.data && members.data.length > 0 && grades.data && (
        <ul className="adm-list">
          {members.data.map((member) => (
            /**
             * key에 등급을 섞지 않는다. 섞으면 변경 후 재조회에서 등급이 바뀌는 순간
             * 줄이 remount 되어 "등급을 변경했습니다" 안내가 곧바로 사라진다 —
             * 실제로 브라우저에서 안내가 한 번도 보이지 않았다.
             * 드롭다운은 그대로 새 등급을 가리키고 있으므로 저장 버튼은 자연히 비활성이 된다.
             */
            <회원줄 member={member} grades={grades.data} key={member.id} />
          ))}
        </ul>
      )}

      {grades.data && <등급체계 grades={grades.data} />}
    </main>
  );
}
