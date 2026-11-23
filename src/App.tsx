import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AdminLayout from './layouts/AdminLayout';
import DemoPage from './pages/DemoPage';
import MemberListPage from './pages/MemberListPage';
import MemberFormPage from './pages/MemberFormPage';
import TagTreePage from './pages/TagTreePage';
import CommissionRulesPage from './pages/CommissionRulesPage';

/** 路由：模板示例页挂在 /admin 下；#2370 佣金规则表页按工单要求挂 /commission/rules。真实接入时把 MSW 换成真实 API（见 README 集成点）。 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AdminLayout />}>
          <Route path="/admin/demo" element={<DemoPage />} />
          <Route path="/admin/members" element={<MemberListPage />} />
          <Route path="/admin/members/new" element={<MemberFormPage />} />
          <Route path="/admin/tags" element={<TagTreePage />} />
          <Route path="/commission/rules" element={<CommissionRulesPage />} />
          <Route path="*" element={<Navigate to="/admin/demo" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
