import { Suspense, useState } from 'react';
import { Drawer } from 'antd';
import { Outlet } from 'react-router-dom';
import BackgroundFx from '@components/organisms/BackgroundFx';
import Sidebar from '@components/organisms/Sidebar';
import TopBar from '@components/organisms/TopBar';
import Loading from '@components/molecules/Loading';
import { useResponsive } from '@hooks/useResponsive';
import styles from './AdminLayout.module.css';

export default function AdminLayout() {
  const { isMobile } = useResponsive();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className={styles.layout}>
      <BackgroundFx intensity="subtle" />

      {/* 桌面端侧边栏 */}
      {!isMobile && <Sidebar />}

      {/* 移动端抽屉 */}
      {isMobile && (
        <Drawer
          placement="left"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          width={260}
          styles={{
            body: { padding: 0 },
            content: { background: 'var(--bg-panel)' },
          }}
          closable={false}
        >
          <Sidebar onNavigate={() => setDrawerOpen(false)} />
        </Drawer>
      )}

      <div className={styles.body}>
        <TopBar
          onMenuClick={() => setDrawerOpen(true)}
          showMenuBtn={isMobile}
        />
        <main className={styles.content}>
          <div className={styles.scrollArea}>
            <Suspense fallback={<Loading overlay />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}
