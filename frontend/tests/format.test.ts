import { describe, expect, it } from 'vitest';
import { formatDate } from '../src/lib/format';

describe('formatDate', () => {
  it('ISO 일시를 YYYY-MM-DD로 바꾼다', () => {
    // 와이어프레임 5번의 "가입일 2026-01-10" 표기
    expect(formatDate('2026-01-10T05:00:00.000Z')).toBe('2026-01-10');
  });

  it('월·일을 두 자리로 채운다', () => {
    expect(formatDate('2026-03-07T12:00:00.000Z')).toBe('2026-03-07');
  });

  it('날짜만 있는 값도 처리한다', () => {
    expect(formatDate('2026-06-01')).toBe('2026-06-01');
  });

  it('해석할 수 없는 값은 원문을 그대로 돌려준다', () => {
    // "NaN-NaN-NaN"을 화면에 띄우는 것보다 낫다.
    expect(formatDate('언젠가')).toBe('언젠가');
    expect(formatDate('')).toBe('');
  });
});
