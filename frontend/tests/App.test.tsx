import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../src/App';
import { useAuthStore } from '../src/features/auth/authStore';
import { renderWithProviders } from './renderWithProviders';

beforeEach(() => {
  useAuthStore.setState({ accessToken: null, refreshToken: null, memberId: null, isAdmin: false });
  localStorage.clear();
});

describe('App 라우팅', () => {
  it('루트 경로에서 홈 화면이 렌더링된다', () => {
    renderWithProviders(<App />, '/');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      '색소폰 동호회 “색연필”에 오신 것을 환영합니다',
    );
  });

  it('홈에 게시판·연습실 예약 바로가기가 있다', () => {
    renderWithProviders(<App />, '/');

    // 상단 메뉴에도 같은 이름이 있으므로 타일 제목(h2)으로 찾는다.
    expect(screen.getByRole('heading', { level: 2, name: '게시판' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '연습실 예약' })).toBeInTheDocument();
  });

  it('상단 공통 네비게이션이 모든 화면에 함께 렌더링된다', () => {
    renderWithProviders(<App />, '/');

    expect(screen.getByRole('link', { name: '색연필' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('button', { name: '메뉴' })).toBeInTheDocument();
  });

  it('등록되지 않은 경로는 준비 중 안내를 보여준다', () => {
    // /boards 같은 보호 경로는 FE-03부터 RequireAuth가 먼저 가로채므로
    // 캐치올(`*`)을 확인하려면 라우트가 아예 없는 경로를 써야 한다.
    renderWithProviders(<App />, '/nowhere');

    // 헤더 아래가 빈 화면이 되면 메뉴가 고장 난 것처럼 보인다.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('준비 중인 화면입니다');
    // 준비 중 화면에서도 네비게이션은 남아 있어야 다른 메뉴로 넘어갈 수 있다.
    expect(screen.getByRole('link', { name: '색연필' })).toBeInTheDocument();
  });
});
