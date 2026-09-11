/**
 * Playwright 결과(results.json)와 화면찍기 목록(<project>/shots.jsonl)을 합쳐
 * 스크린샷이 들어간 마크다운 리포트를 **프로젝트별로** 만든다.
 *
 *   e2e/desktop/REPORT.md   ← desktop 프로젝트 결과
 *   e2e/mobile/REPORT.md    ← mobile 프로젝트 결과
 *
 * 실행: node report.mjs   (npm test 가 끝난 뒤 자동으로 실행된다)
 *
 * 별도 리포터를 만들지 않고 결과 파일을 읽어 조립하는 이유는, Playwright의 JSON
 * 리포터가 이미 필요한 것(제목·프로젝트·상태·소요시간·오류)을 전부 담고 있기 때문이다.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const 여기 = dirname(fileURLToPath(import.meta.url));
const e2e = join(여기, 'e2e');

const 결과 = JSON.parse(readFileSync(join(e2e, 'results.json'), 'utf8'));

/** results.json은 suite가 중첩된다 — 테스트만 평평하게 끌어낸다. */
function 테스트들(suite, 상위 = []) {
  const 경로 = suite.title ? [...상위, suite.title] : 상위;
  const 모음 = [];
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const 마지막 = test.results[test.results.length - 1];
      모음.push({
        프로젝트: test.projectName ?? 'desktop',
        // 파일 이름이 suite 경로 맨 앞에 오므로 그 다음이 describe 제목이다.
        그룹: 경로.filter((x) => !x.endsWith('.spec.ts')).pop() ?? '',
        제목: spec.title,
        상태: 마지막?.status ?? 'unknown',
        소요: 마지막?.duration ?? 0,
        오류: 마지막?.error?.message ?? '',
      });
    }
  }
  for (const 하위 of suite.suites ?? []) 모음.push(...테스트들(하위, 경로));
  return 모음;
}

const 전체 = (결과.suites ?? []).flatMap((s) => 테스트들(s));
const 표시 = { passed: '통과', failed: '실패', timedOut: '시간초과', skipped: '건너뜀' };
const 설명 = {
  desktop: { 제목: '데스크톱', 폭: '1280×900 (Desktop Chrome)' },
  mobile: { 제목: '모바일', 폭: '393×851 (Pixel 5, 터치)' },
};

const 시각 = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
let 만든개수 = 0;

for (const 프로젝트 of [...new Set(전체.map((t) => t.프로젝트))]) {
  const 목록 = 전체.filter((t) => t.프로젝트 === 프로젝트);
  const 기준 = join(e2e, 프로젝트);
  mkdirSync(기준, { recursive: true });

  /** 테스트 제목 → 스크린샷 목록 */
  const 그림 = new Map();
  const 목록파일 = join(기준, 'shots.jsonl');
  if (existsSync(목록파일)) {
    for (const 줄 of readFileSync(목록파일, 'utf8').split('\n')) {
      if (!줄.trim()) continue;
      const { 테스트, 파일, 설명: 캡션 } = JSON.parse(줄);
      if (!그림.has(테스트)) 그림.set(테스트, []);
      // 같은 테스트를 다시 돌리면 파일이 덮어써지므로 중복 항목은 접는다.
      const 모음 = 그림.get(테스트);
      if (!모음.some((x) => x.파일 === 파일)) 모음.push({ 파일, 캡션 });
    }
  }

  const 통계 = {
    전체: 목록.length,
    통과: 목록.filter((t) => t.상태 === 'passed').length,
    실패: 목록.filter((t) => t.상태 === 'failed' || t.상태 === 'timedOut').length,
    건너뜀: 목록.filter((t) => t.상태 === 'skipped').length,
  };

  const 줄들 = [];
  const 이름 = 설명[프로젝트]?.제목 ?? 프로젝트;

  줄들.push(`# 색연필 색소폰 동호회 홈페이지 — E2E 통합테스트 리포트 (${이름})`);
  줄들.push('');
  줄들.push(`- 실행 시각: ${시각}`);
  줄들.push(`- 뷰포트: ${설명[프로젝트]?.폭 ?? 프로젝트}`);
  줄들.push('- 대상: 프론트엔드 http://localhost:5174 / 백엔드 http://localhost:3001 (개발서버, 개발 DB `clubhome`)');
  줄들.push(`- 도구: Playwright ${결과.config?.version ?? ''} (Chromium)`);
  줄들.push('- 근거 시나리오: `docs/3-user-scenario.md` S-01~S-08, 반응형 규칙은 `docs/4-wireframes.md` §1');
  줄들.push('');
  줄들.push(`**${통계.전체}건 중 통과 ${통계.통과} · 실패 ${통계.실패} · 건너뜀 ${통계.건너뜀}**`);
  줄들.push('');
  줄들.push('## 요약');
  줄들.push('');
  줄들.push('| 시나리오 | 테스트 | 결과 | 소요 |');
  줄들.push('|---|---|---|---|');
  for (const t of 목록) {
    줄들.push(`| ${t.그룹} | ${t.제목} | ${표시[t.상태] ?? t.상태} | ${(t.소요 / 1000).toFixed(1)}s |`);
  }
  줄들.push('');

  if (통계.실패 > 0) {
    줄들.push('## 실패 상세');
    줄들.push('');
    for (const t of 목록.filter((x) => x.상태 !== 'passed' && x.상태 !== 'skipped')) {
      줄들.push(`### ${t.그룹} — ${t.제목}`);
      줄들.push('');
      줄들.push('```');
      줄들.push(t.오류.replace(/\[\d+m/g, '').trim());
      줄들.push('```');
      줄들.push('');
    }
  }

  줄들.push('## 화면 캡처');
  줄들.push('');
  줄들.push('시나리오 진행 순서대로 싣는다. `[엣지]`가 붙은 것은 거부·오류 경로다.');
  줄들.push('');
  let 그림수 = 0;
  for (const t of 목록) {
    const 모음 = 그림.get(t.제목);
    if (!모음 || 모음.length === 0) continue;
    줄들.push(`### ${t.그룹} — ${t.제목} (${표시[t.상태] ?? t.상태})`);
    줄들.push('');
    for (const { 파일, 캡션 } of 모음) {
      줄들.push(`**${캡션}**`);
      줄들.push('');
      줄들.push(`![${캡션}](./screenshots/${파일})`);
      줄들.push('');
      그림수 += 1;
    }
  }

  writeFileSync(join(기준, 'REPORT.md'), 줄들.join('\n'), 'utf8');
  console.log(
    `리포트 생성: e2e/${프로젝트}/REPORT.md (테스트 ${통계.전체}건, 통과 ${통계.통과}, 스크린샷 ${그림수}장)`,
  );
  만든개수 += 1;
}

if (만든개수 === 0) console.log('결과에 테스트가 없어 리포트를 만들지 않았다.');
