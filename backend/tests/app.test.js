'use strict';

require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const app = require('../src/app');
const { pool } = require('../src/db/pool');
const { AppError, errorHandler } = require('../src/middlewares/errorHandler');

/** 임시 포트로 앱을 띄우고 콜백에 base URL을 넘긴다. */
async function withServer(target, callback) {
  const server = target.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    return await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('GET /health는 200과 DB 연결 상태를 응답한다', async () => {
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', db: 'ok' });
  });
});

test('정의되지 않은 경로는 404 ErrorResponse 형식으로 응답한다', async () => {
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/없는-경로`);
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.code, 'NOT_FOUND');
    assert.equal(typeof body.message, 'string');
  });
});

test('AppError는 지정한 상태코드와 code로 응답한다', async () => {
  const target = express();
  target.get('/boom', () => {
    throw new AppError(409, 'RESERVATION_SLOT_CONFLICT', '이미 예약된 시간대가 포함되어 있습니다.');
  });
  target.use(errorHandler);

  await withServer(target, async (base) => {
    const response = await fetch(`${base}/boom`);
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      code: 'RESERVATION_SLOT_CONFLICT',
      message: '이미 예약된 시간대가 포함되어 있습니다.',
    });
  });
});

test('예상치 못한 예외는 500으로 감싸고 내부 메시지를 노출하지 않는다', async () => {
  const target = express();
  target.get('/boom', async () => {
    throw new Error('password_hash 컬럼 접근 실패');
  });
  target.use(errorHandler);

  await withServer(target, async (base) => {
    const response = await fetch(`${base}/boom`);
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.code, 'INTERNAL_ERROR');
    assert.ok(!body.message.includes('password_hash'));
  });
});

test.after(async () => {
  await pool.end();
});
