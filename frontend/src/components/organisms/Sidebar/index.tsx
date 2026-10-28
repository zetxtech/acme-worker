import { NavLink } from 'react-router-dom';
import {
  Activity,
  BookOpen,
  FileStack,
  Globe,
  HelpCircle,
  Info,
  LayoutGrid,
  PlusCircle,
  ShieldCheck,
  Settings2,
  Server,
  Users,
  UserCog,
  Zap,
} from 'lucide-react';
import Logo from '../Logo';
import UserCard from '../UserCard';
import { APP_NAME } from '@utils/constants';
import { useAuthStore } from '@stores/useAuthStore';
import styles from './Sidebar.module.css';

interface MenuItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  badge?: string;
}

const MENU: MenuItem[] = [
  { path: '/panel', label: '管理中心', icon: <LayoutGrid size={18} /> },
  { path: '/certs', label: '证书列表', icon: <FileStack size={18} /> },
  { path: '/apply', label: '申请证书', icon: <PlusCircle size={18} /> },
  { path: '/domains', label: 'DNS 验证账号', icon: <Globe size={18} /> },
  { path: '/deployments', label: '部署目标', icon: <Server size={18} /> },
  { path: '/account', label: '账号设置', icon: <UserCog size={18} /> },
  { path: '/account/apidoc', label: 'API 文档', icon: <BookOpen size={18} /> },
  { path: '/help', label: '帮助文档', icon: <HelpCircle size={18} /> },
  { path: '/about', label: '关于平台', icon: <Info size={18} /> },
];

const ADMIN_MENU: MenuItem[] = [
  { path: '/admin/users', label: '用户管理', icon: <Users size={18} /> },
  { path: '/admin/certs', label: '证书管理', icon: <ShieldCheck size={18} /> },
  { path: '/admin/automation', label: '自动化', icon: <Zap size={18} /> },
  { path: '/admin/system', label: '系统管理', icon: <Settings2 size={18} /> },
];

export interface SidebarProps {
  onNavigate?: () => void;
}

export default function Sidebar({ onNavigate }: SidebarProps) {
  const isAdmin = useAuthStore((s) => s.isAdmin);

  const renderItem = (item: MenuItem) => (
    <NavLink
      key={item.path}
      to={item.path}
      end
      onClick={onNavigate}
      className={({ isActive }) =>
        [styles.menuItem, isActive && styles.active].filter(Boolean).join(' ')
      }
    >
      <span className={styles.menuIcon}>{item.icon}</span>
      <span className={styles.menuText}>{item.label}</span>
      {item.badge && <span className={styles.menuBadge}>{item.badge}</span>}
    </NavLink>
  );

  return (
    <aside className={styles.sidebar}>
      {/* Logo 区域 */}
      <div className={styles.brand}>
        <Logo size={36} />
        <div className={styles.brandText}>
          <div className={styles.brandName}>{APP_NAME}</div>
          <div className={styles.brandSub}>SSL 证书助手</div>
        </div>
      </div>

      {/* 导航标签 */}
      <div className={styles.menuLabel}>
        <Activity size={11} />
        <span>CertHub</span>
      </div>

      {/* 普通菜单 */}
      <nav className={styles.menu}>{MENU.map(renderItem)}</nav>

      {/* 管理员专区：仅管理员可见 ======================================= */}
      {isAdmin && (
        <>
          <div
            className={`${styles.menuLabel} ${styles.menuAdmin}`}
            aria-label="管理员专区"
          >
            <ShieldCheck size={11} />
            <span>Admin</span>
          </div>
          <nav className={styles.menu}>{ADMIN_MENU.map(renderItem)}</nav>
        </>
      )}

      {/* 底部空间 */}
      <div className={styles.footer}>
        <UserCard />
      </div>
    </aside>
  );
}
