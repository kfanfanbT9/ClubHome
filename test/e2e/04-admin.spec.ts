import { expect, test } from '@playwright/test';
import { 계정, 로그인, 메뉴열기, 메뉴항목, 화면찍기 } from './helpers';

/**
 * S-07 회원 등급 변경 (F-30)
 * S-08 게시판/연습실 관리 (F-31, F-32)
 * 근거: docs/3-user-scenario.md §2
 */

test.describe('S-07 회원 등급 변경', () => {
  test('관리자에게만 [관리자] 메뉴가 보인다', async ({ page }, testInfo) => {
    await 로그인(page, 계정.admin);
    // 모바일이면 햄버거를 펼쳐야 메뉴가 보인다.
    await 메뉴열기(page);
    await expect(메뉴항목(page, '관리자')).toBeVisible();
    await 메뉴항목(page, '관리자').click();

    await expect(page.getByRole('heading', { name: '관리자' })).toBeVisible();
    await 화면찍기(page, testInfo, '60-admin-home', 'S-07 관리자 입구 — 등급·게시판·연습실 관리로 가는 길');
  });

  test('회원을 검색해 등급을 바꾼다', async ({ page }, testInfo) => {
    await 로그인(page, 계정.admin);
    await page.goto('/admin/members');

    await page.getByLabel('검색 (이름 또는 이메일)').fill(계정.피실험자.email);
    await page.getByRole('button', { name: '검색' }).click();

    const 대상 = page.locator('li.adm-row').filter({ hasText: 계정.피실험자.email }).first();
    await expect(대상).toBeVisible();
    await expect(대상).toContainText('현재등급: 준회원');
    await 화면찍기(page, testInfo, '61-admin-members', 'S-07 회원 검색 결과 — 현재 등급과 변경 드롭다운');

    // 준회원 → 정회원
    await 대상.getByRole('combobox').selectOption({ label: '정회원' });
    await 대상.getByRole('button', { name: '저장' }).click();

    /**
     * 성공 안내가 실제로 보여야 한다. 예전에 목록 key에 등급을 섞어 두어 재조회 순간
     * 줄이 remount 되면서 이 안내가 한 번도 보이지 않던 버그가 있었다 —
     * 그 회귀를 여기서 막는다(MemberGradeAdminPage 주석).
     */
    await expect(대상.getByRole('status')).toContainText('등급을 변경했습니다.');
    await expect(대상).toContainText('현재등급: 정회원');
    await 화면찍기(page, testInfo, '62-admin-grade-changed', 'S-07 등급 변경 성공 — 안내와 갱신된 등급이 함께 보인다');

    // 다음 실행을 위해 준회원으로 되돌린다.
    await 대상.getByRole('combobox').selectOption({ label: '준회원' });
    await 대상.getByRole('button', { name: '저장' }).click();
    await expect(대상).toContainText('현재등급: 준회원');
  });

  test('등급 체계가 서열 순으로 보인다', async ({ page }, testInfo) => {
    await 로그인(page, 계정.admin);
    await page.goto('/admin/members');

    const 등급영역 = page.locator('.adm-section').filter({ hasText: '등급 체계 관리' });
    await expect(등급영역.getByText('준회원 (10)')).toBeVisible();
    await expect(등급영역.getByText('정회원 (20)')).toBeVisible();
    await expect(등급영역.getByText(/운영진 \(30\).*관리자/)).toBeVisible();
    await 화면찍기(page, testInfo, '63-admin-grades', 'S-07 등급 체계 — 서열 순 나열, 운영진은 관리자 표시');
  });

  test('[엣지] 비관리자는 관리자 화면에 들어갈 수 없다', async ({ page }, testInfo) => {
    await 로그인(page, 계정.junior);

    // 메뉴 자체가 없다.
    await expect(page.getByRole('link', { name: '관리자' })).toHaveCount(0);

    // 주소로 직접 들어가도 홈으로 되돌린다(RequireAdmin).
    await page.goto('/admin/members');
    await expect(page).toHaveURL(/\/$/);
    await 화면찍기(page, testInfo, '64-admin-blocked', '[엣지] 준회원이 관리자 경로 진입 — 홈으로 돌려보낸다');
  });
});

test.describe('S-08 게시판·연습실 관리', () => {
  test('게시판 목록에 비활성 게시판까지 보인다', async ({ page }, testInfo) => {
    await 로그인(page, 계정.admin);
    await page.goto('/admin/boards');

    await expect(page.getByRole('heading', { name: /게시판 관리/ })).toBeVisible();
    // 관리 화면은 비활성 포함 전체를 쓴다 — 일반 목록과 건수가 다르다.
    expect(await page.locator('li.adm-row').count()).toBeGreaterThanOrEqual(3);
    await 화면찍기(page, testInfo, '70-admin-boards', 'S-08 게시판 관리 — 최소등급과 사용여부');
  });

  test('게시판을 생성하고 다시 삭제한다', async ({ page }, testInfo) => {
    const 이름 = `E2E 임시게시판 ${Date.now()}`;
    await 로그인(page, 계정.admin);
    await page.goto('/admin/boards');

    await page.getByRole('button', { name: '+ 게시판 생성' }).click();
    await page.getByLabel('게시판명').fill(이름);
    await page.getByLabel('설명').fill('통합테스트가 만든 게시판');
    await 화면찍기(page, testInfo, '71-board-create-form', 'S-08 게시판 생성 폼 — 모달이 아니라 인라인');

    await page.getByRole('button', { name: '저장' }).click();
    await expect(page.getByText(이름)).toBeVisible();
    await 화면찍기(page, testInfo, '72-board-created', 'S-08 게시판 생성 완료');

    // 글이 없는 게시판이므로 삭제된다(글이 있으면 서버가 409로 막는다).
    const 새게시판 = page.locator('li.adm-row').filter({ hasText: 이름 }).first();
    await 새게시판.getByRole('button', { name: '삭제' }).click();
    await 새게시판.getByRole('button', { name: '삭제' }).click();
    await expect(page.getByText(이름)).toHaveCount(0);
    await 화면찍기(page, testInfo, '73-board-deleted', 'S-08 게시판 삭제 완료');
  });

  test('[엣지] 게시글이 있는 게시판은 삭제가 거부된다', async ({ page }, testInfo) => {
    const 글제목 = `삭제거부 확인용 ${Date.now()}`;
    await 로그인(page, 계정.admin);

    // 자유게시판에 글을 하나 남긴다.
    await page.goto('/boards');
    await page.getByText('자유게시판').click();
    await page.getByRole('link', { name: '글쓰기' }).click();
    await page.getByLabel('제목').fill(글제목);
    await page.getByLabel('내용').fill('이 글이 있는 한 게시판은 지워지지 않아야 한다.');
    await page.getByRole('button', { name: '등록' }).click();
    await expect(page.getByRole('heading', { name: 글제목 })).toBeVisible();

    await page.goto('/admin/boards');
    const 자유게시판 = page.locator('li.adm-row').filter({ hasText: '자유게시판' }).first();
    await 자유게시판.getByRole('button', { name: '삭제' }).click();
    await 자유게시판.getByRole('button', { name: '삭제' }).click();

    await expect(자유게시판.getByRole('alert')).toContainText('게시글이 있는 게시판은 삭제할 수 없습니다.');
    // 다음 행동까지 안내한다.
    await expect(자유게시판.getByRole('alert')).toContainText('비활성');
    await 화면찍기(page, testInfo, '74-board-delete-denied', '[엣지] 게시글이 있는 게시판 삭제 — 409와 대안 안내');

    // 남긴 글을 치운다.
    await page.goto('/boards');
    await page.getByText('자유게시판').click();
    await page.getByText(글제목).click();
    await page.getByRole('button', { name: '삭제' }).click();
    await page.getByRole('button', { name: '삭제' }).click();
    await expect(page.getByText(글제목)).toHaveCount(0);
  });

  test('연습실 관리 화면에서 예약 현황까지 본다', async ({ page }, testInfo) => {
    await 로그인(page, 계정.admin);
    await page.goto('/admin/practice-rooms');

    await expect(page.getByRole('heading', { name: /연습실 관리/ })).toBeVisible();
    // 예약 현황은 별도 화면이 아니라 같은 화면의 섹션이다(와이어프레임 14번 구현 결과).
    await expect(page.getByRole('heading', { name: '예약 현황·내역' })).toBeVisible();
    await 화면찍기(page, testInfo, '75-admin-rooms', 'S-08 연습실 관리 — 같은 화면 아래에 예약 현황·내역 섹션');
  });

  test('관리자가 예약을 강제 취소한다', async ({ page }, testInfo) => {
    await 로그인(page, 계정.admin);
    await page.goto('/admin/practice-rooms');

    const 예약섹션 = page.locator('.adm-section').filter({ hasText: '예약 현황·내역' });

    /**
     * 목록이 그려지기 전에 세면 항상 0이라 테스트가 조용히 건너뛰어진다.
     * 조회가 끝난 것을 먼저 확인한 뒤에 판단한다.
     */
    await expect(예약섹션.getByText('불러오는 중…')).toHaveCount(0);
    const 강제취소 = 예약섹션.getByRole('button', { name: '강제취소' }).first();
    if ((await 강제취소.count()) === 0) {
      test.skip(true, '취소할 수 있는(reserved) 예약이 없다');
    }

    await 강제취소.click();
    await expect(page.getByText('이 예약을 강제로 취소할까요?')).toBeVisible();
    await 화면찍기(page, testInfo, '76-force-cancel-confirm', 'S-08 강제 취소 확인 — 관리자는 시작 여부와 무관하게 취소할 수 있다');

    await 예약섹션.getByRole('button', { name: '강제취소' }).first().click();
    await expect(예약섹션.getByText('취소').first()).toBeVisible();
    await 화면찍기(page, testInfo, '77-force-cancel-done', 'S-08 강제 취소 완료');
  });
});
