import { expect, test } from '@playwright/test';
import { 계정, 날짜, 로그아웃, 로그인, 새이메일, 화면찍기 } from './helpers';

/**
 * S-01 신규 회원가입 및 로그인 (F-01, F-02)
 * 근거: docs/3-user-scenario.md §1 S-01
 */
test.describe('S-01 회원가입·로그인', () => {
  test('홈 화면이 비로그인 상태로 열린다', async ({ page }, testInfo) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { name: /색연필.*환영합니다/ }),
    ).toBeVisible();
    /**
     * 비로그인 상태에서는 메뉴에 "로그인"이 있다(와이어프레임 2번).
     * 모바일에서는 이 영역이 햄버거 안으로 접혀 `display: none`이 되고, 그런 요소는
     * 접근성 트리에서 빠져 역할 선택자로 찾히지 않는다 — 두 폭에서 같은 뜻을 갖도록
     * 영역의 글자로 본다. 접힌 상태의 표시 자체는 모바일 전용 스펙(05)에서 검증한다.
     */
    await expect(page.locator('.nav__auth')).toContainText('로그인');
    await expect(page.locator('.nav__auth')).not.toContainText('로그아웃');

    await 화면찍기(page, testInfo, '01-home-guest', '홈 화면(비로그인) — 메뉴에 "로그인"이 노출된다');
  });

  test('가입 후 그 계정으로 로그인한다', async ({ page }, testInfo) => {
    const 이메일 = 새이메일();

    await page.goto('/signup');
    await page.getByLabel('이름').fill('E2E 신규회원');
    await page.getByLabel('이메일(ID)').fill(이메일);
    await page.getByLabel('비밀번호', { exact: true }).fill('Test1234!');
    await page.getByLabel('비밀번호 확인').fill('Test1234!');
    await page.getByLabel('연락처').fill('010-0000-0000');
    await 화면찍기(page, testInfo, '02-signup-filled', '회원가입 폼 입력 완료');

    await page.getByRole('button', { name: '가입하기' }).click();

    // 가입에 성공하면 로그인 화면으로 보낸다.
    await expect(page).toHaveURL(/\/login/);
    await 화면찍기(page, testInfo, '03-signup-done', '가입 성공 후 로그인 화면으로 이동');

    await 로그인(page, { email: 이메일, password: 'Test1234!' });
    await 화면찍기(page, testInfo, '04-login-done', '로그인 성공 — 메뉴가 "로그아웃"으로 바뀐다');

    // 신규 회원은 기본 등급(준회원)을 받는다(S-01 3단계).
    await page.goto('/me');
    await expect(page.getByText('준회원').first()).toBeVisible();
    await 화면찍기(page, testInfo, '05-mypage-newbie', '신규 회원에게 기본 등급(준회원)이 부여된다');
  });

  test('[엣지] 이미 가입된 이메일은 거부된다', async ({ page }, testInfo) => {
    await page.goto('/signup');
    await page.getByLabel('이름').fill('중복 시도');
    await page.getByLabel('이메일(ID)').fill(계정.junior.email);
    await page.getByLabel('비밀번호', { exact: true }).fill('Test1234!');
    await page.getByLabel('비밀번호 확인').fill('Test1234!');
    await page.getByLabel('연락처').fill('010-0000-0000');
    await page.getByRole('button', { name: '가입하기' }).click();

    /**
     * 서버가 409로 거절한다. 이 오류는 폼 전체 안내가 아니라 **이메일 칸 아래**에
     * 붙는다 — 어느 칸의 문제인지 아는 오류이기 때문이다(와이어프레임 3번이
     * "이메일 중복 시 인라인 에러"를 요구한다, SignupPage 주석).
     */
    await expect(page.locator('#email-error')).toBeVisible();
    await expect(page.getByLabel('이메일(ID)')).toHaveAttribute('aria-invalid', 'true');
    await expect(page).toHaveURL(/\/signup/);
    await 화면찍기(page, testInfo, '06-signup-duplicate', '[엣지] 이메일 중복 가입 거부');
  });

  test('[엣지] 비밀번호 확인이 다르면 서버에 보내지 않는다', async ({ page }, testInfo) => {
    await page.goto('/signup');
    await page.getByLabel('이름').fill('불일치 시도');
    await page.getByLabel('이메일(ID)').fill(새이메일());
    await page.getByLabel('비밀번호', { exact: true }).fill('Test1234!');
    await page.getByLabel('비밀번호 확인').fill('Different1234!');
    await page.getByLabel('연락처').fill('010-0000-0000');
    await page.getByRole('button', { name: '가입하기' }).click();

    await expect(page.getByText('비밀번호가 일치하지 않습니다.')).toBeVisible();
    await expect(page).toHaveURL(/\/signup/);
    await 화면찍기(page, testInfo, '07-signup-mismatch', '[엣지] 비밀번호 확인 불일치 — 클라이언트에서 차단');
  });

  test('[엣지] 비밀번호가 틀리면 로그인이 거부된다', async ({ page }, testInfo) => {
    await page.goto('/login');
    await page.getByLabel('이메일(ID)').fill(계정.junior.email);
    await page.getByLabel('비밀번호', { exact: true }).fill('WrongPassword!');
    await page.getByRole('button', { name: '로그인' }).click();

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('button', { name: '로그아웃' })).toHaveCount(0);
    await 화면찍기(page, testInfo, '08-login-failed', '[엣지] 비밀번호 불일치 — 로그인 실패');
  });

  test('[엣지] 로그인 없이 보호된 화면에 가면 로그인 화면으로 보낸다', async ({ page }, testInfo) => {
    await page.goto('/me/reservations?roomId=1');

    await expect(page).toHaveURL(/\/login/);
    await 화면찍기(page, testInfo, '09-guard-redirect', '[엣지] 비로그인 접근 차단 — 로그인 화면으로 이동');
  });

  test('로그아웃하면 비로그인 상태로 돌아간다', async ({ page }, testInfo) => {
    await 로그인(page, 계정.junior);
    await 로그아웃(page);

    await expect(page.locator('.nav__auth')).not.toContainText('로그아웃');
    await 화면찍기(page, testInfo, '10-logout', '로그아웃 후 비로그인 상태');
  });
});

/**
 * S-02 본인 정보 수정 (F-03)
 * 근거: docs/3-user-scenario.md §1 S-02
 */
test.describe('S-02 본인 정보 수정', () => {
  test('이름·연락처를 수정하고, 이메일은 수정할 수 없다', async ({ page }, testInfo) => {
    await 로그인(page, 계정.senior);
    await page.goto('/me');

    // 이메일(ID)과 등급·가입일은 읽기 전용으로 표시된다(와이어프레임 5번).
    await expect(page.getByText(계정.senior.email)).toBeVisible();
    await expect(page.getByLabel('이메일(ID)')).toHaveCount(0);
    await 화면찍기(page, testInfo, '11-mypage', '마이페이지 — 이메일·등급·가입일은 읽기 전용');

    const 새연락처 = `010-${날짜().slice(5, 7)}${날짜().slice(8, 10)}-1234`;
    await page.getByLabel('연락처').fill(새연락처);
    await page.getByRole('button', { name: '저장' }).click();

    await expect(page.getByRole('status')).toBeVisible();
    await 화면찍기(page, testInfo, '12-mypage-saved', '본인 정보 수정 저장 성공');

    // 새로고침해도 남아 있어야 실제로 저장된 것이다.
    await page.reload();
    await expect(page.getByLabel('연락처')).toHaveValue(새연락처);
  });

  test('[엣지] 필수 항목을 비우면 저장이 거부된다', async ({ page }, testInfo) => {
    await 로그인(page, 계정.senior);
    await page.goto('/me');

    await page.getByLabel('이름').fill('');
    await page.getByRole('button', { name: '저장' }).click();

    await expect(page.getByText('이름을 입력하세요.')).toBeVisible();
    await 화면찍기(page, testInfo, '13-mypage-required', '[엣지] 이름 미입력 — 저장 거부');
  });
});
