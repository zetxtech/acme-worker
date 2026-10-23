import { useState } from 'react';
import { Button } from 'antd';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, Globe, PlayCircle } from 'lucide-react';
import SectionHeader from '@components/Layout/SectionHeader';
import StatusPulse from '@components/molecules/StatusPulse';
import Pill from '@components/atoms/Pill';
import CodeInline from '@components/atoms/CodeInline';
import CopyButton from '@components/molecules/CopyButton';
import type { Order, DomainItem } from '@api/types';
import { AUTH_MAP, FLAG_PULSE, FLAG_MAP } from '@utils/constants';
import styles from './Order.module.css';

export interface DomainVerifyProps {
  order: Order;
  onVerifySingle: (name: string) => void;
}

export default function DomainVerify({
  order,
  onVerifySingle,
}: DomainVerifyProps) {
  const list = order.list || [];
  const pendingCount = list.filter((d) => d.flag !== undefined && d.flag < 3).length;

  return (
    <div className={styles.verifyCard}>
      <SectionHeader
        icon={<Globe size={16} />}
        title={`域名验证 (${list.length} 个)`}
        subtitle={pendingCount > 0 ? `${pendingCount} 个待处理` : '全部已处理'}
      />

      <div className={styles.domainPanels}>
        {list.map((d, i) => (
          <DomainPanel
            key={i}
            domain={d}
            onVerify={() => onVerifySingle(d.name)}
          />
        ))}
      </div>
    </div>
  );
}

function DomainPanel({
  domain,
  onVerify,
}: {
  domain: DomainItem;
  onVerify: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const flag = domain.flag ?? 0;
  const pulseStatus = FLAG_PULSE[flag] || 'pending';
  const isVerifiable = flag === 2;

  const recordName = `_acme-challenge.${domain.name.replace(/^\*\./, '')}`;
  const recordType = domain.type === 'dns-auto' ? 'CNAME' : 'TXT';
  const dnsStatus: Record<string, string> = {preparing_records: '等待准备 DNS 记录', access_denied: 'DNS 账户授权已失效，请联系账户所有者', provider_failed: '写入失败，请检查 DNS 账户后重试', waiting_propagation: '等待 DNS 生效',
    propagated: 'DNS 已生效，等待验证', cleanup_pending: '验证已完成，等待清理记录', cleaned: '验证记录已清理'};
  const recordValue =
    domain.type === 'dns-auto' ? domain.auto || '-' : domain.auth || '-';

  return (
    <div className={styles.domainPanel}>
      <button
        type="button"
        className={styles.domainPanelHead}
        onClick={() => setExpanded(!expanded)}
      >
        <div className={styles.domainPanelLeft}>
          <StatusPulse status={pulseStatus} size={8} />
          <CodeInline color={domain.name.startsWith('*') ? 'accent' : 'brand'}>
            {domain.name}
          </CodeInline>
          <Pill variant="neutral" size="xs">
            {AUTH_MAP[domain.type] || domain.type}
          </Pill>
          <Pill
            variant={
              flag === 5
                ? 'ok'
                : flag < 0
                  ? 'err'
                  : flag >= 3
                    ? 'lemon'
                    : 'info'
            }
            size="xs"
          >
            {FLAG_MAP[flag] || '等待中'}
          </Pill>
        </div>
        <motion.div
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronRight size={16} className={styles.domainPanelArrow} />
        </motion.div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className={styles.domainPanelBody}
          >
            <div className={styles.domainPanelInner}>
              <div className={styles.hint}>
                {domain.type === 'dns-api' ? dnsStatus[domain.dnsStatus ?? ''] ?? '等待自动验证'
                  : domain.type === 'web-self' ? '请将验证内容保存到以下地址：' : '请在您的 DNS 提供商中添加以下记录以完成验证：'}
              </div>

              <div className={styles.dnsTable}>
                <DnsRow label="记录类型" value={domain.type === 'web-self' ? 'HTTP-01' : recordType} />
                <DnsRow label={domain.type === 'web-self' ? '验证地址' : '记录名称'} value={domain.type === 'web-self'
                  ? `http://${domain.name}/.well-known/acme-challenge/${domain.token ?? ''}` : recordName} />
                <DnsRow label="记录值" value={recordValue} mono />
                {domain.type === 'dns-api' && <DnsRow label="DNS 账户" value={domain.dnsAccountId ?? '-'}/>}
                <DnsRow
                  label="验证命令"
                  value={`nslookup -q=${recordType} ${recordName}`}
                  mono
                />
              </div>

              <div className={styles.domainActions}>
                <Button
                  type="primary"
                  icon={<PlayCircle size={14} />}
                  onClick={onVerify}
                  disabled={!isVerifiable}
                >
                  {isVerifiable ? '触发验证' : '耐心等待...'}
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DnsRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className={styles.dnsRow}>
      <div className={styles.dnsLabel}>{label}</div>
      <div className={styles.dnsValue}>
        <code className={mono ? styles.dnsValueMono : styles.dnsValueText}>
          {value}
        </code>
        <CopyButton text={value} successMsg={`${label}已复制`} size={13} />
      </div>
    </div>
  );
}
