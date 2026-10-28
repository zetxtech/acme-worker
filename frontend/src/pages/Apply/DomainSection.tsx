import { Alert, Input, Segmented, Select, Switch, Tooltip } from 'antd';
import { Link } from 'react-router-dom';
import { resourceSelectable, type DcvState, type WorkflowResource } from '@api/resources';
import { useAuthStore } from '@stores/useAuthStore';
import { Plus, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import SectionHeader from '@components/Layout/SectionHeader';
import Kaomoji from '@components/molecules/Kaomoji';
import type { DomainRowForm } from './index';
import { AUTH_OPTIONS, AUTH_OPTIONS_IP } from '@utils/constants';
import styles from './Apply.module.css';

const MAX_DOMAINS = 10;
const VERIFICATION_LABELS: Record<string, string> = {
  'dns-self': '手动 TXT', 'dns-auto': 'DCV 托管', 'web-self': 'HTTP', 'dns-api': 'DNS 账户',
};

/**
 * 清理域名输入：
 * - 去除所有空白字符（含全角空格、制表符、换行等）
 * - 只保留合法的域名字符：字母、数字、`.`、`-`、`*`
 * - 统一转为小写，避免 ACME 服务端因大小写差异或非法字符拒绝
 * - 去除开头的 `.`、`-`
 */
export function sanitizeDomainInput(raw: string): string {
  if (!raw) return '';
  let v = raw
    // 去除各种空白（空格、全角空格、零宽空格、制表符、换行等）
    .replace(/[\s\u00A0\u3000\u200B-\u200D\uFEFF]/g, '')
    // 去除除合法字符外的所有字符
    .replace(/[^a-zA-Z0-9.*\-]/g, '')
    .toLowerCase();
  // 去除开头的 . 和 -
  v = v.replace(/^[.\-]+/, '');
  return v;
}

/**
 * 清理 IP 地址输入：
 * - 去除空白字符
 * - 只保留数字和 `.`
 */
export function sanitizeIPInput(raw: string): string {
  if (!raw) return '';
  return raw.replace(/[\s\u00A0\u3000\u200B-\u200D\uFEFF]/g, '').replace(/[^0-9.]/g, '');
}

export interface DomainSectionProps {
  dcv?: DcvState;
  dnsAccounts: WorkflowResource[];
  domains: DomainRowForm[];
  onChange: (domains: DomainRowForm[]) => void;
  defaultRow: () => DomainRowForm;
}

export default function DomainSection({
  dcv,
  dnsAccounts,
  domains,
  onChange,
  defaultRow,
}: DomainSectionProps) {
  const isAdmin = useAuthStore((state) => state.isAdmin);
  const email = useAuthStore((state) => state.email);
  const updateRow = (id: string, patch: Partial<DomainRowForm>) => {
    onChange(domains.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };

  const removeRow = (id: string) => {
    if (domains.length === 1) return;
    onChange(domains.filter((d) => d.id !== id));
  };

  const addRow = () => {
    if (domains.length >= MAX_DOMAINS) return;
    onChange([...domains, defaultRow()]);
  };

  return (
    <div className={styles.section}>
      <SectionHeader
        title="域名配置"
        subtitle={`添加您要申请证书的域名（最多 ${MAX_DOMAINS} 个）`}
      />

      <div className={styles.domainList}>
        <AnimatePresence initial={false}>
          {domains.map((d, i) => (
            <motion.div
              key={d.id}
              className={styles.domainRow}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
            >
              <div className={styles.domainHead}>
                <span className={styles.domainIndex}>#{i + 1}</span>
                {domains.length > 1 && (
                  <Tooltip title="删除此域名">
                    <button
                      type="button"
                      className={styles.removeBtn}
                      onClick={() => removeRow(d.id)}
                      aria-label="删除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </Tooltip>
                )}
              </div>

              <Input
                size="large"
                value={d.domain}
                onChange={(e) =>
                  updateRow(d.id, {
                    domain: d.isIP
                      ? sanitizeIPInput(e.target.value)
                      : sanitizeDomainInput(e.target.value),
                  })
                }
                onPaste={(e) => {
                  // 粘贴时同样做一次清理（处理剪贴板带前导空格/中文等常见场景）
                  const text = e.clipboardData.getData('text');
                  const cleaned = d.isIP ? sanitizeIPInput(text) : sanitizeDomainInput(text);
                  if (cleaned !== text) {
                    e.preventDefault();
                    updateRow(d.id, { domain: cleaned });
                  }
                }}
                placeholder={d.isIP ? '192.168.1.1' : 'example.com'}
                className={styles.domainInput}
                maxLength={d.isIP ? 15 : 253}
                autoComplete="off"
                spellCheck={false}
              />

              <div className={styles.domainControls}>
                <label className={styles.switchLabel}>
                  <Switch
                    size="small"
                    checked={d.isIP}
                    onChange={(c) => updateRow(d.id, {
                      isIP: c,
                      // 勾选IP证书时：强制WEB验证、禁用通配符
                      ...(c ? { wildcard: false, includeRoot: false, verification: 'web-self' as const }
                        : {wildcard: defaultRow().wildcard, includeRoot: defaultRow().includeRoot, verification: defaultRow().verification}),
                    })}
                  />
                  <span>IP 证书</span>
                </label>
                  <label className={styles.switchLabel}>
                    <Switch
                      size="small"
                      disabled={d.isIP}
                      checked={d.wildcard}
                      onChange={(c) => updateRow(d.id, { wildcard: c })}
                    />
                    <span>通配符 (*.)</span>
                  </label>
                  <label className={styles.switchLabel}>
                    <Switch
                      size="small"
                      disabled={d.isIP}
                      checked={d.includeRoot}
                      onChange={(c) => updateRow(d.id, { includeRoot: c })}
                    />
                    <span>包含根域名</span>
                  </label>
              </div>

              <Segmented
                options={(d.isIP ? AUTH_OPTIONS_IP : [...AUTH_OPTIONS, {value: 'dns-api', label: 'DNS 账户'}]).map((option) => ({
                  ...option, disabled: option.value === 'dns-auto' && !dcv?.available,
                  label: <Tooltip title={option.value === 'dns-auto' && !dcv?.available
                    ? isAdmin ? 'DCV 托管尚未配置，请先完成域名托管设置' : 'DCV 托管尚未启用，请联系管理员'
                    : option.label}><span tabIndex={option.value === 'dns-auto' && !dcv?.available ? 0 : undefined}>{VERIFICATION_LABELS[option.value] ?? option.label}</span></Tooltip>,
                }))}
                value={d.verification}
                onChange={(v) =>
                  updateRow(d.id, { verification: v as DomainRowForm['verification'] })
                }
                className={styles.verifySeg}
                block
              />
              {d.verification === 'dns-api' && <div style={{marginTop: 12}}>
                <Select aria-label="DNS 账户" style={{width: '100%'}} value={d.dnsAccountId} placeholder="选择 DNS 账户"
                  options={dnsAccounts.map((account) => ({value: account.id, label: `${account.name} (${account.provider})`,
                    disabled: !resourceSelectable(account, email, d.domain ? [d.domain] : [])}))}
                  onChange={(id) => updateRow(d.id, {dnsAccountId: id})}/>
                <Link to="/domains">管理 DNS 验证账号</Link>
              </div>}
              {d.verification === 'dns-self' && <Alert style={{marginTop: 12}} type="info" showIcon message="手动 TXT 需要在每次续期时更新记录"/>}
            </motion.div>
          ))}
        </AnimatePresence>

        {domains.length < MAX_DOMAINS ? (
          <button
            type="button"
            className={styles.addBtn}
            onClick={addRow}
          >
            <Plus size={16} />
            <span>
              添加域名 ({domains.length}/{MAX_DOMAINS})
            </span>
          </button>
        ) : (
          <div className={styles.maxHint}>
            <Kaomoji mood="warning" inline size={14} /> 已达最大数量限制
          </div>
        )}
      </div>
    </div>
  );
}
