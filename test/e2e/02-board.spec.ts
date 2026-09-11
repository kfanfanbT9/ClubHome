import { expect, test } from '@playwright/test';
import { 계정, 로그인, 화면찍기 } from './helpers';

/**
 * S-03 등급에 따른 게시판 접근 제한 (F-10, F-11)
 * 근거: docs/3-user-scenario.md §1 S-03
 *
 * 시드 기준: 자유게시판(최소등급 10) / 정회원 게시판(20) / 운영진 전용(30).
 * 준회원(10)으로 로그인하면 뒤의 둘이 잠금으로 보여야 한다.
 */
test.describe('S-03 등급별 게시판 접근', () => {
  test('준회원에게는 상위 게시판이 잠금으로 보인다', async ({ page }, testInfo) => {
    await 로그인(page, 계정.junior);
    await page.goto('/boards');

    await expect(page.getByRole('heading', { name: '게시판 목록' })).toBeVisible();
    // 접근 불가 게시판도 목록에는 나온다(구현 확정: 감추지 않고 잠금 표시).
    await expect(page.getByText('자유게시판')).toBeVisible();
    await expect(page.getByText(/접근불가/).first()).toBeVisible();
    // 내 등급이 화면 아래에 표시된다.
    await expect(page.getByText(/내 등급: 준회원/)).toBeVisible();

    await 화면찍기(page, testInfo, '20-boards-junior', 'S-03 게시판 목록(준회원) — 상위 게시판은 자물쇠와 "접근불가" 표기');
  });

  test('[엣지] 등급 미달 게시판에 들어가면 서버가 거부한다', async ({ page }, testInfo) => {
    await 로그인(page, 계정.junior);
    await page.goto('/boards');

    // 잠긴 게시판도 링크다 — 실제 거절과 그 문구는 서버 403이 내려준다.
    const 잠긴게시판 = page.locator('a.board-row--locked').first();
    await expect(잠긴게시판).toBeVisible();
    await 잠긴게시판.click();

    await expect(page.getByRole('alert')).toContainText('이용 권한이 없는 게시판입니다.');
    await 화면찍기(page, testInfo, '21-board-forbidden', '[엣지] 등급 미달 게시판 진입 — 서버 403 문구를 그대로 노출');
  });

  test('정회원은 정회원 게시판에 들어갈 수 있다', async ({ page }, testInfo) => {
    await 로그인(page, 계정.senior);
    await page.goto('/boards');

    await expect(page.getByText(/내 등급: 정회원/)).toBeVisible();
    await page.getByText('정회원 게시판').click();

    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('link', { name: '글쓰기' })).toBeVisible();
    await 화면찍기(page, testInfo, '22-board-allowed', 'S-03 등급 충족 — 정회원 게시판 진입 성공');
  });
});

/**
 * S-04 게시글 작성 및 본인 글 수정/삭제 (F-11, F-12)
 * 근거: docs/3-user-scenario.md §1 S-04
 */
test.describe('S-04 게시글 작성·수정·삭제', () => {
  const 제목 = `E2E 테스트 글 ${Date.now()}`;
  const 수정제목 = `${제목} (수정됨)`;

  test('글을 쓰면 목록과 상세에 나타난다', async ({ page }, testInfo) => {
    await 로그인(page, 계정.senior);
    await page.goto('/boards');
    await page.getByText('자유게시판').click();

    await 화면찍기(page, testInfo, '23-post-list-empty', 'S-04 게시글 목록(작성 전)');

    await page.getByRole('link', { name: '글쓰기' }).click();
    await page.getByLabel('제목').fill(제목);
    await page.getByLabel('내용').fill('Playwright 통합테스트가 작성한 글입니다.\n두 번째 줄.');
    await 화면찍기(page, testInfo, '24-post-write', 'S-04 글쓰기 폼 입력');

    await page.getByRole('button', { name: '등록' }).click();

    // 등록하면 그 글의 상세로 간다.
    await expect(page.getByRole('heading', { name: 제목 })).toBeVisible();
    await expect(page.getByText('Playwright 통합테스트가 작성한 글입니다.')).toBeVisible();
    await 화면찍기(page, testInfo, '25-post-detail', 'S-04 게시글 상세 — 작성자에게 수정·삭제 버튼이 보인다');

    // 목록에도 보여야 한다.
    await page.getByRole('link', { name: '목록' }).click();
    await expect(page.getByText(제목)).toBeVisible();
    await 화면찍기(page, testInfo, '26-post-list', 'S-04 게시글 목록 — 번호는 게시판 내 순번');
  });

  test('본인 글을 수정한다', async ({ page }, testInfo) => {
    await 로그인(page, 계정.senior);
    await page.goto('/boards');
    await page.getByText('자유게시판').click();
    await page.getByText(제목).click();

    /**
     * 조회수는 상세를 **조회할 때** 서버가 올린다. 수정 후 상세를 캐시 무효화로
     * 다시 불러오면 조회수가 한 번 더 올라간다 — 실제로 그렇게 동작하던 버그를
     * 잡아 응답으로 갈아끼우도록 고쳤으므로(useBoardQueries), 여기서 회귀를 막는다.
     */
    const 조회수읽기 = async () => {
      const 문구 = await page.locator('.post__meta').innerText();
      return Number(문구.match(/조회수:\s*(\d+)/)?.[1]);
    };
    const 수정전조회수 = await 조회수읽기();
    expect(Number.isInteger(수정전조회수)).toBe(true);

    await page.getByRole('link', { name: '수정' }).click();
    await page.getByLabel('제목').fill(수정제목);
    await page.getByRole('button', { name: '저장' }).click();

    await expect(page.getByRole('heading', { name: 수정제목 })).toBeVisible();
    // 수정은 조회가 아니다 — 조회수가 올라가면 안 된다.
    expect(await 조회수읽기()).toBe(수정전조회수);
    await 화면찍기(page, testInfo, '27-post-updated', 'S-04 게시글 수정 완료 — 수정으로 조회수가 오르지 않는다');
  });

  test('[엣지] 타인의 글에는 수정·삭제 버튼이 없다', async ({ page }, testInfo) => {
    // 정회원이 쓴 글을 준회원이 연다(같은 자유게시판, 최소등급 10이라 열람은 된다).
    await 로그인(page, 계정.junior);
    await page.goto('/boards');
    await page.getByText('자유게시판').click();
    await page.getByText(수정제목).click();

    await expect(page.getByRole('heading', { name: 수정제목 })).toBeVisible();
    await expect(page.getByRole('link', { name: '수정' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '삭제' })).toHaveCount(0);
    await 화면찍기(page, testInfo, '28-post-other-owner', '[엣지] 타인 글 — 수정·삭제 버튼이 노출되지 않는다');
  });

  test('본인 글을 삭제하면 목록에서 사라진다', async ({ page }, testInfo) => {
    await 로그인(page, 계정.senior);
    await page.goto('/boards');
    await page.getByText('자유게시판').click();
    await page.getByText(수정제목).click();

    // 삭제는 곧바로 실행하지 않고 한 번 더 묻는다(ConfirmButton).
    await page.getByRole('button', { name: '삭제' }).click();
    await expect(page.getByText('정말 삭제할까요?')).toBeVisible();
    await 화면찍기(page, testInfo, '29-post-delete-confirm', 'S-04 삭제 전 확인 — 브라우저 confirm 대신 화면에서 묻는다');

    await page.getByRole('button', { name: '삭제' }).click();

    // 삭제하면 목록으로 돌아가고 그 글이 없다.
    await expect(page).toHaveURL(/\/boards\/\d+\/posts/);
    await expect(page.getByText(수정제목)).toHaveCount(0);
    await 화면찍기(page, testInfo, '30-post-deleted', 'S-04 삭제 후 목록에서 사라짐');
  });

  test('[엣지] 없는 글을 열면 오류를 안내한다', async ({ page }, testInfo) => {
    await 로그인(page, 계정.senior);
    await page.goto('/posts/99999999');

    await expect(page.getByRole('alert')).toBeVisible();
    await 화면찍기(page, testInfo, '31-post-not-found', '[엣지] 존재하지 않는 게시글 — 404 안내');
  });

  test('[엣지] 없는 경로는 404 화면을 보여준다', async ({ page }, testInfo) => {
    await page.goto('/이런경로는없다');

    await expect(page.getByRole('heading')).toBeVisible();
    await 화면찍기(page, testInfo, '32-not-found', '[엣지] 정의되지 않은 경로 — 404 화면');
  });
});
