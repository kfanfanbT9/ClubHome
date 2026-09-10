import { Route, Routes } from 'react-router-dom';
import Layout from './components/layout/Layout';
import RequireAuth from './components/layout/RequireAuth';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import NotReadyPage from './pages/NotReadyPage';
import SignupPage from './pages/SignupPage';

/**
 * 라우팅 정의 (원칙 §6).
 *
 * 홈·로그인·회원가입만 공개다. 나머지 API는 모두 서버가 토큰을 요구하므로
 * (swagger에서 `security: []`인 것은 signup·login·refresh뿐) 로그인 없이 열면
 * 401만 받는 빈 화면이 된다. 그래서 RequireAuth 아래로 넣는다.
 *
 * 화면을 만드는 이슈에서 NotReadyPage를 그 화면으로 바꾼다.
 */
export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />

        <Route element={<RequireAuth />}>
          <Route path="/boards" element={<NotReadyPage />} />
          <Route path="/practice-rooms" element={<NotReadyPage />} />
          <Route path="/me" element={<NotReadyPage />} />
          <Route path="/admin" element={<NotReadyPage />} />
        </Route>

        <Route path="*" element={<NotReadyPage />} />
      </Route>
    </Routes>
  );
}
