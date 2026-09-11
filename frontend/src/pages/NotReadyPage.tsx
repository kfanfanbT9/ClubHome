import { Link, useLocation } from 'react-router-dom';

/**
 * 정의되지 않은 경로를 받는 화면 (라우트 폴백, `App.tsx`의 `path="*"`).
 *
 * 원래는 "아직 만들지 않은 화면" 자리였다. 메뉴 링크를 최종 경로로 미리 걸어두고
 * 화면이 완성될 때까지 이 한 장으로 받았기 때문이다. 모든 화면이 완성된 지금은
 * **잘못된 주소 안내**만 남는다 — 문구도 그에 맞춘다. 배포 후 주소를 잘못 입력한
 * 사용자에게 "준비 중"이라고 답하면 없는 페이지를 기다리게 만든다.
 *
 * 요청한 경로를 그대로 보여주는 이유는, 오타인지 바뀐 주소인지 사용자가 스스로
 * 판단할 수 있게 하기 위해서다.
 */
export default function NotReadyPage() {
  const location = useLocation();

  return (
    <main className="page">
      <h1 className="page__title">페이지를 찾을 수 없습니다</h1>

      <p className="page__note">
        요청한 경로: <code>{`${location.pathname}${location.search}`}</code>
      </p>

      <p className="page__note">
        주소가 잘못되었거나 더 이상 사용하지 않는 경로입니다.{' '}
        <Link className="link" to="/">
          홈으로 돌아가기
        </Link>
      </p>
    </main>
  );
}
