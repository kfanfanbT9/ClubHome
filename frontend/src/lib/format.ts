/** 표시용 포맷 유틸. 값 자체를 바꾸지 않고 보여줄 문자열만 만든다. */

const 두자리 = (n: number) => String(n).padStart(2, '0');

/**
 * ISO 날짜·일시를 `YYYY-MM-DD`로 (와이어프레임 5번의 "가입일 2026-01-10" 표기).
 *
 * 문자열을 앞 10자만 자르지 않고 Date를 거치는 이유: 서버는 UTC로 내려주므로
 * 자르면 사용자의 자정 전후로 하루가 어긋난다. 보는 사람의 시간대 기준 날짜를 쓴다.
 */
export function formatDate(iso: string): string {
  const 날짜 = new Date(iso);
  // 예상 밖 형태가 오면 "NaN-NaN-NaN"을 보여주는 대신 원문을 그대로 둔다.
  if (Number.isNaN(날짜.getTime())) return iso;
  return `${날짜.getFullYear()}-${두자리(날짜.getMonth() + 1)}-${두자리(날짜.getDate())}`;
}
