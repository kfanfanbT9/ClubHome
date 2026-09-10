import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../src/features/auth/authStore';
import BoardListPage from '../src/pages/BoardListPage';
import { type FetchMock, fetch가로채기, 응답 } from './fetchMock';
import { renderWithProviders } from './renderWithProviders';

const 회원 = {
  id: 7,
  email: 'junior@example.com',
  name: '박신입',
  phone: null,
  memberGradeId: 1,
  memberGrade: { id: 1, name: '준회원', description: null, gradeLevel: 10, isAdmin: false },
  accountStatus: 'active',
  joinedAt: '2026-01-10T00:00:00.000Z',
};

const 게시판목록 = [
  { id: 1, name: '자유게시판', description: '전체 회원', minGradeLevel: 10, isActive: true, canAccess: true },
  { id: 2, name: '정회원 게시판', description: '정회원 이상', minGradeLevel: 20, isActive: true, canAccess: false },
  { id: 3, name: '운영진 전용', description: '운영진만', minGradeLevel: 30, isActive: true, canAccess: false },
];

let fetchMock: FetchMock;

/** 게시판 목록과 본인 정보를 경로에 따라 나눠 응답한다. */
function 목설정(boards: unknown = 게시판목록) {
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve(url.includes('/api/members/me') ? 응답(200, 회원) : 응답(200, boards)),
  );
}

beforeEach(() => {
  useAuthStore.setState({
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    memberId: 7,
    isAdmin: false,
  });
  localStorage.clear();
  fetchMock = fetch가로채기();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('게시판 목록', () => {
  it('게시판 이름과 설명이 표시된다', async () => {
    목설정();
    renderWithProviders(<BoardListPage />);

    expect(await screen.findByText('자유게시판')).toBeInTheDocument();
    expect(screen.getByText('정회원 게시판')).toBeInTheDocument();
    expect(screen.getByText('운영진 전용')).toBeInTheDocument();
  });

  it('접근 가능한 게시판과 불가한 게시판이 시각적으로 구분된다', async () => {
    목설정();
    renderWithProviders(<BoardListPage />);

    await screen.findByText('자유게시판');

    // 접근 가능
    expect(screen.getByRole('link', { name: /자유게시판/ })).not.toHaveClass('board-row--locked');
    expect(screen.getByText('이용 가능')).toBeInTheDocument();

    // 접근 불가 — 색만으로 구분하지 않고 "접근불가" 문구와 최소등급을 함께 둔다.
    expect(screen.getByRole('link', { name: /정회원 게시판/ })).toHaveClass('board-row--locked');
    expect(screen.getByText('접근불가 · 최소등급 20 필요')).toBeInTheDocument();
    expect(screen.getByText('접근불가 · 최소등급 30 필요')).toBeInTheDocument();
  });

  it('접근 불가 게시판도 링크로 남아 있어 클릭할 수 있다', async () => {
    목설정();
    renderWithProviders(<BoardListPage />);

    await screen.findByText('정회원 게시판');

    // 완료조건이 "클릭 시 권한 없음 안내"이므로 눌릴 수 있어야 한다.
    // 실제 거절 문구는 게시글 목록에서 서버 403이 내려준다.
    expect(screen.getByRole('link', { name: /정회원 게시판/ })).toHaveAttribute(
      'href',
      '/boards/2/posts',
    );
  });

  it('내 등급이 표시된다', async () => {
    목설정();
    renderWithProviders(<BoardListPage />);

    expect(await screen.findByText(/내 등급: 준회원/)).toBeInTheDocument();
  });

  it('게시판이 없으면 빈 상태 안내를 보여준다', async () => {
    목설정([]);
    renderWithProviders(<BoardListPage />);

    expect(await screen.findByText('이용할 수 있는 게시판이 없습니다.')).toBeInTheDocument();
  });

  it('조회 실패는 안내로 표시된다', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('/api/members/me')
          ? 응답(200, 회원)
          : 응답(403, { message: '권한이 없습니다.' }),
      ),
    );
    renderWithProviders(<BoardListPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('권한이 없습니다.');
  });
});
