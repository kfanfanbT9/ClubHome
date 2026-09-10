'use strict';

require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
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

test('GET /health는 DB가 정상이면 200과 db:ok를 응답한다', async () => {
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', db: 'ok' });
  });
});

/**
 * DB 연결 실패 시 503. 이 프로세스의 커넥션 풀은 건드릴 수 없으므로(pool.js가 모듈 로드
 * 시점에 DATABASE_URL을 읽어 고정한다) 자식 프로세스에 닿지 않는 주소를 주입해 확인한다
 * — auth-utils.test.js의 "시크릿 미설정 시 모듈 로드 실패"와 같은 방식이다.
 *
 * 포트 1은 항상 거부되므로 타임아웃 없이 즉시 실패한다. 개발·테스트 DB 어느 쪽에도
 * 접속하지 않는다.
 */
test('GET /health는 DB 연결이 끊기면 503과 db:error를 응답한다', () => {
  const env = {
    ...process.env,
    DATABASE_URL: 'postgresql://nobody:nobody@127.0.0.1:1/nodb',
    LOG_LEVEL: 'silent', // 자식의 요청·오류 로그가 stdout/stderr에 섞이지 않게 한다
  };

  const 스크립트 = `
    const app = require('./src/app');
    const server = app.listen(0, async () => {
      const response = await fetch('http://127.0.0.1:' + server.address().port + '/health');
      console.log(JSON.stringify({ status: response.status, body: await response.json() }));
      server.close(() => process.exit(0));
    });
  `;

  const 결과 = spawnSync(process.execPath, ['-e', 스크립트], {
    cwd: path.join(__dirname, '..'),
    env,
    encoding: 'utf8',
  });

  assert.equal(결과.status, 0, `자식 프로세스 실패: ${결과.stderr}`);
  const 출력 = JSON.parse(결과.stdout.trim().split('\n').pop());
  assert.equal(출력.status, 503, 'DB가 끊겼는데 200이면 프로브가 장애를 감지할 수 없다');
  assert.deepEqual(출력.body, { status: 'error', db: 'error' });
});

/**
 * CORS. middlewares/cors.js가 모듈 로드 시점에 CORS_ORIGIN을 읽어 허용 목록을 고정하므로
 * 이 프로세스에서는 바꿀 수 없다 — 위 503 케이스와 같이 자식 프로세스에 주입해 확인한다.
 * 한 번의 spawn으로 네 경우(허용/비허용/preflight/Origin 없음)를 모두 검사한다.
 */
test('CORS는 허용 목록의 origin에만 헤더를 내려주고 preflight를 204로 끝낸다', () => {
  const 허용 = 'http://localhost:5173';
  const env = {
    ...process.env,
    CORS_ORIGIN: `${허용},https://clubhome.example.com`,
    LOG_LEVEL: 'silent',
  };

  const 스크립트 = `
    const app = require('./src/app');
    const server = app.listen(0, async () => {
      const base = 'http://127.0.0.1:' + server.address().port;
      const 수집 = async (label, path, options) => {
        const r = await fetch(base + path, options);
        return [label, {
          status: r.status,
          allowOrigin: r.headers.get('access-control-allow-origin'),
          allowMethods: r.headers.get('access-control-allow-methods'),
          allowHeaders: r.headers.get('access-control-allow-headers'),
          allowCredentials: r.headers.get('access-control-allow-credentials'),
          vary: r.headers.get('vary'),
        }];
      };
      const 결과 = Object.fromEntries([
        await 수집('허용', '/health', { headers: { Origin: '${허용}' } }),
        await 수집('비허용', '/health', { headers: { Origin: 'http://evil.example.com' } }),
        await 수집('preflight', '/api/auth/login', {
          method: 'OPTIONS',
          headers: {
            Origin: '${허용}',
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'content-type,authorization',
          },
        }),
        await 수집('Origin없음', '/health', {}),
      ]);
      console.log(JSON.stringify(결과));
      server.close(() => process.exit(0));
    });
  `;

  const 결과 = spawnSync(process.execPath, ['-e', 스크립트], {
    cwd: path.join(__dirname, '..'),
    env,
    encoding: 'utf8',
  });

  assert.equal(결과.status, 0, `자식 프로세스 실패: ${결과.stderr}`);
  const r = JSON.parse(결과.stdout.trim().split('\n').pop());

  // 허용된 origin: `*`가 아니라 요청 origin을 그대로 되돌려준다.
  assert.equal(r.허용.status, 200);
  assert.equal(r.허용.allowOrigin, 허용);
  assert.equal(r.허용.vary, 'Origin', 'Vary가 없으면 캐시가 다른 origin에 응답을 재사용한다');

  // 비허용 origin: 허용 헤더가 없어야 한다(있으면 브라우저가 통과시킨다).
  assert.equal(r.비허용.allowOrigin, null);
  assert.equal(r.비허용.vary, 'Origin', '차단하는 응답도 origin에 따라 달라지므로 Vary가 필요하다');

  // preflight: 204 + 메서드·헤더 목록. 200이어도 브라우저는 받아들이지만 본문이 없어야 한다.
  assert.equal(r.preflight.status, 204);
  assert.equal(r.preflight.allowOrigin, 허용);
  assert.match(r.preflight.allowMethods, /PATCH/);
  assert.match(r.preflight.allowHeaders, /Authorization/);

  // 쿠키를 쓰지 않으므로 credentials는 어느 응답에도 없어야 한다.
  assert.equal(r.허용.allowCredentials, null);
  assert.equal(r.preflight.allowCredentials, null);

  // Origin 없는 요청(curl·동일 출처)은 CORS 처리를 타지 않는다.
  assert.equal(r.Origin없음.status, 200);
  assert.equal(r.Origin없음.allowOrigin, null);
  assert.equal(r.Origin없음.vary, null);
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
