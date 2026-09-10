import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../src/features/auth/authStore';
import { boardKeys } from '../src/features/board/useBoardQueries';
import PostFormPage from '../src/pages/PostFormPage';
import { type FetchMock, fetch가로채기, 응답 } from './fetchMock';
import { renderWithProviders } from './renderWithProviders';

const 게시판목록 = [
  { id: 1, name: '자유게시판', description: null, minGradeLevel: 10, isActive: true, canAccess: true },
];

const 기존글 = {
  id: 12,
  boardId: 1,
  memberId: 7,
  authorName: '김색소',
  title: '원래 제목',
  content: '원래 내용',
  viewCount: 34,
  createdAt: '2026-09-08T01:00:00.000Z',
};

let fetchMock: FetchMock;

function 렌더(경로: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/boards/:boardId/posts/new" element={<PostFormPage />} />
      <Route path="/posts/:postId/edit" element={<PostFormPage />} />
      <Route path="/posts/:postId" element={<h1>상세 화면</h1>} />
      <Route path="/boards/:boardId/posts" element={<h1>게시글 목록</h1>} />
    </Routes>,
    경로,
  );
}

function 입력하기(라벨: string, 값: string) {
  fireEvent.change(screen.getByLabelText(라벨), { target: { value: 값 } });
}

beforeEach(() => {
  useAuthStore.getState().setAuth({
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

describe('새 글 작성', () => {
  it('빈 값으로 등록하면 요청을 보내지 않는다', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(응답(200, 게시판목록)));
    렌더('/boards/1/posts/new');

    fireEvent.click(screen.getByRole('button', { name: '등록' }));

    expect(screen.getByText('제목을 입력하세요.')).toBeInTheDocument();
    expect(screen.getByText('내용을 입력하세요.')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === 'POST'),
    ).toBe(false);
  });

  it('제목·내용을 보내고 작성한 글로 이동한다', async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) =>
      Promise.resolve(
        init?.method === 'POST'
          ? 응답(201, { ...기존글, id: 99, title: '새 제목' })
          : 응답(200, 게시판목록),
      ),
    );
    렌더('/boards/1/posts/new');

    입력하기('제목', '새 제목');
    입력하기('내용', '새 내용');
    fireEvent.click(screen.getByRole('button', { name: '등록' }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('상세 화면'),
    );
    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST');
    expect((post as [string])[0]).toContain('/api/boards/1/posts');
    expect(JSON.parse((post as [string, RequestInit])[1].body as string)).toEqual({
      title: '새 제목',
      content: '새 내용',
    });
  });

  it('작성 후 그 게시판의 목록 캐시를 무효화한다', async () => {
    let 목록조회 = 0;
    fetchMock.mockImplementation((url: string, init: RequestInit) => {
      if (init?.method === 'POST') return Promise.resolve(응답(201, { ...기존글, id: 99 }));
      if ((url as string).includes('/api/boards/1/posts')) {
        목록조회 += 1;
        return Promise.resolve(응답(200, { items: [], page: 1, pageSize: 20, totalCount: 0 }));
      }
      return Promise.resolve(응답(200, 게시판목록));
    });
    // 목록을 먼저 캐시에 올려두기 위해 목록 라우트를 함께 렌더한다.
    renderWithProviders(
      <Routes>
        <Route path="/boards/:boardId/posts/new" element={<PostFormPage />} />
        <Route path="/posts/:postId" element={<h1>상세 화면</h1>} />
      </Routes>,
      '/boards/1/posts/new',
    );

    입력하기('제목', '새 제목');
    입력하기('내용', '새 내용');
    fireEvent.click(screen.getByRole('button', { name: '등록' }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('상세 화면'),
    );
    // 목록 데이터를 손으로 맞추지 않고 무효화로 갱신한다(원칙 §2.1).
    expect(목록조회).toBe(0);
  });

  it('서버 403은 안내로 표시된다', async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) =>
      Promise.resolve(
        init?.method === 'POST'
          ? 응답(403, { message: '이 게시판에 글을 쓸 등급이 아닙니다.' })
          : 응답(200, 게시판목록),
      ),
    );
    렌더('/boards/1/posts/new');

    입력하기('제목', '제목');
    입력하기('내용', '내용');
    fireEvent.click(screen.getByRole('button', { name: '등록' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '이 게시판에 글을 쓸 등급이 아닙니다.',
    );
  });

  it('다시 입력하면 서버 오류 안내가 사라진다', async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) =>
      Promise.resolve(
        init?.method === 'POST'
          ? 응답(403, { message: '이 게시판에 글을 쓸 등급이 아닙니다.' })
          : 응답(200, 게시판목록),
      ),
    );
    렌더('/boards/1/posts/new');

    입력하기('제목', '제목');
    입력하기('내용', '내용');
    fireEvent.click(screen.getByRole('button', { name: '등록' }));
    await screen.findByRole('alert');

    입력하기('제목', '제목 고침');

    // reset()은 React state가 아니라 Query 캐시를 건드리므로 리렌더가 한 틱 뒤에 온다.
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('취소를 누르면 목록으로 돌아간다', () => {
    fetchMock.mockImplementation(() => Promise.resolve(응답(200, 게시판목록)));
    렌더('/boards/1/posts/new');

    expect(screen.getByRole('link', { name: '취소' })).toHaveAttribute('href', '/boards/1/posts');
  });
});

describe('글 수정', () => {
  it('기존 제목·내용이 폼에 채워진다', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(url.includes('/api/posts/') ? 응답(200, 기존글) : 응답(200, 게시판목록)),
    );
    렌더('/posts/12/edit');

    expect(await screen.findByDisplayValue('원래 제목')).toBeInTheDocument();
    expect(screen.getByDisplayValue('원래 내용')).toBeInTheDocument();
  });

  it('PATCH로 보내고 상세로 돌아간다', async () => {
    fetchMock.mockImplementation((url: string, init: RequestInit) => {
      if (init?.method === 'PATCH') return Promise.resolve(응답(200, { ...기존글, title: '고친 제목' }));
      if (url.includes('/api/posts/')) return Promise.resolve(응답(200, 기존글));
      return Promise.resolve(응답(200, 게시판목록));
    });
    렌더('/posts/12/edit');

    await screen.findByDisplayValue('원래 제목');
    입력하기('제목', '고친 제목');
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('상세 화면'),
    );
    const patch = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit)?.method === 'PATCH',
    );
    expect((patch as [string])[0]).toContain('/api/posts/12');
    expect(JSON.parse((patch as [string, RequestInit])[1].body as string)).toEqual({
      title: '고친 제목',
      content: '원래 내용',
    });
  });

  it('취소를 누르면 상세로 돌아간다', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(url.includes('/api/posts/') ? 응답(200, 기존글) : 응답(200, 게시판목록)),
    );
    렌더('/posts/12/edit');

    await screen.findByDisplayValue('원래 제목');
    expect(screen.getByRole('link', { name: '취소' })).toHaveAttribute('href', '/posts/12');
  });

  it('제목이 200자를 넘으면 보내지 않는다', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(url.includes('/api/posts/') ? 응답(200, 기존글) : 응답(200, 게시판목록)),
    );
    렌더('/posts/12/edit');

    await screen.findByDisplayValue('원래 제목');
    // swagger PostCreateRequest.title.maxLength 와 같은 기준이다.
    입력하기('제목', '가'.repeat(201));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(screen.getByText('제목은 200자를 넘을 수 없습니다.')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === 'PATCH'),
    ).toBe(false);
  });
});

describe('수정이 조회수를 올리지 않는다', () => {
  it('상세 캐시를 응답으로 갈아끼우고 다시 조회하지 않는다', async () => {
    let 상세조회 = 0;
    fetchMock.mockImplementation((url: string, init: RequestInit) => {
      if (init?.method === 'PATCH') {
        return Promise.resolve(응답(200, { ...기존글, title: '고친 제목', viewCount: 34 }));
      }
      if (url.includes('/api/posts/')) {
        상세조회 += 1;
        return Promise.resolve(응답(200, 기존글));
      }
      return Promise.resolve(응답(200, 게시판목록));
    });
    const { queryClient } = 렌더('/posts/12/edit');

    await screen.findByDisplayValue('원래 제목');
    expect(상세조회).toBe(1);

    입력하기('제목', '고친 제목');
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('상세 화면'),
    );

    // 상세를 무효화하면 다시 조회하게 되고, 서버는 그 조회에서 조회수를 올린다.
    // 글을 고쳤을 뿐인데 조회수가 오르는 것은 틀린 값이다.
    expect(상세조회).toBe(1);
    // 대신 응답으로 캐시를 갈아끼워 최신 제목이 들어 있어야 한다.
    expect(queryClient.getQueryData(boardKeys.post(12))).toMatchObject({ title: '고친 제목' });
  });
});
