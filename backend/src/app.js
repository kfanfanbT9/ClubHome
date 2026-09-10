'use strict';

const express = require('express');
const routes = require('./routes');
const logger = require('./utils/logger');
const { cors } = require('./middlewares/cors');
const { notFoundHandler, errorHandler } = require('./middlewares/errorHandler');

const app = express();

/**
 * 요청/응답 로깅. express.json()보다 먼저 등록해 본문 파싱이 실패한 요청(400)까지 덮는다.
 * 응답이 끝난 뒤(res 'finish') 한 줄로 남기므로 상태코드·소요시간을 함께 적을 수 있고,
 * requireAuth가 그 사이에 채운 req.member도 이 시점에는 확정되어 있다.
 *
 * 요청 본문은 절대 남기지 않는다 — 회원가입·로그인 본문에 비밀번호가, 인증 헤더에는
 * Access Token이 들어 있다. 남기는 것은 메서드·경로·상태·소요시간·회원ID뿐이다.
 */
app.use((req, res, next) => {
  const 시작 = process.hrtime.bigint();

  res.on('finish', () => {
    const 소요밀리초 = Number(process.hrtime.bigint() - 시작) / 1e6;
    logger.info('요청', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      duration: `${소요밀리초.toFixed(1)}ms`,
      memberId: req.member && req.member.id,
    });
  });

  next();
});

// CORS는 라우터·본문 파서보다 앞에 둔다 — preflight(OPTIONS)를 여기서 끝내고,
// 허용되지 않은 출처에 대해서도 로그는 남도록 요청 로거 다음 자리에 놓는다.
app.use(cors);

app.use(express.json());
app.use(routes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
