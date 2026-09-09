'use strict';

const bcrypt = require('bcryptjs');

// bcryptjs 기본값. 순수 JS 구현이라 상향 시 로그인 응답이 체감 지연되므로 고정한다.
const SALT_ROUNDS = 10;

/** 평문 비밀번호를 해시로 변환한다. 입력 검증은 controller 책임이므로 하지 않는다. */
function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

/** 평문 비밀번호와 해시가 일치하는지 비교한다. */
function verifyPassword(plainPassword, passwordHash) {
  return bcrypt.compare(plainPassword, passwordHash);
}

module.exports = { hashPassword, verifyPassword };
