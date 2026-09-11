import { expect, test } from '@playwright/test';
import { 가로넘침, 계정, 날짜, 로그인, 메뉴열기, 화면찍기 } from './helpers';

/**
 * 모바일 전용 검증 (mobile 프로젝트에서만 돈다).
 *
 * 근거: docs/4-wireframes.md §1 반응형 규칙
 *   - 상단 네비게이션은 모바일에서 햄버거(≡) 안으로 축소된다.
 *   - 표 위주 화면(게시글 목록·예약현황·내 예약 내역)은 표를 축소하지 않고
 *     **행 단위 카드 리스트**로 전환한다.
 *   - 폼 위주 화면은 PC/모바일 모두 1열이라 구성이 같다.
 *   - 관리자 화면은 모바일에서 표를 가로 스크롤로 보여주는 것으로 충분하다.
 *
 * 표↔카드 전환은 DOM을 두 벌 만들지 않고 CSS로만 처리한다 — 열 제목 줄을
 * 모바일에서 숨기고(`display: none`) 768px 이상에서만 표로 배치한다(app.css).
 * 그래서 "열 제목이 보이지 않는다"가 카드 모드의 판정 기준이 된다.
 */

test.describe('모바일 - 공통 네비게이션', () => {
  test('메뉴가 햄버거로 접히고 눌러서 펼친다', async ({ page }, testInfo) => {
    await 로그인(page, 계정.senior);
    await page.goto('/');

    // 가로 메뉴는 DOM에 있지만 모바일에서는 보이지 않는다.
    await expect(page.locator('.nav__menu')).toBeAttached();
    await expect(page.locator('.nav__menu')).not.toBeVisible();
    await expect(page.locator('.nav__sheet')).toHaveCount(0);

    const 햄버거 = page.getByRole('button', { name: '메뉴', exact: true });
    await expect(햄버거).toBeVisible();
    await expect(햄버거).toHaveAttribute('aria-expanded', 'false');
    await 화면찍기(page, testInfo, '80-nav-collapsed', '모바일 홈 — 메뉴가 햄버거(≡)로 접혀 있다');

    await 햄버거.click();

    // 펼치면 시트에 메뉴와 인증 항목이 함께 나온다.
    const 시트 = page.locator('.nav__sheet');
    await expect(시트).toBeVisible();
    await expect(시트.getByRole('link', { name: '게시판' })).toBeVisible();
    await expect(시트.getByRole('link', { name: '연습실예약' })).toBeVisible();
    await expect(시트.getByRole('link', { name: '마이페이지' })).toBeVisible();
    await expect(시트.getByRole('button', { name: '로그아웃' })).toBeVisible();
    await expect(page.getByRole('button', { name: '메뉴 닫기' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await 화면찍기(page, testInfo, '81-nav-open', '모바일 — 햄버거를 펼친 메뉴 시트');

    // 메뉴를 고르면 이동하면서 시트가 닫힌다.
    await 시트.getByRole('link', { name: '게시판' }).click();
    await expect(page).toHaveURL(/\/boards/);
    await expect(page.locator('.nav__sheet')).toHaveCount(0);
    await 화면찍기(page, testInfo, '82-nav-closed-after-move', '모바일 — 메뉴 선택 후 시트가 닫힌다');
  });

  test('관리자 메뉴도 시트 안에 들어간다', async ({ page }, testInfo) => {
    await 로그인(page, 계정.admin);
    await page.goto('/');
    await 메뉴열기(page);

    await expect(page.locator('.nav__sheet').getByRole('link', { name: '관리자' })).toBeVisible();
    await 화면찍기(page, testInfo, '83-nav-admin', '모바일 — 관리자 메뉴가 시트에 추가된다');
  });
});

test.describe('모바일 - 표에서 카드로 전환', () => {
  test('게시글 목록이 카드 리스트로 보인다', async ({ page }, testInfo) => {
    const 제목 = `모바일 확인용 글 ${Date.now()}`;
    await 로그인(page, 계정.senior);
    await page.goto('/boards');
    await page.getByText('자유게시판').click();

    // 카드에 담을 내용이 있어야 하므로 한 건 만든다.
    await page.getByRole('link', { name: '글쓰기' }).click();
    await page.getByLabel('제목').fill(제목);
    await page.getByLabel('내용').fill('모바일 카드 전환 확인용');
    await page.getByRole('button', { name: '등록' }).click();
    await expect(page.getByRole('heading', { name: 제목 })).toBeVisible();
    await page.getByRole('link', { name: '목록' }).click();

    // 열 제목 줄은 표일 때만 의미가 있어 모바일에서는 숨는다.
    await expect(page.locator('.post-list__head')).toBeAttached();
    await expect(page.locator('.post-list__head')).not.toBeVisible();
    // 카드 자체는 보인다(제목 + 메타 2줄).
    const 카드 = page.locator('.post-row').first();
    await expect(카드).toBeVisible();
    await expect(카드).toContainText(제목);
    await 화면찍기(page, testInfo, '84-post-list-card', '모바일 게시글 목록 — 표 대신 카드, 열 제목은 숨김');

    expect(await 가로넘침(page)).toBe(0);

    // 뒷정리
    await page.getByText(제목).click();
    await page.getByRole('button', { name: '삭제' }).click();
    await page.getByRole('button', { name: '삭제' }).click();
    await expect(page.getByText(제목)).toHaveCount(0);
  });

  test('내 예약 내역이 카드 리스트로 보인다', async ({ page }, testInfo) => {
    await 로그인(page, 계정.senior);
    await page.goto('/me/reservations');

    await expect(page.locator('.res-list__head')).toBeAttached();
    await expect(page.locator('.res-list__head')).not.toBeVisible();

    const 첫줄 = page.locator('.res-row').first();
    if ((await 첫줄.count()) > 0) await expect(첫줄).toBeVisible();
    await 화면찍기(page, testInfo, '85-my-reservations-card', '모바일 내 예약 내역 — 카드 리스트, 필터는 위쪽 드롭다운');

    expect(await 가로넘침(page)).toBe(0);
  });

  test('예약현황의 선택 요약이 화면 하단에 붙어 따라온다', async ({ page }, testInfo) => {
    await 로그인(page, 계정.senior);
    await page.goto(`/practice-rooms?date=${날짜(5)}`);

    // 슬롯이 26개라 화면을 넘긴다 — 요약과 신청 버튼은 스크롤해도 보여야 한다
    // (와이어프레임 9번 모바일: 선택 요약 + 예약 신청 버튼을 화면 하단에 배치).
    const 요약 = page.locator('.summary');
    await expect(요약).toHaveCSS('position', 'sticky');

    await page.locator('li.slot:not(.slot--taken) input[type="checkbox"]').first().check();
    await expect(page.getByText(/30분 단위 1슬롯/)).toBeVisible();

    await page.mouse.wheel(0, 1200);
    await expect(요약).toBeInViewport();
    await expect(page.getByRole('button', { name: '예약 신청' })).toBeInViewport();
    await 화면찍기(page, testInfo, '86-slot-summary-sticky', '모바일 예약현황 — 스크롤해도 하단 요약·신청 버튼이 붙어 있다');

    expect(await 가로넘침(page)).toBe(0);
  });
});

test.describe('모바일 - 레이아웃 넘침', () => {
  /**
   * 문서가 기록한 반응형 실측(docs/10-integration-check.md §4)을 자동화한다.
   * 가로 스크롤이 생기면 모바일에서 내용이 잘려 보인다.
   */
  const 화면들: Array<{ 이름: string; 경로: string }> = [
    { 이름: '홈', 경로: '/' },
    { 이름: '로그인', 경로: '/login' },
    { 이름: '회원가입', 경로: '/signup' },
    { 이름: '마이페이지', 경로: '/me' },
    { 이름: '게시판 목록', 경로: '/boards' },
    { 이름: '연습실 예약현황', 경로: '/practice-rooms' },
    { 이름: '내 예약 내역', 경로: '/me/reservations' },
  ];

  for (const { 이름, 경로 } of 화면들) {
    test(`${이름} 화면에 가로 스크롤이 없다`, async ({ page }) => {
      await 로그인(page, 계정.senior);
      await page.goto(경로);
      // 본문이 그려진 뒤에 잰다 — 로딩 중에는 넘칠 것이 아직 없다.
      await expect(page.locator('main, .band').first()).toBeVisible();

      expect(await 가로넘침(page)).toBe(0);
    });
  }

  test('관리자 화면은 가로 스크롤을 자체 영역 안에서 처리한다', async ({ page }, testInfo) => {
    await 로그인(page, 계정.admin);
    await page.goto('/admin/practice-rooms');
    await expect(page.getByRole('heading', { name: /연습실 관리/ })).toBeVisible();

    /**
     * 관리자 화면은 주로 PC에서 쓰는 것을 전제하지만(와이어프레임 §1),
     * 그렇더라도 **문서 전체가 가로로 밀리면 안 된다.** 넓은 표는 자기 영역 안에서
     * 스크롤되어야 한다.
     */
    expect(await 가로넘침(page)).toBe(0);
    await 화면찍기(page, testInfo, '87-admin-mobile', '모바일 관리자 화면 — 문서는 가로로 밀리지 않는다');
  });
});

test.describe('모바일 - 주요 화면과 엣지케이스', () => {
  test('폼 화면은 1열 그대로다', async ({ page }, testInfo) => {
    await page.goto('/login');
    await 화면찍기(page, testInfo, '88-login-mobile', '모바일 로그인 — 폼은 PC와 같은 1열 구성');

    await page.goto('/signup');
    await 화면찍기(page, testInfo, '89-signup-mobile', '모바일 회원가입');
  });

  test('게시판 목록의 잠금 표시가 모바일에서도 읽힌다', async ({ page }, testInfo) => {
    await 로그인(page, 계정.junior);
    await page.goto('/boards');

    await expect(page.getByText(/접근불가/).first()).toBeVisible();
    await 화면찍기(page, testInfo, '90-boards-mobile', '모바일 게시판 목록 — 자물쇠와 "접근불가"가 줄바꿈되어도 읽힌다');
  });

  test('[엣지] 등급 미달 게시판 거부 안내가 모바일에서도 보인다', async ({ page }, testInfo) => {
    await 로그인(page, 계정.junior);
    await page.goto('/boards');
    await page.locator('a.board-row--locked').first().click();

    await expect(page.getByRole('alert')).toContainText('이용 권한이 없는 게시판입니다.');
    await 화면찍기(page, testInfo, '91-forbidden-mobile', '[엣지] 모바일 — 등급 미달 게시판 거부 안내');
    expect(await 가로넘침(page)).toBe(0);
  });

  test('[엣지] 비연속 슬롯 안내가 모바일에서도 보인다', async ({ page }, testInfo) => {
    await 로그인(page, 계정.senior);
    await page.goto(`/practice-rooms?date=${날짜(6)}`);

    const 빈슬롯 = page.locator('li.slot:not(.slot--taken) input[type="checkbox"]');
    await 빈슬롯.nth(0).check();
    await 빈슬롯.nth(2).click();

    await expect(page.getByRole('alert')).toContainText('연속된 시간대만 함께 예약할 수 있습니다.');
    await 화면찍기(page, testInfo, '92-noncontiguous-mobile', '[엣지] 모바일 — 비연속 슬롯 선택 거절 안내');
  });

  test('[엣지] 모바일에서도 관리자 경로는 비관리자를 막는다', async ({ page }, testInfo) => {
    await 로그인(page, 계정.junior);
    await page.goto('/admin/boards');

    await expect(page).toHaveURL(/\/$/);
    await 화면찍기(page, testInfo, '93-admin-blocked-mobile', '[엣지] 모바일 — 준회원의 관리자 경로 진입 차단');
  });
});
