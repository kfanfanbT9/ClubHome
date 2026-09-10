import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { endpoints } from '../../api/endpoints';
import type { Board, PostListResponse } from '../../types';

/**
 * 게시판·게시글 조회. 컴포넌트는 이 훅을 통해서만 서버 데이터를 가져온다(원칙 §2.1).
 */

export const boardKeys = {
  list: ['boards'] as const,
  posts: (boardId: number, page: number) => ['boards', boardId, 'posts', { page }] as const,
};

/** 서버가 활성 게시판만, 그리고 요청 회원의 `canAccess`를 함께 내려준다. */
export function useBoards() {
  return useQuery({
    queryKey: boardKeys.list,
    queryFn: () => api.get<Board[]>(endpoints.boards),
  });
}

/**
 * 게시판 하나를 목록 캐시에서 꺼낸다.
 *
 * `GET /api/boards/{boardId}`를 따로 부르지 않는 이유: 그 응답에는 `canAccess`가 없다
 * (swagger에 "목록 조회 시에만 포함"으로 명시). 글쓰기 버튼 노출 판정에 그 값이 필요하고,
 * 프론트에서 등급 서열을 다시 계산하지 않기로 했으므로 목록이 준 값을 쓴다.
 */
export function useBoard(boardId: number) {
  const query = useBoards();
  return {
    ...query,
    board: query.data?.find((board) => board.id === boardId),
  };
}

export function usePosts(boardId: number, page: number) {
  return useQuery({
    queryKey: boardKeys.posts(boardId, page),
    queryFn: () =>
      api.get<PostListResponse>(endpoints.boardPosts(boardId), { query: { page } }),
    // 게시판이 정해지지 않은 주소에서는 요청을 보내지 않는다.
    enabled: Number.isInteger(boardId),
  });
}
