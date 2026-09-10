import { Route, Routes } from 'react-router-dom';
import Layout from './components/layout/Layout';
import HomePage from './pages/HomePage';
import NotReadyPage from './pages/NotReadyPage';

/**
 * 라우팅 정의 (원칙 §6).
 * 화면을 추가하는 이슈에서 그 화면의 경로를 Layout 아래에 한 줄씩 넣는다.
 * 아직 라우트가 없는 경로는 `*`가 받아 "준비 중" 안내를 보여준다.
 */
export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="*" element={<NotReadyPage />} />
      </Route>
    </Routes>
  );
}
