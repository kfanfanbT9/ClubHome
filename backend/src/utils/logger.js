'use strict';

/**
 * 콘솔 전용 로거. 원칙 §5("로그는 콘솔 출력(+파일 리다이렉트) 수준으로 충분하며,
 * 별도 로그 수집 인프라(ELK 등)는 두지 않는다")에 따라 의존성 없이 console만 감싼다.
 *
 * 한 이벤트 = 한 줄. 파일로 리다이렉트해도 grep으로 바로 걸리는 형식이다:
 *   2026-09-10T07:21:03.123Z INFO  요청 method=POST path=/api/auth/login status=200 duration=12.4ms
 *
 * info는 stdout, warn·error는 stderr로 나간다 — `npm start > app.log 2> error.log` 로
 * 정상 트래픽과 문제를 파일 단위로 분리할 수 있다.
 */

const LEVELS = { silent: 0, error: 1, warn: 2, info: 3 };

// node --test 하위 프로세스에는 NODE_TEST_CONTEXT가 설정된다(실측 v24.20.0: "child-v8").
// 테스트에서 기본을 silent로 두는 이유: 231건이 각자 요청을 보내므로 요청 로그가
// 실패 원인을 덮어버린다. LOG_LEVEL을 명시하면 테스트 중에도 켤 수 있다.
const DEFAULT_LEVEL = process.env.NODE_TEST_CONTEXT ? 'silent' : 'info';
const threshold = LEVELS[process.env.LOG_LEVEL] ?? LEVELS[DEFAULT_LEVEL];

/**
 * 부가 정보를 `key=value` 나열로 만든다. 값에 공백이 있으면(한국어 오류 메시지 등)
 * 따옴표로 감싸 한 줄 파싱이 깨지지 않게 한다. undefined·null 필드는 생략한다.
 */
function formatFields(fields) {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => {
      const 표기 = typeof value === 'string' && value.includes(' ') ? JSON.stringify(value) : value;
      return `${key}=${표기}`;
    })
    .join(' ');
}

/**
 * fields의 `error` 키는 예약어다 — Error 객체를 넣으면 스택을 다음 줄에 덧붙인다.
 * 그 외 키는 모두 `key=value`로 나열된다.
 */
function log(level, message, fields = {}) {
  if (LEVELS[level] > threshold) return;

  const { error, ...rest } = fields;
  const 본문 = [
    `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}`,
    formatFields(rest),
  ]
    .filter(Boolean)
    .join(' ');

  const sink = level === 'info' ? console.log : console.error;
  sink(error && error.stack ? `${본문}\n${error.stack}` : 본문);
}

module.exports = {
  info: (message, fields) => log('info', message, fields),
  warn: (message, fields) => log('warn', message, fields),
  error: (message, fields) => log('error', message, fields),
};
