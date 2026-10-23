import { Menu, RefreshCw } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useMemo } from 'react';
import TerminalPrompt from '@components/molecules/TerminalPrompt';
import Kaomoji from '@components/molecules/Kaomoji';
import ThemeSwitch from '@components/molecules/ThemeSwitch';
import { useAuthStore } from '@stores/useAuthStore';
import styles from './TopBar.module.css';

export interface TopBarProps {
  onMenuClick?: () => void;
  showMenuBtn?: boolean;
}

const PATH_MAP: Record<string, string> = {
  '/panel': '~/panel',
  '/certs': '~/certs',
  '/apply': '~/apply',
  '/order': '~/order',
  '/resources': '~/resources',
  '/domains': '~/domains',
  '/deployments': '~/deployments',
  '/account': '~/account',
  '/help': '~/help',
  '/about': '~/about',
  '/admin': '~/admin',
};

export default function TopBar({ onMenuClick, showMenuBtn }: TopBarProps) {
  const email = useAuthStore((s) => s.email);
  const { pathname } = useLocation();

  const promptPath = useMemo(() => {
    if (pathname.startsWith('/order/')) return `~/order/${pathname.split('/')[2].slice(0, 6)}`;
    if (pathname.startsWith('/admin/') || pathname === '/account/apidoc') return `~${pathname}`;
    for (const k of Object.keys(PATH_MAP)) {
      if (pathname.startsWith(k)) return PATH_MAP[k];
    }
    return '~';
  }, [pathname]);

  const user = useMemo(() => {
    if (!email) return 'guest';
    return email.split('@')[0].slice(0, 12);
  }, [email]);

  const suffix = pathname === '/panel' ? <span>welcome back <Kaomoji mood="welcome" inline size={14} /></span>
    : pathname === '/certs' ? 'ls -la'
      : pathname === '/apply' ? 'new cert'
        : pathname === '/account' ? 'whoami'
          : pathname.startsWith('/order/') ? `inspect // id:${pathname.split('/')[2].slice(0, 10)}`
            : undefined;

  return (
    <header className={styles.topbar}>
      <div className={styles.left}>
        {showMenuBtn && (
          <button
            type="button"
            onClick={onMenuClick}
            className={styles.menuBtn}
            aria-label="展开菜单"
          >
            <Menu size={18} />
          </button>
        )}
        <TerminalPrompt user={user} host="certhub" path={promptPath} suffix={suffix} />
      </div>

      <div className={styles.right}>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className={styles.iconBtn}
          aria-label="刷新页面"
          title="刷新"
        >
          <RefreshCw size={16} />
        </button>
        <ThemeSwitch />
      </div>
    </header>
  );
}
