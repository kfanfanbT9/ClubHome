import { Route, Routes } from 'react-router-dom';
import Layout from './components/layout/Layout';
import RequireAdmin from './components/layout/RequireAdmin';
import RequireAuth from './components/layout/RequireAuth';
import AdminHomePage from './pages/admin/AdminHomePage';
import BoardAdminPage from './pages/admin/BoardAdminPage';
import MemberGradeAdminPage from './pages/admin/MemberGradeAdminPage';
import PracticeRoomAdminPage from './pages/admin/PracticeRoomAdminPage';
import BoardListPage from './pages/BoardListPage';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import MyPage from './pages/MyPage';
import MyReservationsPage from './pages/MyReservationsPage';
import NotReadyPage from './pages/NotReadyPage';
import PostDetailPage from './pages/PostDetailPage';
import PostFormPage from './pages/PostFormPage';
import PostListPage from './pages/PostListPage';
import PracticeRoomPage from './pages/PracticeRoomPage';
import ReservationConfirmPage from './pages/ReservationConfirmPage';
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
          <Route path="/boards" element={<BoardListPage />} />
          <Route path="/boards/:boardId/posts" element={<PostListPage />} />
          <Route path="/boards/:boardId/posts/new" element={<PostFormPage />} />
          <Route path="/posts/:postId" element={<PostDetailPage />} />
          <Route path="/posts/:postId/edit" element={<PostFormPage />} />
          <Route path="/practice-rooms" element={<PracticeRoomPage />} />
          <Route path="/practice-rooms/:roomId/reserve" element={<ReservationConfirmPage />} />
          <Route path="/me/reservations" element={<MyReservationsPage />} />
          <Route path="/me" element={<MyPage />} />

          {/* 관리자 화면. 클라이언트 가드일 뿐이고 실제 인가는 서버가 403으로 한다. */}
          <Route element={<RequireAdmin />}>
            <Route path="/admin" element={<AdminHomePage />} />
            <Route path="/admin/members" element={<MemberGradeAdminPage />} />
            <Route path="/admin/boards" element={<BoardAdminPage />} />
            <Route path="/admin/practice-rooms" element={<PracticeRoomAdminPage />} />
          </Route>
        </Route>

        <Route path="*" element={<NotReadyPage />} />
      </Route>
    </Routes>
  );
}
