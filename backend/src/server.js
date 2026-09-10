'use strict';

require('dotenv').config({ quiet: true });

const app = require('./app');
const logger = require('./utils/logger');

const port = Number(process.env.PORT) || 3000;

app.listen(port, () => {
  // 로그 형식을 요청·오류 로그와 통일한다(기동 라인만 다른 형식이면 파일에서 걸러내기 어렵다).
  logger.info('서버 기동', { port, logLevel: process.env.LOG_LEVEL || 'info' });
});
