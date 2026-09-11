import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import ErrorBoundary from './components/common/ErrorBoundary';
import { createQueryClient } from './lib/queryClient';
// 토큰을 먼저 정의한 뒤 그 값을 쓰는 컴포넌트 스타일을 올린다.
import './styles/tokens.css';
import './styles/app.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root 엘리먼트를 찾을 수 없습니다. index.html을 확인하세요.');

createRoot(root).render(
  <StrictMode>
    {/*
      마지막 방어선. Layout 안쪽 경계가 본문을 맡고, 이 바깥 경계는 그 위에서 터지는
      것(Header, 라우터, Provider 초기화)을 받는다. 이게 없으면 그런 예외는 곧바로
      흰 화면이 된다.
    */}
    <ErrorBoundary 제목="앱을 시작할 수 없습니다">
      <QueryClientProvider client={createQueryClient()}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
