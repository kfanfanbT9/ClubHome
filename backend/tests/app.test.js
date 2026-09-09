'use strict';

require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const app = require('../src/app');
const { pool, query, withTransaction } = require('../src/db/pool');
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

test('잘못된 JSON 본문은 500이 아닌 400으로 응답한다', async () => {
  const target = express();
  target.use(express.json());
  target.post('/echo', (req, res) => res.json(req.body));
  target.use(errorHandler);

  await withServer(target, async (base) => {
    const response = await fetch(`${base}/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{깨진 JSON',
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'BAD_REQUEST');
  });
});

test('withTransaction은 성공 시 COMMIT, 오류 시 ROLLBACK한다', async () => {
  await query('CREATE TABLE IF NOT EXISTS tx_probe (v integer)');
  try {
    await assert.rejects(
      withTransaction(async (client) => {
        await client.query('INSERT INTO tx_probe VALUES (1)');
        throw new Error('의도적 실패');
      }),
      /의도적 실패/,
    );
    let result = await query('SELECT count(*)::int AS count FROM tx_probe');
    assert.equal(result.rows[0].count, 0, 'ROLLBACK되어 행이 남지 않아야 한다');

    await withTransaction((client) => client.query('INSERT INTO tx_probe VALUES (2)'));
    result = await query('SELECT count(*)::int AS count FROM tx_probe');
    assert.equal(result.rows[0].count, 1, 'COMMIT되어 행이 남아야 한다');
  } finally {
    await query('DROP TABLE IF EXISTS tx_probe');
  }
});

test.after(async () => {
  await pool.end();
});
