import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, type Page, type TestInfo } from '@playwright/test';

/** 개발 시드 계정. 비밀번호는 모두 같다(docs/seed-dev.sql). */
export const 계정 = {
  admin: { email: 'admin@clubhome.local', password: 'Test1234!', name: '관리자' },
  senior: { email: 'senior@clubhome.local', password: 'Test1234!', name: '정회원' },
  junior: { email: 'junior1@clubhome.local', password: 'Test1234!', name: '준회원' },
  /**
   * 등급 변경 테스트 대상. 시드 계정이 아니라 이전에 가입된 일반 계정이다 —
   * 시드 계정(junior1 등)의 등급을 바꾸면 그 등급을 전제로 한 다른 검증이 깨진다
   * (docs/10-integration-check.md §7의 실제 사고 기록).
   */
  피실험자: { email: 'user1@example.com', password: 'Test1234!' },
} as const;

/** CSS의 반응형 전환 기준(app.css의 `@media (min-width: 768px)`)과 같은 값. */
export const 전환폭 = 768;

/** 지금 뷰포트가 모바일 폭인가. 네비게이션이 햄버거로 접히는 기준이다. */
export function 모바일(page: Page): boolean {
  return (page.viewportSize()?.width ?? 전환폭) < 전환폭;
}

/**
 * 모바일이면 햄버거를 눌러 메뉴를 펼친다. 데스크톱에서는 아무것도 하지 않는다.
 *
 * 모바일에서 가로 메뉴(`.nav__menu`)와 인증 항목(`.nav__auth`)은 DOM에 남아 있되
 * `display: none`이다. 그래서 펼치기 전에는 "로그아웃" 버튼이 **존재하지만 보이지 않고**,
 * 펼친 뒤에는 숨은 것과 보이는 것 둘이 잡힌다 — 뒤의 것(시트)이 실제로 누를 수 있는 쪽이다.
 */
export async function 메뉴열기(page: Page): Promise<void> {
  if (!모바일(page)) return;
  const 햄버거 = page.getByRole('button', { name: '메뉴', exact: true });
  if ((await 햄버거.count()) > 0) await 햄버거.click();
}

/** 지금 화면에서 실제로 누를 수 있는 네비게이션 항목. 모바일이면 펼친 시트 쪽이다. */
export function 메뉴항목(page: Page, 이름: string) {
  return page.getByRole('link', { name: 이름, exact: true }).last();
}

const 목록파일이름 = 'shots.jsonl';

/**
 * 화면을 찍어 저장하고 리포트가 쓸 목록에 한 줄 남긴다.
 *
 * 저장 위치는 프로젝트별로 갈린다(`e2e/desktop/`, `e2e/mobile/`) — 같은 이름의
 * 화면을 두 폭에서 찍으므로 한 디렉토리에 두면 뒤에 돈 쪽이 앞의 것을 덮어쓴다.
 */
export async function 화면찍기(
  page: Page,
  testInfo: TestInfo,
  이름: string,
  설명: string,
): Promise<void> {
  const 기준 = join(__dirname, testInfo.project.name);
  const 파일 = `${이름}.png`;
  const 경로 = join(기준, 'screenshots', 파일);
  mkdirSync(dirname(경로), { recursive: true });
  await page.screenshot({ path: 경로, fullPage: true });
  appendFileSync(
    join(기준, 목록파일이름),
    `${JSON.stringify({ 테스트: testInfo.title, 파일, 설명 })}\n`,
    'utf8',
  );
}

/** 로그인하고 로그인 화면을 벗어난 것까지 확인한다. */
export async function 로그인(
  page: Page,
  { email, password }: { email: string; password: string },
): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('이메일(ID)').fill(email);
  await page.getByLabel('비밀번호', { exact: true }).fill(password);
  await page.getByRole('button', { name: '로그인' }).click();

  /**
   * 인증 상태는 `.nav__auth`의 글자로 판정한다(로그인 ↔ 로그아웃).
   *
   * `getByRole`을 쓰지 않는 이유: 모바일에서 이 영역은 `display: none`이고,
   * 그런 요소는 접근성 트리에서 빠지므로 역할 선택자로는 **존재조차 찾지 못한다**
   * (`toBeAttached`로도 안 잡힌다). CSS 선택자와 텍스트 비교는 숨은 요소에도 통해
   * 두 폭에서 같은 뜻을 갖는다.
   */
  await expect(page.locator('.nav__auth')).toContainText('로그아웃');
  await expect(page).not.toHaveURL(/\/login/);
}

export async function 로그아웃(page: Page): Promise<void> {
  // 모바일이면 햄버거를 펼쳐야 누를 수 있다. 펼친 뒤에는 시트 쪽이 보이는 항목이다.
  await 메뉴열기(page);
  await page.getByRole('button', { name: '로그아웃' }).last().click();
  await expect(page.locator('.nav__auth')).toContainText('로그인');
}

/** 오늘/내일/어제를 YYYY-MM-DD로. 예약 날짜 입력에 그대로 넣는다. */
export function 날짜(더할일수 = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + 더할일수);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

/** 재실행해도 겹치지 않는 가입용 이메일. */
export function 새이메일(): string {
  return `e2e-${Date.now()}@example.com`;
}

/**
 * 문서가 요구하는 "가로 스크롤 없음"을 측정한다(docs/10-integration-check.md §4).
 * 넘침이 있으면 스크롤 폭이 보이는 폭보다 크다.
 */
export async function 가로넘침(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}
