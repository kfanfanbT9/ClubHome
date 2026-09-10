/**
 * 최소 클라이언트 검증.
 *
 * 여기서 하는 것은 즉각적인 UX를 위한 형식 확인까지다 — 서버에 다녀오지 않고도 알 수 있는
 * 것만 본다. 이메일 중복처럼 데이터를 봐야 아는 판정은 서버 응답 기준으로만 표시한다(원칙 §2.1).
 * 이 검증을 통과한 것이 저장 성공을 뜻하지 않는다.
 */

// 로컬파트@도메인.최상위 수준만 본다. RFC 5322를 흉내내는 정규식은 길이만 길고
// 실제로 걸러내는 것은 늘지 않는다 — 최종 판정은 서버 400이다.
const 이메일패턴 = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return 이메일패턴.test(value);
}

/** swagger `SignupRequest.password.minLength` 와 같은 값 */
export const PASSWORD_MIN_LENGTH = 8;
