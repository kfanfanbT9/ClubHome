'use strict';

const logger = require('../utils/logger');

/**
 * 서비스 레이어에서 의도적으로 발생시키는 오류.
 * status와 code를 함께 담아 controller를 거치지 않고 errorHandler가 그대로 응답한다.
 */
class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** 정의되지 않은 경로 처리 */
function notFoundHandler(req, res) {
  res.status(404).json({ code: 'NOT_FOUND', message: '요청한 경로를 찾을 수 없습니다.' });
}

/**
 * 표준 오류 응답. 응답 본문은 swagger.yaml의 ErrorResponse 스키마({code, message})와 일치한다.
 * Express 5는 async 핸들러에서 발생한 예외도 이 미들웨어로 전달한다.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(error, req, res, next) {
  const status = error.status || 500;
  const isServerError = status >= 500;

  if (isServerError) {
    // 예상하지 못한 오류다 — 스택까지 남겨야 원인을 추적할 수 있다.
    logger.error('서버 오류', { method: req.method, path: req.originalUrl, error });
  } else {
    // 의도된 거부(인증 실패, 등급 미달, 예약 겹침 등)다. 스택은 노이즈이므로 사유만 남긴다.
    // 응답에서 감추는 값이 없는 4xx이니 message를 그대로 적어도 새로 노출되는 정보는 없다.
    logger.warn('요청 거부', {
      method: req.method,
      path: req.originalUrl,
      status,
      code: error.code || 'BAD_REQUEST',
      message: error.message,
      memberId: req.member && req.member.id,
    });
  }

  res.status(status).json({
    // AppError가 아닌 오류(예: express.json()의 JSON 파싱 실패)도 4xx/5xx를 구분해 표기한다.
    code: error.code || (isServerError ? 'INTERNAL_ERROR' : 'BAD_REQUEST'),
    message: isServerError ? '서버 오류가 발생했습니다.' : error.message,
  });
}

module.exports = { AppError, notFoundHandler, errorHandler };
