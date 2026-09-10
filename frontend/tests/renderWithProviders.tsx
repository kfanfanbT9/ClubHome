import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { createQueryClient } from '../src/lib/queryClient';

/**
 * Provider와 라우터로 감싸 렌더한다. 두 곳 이상에서 같은 껍데기가 필요해 분리했다.
 * MemoryRouter를 쓰는 이유는 jsdom에 실제 히스토리가 없어도 경로를 지정할 수 있기 때문이다.
 */
export function renderWithProviders(ui: ReactNode, 경로 = '/') {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[경로]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}
