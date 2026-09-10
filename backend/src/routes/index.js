'use strict';

const path = require('node:path');
const express = require('express');
const { query } = require('../db/pool');
const logger = require('../utils/logger');
const authRoutes = require('./auth-routes');
const memberRoutes = require('./member-routes');
const boardRoutes = require('./board-routes');
const { postRoutes, boardPostRoutes } = require('./post-routes');
const practiceRoomRoutes = require('./practice-room-routes');
const { reservationRoutes, memberReservationRoutes } = require('./reservation-routes');
const adminRoutes = require('./admin-routes');

const router = express.Router();

// GET /health — DB 연결 상태를 포함한 서버 상태 확인 (swagger.yaml /health, 인증 불필요)
//
// DB 연결이 끊기면 200이 아니라 503으로 응답한다. 상태코드만 보는 프로브(로드밸런서,
// `curl -f`, 외부 모니터링)가 대부분이므로, 200을 주면서 본문에만 `db: "error"`를 담으면
// 장애가 아무에게도 감지되지 않는다. 본문 파싱을 요구하지 않는 것이 헬스체크의 요점이다.
router.get('/health', async (req, res) => {
  let db = 'ok';
  try {
    await query('SELECT 1');
  } catch (error) {
    db = 'error';
    // 원인을 남긴다 — 503만 보고는 커넥션 거부인지 인증 실패인지 알 수 없다.
    logger.error('헬스체크 DB 확인 실패', { error });
  }

  const healthy = db === 'ok';
  res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'error', db });
});

// API 문서 노출 스위치. `ENABLE_API_DOCS=true`일 때만 아래 두 경로가 등록된다.
//
// 기본값을 끔으로 둔 이유: 이 두 경로에는 인증이 없어 켜져 있으면 API 표면 전체가 공개된다.
// 켜는 것을 잊으면 개발 중 문서를 못 보는 정도지만, 끄는 것을 잊으면 운영에서 그대로
// 노출되므로 실수의 비용이 한쪽으로 크게 치우친다 — 그래서 "명시적으로 켜야 열린다".
// 'true' 문자열만 인정한다(admin-controller의 optionalBoolean과 같은 엄격성).
const apiDocsEnabled = process.env.ENABLE_API_DOCS === 'true';

if (apiDocsEnabled) {
  // swagger-ui-express는 swagger-ui-dist(정적 자산 수 MB)를 끌어온다. 꺼져 있을 때는
  // 아예 require하지 않아 운영 프로세스가 이 자산을 메모리에 올리지 않는다.
  const swaggerUi = require('swagger-ui-express');

  // GET /swagger.yaml — 스펙 원문. 아래 Swagger UI가 브라우저에서 이 URL을 읽어 파싱한다.
  // 서버에서 YAML을 객체로 넘기지 않는 이유: 그러려면 yaml 파서를 새로 설치해야 하는데,
  // UI가 이미 클라이언트에서 YAML을 읽을 수 있으므로 의존성 없이 같은 결과가 나온다.
  router.get('/swagger.yaml', (req, res) => {
    res.type('text/yaml').sendFile(path.join(__dirname, '..', '..', 'swagger.yaml'));
  });

  // GET /api-docs — Swagger UI. `/api/...` 라우터들과 경로 세그먼트가 달라 충돌하지 않는다.
  // 인증을 걸지 않는다: UI에서 로그인 후 Access Token을 Authorize에 넣어 보호된
  // 엔드포인트를 시험(Try it out)하는 것이 이 화면의 용도다.
  router.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(null, { swaggerOptions: { url: '/swagger.yaml' } })
  );

  // 켜져 있다는 사실 자체가 기동 로그에 남아야 한다 — 운영에서 실수로 켠 것을 알아챌 단서다.
  logger.warn('API 문서 공개 중 - 인증 없이 접근 가능', { paths: '/api-docs,/swagger.yaml' });
}
// 꺼져 있으면 두 경로는 등록되지 않아 notFoundHandler의 404로 떨어진다(기능 존재를 알리지 않는다).

// 도메인별 라우터는 /api 하위로 등록한다(swagger paths 키가 이미 /api를 포함, servers.url = "/").
router.use('/api/auth', authRoutes);
router.use('/api/members', memberRoutes);
router.use('/api/members', memberReservationRoutes);
router.use('/api/boards', boardRoutes);
router.use('/api/boards', boardPostRoutes);
router.use('/api/posts', postRoutes);
router.use('/api/practice-rooms', practiceRoomRoutes);
router.use('/api/reservations', reservationRoutes);
router.use('/api/admin', adminRoutes);

module.exports = router;
