import { cleanup } from '@testing-library/react';
// jest-dom 매처(toBeInTheDocument 등)를 vitest의 expect에 붙인다.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

/**
 * 렌더한 DOM을 테스트마다 치운다.
 *
 * RTL은 `globals: true`일 때만 afterEach(cleanup)을 스스로 등록한다. 이 프로젝트는
 * describe·it·expect를 명시적으로 import하는 쪽을 택했으므로(globals 미사용)
 * 여기서 직접 걸어준다. 없으면 렌더 결과가 테스트 간에 쌓여 같은 요소가
 * 여러 개로 잡힌다.
 */
afterEach(cleanup);
