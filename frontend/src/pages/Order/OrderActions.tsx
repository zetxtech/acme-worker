import { App as AntdApp, Button } from 'antd';
import { useNavigate } from 'react-router-dom';
import {
  Archive,
  CloudUpload,
  Download,
  FileLock2,
  Key,
  Pencil,
  PlayCircle,
  RotateCcw,
  ShieldOff,
  Trash2,
  XCircle,
  Zap,
} from 'lucide-react';
import type { Order, OrderAction } from '@api/types';
import { handleDownloadZip, handleDownloadPfx } from '@utils/certDownload';
import styles from './Order.module.css';

export interface OrderActionsProps {
  order: Order;
  operating: boolean;
  onAction: (
    action: OrderAction,
    domainName?: string,
    opts?: {
      confirm?: string;
      danger?: boolean;
      filename?: string;
      /** 需要用户输入此字段值才能确认（通常传订单ID） */
      requireConfirmId?: string;
      /** 吊销证书时是否提示选择原因 */
      pickRevokeReason?: boolean;
    },
  ) => void;
}

export default function OrderActions({
  order,
  operating,
  onAction,
}: OrderActionsProps) {
  const { message } = AntdApp.useApp();
  const navigate = useNavigate();
  const isPending = order.flag >= 0 && order.flag < 5;
  const isVerifiable = order.flag === 2 && order.list.some((domain) =>
    ['dns-self', 'web-self'].includes(domain.type) && Number(domain.flag ?? 0) < 3 || domain.dnsStatus === 'waiting_delegation');
  const isSigned = order.flag === 5;
  const hasCert = !!order.cert;
  const hasKey = !!order.keys;

  return (
    <div className={styles.actionsBar}>
      {isSigned && order.work?.intent === 'cleanup' && order.work.status === 'action_required'
        && <Button icon={<RotateCcw size={16}/>} loading={operating} onClick={() => onAction('process')}>重试清理验证记录</Button>}
      {isPending && (
        <>
          {order.work?.reason === 'timeout' && <Button icon={<RotateCcw size={16}/>} loading={operating} onClick={() => onAction('process')}>重新检查</Button>}
          {isVerifiable && <Button
            size="large"
            icon={<PlayCircle size={16} />}
            disabled={!isVerifiable || operating}
            loading={operating}
            onClick={() =>
              onAction('verify', undefined, {
                confirm: '确认触发全部域名的验证？',
              })
            }
          >
            已配置记录，检查验证
          </Button>}
          {order.flag < 4 && <Button
            size="large"
            icon={<Pencil size={16} />}
            disabled={operating}
            loading={operating}
            onClick={() => navigate(`/apply?edit=${encodeURIComponent(order.uuid)}`)}
          >
            修改申请
          </Button>}
          <Button
            danger
            size="large"
            icon={<XCircle size={16} />}
            loading={operating}
            disabled={operating}
            onClick={() =>
              onAction('cancel', undefined, {
                confirm: '停止后续处理？申请记录和已有证书会保留。',
                danger: true,
              })
            }
          >
            撤销申请
          </Button>
        </>
      )}

      {order.flag < 0 && order.work?.status !== 'cancelled' && <>
        <Button type="primary" loading={operating} icon={<RotateCcw size={16}/>} onClick={() => onAction('process')}>重试申请</Button>
        <Button icon={<Pencil size={16}/>} onClick={() => navigate(`/apply?edit=${encodeURIComponent(order.uuid)}`)}>编辑并重新提交</Button>
      </>}

      {isSigned && (
        <>
          <Button
            type="primary"
            size="large"
            icon={<Download size={16} />}
            disabled={!hasCert}
            loading={operating}
            onClick={() =>
              onAction('ca_get', undefined, {
                filename: `${order.uuid}.crt`,
              })
            }
          >
            下载证书
          </Button>
          <Button
            size="large"
            icon={<Key size={16} />}
            disabled={!hasKey || operating}
            loading={operating}
            onClick={() =>
              onAction('ca_key', undefined, {
                filename: `${order.uuid}.pem`,
              })
            }
          >
            下载密钥
          </Button>
          <Button
            size="large"
            icon={<Archive size={16} />}
            disabled={!hasKey || operating}
            onClick={() => handleDownloadZip(order.uuid, message)}
          >
            下载 ZIP
          </Button>
          <Button
            size="large"
            icon={<FileLock2 size={16} />}
            disabled={!hasKey || operating}
            onClick={() => handleDownloadPfx(order.uuid, message)}
          >
            下载 PFX
          </Button>
          <Button
            size="large"
            icon={<RotateCcw size={16} />}
            loading={operating}
            disabled={operating}
            onClick={() =>
              onAction('re_new', undefined, {
                confirm: '确认续期此证书？将重新发起签发流程',
              })
            }
          >
            续期证书
          </Button>
          <Button
            size="large"
            icon={<CloudUpload size={16} />}
            loading={operating}
            disabled={operating}
            onClick={() =>
              onAction('edge_push', undefined, {
                confirm: '确认把当前证书重新下发到所有启用的边缘平台？',
              })
            }
          >
            边缘下发
          </Button>
          <Button
            size="large"
            icon={<Trash2 size={16} />}
            disabled={!hasKey || operating}
            loading={operating}
            onClick={() =>
              onAction('rm_key', undefined, {
                confirm: '确认清空本地私钥？清空后无法使用私钥吊销或续期证书，此操作不可恢复',
                danger: true,
                requireConfirmId: order.uuid,
              })
            }
          >
            清空私钥
          </Button>
          <Button
            size="large"
            icon={<ShieldOff size={16} />}
            disabled={!hasKey || operating}
            loading={operating}
            onClick={() =>
              onAction('ca_del', undefined, {
                confirm: '确认吊销此证书？吊销后证书将被 CA 标记为无效，使用该证书的服务都将无法正常工作',
                danger: true,
                requireConfirmId: order.uuid,
                pickRevokeReason: true,
              })
            }
          >
            吊销证书
          </Button>
          <Button
            danger
            size="large"
            icon={<XCircle size={16} />}
            loading={operating}
            disabled={operating}
            onClick={() =>
              onAction('cancel', undefined, {
                confirm: '确认删除此订单？所有相关信息将丢失',
                danger: true,
                requireConfirmId: order.uuid,
              })
            }
          >
            删除订单
          </Button>
        </>
      )}
    </div>
  );
}
