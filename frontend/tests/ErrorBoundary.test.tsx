import { render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ErrorBoundary from '../src/components/common/ErrorBoundary';

/**
 * 오류 경계는 "예외가 실제로 났을 때"만 의미가 있으므로, 일부러 터뜨려 확인한다.
 *
 * React는 경계가 잡은 예외도 콘솔에 한 번 더 찍는다. 그대로 두면 테스트 출력이
 * 빨간 스택으로 덮여 진짜 실패를 놓치므로 이 파일에서만 콘솔을 가린다.
 */
function 터지는컴포넌트({ 터질까 = true }: { 터질까?: boolean }) {
  if (터질까) throw new Error('의도적으로 터뜨린 오류');
  return <p>정상 화면</p>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('예외가 없으면 자식을 그대로 보여준다', () => {
    render(
      <ErrorBoundary>
        <터지는컴포넌트 터질까={false} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('정상 화면')).toBeInTheDocument();
  });

  it('렌더링 중 예외가 나면 흰 화면 대신 안내를 보여준다', () => {
    render(
      <ErrorBoundary>
        <터지는컴포넌트 />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      '화면을 표시할 수 없습니다',
    );
    // 보조기기가 즉시 읽도록 alert로 알린다.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // 빠져나갈 길을 준다 — 이게 없으면 새로고침 말고는 방법이 없다.
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '홈으로' })).toHaveAttribute('href', '/');
  });

  it('원인 메시지를 함께 보여준다', () => {
    render(
      <ErrorBoundary>
        <터지는컴포넌트 />
      </ErrorBoundary>,
    );

    // 사용자가 그대로 전달할 수 있어야 원인 파악이 빨라진다.
    expect(screen.getByText('의도적으로 터뜨린 오류')).toBeInTheDocument();
  });

  it('제목을 바꿔 쓸 수 있다', () => {
    render(
      <ErrorBoundary 제목="앱을 시작할 수 없습니다">
        <터지는컴포넌트 />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      '앱을 시작할 수 없습니다',
    );
  });

  it('"다시 시도"를 누르면 자식을 다시 그린다', () => {
    /**
     * 같은 자식이 또 터지면 다시 오류 화면으로 돌아온다(정상이다).
     * 여기서는 일시적인 실패였던 경우를 흉내 내, 오류 화면을 확인한 **뒤에** 성공하게 바꾼다.
     *
     * 컴포넌트가 스스로 "처음 한 번만 터지도록" 만들면 안 된다 — React가 실패한 트리를
     * 한 번 다시 렌더하면서 그 사이에 복구돼, 오류 화면이 아예 뜨지 않는다.
     */
    let 터질까 = true;
    function 조건부터짐() {
      if (터질까) throw new Error('일시적 실패');
      return <p>복구된 화면</p>;
    }

    render(
      <ErrorBoundary>
        <조건부터짐 />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();

    터질까 = false;
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));

    expect(screen.getByText('복구된 화면')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('콘솔에 원인을 남긴다', () => {
    render(
      <ErrorBoundary>
        <터지는컴포넌트 />
      </ErrorBoundary>,
    );

    // 별도 수집 서비스를 두지 않으므로 콘솔이 유일한 단서다(원칙 §5).
    const 남긴것 = (console.error as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(남긴것.some((인자: unknown[]) => String(인자[0]).includes('[ErrorBoundary]'))).toBe(
      true,
    );
  });
});
