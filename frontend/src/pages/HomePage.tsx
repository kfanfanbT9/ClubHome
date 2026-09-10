/**
 * 홈 화면 (와이어프레임 2번).
 *
 * FE-01에서는 라우터·Provider가 실제로 붙었는지 확인할 수 있는 최소 화면만 둔다.
 * 확정된 시안(docs/designs/02-home.html)대로 메뉴바·강조 밴드·바로가기 타일을 얹는 것은 FE-02다.
 */
export default function HomePage() {
  return (
    <main style={{ maxWidth: 'var(--container)', margin: '0 auto', padding: 'var(--space-12) var(--space-4)' }}>
      <h1 style={{ fontSize: 'var(--text-2xl)', lineHeight: 'var(--leading-tight)', margin: 0 }}>
        색연필 색소폰 동호회
      </h1>
      <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-3)' }}>
        게시판에서 공지를 확인하고, 연습실을 30분 단위로 예약하세요.
      </p>
    </main>
  );
}
