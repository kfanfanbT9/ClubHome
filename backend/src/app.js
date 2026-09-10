'use strict';

const path = require('node:path');
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

/**
 * 프론트엔드 정적 서빙 스위치 (`STATIC_DIR`).
 *
 * 배포 형태가 단일 서버(단일 VM/컨테이너)이므로(PRD §5, 원칙 §1) 프론트 빌드 결과를
 * 이 프로세스가 함께 내보낼 수 있게 한다. 그러면 프론트와 API가 같은 출처가 되어
 * CORS 설정 자체가 필요 없어진다 — nginx 같은 정적 서버를 하나 더 두지 않아도 된다.
 *
 * 미설정이면 아무것도 등록하지 않는다. 개발 중에는 Vite가 프론트를 서빙하고
 * 이 서버는 API만 담당하므로, 기본값은 "끔"이 맞다(CORS_ORIGIN·ENABLE_API_DOCS와 같은 관례).
 *
 * **API 라우터 뒤에 등록한다.** 앞에 두면 `/api/...` 요청이 정적 파일 탐색을 먼저 거친다.
 */
const staticDir = process.env.STATIC_DIR;

if (staticDir) {
  /**
   * 상대 경로는 **백엔드 루트 기준**으로 푼다. `process.cwd()` 기준으로 풀면
   * `../frontend/dist`가 서버를 어디서 띄웠는지에 따라 다른 곳을 가리킨다 —
   * systemd 의 `WorkingDirectory`가 backend 가 아니면 정적 파일을 못 찾는다.
   * `.env`에 적힌 `../frontend/dist`가 "backend 옆의 frontend"를 뜻하도록 고정한다.
   * 절대 경로는 그대로 쓰인다.
   */
  const 정적경로 = path.resolve(__dirname, '..', staticDir);
  app.use(express.static(정적경로));

  /**
   * SPA 폴백. `/boards` 같은 클라이언트 라우트를 주소창에 직접 넣거나 새로고침하면
   * 서버로 그 경로가 오는데, 파일이 없으므로 index.html을 돌려줘야 라우터가 화면을 그린다.
   *
   * `/api/`로 시작하는 요청은 넘기지 않는다 — 없는 API를 불렀을 때 JSON 404가 아니라
   * HTML이 200으로 돌아오면, 클라이언트가 응답을 파싱하다 엉뚱한 곳에서 깨진다.
   * GET이 아닌 요청도 넘기지 않는다(POST /없는경로에 index.html을 주는 것은 틀린 응답이다).
   *
   * 라우트 패턴(`'*'`) 대신 미들웨어로 판별하는 이유는 Express 5에서 와일드카드 문법이
   * 바뀌었기 때문이다. 조건을 코드로 적으면 버전에 따라 달라지지 않는다.
   */
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(정적경로, 'index.html'), (error) => {
      // index.html이 없으면(빌드 전 디렉토리를 가리킨 경우) 404로 떨어뜨린다.
      if (error) next();
    });
  });

  logger.info('정적 파일 서빙', { dir: 정적경로 });
}

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
