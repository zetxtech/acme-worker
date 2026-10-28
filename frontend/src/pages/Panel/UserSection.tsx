import { useMemo, useState } from 'react';
import { App, Button, Input } from 'antd';
import {
  ChevronRight,
  Copy,
  Lock,
  RefreshCw,
  Save,
  Trash2,
  Unlock,
  UserCog,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { eraseAccount, updateApiToken } from '@api/user';
import { randomString } from '@utils/crypto';
import { randomKaomoji } from '@utils/kaomoji';
import SectionHeader from '@components/Layout/SectionHeader';
import CodeBlock from '@components/molecules/CodeBlock';
import styles from './Panel.module.css';

export interface UserSectionProps {
  email: string;
  defaultExpanded?: boolean;
  collapsible?: boolean;
}

export default function UserSection({ email, defaultExpanded = false, collapsible = true }: UserSectionProps) {
  const { modal, message } = App.useApp();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [token, setToken] = useState('');
  const [savingToken, setSavingToken] = useState(false);
  const Header = collapsible ? 'button' : 'div';

  const curlExample = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `curl -X GET "${origin}/certs/{订单ID}?keys={API密钥}" \\
     -H "Content-Type: application/json" -o cert.json
jq -r '.cert' cert.json > /path/to/cert.pem
jq -r '.keys' cert.json > /path/to/keys.pem`;
  }, []);

  const handleGenerateToken = () => {
    setToken(randomString(32));
    message.success(`已生成新 Token ${randomKaomoji('success')}`);
  };

  const handleSaveToken = () => {
    if (token.trim().length < 8) {
      message.warning('Token 太短，请先生成或填写');
      return;
    }
    modal.confirm({
      title: '确认更新 API Token？',
      content:
        '如您已配置自动部署，请同步更新。此 Token 在离开本页面后不可再次查看。',
      okText: '确认更新',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        setSavingToken(true);
        try {
          const ok = await updateApiToken(token);
          if (ok) {
            message.success(`Token 已更新 ${randomKaomoji('success')}`);
            setToken('');
          }
        } finally {
          setSavingToken(false);
        }
      },
    });
  };

  const handleChangePassword = () => {
    window.location.hash = `#/login?mode=reset&email=${encodeURIComponent(email)}`;
  };

  const handleDeleteAccount = () => {
    let input = '';
    modal.confirm({
      title: '确认删除账号？',
      icon: <Trash2 size={16} />,
      content: (
        <div style={{ marginTop: 12 }}>
          <p style={{ marginBottom: 8, color: 'var(--text-2)' }}>
            此操作不可逆转！所有证书订单将被一并删除。
          </p>
          <p style={{ marginBottom: 12, color: 'var(--text-2)' }}>
            请输入您的邮箱 <strong style={{ color: 'var(--err)' }}>{email}</strong> 以确认：
          </p>
          <Input
            placeholder="输入邮箱进行确认"
            onChange={(e) => (input = e.target.value)}
          />
        </div>
      ),
      okText: '永久删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        if (input !== email) {
          message.error('邮箱输入不正确');
          return Promise.reject();
        }
        try {
          await eraseAccount(email);
          message.success('账号已删除，再见 (｡•̀ᴗ-)✧');
          setTimeout(() => {
            window.location.hash = '#/';
          }, 800);
        } catch {
          /* 拦截器已 toast */
        }
      },
    });
  };

  return (
    <div id="user-section" className={styles.collapseCard}>
      <Header
        type={collapsible ? 'button' : undefined}
        className={styles.collapseHeader}
        style={!collapsible ? {cursor: 'default'} : undefined}
        onClick={collapsible ? () => setExpanded(!expanded) : undefined}
      >
        <SectionHeader
          icon={<UserCog size={16} />}
          title="账号操作"
          subtitle="API Token、密码管理与账号删除"
          compact
        />
        {collapsible && <motion.span
          className={styles.collapseArrow}
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronRight size={18} />
        </motion.span>}
      </Header>

      <AnimatePresence initial={false}>
        {(expanded || !collapsible) && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className={styles.collapseBody}
          >
            <div className={styles.collapseInner}>
              {/* API Token 区 */}
              <div className={styles.field}>
                <label className={styles.fieldLabel}>
                  <Copy size={14} /> API Token
                </label>
                <div className={styles.fieldRow}>
                  <Input
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="留空则不更改"
                  />
                  <Button
                    icon={<RefreshCw size={14} />}
                    onClick={handleGenerateToken}
                  >
                    生成
                  </Button>
                  <Button
                    type="primary"
                    icon={<Save size={14} />}
                    onClick={handleSaveToken}
                    loading={savingToken}
                  >
                    应用
                  </Button>
                </div>
              </div>

              {/* curl 示例 */}
              <div className={styles.field}>
                <label className={styles.fieldLabel}>
                  <Lock size={14} /> 通过 API 获取证书示例
                </label>
                <CodeBlock language="bash" code={curlExample} />
              </div>

              {/* 账号操作 */}
              <div className={styles.accountActions}>
                <Button
                  icon={<Unlock size={14} />}
                  onClick={handleChangePassword}
                >
                  修改密码
                </Button>
                <Button
                  danger
                  icon={<Trash2 size={14} />}
                  onClick={handleDeleteAccount}
                >
                  删除账号
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
