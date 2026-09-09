'use strict';

const jwt = require('jsonwebtoken');
const { AppError } = require('../middlewares/errorHandler');

/**
 * 환경변수를 읽고 없으면 즉시 예외를 던진다(fail-fast).
 * 시크릿·유효기간에 폴백 기본값을 두지 않기 위한 유일한 통로다.
 */
function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`환경변수 ${name} 미설정`);
  }
  return value;
}

// 모듈 로드 시점에 즉시 읽는다. 하나라도 없으면 서버 기동이 실패한다.
const ACCESS_SECRET = requireEnv('JWT_ACCESS_SECRET');
const REFRESH_SECRET = requireEnv('JWT_REFRESH_SECRET');
const ACCESS_EXPIRES_IN = requireEnv('JWT_ACCESS_EXPIRES_IN');
const REFRESH_EXPIRES_IN = requireEnv('JWT_REFRESH_EXPIRES_IN');

/** Access Token 발급. 회원ID·등급·관리자 여부를 클레임에 담는다. */
function signAccessToken({ id, gradeLevel, isAdmin }) {
  return jwt.sign(
    { memberId: id, gradeLevel, isAdmin, typ: 'access' },
    ACCESS_SECRET,
    { expiresIn: ACCESS_EXPIRES_IN }
  );
}

/** Refresh Token 발급. 회원ID만 담는다(등급 재조회는 재발급 시점에 수행). */
function signRefreshToken({ id }) {
  return jwt.sign({ memberId: id, typ: 'refresh' }, REFRESH_SECRET, {
    expiresIn: REFRESH_EXPIRES_IN,
  });
}

/**
 * 토큰 검증 공통 로직. 만료/위조/토큰 종류 불일치를 401 AppError로 매핑한다.
 * jsonwebtoken이 던지는 원본 오류를 그대로 흘리면 errorHandler가 500으로 처리하므로
 * 이 매핑을 통해서만 검증 결과가 나가게 한다.
 */
function verifyToken(token, secret, expectedTyp) {
  let payload;
  try {
    payload = jwt.verify(token, secret);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new AppError(401, 'TOKEN_EXPIRED', '토큰이 만료되었습니다.');
    }
    throw new AppError(401, 'UNAUTHORIZED', '유효하지 않은 토큰입니다.');
  }

  if (payload.typ !== expectedTyp) {
    throw new AppError(401, 'UNAUTHORIZED', '유효하지 않은 토큰입니다.');
  }

  return payload;
}

/** Access Token 검증. 실패 시 401 AppError를 던진다. */
function verifyAccessToken(token) {
  return verifyToken(token, ACCESS_SECRET, 'access');
}

/** Refresh Token 검증. 실패 시 401 AppError를 던진다. */
function verifyRefreshToken(token) {
  return verifyToken(token, REFRESH_SECRET, 'refresh');
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};
