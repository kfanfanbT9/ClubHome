import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { useAuthStore } from '../src/features/auth/authStore';
import PostListPage from '../src/pages/PostListPage';
import { type FetchMock, fetch가로채기, 응답 } from './fetchMock';
import { renderWithProviders } from './renderWithProviders';

const 게시판목록 = [
  { id: 1, name: '자유게시판', description: null, minGradeLevel: 10, isActive: true, canAccess: true },
  { id: 2, name: '정회원 게시판', description: null, minGradeLevel: 20, isActive: true, canAccess: false },
];

function 게시글(id: number, title: string) {
  return {
    id,
    boardId: 1,
    memberId: 3,
    authorName: '김색소',
    title,
    content: '내용',
    viewCount: id * 2,
    createdAt: '2026-09-08T01:00:00.000Z',
  };
}

let fetchMock: FetchMock;

/** `/boards/:boardId/posts` 경로에 실제로 올려 useParams가 동작하게 한다. */
function 렌더(경로 = '/boards/1/posts') {
  return renderWithProviders(
    <Routes>
      <Route path="/boards/:boardId/posts" element={<PostListPage />} />
    </Routes>,
    경로,
  );
}

function 목설정(게시글응답: { status: number; body?: unknown }) {
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve(
      url.includes('/posts')
        ? 응답(게시글응답.status, 게시글응답.body)
        : 응답(200, 게시판목록),
    ),
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

describe('게시글 목록 표시', () => {
  it('제목·작성자·작성일·조회수가 표시된다', async () => {
    목설정({
      status: 200,
      body: { items: [게시글(12, '이번주 정기연습 안내')], page: 1, pageSize: 20, totalCount: 1 },
    });
    렌더();

    expect(await screen.findByRole('link', { name: '이번주 정기연습 안내' })).toHaveAttribute(
      'href',
      '/posts/12',
    );
    expect(screen.getByText('김색소')).toBeInTheDocument();
    expect(screen.getByText('09-08')).toBeInTheDocument();
    expect(screen.getByText('24')).toBeInTheDocument();
    // 모바일 카드에서 "조회 24"로 읽혀야 한다 — 라벨과 숫자가 붙으면 "조회24"가 된다.
    expect(document.querySelector('.post-row__views')?.textContent).toBe('조회 24');
  });

  it('번호는 게시글 id가 아니라 게시판 안에서의 순번이다', async () => {
    목설정({
      status: 200,
      body: {
        items: [게시글(1066, '최신 글'), 게시글(1065, '그 전 글'), 게시글(1064, '그 전전 글')],
        page: 1,
        pageSize: 20,
        totalCount: 3,
      },
    });
    렌더();

    await screen.findByRole('link', { name: '최신 글' });
    // id는 전체 게시판에서 하나씩 올라가는 값이라, 글이 3개인 게시판에도 1066이 찍힌다.
    const 번호들 = [...document.querySelectorAll('.post-row__no')].map((e) => e.textContent);
    expect(번호들).toEqual(['3', '2', '1']);
  });

  it('둘째 페이지의 번호는 앞 페이지 건수를 뺀 값에서 이어진다', async () => {
    목설정({
      status: 200,
      body: {
        items: [게시글(5, '스물한번째'), 게시글(4, '스물두번째')],
        page: 2,
        pageSize: 20,
        totalCount: 22,
      },
    });
    렌더('/boards/1/posts?page=2');

    await screen.findByRole('link', { name: '스물한번째' });
    const 번호들 = [...document.querySelectorAll('.post-row__no')].map((e) => e.textContent);
    expect(번호들).toEqual(['2', '1']);
  });

  it('게시판 이름이 제목에 나온다', async () => {
    목설정({ status: 200, body: { items: [게시글(1, '글')], page: 1, pageSize: 20, totalCount: 1 } });
    렌더();

    // 제목 엘리먼트는 처음부터 있으므로(게시판 이름만 나중에 채워진다)
    // 이름이 도착하기를 먼저 기다린다.
    await screen.findByText(/자유게시판/);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('자유게시판');
  });

  it('게시글이 없으면 빈 상태 안내를 보여준다', async () => {
    목설정({ status: 200, body: { items: [], page: 1, pageSize: 20, totalCount: 0 } });
    렌더();

    expect(await screen.findByText('아직 등록된 게시글이 없습니다.')).toBeInTheDocument();
  });
});

describe('접근 권한', () => {
  it('등급 미달이면 서버 403 문구를 그대로 보여준다', async () => {
    목설정({ status: 403, body: { code: 'FORBIDDEN', message: '이 게시판을 이용할 등급이 아닙니다.' } });
    렌더('/boards/2/posts');

    // 완료조건: 접근 불가 게시판 클릭 시 권한 없음 안내가 표시된다.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '이 게시판을 이용할 등급이 아닙니다.',
    );
  });

  it('작성 권한이 없는 회원에게는 글쓰기 버튼이 노출되지 않는다', async () => {
    목설정({ status: 403, body: { message: '이 게시판을 이용할 등급이 아닙니다.' } });
    렌더('/boards/2/posts');

    await screen.findByRole('alert');
    expect(screen.queryByRole('link', { name: '글쓰기' })).not.toBeInTheDocument();
  });

  it('등급을 충족하면 글쓰기 버튼이 노출된다', async () => {
    목설정({ status: 200, body: { items: [], page: 1, pageSize: 20, totalCount: 0 } });
    렌더('/boards/1/posts');

    expect(await screen.findByRole('link', { name: '글쓰기' })).toHaveAttribute(
      'href',
      '/boards/1/posts/new',
    );
  });
});

describe('페이지네이션', () => {
  const 스무건 = Array.from({ length: 20 }, (_, i) => 게시글(i + 1, `글 ${i + 1}`));

  it('첫 페이지에서는 "이전"이 비활성이다', async () => {
    목설정({ status: 200, body: { items: 스무건, page: 1, pageSize: 20, totalCount: 45 } });
    렌더();

    await screen.findByRole('link', { name: '글 1' });
    expect(screen.getByRole('button', { name: '이전' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '다음' })).toBeEnabled();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  it('"다음"을 누르면 주소의 page가 올라가고 그 페이지를 요청한다', async () => {
    목설정({ status: 200, body: { items: 스무건, page: 1, pageSize: 20, totalCount: 45 } });
    렌더();

    await screen.findByRole('link', { name: '글 1' });
    fireEvent.click(screen.getByRole('button', { name: '다음' }));

    // 페이지를 주소에 두면 새로고침·뒤로가기·링크 공유가 그대로 동작한다.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => (url as string).includes('page=2')),
      ).toBe(true),
    );
  });

  it('마지막 페이지에서는 "다음"이 비활성이다', async () => {
    목설정({ status: 200, body: { items: [게시글(1, '글')], page: 3, pageSize: 20, totalCount: 45 } });
    렌더('/boards/1/posts?page=3');

    await screen.findByRole('link', { name: '글' });
    expect(screen.getByRole('button', { name: '다음' })).toBeDisabled();
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
  });

  it('주소의 page가 이상한 값이면 1페이지로 본다', async () => {
    목설정({ status: 200, body: { items: 스무건, page: 1, pageSize: 20, totalCount: 45 } });
    렌더('/boards/1/posts?page=아무거나');

    await screen.findByRole('link', { name: '글 1' });
    // 서버에 page=NaN 을 보내 400을 받는 대신 1페이지로 떨어진다.
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([url]) => (url as string).includes('page=1')),
    ).toBe(true);
  });
});

describe('범위를 벗어난 페이지', () => {
  it('글이 있는 게시판을 비었다고 안내하지 않는다', async () => {
    // ?page=99 를 직접 열거나, 북마크한 3페이지에서 글이 지워진 경우다.
    목설정({ status: 200, body: { items: [], page: 99, pageSize: 20, totalCount: 45 } });
    렌더('/boards/1/posts?page=99');

    // 돌아갈 길을 준다.
    expect(await screen.findByRole('link', { name: '첫 페이지로' })).toHaveAttribute(
      'href',
      '/boards/1/posts',
    );
    expect(screen.queryByText('아직 등록된 게시글이 없습니다.')).not.toBeInTheDocument();
    expect(document.querySelector('.empty')?.textContent).toContain('99페이지에는 게시글이 없습니다.');
  });

  it('정말로 글이 없는 게시판에는 빈 상태 안내가 그대로 나온다', async () => {
    목설정({ status: 200, body: { items: [], page: 1, pageSize: 20, totalCount: 0 } });
    렌더();

    expect(await screen.findByText('아직 등록된 게시글이 없습니다.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '첫 페이지로' })).not.toBeInTheDocument();
  });
});
