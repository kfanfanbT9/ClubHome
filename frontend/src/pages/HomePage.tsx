import { Link } from 'react-router-dom';

/**
 * 홈 화면 (와이어프레임 2번, 확정 시안 docs/designs/02-home.html "강조 밴드").
 *
 * 슬라이드 배너 같은 홈 전용 콘텐츠는 두지 않고 환영 문구와 바로가기만 배치한다(와이어프레임 2번).
 * 타일 설명은 고정 문구다 — 실제 게시판 목록이나 연습실 운영시간을 여기서 조회하지 않는다.
 * 홈에서 서버를 두 번 더 부르는 값을 하기에는 얻는 것이 적고, 없는 데이터를 그럴싸하게
 * 적어두면 화면과 실제가 어긋난다.
 */
export default function HomePage() {
  return (
    <>
      <header className="band">
        <div className="band__inner">
          <h1 className="band__title">색소폰 동호회 “색연필”에 오신 것을 환영합니다</h1>
          <p className="band__sub">
            게시판에서 공지를 확인하고, 연습실을 30분 단위로 예약하세요.
          </p>
        </div>
      </header>

      <main>
        <div className="tiles">
          <Link className="tile" to="/boards">
            <h2 className="tile__name">게시판</h2>
            <p className="tile__desc">공지사항과 회원 게시글을 등급에 따라 열람합니다.</p>
            <span className="tile__go">바로가기 →</span>
          </Link>

          <Link className="tile" to="/practice-rooms">
            <h2 className="tile__name">연습실 예약</h2>
            <p className="tile__desc">하루 예약현황을 보고 원하는 시간대를 30분 단위로 예약합니다.</p>
            <span className="tile__go">바로가기 →</span>
          </Link>
        </div>
      </main>
    </>
  );
}
