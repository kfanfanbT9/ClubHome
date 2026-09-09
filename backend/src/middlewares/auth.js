'use strict';

const { verifyAccessToken } = require('../utils/jwt');
const { AppError } = require('./errorHandler');

/**
 * Access Token을 검증해 로그인 여부만 판단하는 미들웨어.
 * 등급·관리자 판단(인가)은 여기서 하지 않는다 — 각 service 함수의 책임이다(원칙 §2.2).
 *
 * req.member는 토큰 클레임에서 파생된 값이며 members 테이블 행이 아니다.
 * email·accountStatus 등은 들어있지 않다.
 *
 * 라우트 단위로만 부착한다(app.use 전역 등록 금지) — /health, 회원가입/로그인/재발급은
 * swagger에서 security: []로 인증이 필요 없다.
 */
function requireAuth(req, res, next) {
  const authorization = req.headers.authorization || '';
  const [scheme, token] = authorization.split(' ');

  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) {
    throw new AppError(401, 'UNAUTHORIZED', '인증 토큰이 필요합니다.');
  }

  // 실패 시 verifyAccessToken이 던지는 AppError를 그대로 전파한다(재포장 금지).
  const payload = verifyAccessToken(token);

  req.member = {
    id: payload.memberId,
    gradeLevel: payload.gradeLevel,
    isAdmin: payload.isAdmin,
  };

  next();
}

module.exports = { requireAuth };
