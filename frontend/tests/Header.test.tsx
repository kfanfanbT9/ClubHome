import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Header from '../src/components/layout/Header';
import { useAuthStore } from '../src/features/auth/authStore';
import { type FetchMock, fetch가로채기, 항상응답 } from './fetchMock';
import { renderWithProviders } from './renderWithProviders';

let fetchMock: FetchMock;

function 로그인(isAdmin: boolean) {
  useAuthStore.getState().setAuth({
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    memberId: 7,
    isAdmin,
  });
}

/** 닫힌 상태에서는 가로 메뉴 한 벌만, 펼친 상태에서는 두 벌이 DOM에 있다. */
function 링크개수(이름: string) {
  return screen.queryAllByRole('link', { name: 이름 }).length;
}

beforeEach(() => {
  useAuthStore.setState({ accessToken: null, refreshToken: null, memberId: null, isAdmin: false });
  localStorage.clear();
  fetchMock = fetch가로채기();
  // 로그아웃은 확인 응답용 204를 부른다.
  fetchMock.mockImplementation(항상응답(204));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Header 메뉴 구성', () => {
  it('기본 메뉴 3개가 노출된다', () => {
    renderWithProviders(<Header />);

    expect(링크개수('게시판')).toBe(1);
    expect(링크개수('연습실예약')).toBe(1);
    expect(링크개수('마이페이지')).toBe(1);
  });

  it('비로그인 상태에서는 "로그인"이 표시된다', () => {
    renderWithProviders(<Header />);

    expect(screen.getByRole('link', { name: '로그인' })).toHaveAttribute('href', '/login');
    expect(screen.queryByRole('button', { name: '로그아웃' })).not.toBeInTheDocument();
  });

  it('로그인 상태에서는 "로그아웃"이 표시된다', () => {
    로그인(false);
    renderWithProviders(<Header />);

    expect(screen.getByRole('button', { name: '로그아웃' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '로그인' })).not.toBeInTheDocument();
  });

  it('관리자가 아니면 [관리자] 메뉴가 노출되지 않는다', () => {
    로그인(false);
    renderWithProviders(<Header />);

    expect(링크개수('관리자')).toBe(0);
  });

  it('관리자 등급 계정에만 [관리자] 메뉴가 노출된다', () => {
    로그인(true);
    renderWithProviders(<Header />);

    expect(screen.getByRole('link', { name: '관리자' })).toHaveAttribute('href', '/admin');
  });
});

describe('Header 햄버거 메뉴', () => {
  it('펼치면 메뉴 항목이 시트에 나타나고 다시 누르면 접힌다', () => {
    renderWithProviders(<Header />);

    const 햄버거 = screen.getByRole('button', { name: '메뉴' });
    expect(햄버거).toHaveAttribute('aria-expanded', 'false');
    // 접힌 상태에서는 가로 메뉴 한 벌만 있다
    expect(링크개수('게시판')).toBe(1);

    fireEvent.click(햄버거);

    const 펼친햄버거 = screen.getByRole('button', { name: '메뉴 닫기' });
    expect(펼친햄버거).toHaveAttribute('aria-expanded', 'true');
    // 시트가 열려 같은 항목이 한 벌 더 생긴다
    expect(링크개수('게시판')).toBe(2);

    fireEvent.click(펼친햄버거);

    expect(screen.getByRole('button', { name: '메뉴' })).toHaveAttribute('aria-expanded', 'false');
    expect(링크개수('게시판')).toBe(1);
  });

  it('아이콘만 있는 버튼이라도 접근 가능한 이름을 갖는다', () => {
    renderWithProviders(<Header />);

    // 이름 없는 버튼은 스크린리더에서 "버튼"으로만 읽힌다.
    const 햄버거 = screen.getByRole('button', { name: '메뉴' });
    expect(햄버거).toHaveAttribute('aria-controls', 'navSheet');
  });

  it('시트에서 메뉴를 누르면 시트가 닫힌다', () => {
    renderWithProviders(<Header />);

    fireEvent.click(screen.getByRole('button', { name: '메뉴' }));
    expect(링크개수('게시판')).toBe(2);

    // 시트 쪽(두 번째) 링크를 누른다
    fireEvent.click(screen.getAllByRole('link', { name: '게시판' })[1]);

    // 이동 후에도 시트가 열려 있으면 새 화면을 가린다.
    expect(링크개수('게시판')).toBe(1);
  });
});

describe('Header 로그아웃', () => {
  it('로그아웃을 누르면 클라이언트 토큰이 폐기된다', async () => {
    로그인(false);
    renderWithProviders(<Header />);

    fireEvent.click(screen.getByRole('button', { name: '로그아웃' }));

    // 서버에 토큰 저장소가 없으므로 실제 폐기는 클라이언트 토큰 삭제다.
    await waitFor(() => expect(useAuthStore.getState().accessToken).toBeNull());
    expect(useAuthStore.getState().refreshToken).toBeNull();
    expect(useAuthStore.getState().isAdmin).toBe(false);
    // 로그아웃 직후에는 "로그인"으로 바뀐다
    expect(screen.getByRole('link', { name: '로그인' })).toBeInTheDocument();
  });

  it('로그아웃하면 [관리자] 메뉴도 사라진다', async () => {
    로그인(true);
    renderWithProviders(<Header />);

    expect(링크개수('관리자')).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: '로그아웃' }));

    await waitFor(() => expect(링크개수('관리자')).toBe(0));
  });
});
