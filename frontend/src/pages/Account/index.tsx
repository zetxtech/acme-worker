import { UserCog } from 'lucide-react';
import PageShell from '@components/Layout/PageShell';
import SectionHeader from '@components/Layout/SectionHeader';
import { useAuthStore } from '@stores/useAuthStore';
import AcmeSection from '@pages/Panel/AcmeSection';
import UserSection from '@pages/Panel/UserSection';
import styles from './Account.module.css';

export default function Account() {
  const email = useAuthStore((s) => s.email);

  return (
    <PageShell>
      {/* 标题 */}
      <SectionHeader
        icon={<UserCog size={18} />}
        title="账号设置"
        subtitle="管理 ACME 私钥、API Token、登录密码与账号"
      />

      {/* 两列布局：ACME 密钥 + 账号操作 */}
      <div className={styles.grid}>
        <AcmeSection defaultExpanded />
        <UserSection email={email || ''} defaultExpanded />
      </div>
    </PageShell>
  );
}
