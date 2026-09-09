'use strict';

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

  if (status >= 500) {
    console.error(error);
  }

  res.status(status).json({
    code: error.code || 'INTERNAL_ERROR',
    message: status >= 500 ? '서버 오류가 발생했습니다.' : error.message,
  });
}

module.exports = { AppError, notFoundHandler, errorHandler };
