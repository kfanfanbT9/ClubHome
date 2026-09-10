import type { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../src/features/auth/authStore';
import { boardKeys } from '../src/features/board/useBoardQueries';
import PostDetailPage from '../src/pages/PostDetailPage';
import { type FetchMock, fetch가로채기, 응답 } from './fetchMock';
import { renderWithProviders } from './renderWithProviders';

const 게시판목록 = [
  { id: 1, name: '자유게시판', description: null, minGradeLevel: 10, isActive: true, canAccess: true },
];

const 내글 = {
  id: 12,
  boardId: 1,
  memberId: 7,
  authorName: '김색소',
  title: '이번주 정기연습 안내',
  content: '토요일 오후 2시\n2층 연습실입니다.',
  viewCount: 34,
  createdAt: '2026-09-08T01:00:00.000Z',
};

const 남의글 = { ...내글, memberId: 99, authorName: '이연습' };

let fetchMock: FetchMock;

function 렌더() {
  return renderWithProviders(
    <Routes>
      <Route path="/posts/:postId" element={<PostDetailPage />} />
      <Route path="/boards/:boardId/posts" element={<h1>게시글 목록</h1>} />
    </Routes>,
    '/posts/12',
  );
}

function 목설정(post: unknown, 삭제상태 = 204) {
  fetchMock.mockImplementation((url: string, init: RequestInit) => {
    if (init?.method === 'DELETE') return Promise.resolve(응답(삭제상태, 삭제상태 === 204 ? undefined : { message: '권한이 없습니다.' }));
    if (url.includes('/api/posts/')) return Promise.resolve(응답(200, post));
    return Promise.resolve(응답(200, 게시판목록));
  });
}

function 로그인(memberId: number, isAdmin = false) {
  useAuthStore.getState().setAuth({
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    memberId,
    isAdmin,
  });
}

beforeEach(() => {
  useAuthStore.setState({ accessToken: null, refreshToken: null, memberId: null, isAdmin: false });
  localStorage.clear();
  fetchMock = fetch가로채기();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('게시글 상세 표시', () => {
  it('본문·작성자·작성일·조회수가 표시된다', async () => {
    로그인(7);
    목설정(내글);
    렌더();

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      '이번주 정기연습 안내',
    );
    expect(screen.getByText('작성자: 김색소')).toBeInTheDocument();
    expect(screen.getByText('작성일: 2026-09-08')).toBeInTheDocument();
    expect(screen.getByText('조회수: 34')).toBeInTheDocument();
    expect(screen.getByText(/토요일 오후 2시/)).toBeInTheDocument();
  });

  it('조회수 증가 요청을 따로 보내지 않는다', async () => {
    로그인(7);
    목설정(내글);
    렌더();

    await screen.findByText('조회수: 34');
    // 서버가 상세 조회에서 올린다. 프론트가 증가용 요청을 만들면 두 번 올라간다.
    const 게시글요청 = fetchMock.mock.calls.filter(([url]) =>
      (url as string).includes('/api/posts/12'),
    );
    expect(게시글요청).toHaveLength(1);
    expect((게시글요청[0] as [string, RequestInit])[1].method).toBe('GET');
  });

  it('본문의 줄바꿈이 살아 있다', async () => {
    로그인(7);
    목설정(내글);
    렌더();

    await screen.findByText(/토요일 오후 2시/);
    // pre-wrap 이 아니면 두 줄이 한 줄로 붙는다.
    expect(document.querySelector('.post__content')?.textContent).toBe(
      '토요일 오후 2시\n2층 연습실입니다.',
    );
  });
});

describe('수정·삭제 버튼 노출', () => {
  it('본인 게시글에는 수정·삭제가 보인다', async () => {
    로그인(7);
    목설정(내글);
    렌더();

    expect(await screen.findByRole('link', { name: '수정' })).toHaveAttribute(
      'href',
      '/posts/12/edit',
    );
    expect(screen.getByRole('button', { name: '삭제' })).toBeInTheDocument();
  });

  it('타인 게시글에는 수정·삭제가 노출되지 않는다', async () => {
    로그인(7);
    목설정(남의글);
    렌더();

    // 완료조건(S-04): 타인 게시글에는 수정·삭제 버튼이 노출되지 않는다.
    await screen.findByText('작성자: 이연습');
    expect(screen.queryByRole('link', { name: '수정' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '삭제' })).not.toBeInTheDocument();
    // 목록으로 돌아갈 길은 남아 있어야 한다.
    expect(screen.getByRole('link', { name: '목록' })).toBeInTheDocument();
  });

  it('관리자는 타인 게시글도 고칠 수 있다', async () => {
    로그인(7, true);
    목설정(남의글);
    렌더();

    // 도메인 정의서 §6: 작성자 본인 또는 관리자.
    expect(await screen.findByRole('link', { name: '수정' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '삭제' })).toBeInTheDocument();
  });
});

describe('삭제', () => {
  it('한 번 더 묻고 나서 삭제한다', async () => {
    로그인(7);
    목설정(내글);
    렌더();

    fireEvent.click(await screen.findByRole('button', { name: '삭제' }));

    // 9-style.md §6: 삭제는 확인 절차를 먼저 거친다.
    expect(screen.getByText('정말 삭제할까요?')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === 'DELETE'),
    ).toBe(false);
  });

  it('확인하면 삭제하고 목록으로 이동한다', async () => {
    로그인(7);
    목설정(내글);
    렌더();

    fireEvent.click(await screen.findByRole('button', { name: '삭제' }));
    // 확인 상태의 "삭제"를 누른다
    fireEvent.click(screen.getByRole('button', { name: '삭제' }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('게시글 목록'),
    );
    const del = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'DELETE');
    expect((del as [string])[0]).toContain('/api/posts/12');
  });

  it('취소하면 삭제하지 않는다', async () => {
    로그인(7);
    목설정(내글);
    렌더();

    fireEvent.click(await screen.findByRole('button', { name: '삭제' }));
    fireEvent.click(screen.getByRole('button', { name: '취소' }));

    expect(screen.queryByText('정말 삭제할까요?')).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === 'DELETE'),
    ).toBe(false);
  });
});

describe('조회 실패', () => {
  it('403이면 서버 문구를 보여준다', async () => {
    로그인(7);
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('/api/posts/')
          ? 응답(403, { message: '이 게시판을 이용할 등급이 아닙니다.' })
          : 응답(200, 게시판목록),
      ),
    );
    렌더();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '이 게시판을 이용할 등급이 아닙니다.',
    );
  });
});

describe('삭제·수정 후 목록 갱신', () => {
  /** 목록 캐시를 미리 채워 두고, 변경 뒤에 그것이 무효화되는지 본다. */
  function 목록캐시심기(queryClient: QueryClient) {
    queryClient.setQueryData(boardKeys.posts(1, 1), {
      items: [내글],
      page: 1,
      pageSize: 20,
      totalCount: 1,
    });
  }

  it('삭제하면 그 게시판의 목록 캐시가 무효화된다', async () => {
    로그인(7);
    목설정(내글);
    const { queryClient } = 렌더();
    목록캐시심기(queryClient);

    fireEvent.click(await screen.findByRole('button', { name: '삭제' }));
    fireEvent.click(screen.getByRole('button', { name: '삭제' }));

    // 목록을 손으로 맞추지 않고 무효화로 갱신한다(원칙 §2.1).
    // 무효화하지 않으면 지운 글이 목록에 그대로 남는다.
    await waitFor(() =>
      expect(queryClient.getQueryState(boardKeys.posts(1, 1))?.isInvalidated).toBe(true),
    );
  });

  it('삭제하면 그 글의 상세 캐시는 아예 지운다', async () => {
    로그인(7);
    목설정(내글);
    const { queryClient } = 렌더();

    fireEvent.click(await screen.findByRole('button', { name: '삭제' }));
    fireEvent.click(screen.getByRole('button', { name: '삭제' }));

    // 이미 없는 글을 무효화해 두면 뒤로가기로 들어올 때 404를 다시 받는다.
    await waitFor(() =>
      expect(queryClient.getQueryData(boardKeys.post(12))).toBeUndefined(),
    );
  });
});
