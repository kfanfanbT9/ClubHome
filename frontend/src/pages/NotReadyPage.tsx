import { Link, useLocation } from 'react-router-dom';

/**
 * 아직 만들지 않은 화면 자리.
 *
 * 메뉴 링크는 FE-02에서 최종 경로(`/boards`, `/practice-rooms`, `/me`, `/admin`)로
 * 미리 걸어둔다 — 각 화면 이슈가 라우트만 추가하면 바로 이어지기 때문이다.
 * 다만 그 사이에 메뉴를 누르면 헤더 아래가 빈 화면이 되므로, 이 한 화면으로 받아둔다.
 * 화면이 완성되면 해당 경로가 이 자리를 대체하고, 마지막 화면까지 끝나면 이 파일은
 * 잘못된 URL 안내로만 남는다.
 */
export default function NotReadyPage() {
  const location = useLocation();

  return (
    <main className="page">
      <h1 className="page__title">준비 중인 화면입니다</h1>
      <p className="page__note">
        요청한 경로: <code>{`${location.pathname}${location.search}`}</code>
      </p>
      <p className="page__note">
        아직 만들지 않은 화면이에요.{' '}
        <Link className="link" to="/">
          홈으로 돌아가기
        </Link>
      </p>
    </main>
  );
}
