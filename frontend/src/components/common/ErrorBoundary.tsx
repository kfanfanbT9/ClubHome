import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** 화면 전체가 아니라 본문만 감쌀 때 안내 문구를 바꾼다. */
  제목?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * 렌더링 중 터진 예외를 받아 대체 화면을 보여준다 (React 오류 경계).
 *
 * 없으면 React 19는 예외가 난 트리를 통째로 언마운트한다 — 사용자에게는 **흰 화면**만
 * 남고, 무엇이 잘못됐는지도 어떻게 빠져나가는지도 알 수 없다. 배포 후 실제로 가장
 * 곤란한 상태라 이 경계를 둔다.
 *
 * **클래스 컴포넌트인 이유**: 오류 경계는 훅으로 만들 수 없다. `componentDidCatch`와
 * `getDerivedStateFromError`에 대응하는 훅이 React에 없어, 이 파일만 클래스로 둔다.
 *
 * **잡지 못하는 것**: 이벤트 핸들러·비동기 콜백에서 난 예외는 렌더링 중이 아니므로
 * 여기로 오지 않는다. API 오류도 마찬가지다 — 그쪽은 TanStack Query의 `isError`와
 * 각 화면의 `role="alert"` 안내가 이미 처리한다. 이 경계가 맡는 것은 그 밖의
 * "예상하지 못한 렌더링 실패"다.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    /**
     * 콘솔에 남긴다. 별도 오류 수집 서비스는 도입하지 않는다(원칙 §5: 로그는 콘솔만,
     * 신규 인프라 없음). 배포 환경에서는 플랫폼의 함수 로그로 모인다.
     */
    console.error('[ErrorBoundary] 렌더링 실패', error, info.componentStack);
  }

  private 다시시도 = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <main className="page">
        <h1 className="page__title">{this.props.제목 ?? '화면을 표시할 수 없습니다'}</h1>

        <p className="notice notice--error" role="alert">
          예기치 못한 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.
        </p>

        <p className="page__note">
          문제가 계속되면 이 내용을 알려주시면 도움이 됩니다: <code>{error.message}</code>
        </p>

        <div className="form__actions">
          <button type="button" className="button button--primary" onClick={this.다시시도}>
            다시 시도
          </button>
          {/*
            router의 Link를 쓰지 않는다 — 라우터 자체가 깨져서 여기에 온 경우
            Link는 동작하지 않는다. 주소를 새로 여는 편이 확실하다.
          */}
          <a className="button button--quiet" href="/">
            홈으로
          </a>
        </div>
      </main>
    );
  }
}
