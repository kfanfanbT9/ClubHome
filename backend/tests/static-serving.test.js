'use strict';

// 자식 프로세스에 넘길 JWT 시크릿 등을 process.env에 채운다.
// npm test 는 --env-file=.env.test 로 DATABASE_URL만 주므로 나머지는 .env 에서 온다
// (app.test.js 와 같은 방식).
require('dotenv').config();

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

/**
 * IT-02: 프론트엔드 정적 서빙 스위치(`STATIC_DIR`).
 *
 * 자식 프로세스에서 검증하는 이유: STATIC_DIR은 app.js 모듈 로드 시점에 읽혀
 * 라우터 등록 여부를 결정하므로, 같은 프로세스 안에서 값을 바꿔도 이미 만들어진
 * app에는 반영되지 않는다(ENABLE_API_DOCS·CORS_ORIGIN 테스트와 같은 이유).
 */

const 백엔드경로 = path.join(__dirname, '..');

/** 임시 dist 디렉토리를 만들어 돌려준다. */
function 임시dist만들기({ indexHtml = true } = {}) {
  const 디렉토리 = fs.mkdtempSync(path.join(os.tmpdir(), 'clubhome-dist-'));
  if (indexHtml) {
    fs.writeFileSync(
      path.join(디렉토리, 'index.html'),
      '<!doctype html><title>색연필</title><div id="root"></div>'
    );
    fs.writeFileSync(path.join(디렉토리, 'app.js'), 'console.log("빌드된 자산");');
  }
  return 디렉토리;
}

/**
 * 서버를 띄우고 요청 목록을 보낸 뒤 응답을 돌려준다.
 * DB를 건드리지 않는 경로만 요청하므로 DATABASE_URL은 살아 있지 않아도 된다.
 */
function 요청해보기(요청목록, env추가) {
  const 스크립트 = `
    const app = require('./src/app');
    const 요청목록 = ${JSON.stringify(요청목록)};
    const server = app.listen(0, async () => {
      const 기본 = 'http://127.0.0.1:' + server.address().port;
      const 결과 = [];
      for (const 요청 of 요청목록) {
        const response = await fetch(기본 + 요청.path, { method: 요청.method || 'GET' });
        const 본문 = await response.text();
        결과.push({
          path: 요청.path,
          method: 요청.method || 'GET',
          status: response.status,
          contentType: response.headers.get('content-type'),
          본문앞부분: 본문.slice(0, 60),
        });
      }
      console.log(JSON.stringify(결과));
      server.close(() => process.exit(0));
    });
  `;

  const 결과 = spawnSync(process.execPath, ['-e', 스크립트], {
    cwd: 백엔드경로,
    env: { ...process.env, LOG_LEVEL: 'silent', ...env추가 },
    encoding: 'utf8',
  });

  assert.equal(결과.status, 0, `자식 프로세스 실패: ${결과.stderr}`);
  return JSON.parse(결과.stdout.trim().split('\n').pop());
}

test('STATIC_DIR 미설정이면 정적 서빙을 등록하지 않는다', () => {
  const [루트] = 요청해보기([{ path: '/' }], { STATIC_DIR: '' });

  // 개발 중에는 Vite가 프론트를 서빙하므로 이 서버는 API만 담당한다.
  assert.equal(루트.status, 404, 'STATIC_DIR 없이 index.html을 내보내면 안 된다');
});

test('STATIC_DIR을 주면 index.html과 빌드 자산을 서빙한다', () => {
  const dist = 임시dist만들기();
  const [루트, 자산] = 요청해보기([{ path: '/' }, { path: '/app.js' }], { STATIC_DIR: dist });

  assert.equal(루트.status, 200);
  assert.match(루트.contentType, /text\/html/);
  assert.match(루트.본문앞부분, /색연필/);

  assert.equal(자산.status, 200);
  assert.match(자산.본문앞부분, /빌드된 자산/);

  fs.rmSync(dist, { recursive: true, force: true });
});

test('클라이언트 라우트는 index.html로 폴백한다', () => {
  const dist = 임시dist만들기();
  const 응답들 = 요청해보기(
    [{ path: '/boards' }, { path: '/me/reservations' }, { path: '/admin/members' }],
    { STATIC_DIR: dist }
  );

  // 주소창에 직접 넣거나 새로고침하면 이 경로가 서버로 온다.
  // index.html을 주지 않으면 라우터가 뜨기 전에 404 화면이 보인다.
  for (const 응답 of 응답들) {
    assert.equal(응답.status, 200, `${응답.path} 가 폴백되지 않았다`);
    assert.match(응답.본문앞부분, /색연필/);
  }

  fs.rmSync(dist, { recursive: true, force: true });
});

test('없는 API 경로는 HTML이 아니라 JSON 404를 준다', () => {
  const dist = 임시dist만들기();
  const [없는api] = 요청해보기([{ path: '/api/없는리소스' }], { STATIC_DIR: dist });

  // 폴백이 /api/ 를 삼키면 클라이언트가 JSON을 기대하며 HTML을 파싱하다 깨진다.
  assert.equal(없는api.status, 404);
  assert.match(없는api.contentType, /application\/json/);
  assert.doesNotMatch(없는api.본문앞부분, /<!doctype/i);

  fs.rmSync(dist, { recursive: true, force: true });
});

test('GET이 아닌 요청은 폴백하지 않는다', () => {
  const dist = 임시dist만들기();
  const [포스트] = 요청해보기([{ path: '/없는경로', method: 'POST' }], { STATIC_DIR: dist });

  // POST /없는경로 에 index.html을 200으로 주는 것은 틀린 응답이다.
  assert.equal(포스트.status, 404);

  fs.rmSync(dist, { recursive: true, force: true });
});

test('헬스체크는 정적 서빙에 가려지지 않는다', () => {
  const dist = 임시dist만들기();
  const [health] = 요청해보기([{ path: '/health' }], { STATIC_DIR: dist });

  // 프로브가 index.html을 받으면 장애를 감지할 수 없다.
  assert.match(health.contentType, /application\/json/);
  assert.match(health.본문앞부분, /"status"/);

  fs.rmSync(dist, { recursive: true, force: true });
});

test('빌드 전 디렉토리를 가리키면 404로 떨어진다', () => {
  const 빈디렉토리 = 임시dist만들기({ indexHtml: false });
  const [루트] = 요청해보기([{ path: '/' }], { STATIC_DIR: 빈디렉토리 });

  // index.html이 없는데 200을 주면 빈 화면이 정상처럼 보인다.
  assert.equal(루트.status, 404);

  fs.rmSync(빈디렉토리, { recursive: true, force: true });
});
