import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import App from '../src/App';
import { createQueryClient } from '../src/lib/queryClient';

function 앱렌더(경로 = '/') {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[경로]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('App', () => {
  it('루트 경로에서 홈 화면이 렌더링된다', () => {
    앱렌더('/');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('색연필 색소폰 동호회');
  });
});
