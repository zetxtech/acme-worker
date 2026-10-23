import { lazy, Suspense, useEffect } from 'react';
import { App as AntdApp } from 'antd';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import AdminLayout from '@layouts/AdminLayout';
import ProtectedRoute from '@components/Layout/ProtectedRoute';
import { configureApiHandlers } from '@api/request';
import { useAuthStore } from '@stores/useAuthStore';
import { useBootstrapStore } from '@stores/useBootstrapStore';
import Loading from '@components/molecules/Loading';

// 路由懒加载
const PublicLayout = lazy(() => import('@layouts/PublicLayout'));
const Home = lazy(() => import('@pages/Home'));
const Login = lazy(() => import('@pages/Login'));
const Panel = lazy(() => import('@pages/Panel'));
const Certs = lazy(() => import('@pages/Certs'));
const Apply = lazy(() => import('@pages/Apply'));
const Order = lazy(() => import('@pages/Order'));
const Account = lazy(() => import('@pages/Account'));
const ApiDoc = lazy(() => import('@pages/Account/ApiDoc'));
const Help = lazy(() => import('@pages/Help'));
const About = lazy(() => import('@pages/About'));
const Setup = lazy(() => import('@pages/Setup'));
const AdminUsers = lazy(() => import('@pages/Admin/Users'));
const AdminCerts = lazy(() => import('@pages/Admin/Certs'));
const AdminSystem = lazy(() => import('@pages/Admin/System'));
const AdminAutomation = lazy(() => import('@pages/Admin/Automation'));
const Resources = lazy(() => import('@pages/Resources'));

function AppRoutes() {
  const location = useLocation();
  const checkAuth = useAuthStore((s) => s.checkAuth);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const ensureBootstrap = useBootstrapStore((s) => s.ensureLoaded);
  const bootstrap = useBootstrapStore((s) => s.info);
  const bootstrapLoading = useBootstrapStore((s) => s.loading);
  const { message } = AntdApp.useApp();

  useEffect(() => {
    // 配置 API 全局错误处理
    configureApiHandlers({
      onError: (msg) => message.error(msg),
      onUnauthorized: () => {
        clearAuth();
        const path = window.location.hash.slice(1).split('?')[0];
        if (!path.startsWith('/login') && path !== '/') {
          window.location.hash = '#/login';
        }
      },
    });
    // 启动时：先拉取系统状态，再检查登录
    ensureBootstrap();
    checkAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // initialized=false 时，除 /setup 与静态资源外一律重定向到 /setup
  const needsSetup = bootstrap && !bootstrap.initialized;
  const isSetupPath = location.pathname.startsWith('/setup');
  if (needsSetup && !isSetupPath) {
    return (
      <Suspense fallback={<Loading full overlay />}>
        <Routes>
          <Route path="/setup" element={<Setup />} />
          <Route path="*" element={<Navigate to="/setup" replace />} />
        </Routes>
      </Suspense>
    );
  }

  // 尚未获取到 bootstrap 时展示全局 loading，避免闪烁
  if (!bootstrap && bootstrapLoading) {
    return <Loading full overlay />;
  }

  return (
    <Suspense fallback={<Loading full overlay />}>
        <Routes>
          {/* Setup 页面：initialized 后自行跳登录 */}
          <Route path="/setup" element={<Setup />} />

          {/* 公共路由 */}
          <Route element={<PublicLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
          </Route>

          {/* 受保护路由 */}
          <Route
            element={
              <ProtectedRoute>
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/panel" element={<Panel />} />
            <Route path="/certs" element={<Certs />} />
            <Route path="/apply" element={<Apply />} />
            <Route path="/domains" element={<Resources key="domains" kind="dns" />} />
            <Route path="/deployments" element={<Resources key="deployments" kind="targets" />} />
            <Route path="/resources" element={<Navigate to="/domains" replace />} />
            <Route path="/order/:uuid" element={<Order />} />
            <Route path="/account" element={<Account />} />
            <Route path="/account/apidoc" element={<ApiDoc />} />
            <Route path="/help" element={<Help />} />
            <Route path="/about" element={<About />} />
            <Route path="/admin/users" element={<ProtectedRoute requireAdmin><AdminUsers /></ProtectedRoute>} />
            <Route path="/admin/certs" element={<ProtectedRoute requireAdmin><AdminCerts /></ProtectedRoute>} />
            <Route path="/admin/system" element={<ProtectedRoute requireAdmin><AdminSystem /></ProtectedRoute>} />
            <Route path="/admin/automation" element={<ProtectedRoute requireAdmin><AdminAutomation /></ProtectedRoute>} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    </Suspense>
  );
}

export default AppRoutes;
