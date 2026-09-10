import { Route, Routes } from 'react-router-dom';
import HomePage from './pages/HomePage';

/**
 * 라우팅 정의 (원칙 §6).
 * 화면을 추가하는 이슈에서 그 화면의 경로를 여기 한 줄씩 넣는다 —
 * 아직 없는 화면의 경로를 미리 적어두지 않는다(§1 YAGNI).
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
    </Routes>
  );
}
