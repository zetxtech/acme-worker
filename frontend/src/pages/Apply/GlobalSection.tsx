import { Popover, Segmented, Select, Switch } from 'antd';
import { Link } from 'react-router-dom';
import { useAuthStore } from '@stores/useAuthStore';
import type { CaCapability, WorkflowResource } from '@api/resources';
import { Cpu, Shield, ZapOff } from 'lucide-react';
import SectionHeader from '@components/Layout/SectionHeader';
import { SIGN_OPTIONS, TYPE_OPTIONS } from '@utils/constants';
import styles from './Apply.module.css';

export interface GlobalSectionProps {
  capabilities: CaCapability[];
  targets: WorkflowResource[];
  targetIds: string[];
  ca: string;
  autoRenew: boolean;
  encryption: string;
  onChange: (key: string, value: any) => void;
}

export default function GlobalSection({
  capabilities,
  targets,
  targetIds,
  ca,
  autoRenew,
  encryption,
  onChange,
}: GlobalSectionProps) {
  const isAdmin = useAuthStore((state) => state.isAdmin);
  return (
    <div className={styles.section}>
      <SectionHeader
        title="全局设置"
        subtitle="选择证书厂商、加密算法和自动续期选项"
      />

      {/* 厂商大卡片 Radio */}
      <div className={styles.field}>
        <label className={styles.fieldLabel}>
          <Shield size={13} /> 证书厂商
        </label>
        <div className={styles.caGrid}>
          {SIGN_OPTIONS.map((opt) => {
            const capability = capabilities.find((item) => item.id === opt.value);
            const pricing = capability?.id === 'sslcom-trust' ? '免费 DV 仅限单个域名，其他产品另行收费'
              : capability?.pricing === 'free-acme' ? '免费 ACME' : '免费';
            const explanation = capability?.reason === 'incompatible_product' ? '免费产品不支持当前域名组合'
              : capability?.available ? capability.registered ? '已注册 ACME 账户，长期有效'
                : 'EAB 已配置，首次签发时注册账户'
                : isAdmin ? capability?.missing.length ? `缺少配置：${capability.missing.join('、')}` : '厂商未启用'
                  : '暂不可用，请联系管理员';
            return <Popover key={opt.value} trigger={['hover', 'focus', 'click']} content={<div style={{maxWidth: 300, overflowWrap: 'anywhere'}}>
              <div>{explanation}</div><div>{pricing}</div>
              {capability?.id === 'google-trust' && <div>Google 的 EAB 仅首次注册需要，且需在创建后 7 天内使用；注册后账户长期有效。</div>}
              {isAdmin && !capability?.available && <Link to="/admin/system">前往系统管理</Link>}
            </div>}>
            <span tabIndex={0} aria-label={`${opt.label}：${explanation}`} style={{display: 'block', minWidth: 0}}>
            <button
              type="button"
              key={opt.value}
              disabled={!capability?.available}
              style={{width: '100%', height: '100%', opacity: capability?.available ? 1 : 0.5}}
              onClick={() => onChange('ca', opt.value)}
              className={[
                styles.caCard,
                ca === opt.value && styles.caCardActive,
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <div className={styles.caCardTitle}>{opt.label}</div>
              <div className={styles.caCardDesc}>{pricing}</div>
              {ca === opt.value && (
                <div className={styles.caCardMark}>✓</div>
              )}
            </button>
            </span></Popover>;
          })}
        </div>
      </div>

      {/* 算法 */}
      <div className={styles.field}>
        <label className={styles.fieldLabel}>
          <Cpu size={13} /> 加密算法
        </label>
        <Segmented
          options={TYPE_OPTIONS.map((t) => ({
            label: (
              <div className={styles.algoOption}>
                <span className={styles.algoName}>{t.label}</span>
                <span className={styles.algoDesc}>{t.desc}</span>
              </div>
            ),
            value: t.value,
          }))}
          value={encryption}
          onChange={(v) => onChange('encryption', v)}
          block
          size="large"
        />
      </div>

      {/* 自动续期 */}
      <div className={styles.field}>
        <label className={styles.fieldLabel}>部署目标</label>
        <Select mode="multiple" value={targetIds} style={{width: '100%'}} placeholder="不部署，仅签发证书"
          options={targets.map((target) => ({value: target.id, label: `${target.name} (${target.provider})`}))}
          onChange={(ids) => onChange('targetIds', ids)}/>
        <Link to="/deployments">管理部署目标</Link>
      </div>
      <div className={styles.field}>
        <div className={styles.renewRow}>
          <div>
            <div className={styles.renewTitle}>
              <ZapOff size={14} /> 自动续期
            </div>
            <div className={styles.renewDesc}>
              到期前自动申请续期；手动 TXT 仍需更新验证记录
            </div>
          </div>
          <Switch
            checked={autoRenew}
            onChange={(c) => onChange('auto_renew', c)}
          />
        </div>
      </div>
    </div>
  );
}
