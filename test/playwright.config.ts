import { defineConfig, devices } from '@playwright/test';

/**
 * 색연필 색소폰 동호회 홈페이지 - E2E 통합테스트 설정
 *
 * 대상은 **이미 떠 있는 개발서버**다(프론트 5174 / 백엔드 3001).
 * `webServer`를 두지 않는 이유: 개발 중에는 이미 서버를 띄워 둔 상태에서 돌리는 일이
 * 대부분이고, Playwright가 서버를 또 띄우면 포트가 충돌한다. 서버가 꺼져 있으면
 * 첫 테스트가 곧바로 실패하므로 원인도 분명하다.
 *
 * 이 테스트는 개발 DB(clubhome)에 실제로 쓴다 — 회원·게시글·예약이 남는다.
 * 시드 계정(admin/senior/junior1/junior2)의 등급은 건드리지 않는다.
 * 백엔드 단위테스트는 별도 DB(clubhome_test)를 쓰므로 서로 간섭하지 않는다.
 */
export default defineConfig({
  testDir: './e2e',

  /**
   * 하나의 DB를 공유하므로 병렬로 돌리지 않는다.
   * 등급 변경·예약 같은 상태 변경이 다른 테스트의 전제를 무너뜨린다.
   * 프로젝트(desktop/mobile)끼리도 마찬가지라 workers를 1로 둔다.
   */
  fullyParallel: false,
  workers: 1,

  // 통합테스트는 실패를 그대로 봐야 한다. 재시도로 가리면 간헐적 실패를 놓친다.
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 7_000 },

  reporter: [['list'], ['json', { outputFile: 'e2e/results.json' }]],
  outputDir: 'e2e/test-results',

  use: {
    baseURL: 'http://localhost:5174',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 7_000,
  },

  /**
   * 같은 시나리오를 두 폭에서 돌린다. 전환 기준은 CSS의 768px이며(app.css),
   * 그 경계를 사이에 두고 네비게이션(가로 메뉴 ↔ 햄버거)과 목록(표 ↔ 카드)이 바뀐다.
   *
   * 결과는 프로젝트 이름별 디렉토리에 나뉘어 쌓인다(`e2e/<project>/`).
   */
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
      // 모바일 전용 검증(햄버거·카드 전환)은 데스크톱에서 의미가 없다.
      testIgnore: '**/05-mobile.spec.ts',
    },
    {
      name: 'mobile',
      /**
       * Pixel 5(393×851, DPR 2.75, 터치). 와이어프레임의 모바일 기준 폭(390px)과
       * 사실상 같고, 실제 기기 프로필이라 터치 이벤트까지 함께 검증된다.
       */
      use: { ...devices['Pixel 5'] },
    },
  ],
});
