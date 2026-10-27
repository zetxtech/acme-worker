import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, App, Button, Skeleton } from 'antd';
import {
  ArrowLeft,
  Copy,
  RefreshCw,
} from 'lucide-react';
import PageShell from '@components/Layout/PageShell';
import Kaomoji from '@components/molecules/Kaomoji';
import Loading from '@components/molecules/Loading';
import ConfirmIdContent from '@components/molecules/ConfirmIdContent';
import RevokeReasonSelect from '@components/molecules/RevokeReasonSelect';
import { useCopy } from '@hooks/useCopy';
import { getOrder, operateOrder, RevokeReason } from '@api/order';
import type { Order, OrderAction } from '@api/types';
import { FLAG_PULSE, FLAG_COLOR } from '@utils/constants';
import { downloadAsFile, shortenId } from '@utils/format';
import CertInfo from './CertInfo';
import DomainVerify from './DomainVerify';
import OrderActions from './OrderActions';
import OrderProgress from './OrderProgress';
import Deployments from './Deployments';
import styles from './Order.module.css';

export default function OrderPage() {
  const { uuid } = useParams<{ uuid: string }>();
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const { copy } = useCopy();

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [operating, setOperating] = useState(false);
  const [actionTip, setActionTip] = useState('处理中，请稍候...');
  const requestId = useRef(0);
  const [syncError, setSyncError] = useState(false);

  const load = async (silent = false) => {
    if (!uuid) return;
    const sequence = ++requestId.current;
    if (!silent) setLoading(true);
    try {
      const data = await getOrder(uuid, silent);
      if (sequence === requestId.current) { setOrder(data); setSyncError(false); }
    } catch (error: any) {
      if (sequence === requestId.current) {
        setSyncError(error.status !== 404);
        if (error.status === 404) setOrder(null);
      }
    } finally {
      if (sequence === requestId.current) setLoading(false);
    }
  };

  useEffect(() => {
    load();
    return () => { requestId.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uuid]);

  const watching = !!order && (order.work?.intent === 'edit' || ['queued', 'running', 'waiting'].includes(order.work?.status ?? '')
    || order.flag >= 0 && order.flag < 5 && !['action_required', 'failed', 'cancelled'].includes(order.work?.status ?? ''));
  useEffect(() => {
    if (!watching) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!document.hidden && navigator.onLine) await load(true);
      if (!stopped) timer = setTimeout(poll, 4000);
    };
    timer = setTimeout(poll, 1500);
    return () => { stopped = true; clearTimeout(timer); };
  }, [uuid, watching]);

  const handleAction = async (
    action: OrderAction,
    domainName?: string,
    opts?: {
      confirm?: string;
      danger?: boolean;
      filename?: string;
      /** 需要用户输入此字段值才能确认（通常传订单ID） */
      requireConfirmId?: string;
      /** 吊销证书时的原因选择（仅 ca_del 有效） */
      pickRevokeReason?: boolean;
    },
  ) => {
    if (!uuid) return;
    if (action === 'modify') { navigate(`/apply?edit=${encodeURIComponent(uuid)}`); return; }

    // 吊销原因（仅在 ca_del + pickRevokeReason 时使用）
    let revokeReason: RevokeReason = RevokeReason.Unspecified;

    const run = async () => {
      setActionTip(ACTION_TIP[action] || '处理中，请稍候...');
      setOperating(true);
      try {
        const { value, texts } = await operateOrder(
          uuid,
          action,
          domainName,
          action === 'ca_del' ? { revokeReason } : undefined,
        );
        if (action === 'ca_get' || action === 'ca_key') {
          if (value) {
            downloadAsFile(
              value,
              opts?.filename ||
                `${uuid}.${action === 'ca_get' ? 'crt' : 'pem'}`,
            );
            message.success('下载成功 ✨');
          } else {
            message.warning('文件不存在');
          }
        } else {
          message.info(texts || '已受理，将在后台继续处理');
          await load(true);
        }
      } catch (error: any) {
        if (!error.status) message.error(error.message || '操作未受理，请重试');
      } finally {
        setOperating(false);
      }
    };

    if (opts?.requireConfirmId) {
      const expectId = opts.requireConfirmId;
      let matched = false;
      const instance = modal.confirm({
        title: opts.confirm || '危险操作确认',
        icon: null,
        okText: '确认',
        cancelText: '取消',
        width: 480,
        okButtonProps: { danger: !!opts.danger, disabled: true },
        content: (
          <div>
            <ConfirmIdContent
              expectId={expectId}
              onMatchChange={(m) => {
                matched = m;
                instance.update({
                  okButtonProps: { danger: !!opts.danger, disabled: !m },
                });
              }}
            />
            {opts.pickRevokeReason && (
              <RevokeReasonSelect
                onChange={(r) => {
                  revokeReason = r;
                  // 维持当前 matched 状态，仅更新颜色
                  instance.update({
                    okButtonProps: { danger: !!opts.danger, disabled: !matched },
                  });
                }}
              />
            )}
          </div>
        ),
        onOk: run,
      });
      return;
    }

    if (opts?.confirm) {
      modal.confirm({
        title: opts.confirm,
        okText: '确认',
        cancelText: '取消',
        okButtonProps: opts.danger ? { danger: true } : undefined,
        onOk: run,
      });
    } else {
      await run();
    }
  };

  if (loading && !order) {
    return (
      <PageShell>
        <Skeleton active style={{ marginTop: 24 }} />
      </PageShell>
    );
  }

  if (!order) {
    return (
      <PageShell>
        <div className={styles.notFound}>
          <Kaomoji mood="error" size={56} />
          <h2>{syncError ? '暂时无法读取申请' : '申请不存在或无权查看'}</h2>
          <Button onClick={() => syncError ? void load() : navigate('/certs')} icon={<ArrowLeft size={14} />}>
            {syncError ? '重试' : '返回证书列表'}
          </Button>
        </div>
      </PageShell>
    );
  }

  const pulseStatus = FLAG_PULSE[order.flag] || 'pending';
  const colorVariant = FLAG_COLOR[order.flag] as any;

  return (
    <PageShell className={styles.orderPage}>
      {/* 顶部：路径 + 返回 + 复制ID */}
      <div className={styles.greet}>
        <div className={styles.topActions}>
          <Button
            size="small"
            icon={<Copy size={12} />}
            onClick={() => copy(order.uuid, '订单ID已复制')}
          >
            复制ID
          </Button>
          <Button
            size="small"
            icon={<RefreshCw size={12} />}
            onClick={() => void load()}
            loading={loading}
          >
            刷新
          </Button>
          <Button
            size="small"
            icon={<ArrowLeft size={12} />}
            onClick={() => navigate('/certs')}
          >
            返回
          </Button>
        </div>
      </div>

      {/* 进度条 */}
      <OrderProgress flag={order.flag} cancelled={order.work?.status === 'cancelled'}
        label={order.work?.status === 'cancelled' ? order.cert ? '已停止续期，原证书已保留' : '已取消'
          : order.work?.intent === 'edit' ? '编辑中' : order.flag === 2 && order.work?.status !== 'action_required' ? '域名验证中' : undefined}/>

      {order.work && order.work.status !== 'complete' && <Alert showIcon
        type={order.work.status === 'failed' ? 'error' : order.work.status === 'action_required' ? 'warning' : 'info'}
        message={order.work.detail}
        description={syncError ? '连接暂时中断，正在重新同步状态' : watching ? '后台持续处理中，离开页面不会中断申请' : undefined}/>}

      {/* 证书信息 */}
      <CertInfo order={order} />

      {/* 域名验证状态（仅在未完成时显示） */}
      {order.flag !== -1 && (
        <DomainVerify
          order={order}
          onVerifySingle={(name) =>
            handleAction(order.list.find((item) => item.name === name)?.type === 'dns-api' ? 'process' : 'single', name, {
              confirm: `确认触发 ${name} 的单独验证？`,
            })
          }
        />
      )}

      <Deployments order={order}/>

      {/* 底部操作栏 */}
      <OrderActions
        order={order}
        operating={operating}
        onAction={handleAction}
      />

      {/* 操作中遮罩：与页面加载一致的半透明遮罩，整页均匀变暗 */}
      {operating && <Loading full overlay text={actionTip} />}
    </PageShell>
  );
}

/* 动作对应的忙碌文案 */
const ACTION_TIP: Record<string, string> = {
  process: '正在处理订单，请稍候...',
  verify: '正在验证域名，请稍候...',
  single: '正在验证该域名，请稍候...',
  reload: '正在重新生成验证信息...',
  modify: '正在修改申请，请稍候...',
  cancel: '正在取消订单...',
  re_new: '正在发起续期流程...',
  edge_push: '正在把证书下发到边缘平台...',
  ca_get: '正在下载证书...',
  ca_key: '正在下载密钥...',
  ca_del: '正在吊销证书...',
  rm_key: '正在清理私钥...',
};
