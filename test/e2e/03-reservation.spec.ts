import { expect, test, type Page } from '@playwright/test';
import { 계정, 날짜, 로그아웃, 로그인, 화면찍기 } from './helpers';

/**
 * S-05 연습실 예약현황 조회 및 신청, 중복예약 거부 (F-20, F-21)
 * S-06 예약 취소 (시작 전 vs 시작 후) (F-22)
 * 근거: docs/3-user-scenario.md §1 S-05·S-06
 */

/** 예약현황 화면에서 비어 있는 슬롯의 체크박스만 고른다. */
function 빈슬롯(page: Page) {
  return page.locator('li.slot:not(.slot--taken) input[type="checkbox"]');
}

test.describe('S-05 예약현황 조회·신청', () => {
  test('하루 예약현황이 30분 단위로 표시된다', async ({ page }, testInfo) => {
    await 로그인(page, 계정.senior);
    await page.goto(`/practice-rooms?date=${날짜(1)}`);

    await expect(page.getByRole('heading', { name: '연습실 예약' })).toBeVisible();
    await expect(page.getByText(/하루 전체 예약현황 \(30분 단위, 운영시간/)).toBeVisible();
    // 09:00-22:00 운영이면 26슬롯이다.
    expect(await page.locator('li.slot').count()).toBeGreaterThan(0);
    await expect(page.getByText('예약할 시간대를 선택하세요.')).toBeVisible();

    await 화면찍기(page, testInfo, '40-rooms-day', 'S-05 하루 예약현황 — 30분 단위 슬롯 목록');
  });

  test('연속된 슬롯을 골라 예약한다', async ({ page }, testInfo) => {
    await 로그인(page, 계정.senior);
    await page.goto(`/practice-rooms?date=${날짜(1)}`);

    // 연속한 두 칸을 고른다 → 하나의 예약(1시간)이 된다.
    await 빈슬롯(page).nth(0).check();
    await 빈슬롯(page).nth(1).check();
    await expect(page.getByText(/선택한 시간대: .* ~ .* \(30분 단위 2슬롯\)/)).toBeVisible();
    await 화면찍기(page, testInfo, '41-slots-picked', 'S-05 연속 슬롯 2개 선택 — 하단에 시작~종료와 슬롯 수 요약');

    await page.getByRole('button', { name: '예약 신청' }).click();

    // 확인 화면에서 내용을 한 번 더 보여준다(와이어프레임 10번).
    await expect(page.getByRole('heading', { name: /예약 신청/ })).toBeVisible();
    await expect(
      page.getByText('※ 선택 구간 내 슬롯 중 하나라도 이미 예약되어 있으면 신청 전체가 거부됩니다.'),
    ).toBeVisible();
    await 화면찍기(page, testInfo, '42-reserve-confirm', 'S-05 예약 신청 확인 화면');

    await page.getByRole('button', { name: '예약 확정' }).click();

    await expect(page.getByRole('status')).toContainText('예약이 확정되었습니다.');
    await 화면찍기(page, testInfo, '43-reserve-done', 'S-05 예약 확정 — 현황으로 돌아와 성공 안내');
  });

  test('[엣지] 비연속 슬롯을 고르면 안내하고 선택을 막는다', async ({ page }, testInfo) => {
    await 로그인(page, 계정.senior);
    await page.goto(`/practice-rooms?date=${날짜(2)}`);

    await 빈슬롯(page).nth(0).check();
    /**
     * 한 칸 건너뛴 슬롯을 누른다 → 연속이 아니므로 거절된다.
     * `check()`가 아니라 `click()`을 쓰는 이유: check()는 "눌렀으면 체크돼 있어야 한다"를
     * 함께 단정하는데, 여기서는 **눌러도 체크되지 않는 것이 정상**이다.
     */
    await 빈슬롯(page).nth(2).click();
    await expect(빈슬롯(page).nth(2)).not.toBeChecked();

    await expect(page.getByRole('alert')).toContainText('연속된 시간대만 함께 예약할 수 있습니다.');
    // 거절됐으므로 선택은 여전히 1슬롯이다.
    await expect(page.getByText(/30분 단위 1슬롯/)).toBeVisible();
    await 화면찍기(page, testInfo, '44-slots-noncontiguous', '[엣지] 비연속 슬롯 선택 — 안내 후 선택 유지');
  });

  test('[엣지] 가운데 슬롯은 해제할 수 없다', async ({ page }, testInfo) => {
    await 로그인(page, 계정.senior);
    await page.goto(`/practice-rooms?date=${날짜(2)}`);

    await 빈슬롯(page).nth(0).check();
    await 빈슬롯(page).nth(1).check();
    await 빈슬롯(page).nth(2).check();
    await expect(page.getByText(/30분 단위 3슬롯/)).toBeVisible();

    // 가운데를 빼면 구간이 둘로 쪼개진다 — 허용하지 않으므로 체크가 그대로 남는다.
    await 빈슬롯(page).nth(1).click();
    await expect(빈슬롯(page).nth(1)).toBeChecked();
    await expect(page.getByRole('alert')).toContainText(
      '선택은 시작이나 끝 시간대에서만 해제할 수 있습니다.',
    );
    await expect(page.getByText(/30분 단위 3슬롯/)).toBeVisible();
    await 화면찍기(page, testInfo, '45-slots-middle-release', '[엣지] 가운데 슬롯 해제 시도 — 거절하고 3슬롯 유지');
  });

  test('[엣지] 이미 예약된 시간대는 고를 수 없다', async ({ page }, testInfo) => {
    await 로그인(page, 계정.junior);
    await page.goto(`/practice-rooms?date=${날짜(1)}`);

    // 위에서 정회원이 잡아 둔 구간이 다른 회원에게는 "예약불가"로 보인다.
    const 잡힌슬롯 = page.locator('li.slot.slot--taken').first();
    await expect(잡힌슬롯).toBeVisible();
    await expect(잡힌슬롯.locator('input[type="checkbox"]')).toBeDisabled();
    await 화면찍기(page, testInfo, '46-slot-taken', '[엣지] 타인이 예약한 슬롯 — 예약불가 표시와 선택 불가');
  });

  test('[엣지] 화면이 낡아 이미 찬 구간을 신청하면 서버가 409로 거부한다', async ({ page }, testInfo) => {
    // 다른 테스트의 예약에 기대지 않고 이 테스트가 쓸 구간을 직접 만든다.
    const 날 = 날짜(3);
    await 로그인(page, 계정.senior);
    await page.goto(`/practice-rooms?date=${날}`);

    // 연습실 id를 상수로 박지 않는다 — 실제 id는 시드·운영에 따라 다르다(개발 DB는 2·3).
    const roomId = await page.locator('.picker select').first().inputValue();
    await 빈슬롯(page).nth(0).check();
    await page.getByRole('button', { name: '예약 신청' }).click();
    await page.getByRole('button', { name: '예약 확정' }).click();
    await expect(page.getByRole('status')).toContainText('예약이 확정되었습니다.');

    const 잡힌시간 = await page.locator('li.slot.slot--taken .slot__time').first().innerText();
    const [시작, 끝] = 잡힌시간.split('-');
    await 로그아웃(page);

    /**
     * 예약현황을 열어둔 사이에 다른 사람이 먼저 잡은 상황을 확인 화면 주소로 재현한다.
     * 화면에서는 찬 슬롯을 고를 수 없지만, 화면이 낡았으면 이 요청이 실제로 나간다 —
     * 그때 막는 것은 서버다.
     */
    await 로그인(page, 계정.junior);
    await page.goto(`/practice-rooms/${roomId}/reserve?date=${날}&start=${시작}&end=${끝}`);
    await 화면찍기(page, testInfo, '47a-reserve-stale', '[엣지] 이미 찬 구간을 신청하는 화면(낡은 현황)');
    await page.getByRole('button', { name: '예약 확정' }).click();

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('link', { name: '최신 예약현황 보기' })).toBeVisible();
    await 화면찍기(page, testInfo, '47-reserve-conflict', '[엣지] 중복 예약 — 서버 409와 "최신 예약현황 보기" 안내');
  });
});

test.describe('S-06 예약 취소', () => {
  test('시작 전 예약을 취소하면 상태가 취소로 바뀐다', async ({ page }, testInfo) => {
    await 로그인(page, 계정.senior);
    await page.goto('/me/reservations');

    await expect(page.getByRole('heading', { name: /내 예약 내역/ })).toBeVisible();
    await 화면찍기(page, testInfo, '50-my-reservations', 'S-06 내 예약 내역 — 상태별 표시와 취소 버튼');

    const 예약줄 = page.locator('li.res-row').filter({ hasText: 날짜(1) }).first();
    await 예약줄.getByRole('button', { name: '취소' }).click();
    await expect(page.getByText('예약을 취소할까요?')).toBeVisible();
    await 화면찍기(page, testInfo, '51-cancel-confirm', 'S-06 취소 전 확인');

    // 확인 상태에는 "취소"가 둘이다(빨간 확정 / 조용한 되돌리기). 앞의 것이 확정이다.
    await 예약줄.getByRole('button', { name: '취소' }).first().click();

    // 상태 뱃지가 "취소"로 바뀌어야 한다. 버튼 글자와 섞이지 않도록 상태 칸만 본다.
    await expect(예약줄.locator('.res-row__state')).toHaveText('취소');
    await 화면찍기(page, testInfo, '52-cancel-done', 'S-06 취소 완료 — 상태가 "취소"로 바뀐다');
  });

  test('연습실 필터로 예약을 걸러낸다', async ({ page }, testInfo) => {
    await 로그인(page, 계정.senior);
    await page.goto('/me/reservations');

    const 연습실선택 = page.getByLabel('연습실 필터');
    await expect(연습실선택).toBeVisible();
    const 두번째연습실 = (await 연습실선택.locator('option').nth(2).getAttribute('value')) ?? '';
    await 연습실선택.selectOption(두번째연습실);

    // 필터는 주소에 남는다 — 새로고침·링크 공유가 그대로 동작해야 한다.
    await expect(page).toHaveURL(new RegExp(`roomId=${두번째연습실}`));
    await 화면찍기(page, testInfo, '53-filter', 'S-06 연습실 필터 — 선택이 주소에 남는다');
  });

  test('[엣지] 이미 시작된 예약에는 취소 버튼이 없다', async ({ page }, testInfo) => {
    await 로그인(page, 계정.senior);

    /**
     * 지난 날짜로 예약을 만든다. 서버가 과거 날짜를 검증하지 않는다는 사실을
     * 이용한 것이다(docs/10-integration-check.md §5의 미구현 항목) — 동시에
     * 그 미구현을 재현하는 테스트이기도 하다.
     */
    await page.goto(`/practice-rooms?date=${날짜(-1)}`);
    await 빈슬롯(page).nth(0).check();
    await page.getByRole('button', { name: '예약 신청' }).click();
    await page.getByRole('button', { name: '예약 확정' }).click();
    await expect(page.getByRole('status')).toContainText('예약이 확정되었습니다.');
    await 화면찍기(page, testInfo, '54-past-date-reserved', '[엣지·미구현] 지난 날짜 예약이 서버에서 그대로 만들어진다');

    await page.goto('/me/reservations');
    const 지난예약 = page.locator('li.res-row').filter({ hasText: 날짜(-1) }).first();
    await expect(지난예약).toBeVisible();
    // 시작 시각이 지났으므로 취소할 수 없다(reservationRules.취소할수있나).
    await expect(지난예약.getByRole('button', { name: '취소' })).toHaveCount(0);
    await 화면찍기(page, testInfo, '55-past-no-cancel', '[엣지] 시작된 예약 — 취소 버튼이 노출되지 않는다');
  });
});
