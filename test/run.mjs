/**
 * 테스트를 돌리고, 결과와 무관하게 리포트를 만든다.
 *
 * npm 스크립트에서 `playwright test; node report.mjs`로 잇지 않는 이유:
 * 셸이 Windows cmd면 `;`가 구분자가 아니라 명령 이름의 일부가 되어 그대로 깨진다.
 * `&&`로 이으면 이번에는 **실패했을 때 리포트가 만들어지지 않는다** — 실패야말로
 * 리포트에 남아야 하는 것이라 그쪽도 맞지 않는다.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const 여기 = dirname(fileURLToPath(import.meta.url));
const 결과파일 = join(여기, 'e2e', 'results.json');

/**
 * Playwright를 `npx`가 아니라 **CLI 진입점을 node로 직접** 실행한다.
 *
 * Node는 Windows에서 `spawn`으로 `.cmd`를 띄우는 것을 막는다(EINVAL). 그런데
 * spawnSync는 그 실패를 예외가 아니라 `result.error`로만 알려주고 `status`는 null이라,
 * 반환값만 보면 "성공"처럼 지나간다 — 실제로 그 탓에 테스트가 한 건도 돌지 않았는데
 * 직전 실행의 결과 파일로 리포트가 만들어져 초록으로 보이는 일이 있었다.
 */
const require = createRequire(import.meta.url);
const cli = require.resolve('@playwright/test/cli');

// 낡은 결과로 리포트가 만들어지는 일을 구조적으로 막는다.
if (existsSync(결과파일)) rmSync(결과파일);

const 테스트 = spawnSync(process.execPath, [cli, 'test', ...process.argv.slice(2)], {
  cwd: 여기,
  stdio: 'inherit',
});

if (테스트.error) {
  console.error(`테스트를 실행하지 못했다: ${테스트.error.message}`);
  process.exit(1);
}

if (!existsSync(결과파일)) {
  console.error(`결과 파일이 없다(${결과파일}). 리포트를 만들지 않는다.`);
  process.exit(테스트.status || 1);
}

const 리포트 = spawnSync(process.execPath, [join(여기, 'report.mjs')], {
  cwd: 여기,
  stdio: 'inherit',
});

// 테스트 실패를 그대로 종료코드로 돌려준다 — CI에서 초록으로 보이면 안 된다.
process.exit(테스트.status || 리포트.status || 0);
