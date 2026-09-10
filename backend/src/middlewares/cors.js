'use strict';

const logger = require('../utils/logger');

/**
 * CORS 허용 origin 목록. `CORS_ORIGIN` 환경변수에 쉼표로 구분해 적는다.
 *   CORS_ORIGIN=http://localhost:5173,https://clubhome.example.com
 *
 * 미설정이면 목록이 비어 어떤 교차 출처 요청도 허용하지 않는다
 * (원칙 §5 "새 선택 키의 기본값은 가장 닫힌 상태"). 브라우저가 아닌 요청은
 * Origin 헤더가 없어 그냥 통과하므로, 미설정 상태에서 curl·테스트·동일 출처
 * (Swagger UI의 Try it out 포함) 동작은 전혀 바뀌지 않는다.
 *
 * 와일드카드(`*`)는 지원하지 않는다 — 정확히 일치하는 origin만 허용한다.
 * 따라서 `CORS_ORIGIN=*`로 적으면 아무 것도 허용되지 않고 닫힌 채로 남는다.
 */
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// 이 API가 실제로 쓰는 것만 연다(swagger의 34개 operation은 GET·POST·PATCH·DELETE만 쓴다).
const ALLOWED_METHODS = 'GET, POST, PATCH, DELETE, OPTIONS';
// Content-Type은 JSON 본문, Authorization은 Bearer 토큰용이다. 그 외는 열지 않는다.
const ALLOWED_HEADERS = 'Content-Type, Authorization';
const MAX_AGE_SECONDS = '600'; // preflight 결과를 10분간 캐시해 왕복을 줄인다

/**
 * 허용 목록 기반 CORS 미들웨어. 라우터·본문 파서보다 앞에 등록해 preflight가
 * 여기서 끝나게 한다.
 */
function cors(req, res, next) {
  const origin = req.headers.origin;

  // Origin이 없으면 브라우저의 교차 출처 요청이 아니다(curl, 서버 간 호출, 동일 출처).
  if (!origin) return next();

  // 응답 내용이 Origin에 따라 달라지므로 허용 여부와 무관하게 항상 붙인다.
  // 빼먹으면 중간 캐시(프록시·CDN)가 A origin용 응답을 B origin에 재사용해,
  // 허용되지 않은 출처에 허용 헤더가 실린 응답이 전달될 수 있다.
  res.setHeader('Vary', 'Origin');

  if (!allowedOrigins.includes(origin)) {
    // 허용 헤더를 붙이지 않고 그대로 통과시킨다 → 브라우저가 응답을 차단한다.
    // 여기서 4xx로 끊지 않는 이유: CORS는 브라우저가 강제하는 규약이라 서버가 거부해도
    // 보안이 더해지지 않는 반면, Origin을 붙여 보내는 정상 도구까지 막히기 때문이다.
    return next();
  }

  // `*`가 아니라 요청받은 origin을 그대로 되돌려준다(허용 목록 방식의 정석).
  res.setHeader('Access-Control-Allow-Origin', origin);

  // Access-Control-Allow-Credentials는 두지 않는다. 이 API는 쿠키 세션이 아니라
  // Authorization 헤더의 Bearer 토큰으로 인증하므로(ERD §4 무상태 설계) 자격증명
  // 전송을 열 이유가 없다. 필요 없는 권한을 여는 것 자체가 위험이다.

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
    res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
    res.setHeader('Access-Control-Max-Age', MAX_AGE_SECONDS);
    return res.status(204).end(); // preflight 응답에는 본문이 없다
  }

  return next();
}

// 켜져 있다는 사실과 대상이 기동 로그에 남아야 한다 — 오타로 막히는 것을 즉시 알아챌 단서다.
if (allowedOrigins.length > 0) {
  logger.info('CORS 허용 origin', { origins: allowedOrigins.join(',') });
}

module.exports = { cors, allowedOrigins };
