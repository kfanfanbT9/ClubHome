import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { endpoints } from '../../api/endpoints';
import type { Board, Post, PostListResponse } from '../../types';

/**
 * 게시판·게시글 조회와 변경. 컴포넌트는 이 훅을 통해서만 서버와 이야기한다(원칙 §2.1).
 */

/**
 * 쿼리 키. TanStack Query는 키의 **앞부분이 일치하면** 함께 무효화하므로,
 * 게시판 목록 키와 게시글 키가 서로의 접두사가 되지 않게 갈라 둔다.
 * (`['boards']`와 `['boards', 1, 'posts']`처럼 두면 게시판 목록만 갱신하려다
 * 모든 게시글 목록까지 다시 불러오게 된다.)
 */
export const boardKeys = {
  list: ['boards', 'list'] as const,
  /** 한 게시판의 모든 페이지 — 글이 늘거나 줄면 페이지 구성이 바뀌므로 통째로 무효화한다. */
  postsOf: (boardId: number) => ['posts', 'byBoard', boardId] as const,
  posts: (boardId: number, page: number) => ['posts', 'byBoard', boardId, { page }] as const,
  post: (postId: number) => ['posts', 'detail', postId] as const,
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

/**
 * 게시글 상세.
 *
 * 서버가 이 조회에서 조회수를 1 올린다(swagger). 그래서 **자동 재조회를 끈다** —
 * 창을 왔다 갔다 할 때마다 다시 부르면 읽지도 않은 조회수가 올라간다.
 * 덤으로 상세에서 수정 화면으로 넘어갈 때 캐시가 그대로 쓰여 조회수가 또 오르지 않는다.
 */
export function usePost(postId: number) {
  return useQuery({
    queryKey: boardKeys.post(postId),
    queryFn: () => api.get<Post>(endpoints.post(postId)),
    enabled: Number.isInteger(postId),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export interface PostInput {
  title: string;
  content: string;
}

export function useCreatePost(boardId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: PostInput) => api.post<Post>(endpoints.boardPosts(boardId), input),
    onSuccess: () => {
      // 목록 데이터를 따로 복사해 두고 손으로 맞추지 않는다(원칙 §2.1).
      queryClient.invalidateQueries({ queryKey: boardKeys.postsOf(boardId) });
    },
  });
}

export function useUpdatePost(postId: number, boardId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: PostInput) => api.patch<Post>(endpoints.post(postId), input),
    onSuccess: (수정된글) => {
      /**
       * 상세는 **무효화하지 않고 응답으로 갈아끼운다.**
       * 무효화하면 다시 조회하게 되고, 상세 조회는 서버에서 조회수를 1 올린다 —
       * 글을 고쳤을 뿐인데 조회수가 오르는 것은 틀린 값이다(실제로 1에서 2가 되는 것을 확인했다).
       * PATCH 응답이 이미 서버가 확정한 게시글이므로 다시 물어볼 것도 없다.
       */
      queryClient.setQueryData(boardKeys.post(postId), 수정된글);
      // 목록은 제목이 바뀌므로 무효화한다. 목록 조회는 조회수를 올리지 않는다.
      queryClient.invalidateQueries({ queryKey: boardKeys.postsOf(boardId) });
    },
  });
}

export function useDeletePost(postId: number, boardId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    // 삭제는 204(본문 없음)로 응답한다.
    mutationFn: () => api.delete<void>(endpoints.post(postId)),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: boardKeys.post(postId) });
      queryClient.invalidateQueries({ queryKey: boardKeys.postsOf(boardId) });
    },
  });
}
