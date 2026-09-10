import { type ChangeEvent, type FormEvent, useState } from 'react';
import Field from '../components/common/Field';
import ReadOnlyField from '../components/common/ReadOnlyField';
import { useMe, useUpdateMe } from '../features/member/useMemberQueries';
import { formatDate } from '../lib/format';
import type { Member } from '../types';

type 입력 = { name: string; phone: string };
type 오류목록 = Partial<Record<keyof 입력, string>>;

/** swagger `MemberUpdateRequest`의 maxLength와 같은 값 */
const 이름최대 = 50;
const 연락처최대 = 20;

function 검증(값: 입력): 오류목록 {
  const 오류: 오류목록 = {};

  if (!값.name.trim()) 오류.name = '이름을 입력하세요.';
  else if (값.name.length > 이름최대) 오류.name = `이름은 ${이름최대}자를 넘을 수 없습니다.`;

  if (!값.phone.trim()) 오류.phone = '연락처를 입력하세요.';
  else if (값.phone.length > 연락처최대) {
    오류.phone = `연락처는 ${연락처최대}자를 넘을 수 없습니다.`;
  }

  return 오류;
}

/**
 * 조회 결과로 폼을 채우는 부분. 조회와 폼을 나눈 이유는 둘의 책임이 다르기 때문이고,
 * 실무적으로는 `member`를 초기값으로 useState에 넣을 수 있게 하려는 것이다 —
 * 한 컴포넌트에서 하면 조회가 끝난 뒤 useEffect로 폼을 다시 채워야 한다.
 */
function 내정보폼({ member }: { member: Member }) {
  const [값, set값] = useState<입력>({ name: member.name, phone: member.phone ?? '' });
  const [오류, set오류] = useState<오류목록>({});
  const update = useUpdateMe();

  const 변경 = (키: keyof 입력) => (event: ChangeEvent<HTMLInputElement>) => {
    const 값하나 = event.target.value;
    set값((이전) => ({ ...이전, [키]: 값하나 }));
    set오류((이전) => ({ ...이전, [키]: undefined }));
    /**
     * 입력이 바뀌면 직전 저장 결과(성공·실패 모두)는 더 이상 이 입력에 대한 것이 아니다.
     * 다만 **끝난 결과만** 지운다 — isIdle이 false인 상태에는 "저장 중"도 포함되므로
     * `!isIdle`로 걸면 저장 중에 타이핑한 순간 진행 중인 mutation이 지워지고,
     * 성공 안내와 캐시 무효화가 통째로 사라진다. 입력칸은 비활성이 아니라 밟히는 경로다.
     */
    if (update.isSuccess || update.isError) update.reset();
  };

  const 제출 = (event: FormEvent) => {
    event.preventDefault();
    const 새오류 = 검증(값);
    set오류(새오류);
    if (Object.keys(새오류).length > 0) return;

    update.mutate(값);
  };

  return (
    <form className="form" onSubmit={제출} noValidate>
      {/* 이메일은 로그인 ID이고 등급 변경은 관리자만 가능하다 — 읽기 전용으로 둔다.
          이건 표시 제어일 뿐이고, 실제 보장은 서버가 허용 필드를 이름·연락처로
          제한하는 것이다(BE-04). */}
      <ReadOnlyField label="이메일(ID)" value={member.email} note="(수정불가)" />

      <Field
        label="이름"
        name="name"
        value={값.name}
        onChange={변경('name')}
        error={오류.name}
        autoComplete="name"
      />
      <Field
        label="연락처"
        name="phone"
        type="tel"
        value={값.phone}
        onChange={변경('phone')}
        error={오류.phone}
        autoComplete="tel"
      />

      <ReadOnlyField
        label="회원등급"
        value={member.memberGrade.name}
        note="(변경은 관리자만 가능)"
      />
      <ReadOnlyField label="가입일" value={formatDate(member.joinedAt)} />

      {update.isSuccess && (
        <p className="notice notice--success" role="status">
          저장했습니다.
        </p>
      )}
      {update.isError && (
        <p className="notice notice--error" role="alert">
          {update.error.message}
        </p>
      )}

      <button type="submit" className="button button--primary" disabled={update.isPending}>
        {update.isPending ? '저장 중…' : '저장'}
      </button>
    </form>
  );
}

/**
 * 마이페이지 (와이어프레임 5번, S-02).
 */
export default function MyPage() {
  const { data: member, isPending, isError, error } = useMe();

  return (
    <main className="page page--form">
      <h1 className="page__title">마이페이지</h1>

      {isPending && <p className="page__note">불러오는 중…</p>}
      {isError && (
        <p className="notice notice--error" role="alert">
          {error.message}
        </p>
      )}
      {/* key를 회원ID로 주면 다른 회원 정보가 오면 폼이 새로 초기화된다.
          로그아웃 후 다른 계정으로 들어왔을 때 이전 값이 남지 않는다. */}
      {member && <내정보폼 member={member} key={member.id} />}
    </main>
  );
}
