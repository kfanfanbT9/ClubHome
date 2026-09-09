'use strict';

const { AppError } = require('./errorHandler');

/** 한국어 조사 선택. private — export하지 않는다. */
function josa(word, withFinal, withoutFinal) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  const hasFinal = code >= 0 && code <= 11171 && code % 28 !== 0;
  return hasFinal ? withFinal : withoutFinal;
}

/**
 * 문자열 필수값 검증. trim된 문자열을 반환한다. 위반 시 400.
 * maxLength는 선택이다(posts.content는 TEXT이며 swagger에 maxLength가 없다).
 */
function requireString(value, field, { maxLength } = {}) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AppError(400, 'BAD_REQUEST', `${field}${josa(field, '을', '를')} 입력해 주세요.`);
  }
  const trimmed = value.trim();
  if (maxLength !== undefined && trimmed.length > maxLength) {
    throw new AppError(
      400,
      'BAD_REQUEST',
      `${field}${josa(field, '은', '는')} ${maxLength}자 이하여야 합니다.`
    );
  }
  return trimmed;
}

module.exports = { requireString };
