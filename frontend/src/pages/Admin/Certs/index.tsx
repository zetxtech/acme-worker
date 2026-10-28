/**
 * 管理员 - 证书管理页面 /admin/certs
 */
import { useEffect, useMemo, useState } from 'react';
import {
  App as AntdApp,
  Button,
  Input,
  Modal,
  Radio,
  Space,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  DeleteOutlined,
  EditOutlined,
  FireOutlined,
  ReloadOutlined,
  SearchOutlined,
  StopOutlined,
} from '@ant-design/icons';
import {
  listAdminCerts,
  updateAdminCert,
  revokeAdminCert,
  purgeAdminCert,
  deleteAdminCert,
  type AdminCert,
} from '@api/adminCerts';
import { RevokeReason } from '@api/order';
import ConfirmIdContent from '@components/molecules/ConfirmIdContent';
import RevokeReasonSelect from '@components/molecules/RevokeReasonSelect';

const FLAG_OPTIONS = [
  { value: -1, label: '失败', color: 'red' },
  { value: 0, label: '待创建', color: 'default' },
  { value: 1, label: '处理中', color: 'processing' },
  { value: 2, label: '待验证', color: 'gold' },
  { value: 3, label: '验证中', color: 'blue' },
  { value: 4, label: '申请中', color: 'cyan' },
  { value: 5, label: '已签发', color: 'green' },
];

function flagTag(flag: number) {
  const opt = FLAG_OPTIONS.find((o) => o.value === flag);
  if (!opt) return <Tag>未知 ({flag})</Tag>;
  return <Tag color={opt.color as any}>{opt.label}</Tag>;
}

const SIGN_LABEL: Record<string, string> = {
  'lets-encrypt': "Let's Encrypt",
  'google-trust': 'Google Trust',
  'bypass-trust': 'BuyPass',
  'zeroca-trust': 'ZeroSSL',
  'sslcom-trust': 'SSL.com',
};

function signLabel(sign: number | null | string): string {
  const v = String(sign ?? '');
  return SIGN_LABEL[v] || v || '-';
}

function parseDomains(list: string): string {
  try {
    const arr = JSON.parse(list) as any[];
    if (!Array.isArray(arr)) return list;
    return arr.map((d: any) => d?.name ?? '').filter(Boolean).join(', ');
  } catch {
    return list;
  }
}

function formatTime(ts?: number | null) {
  if (!ts) return '-';
  try {
    return new Date(ts).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return String(ts);
  }
}

export default function AdminCertsPage() {
  const { message, modal } = AntdApp.useApp();

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AdminCert[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [mailFilter, setMailFilter] = useState('');
  const [domainFilter, setDomainFilter] = useState('');
  const [flagFilter, setFlagFilter] = useState<number | undefined>();

  // 编辑 flag 弹窗
  const [editing, setEditing] = useState<AdminCert | null>(null);
  const [newFlag, setNewFlag] = useState<number>(0);
  const [newText, setNewText] = useState<string>('');

  const fetchList = async () => {
    setLoading(true);
    try {
      const res = await listAdminCerts({
        page,
        page_size: pageSize,
        mail: mailFilter || undefined,
        domain: domainFilter || undefined,
        flag: flagFilter,
      });
      if (res.flags === 0) {
        setData(res.items);
        setTotal(res.total);
      } else {
        message.error(res.texts || '加载失败');
      }
    } catch (e: any) {
      message.error(e?.texts || e?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  const onSearch = () => {
    setPage(1);
    fetchList();
  };

  const openEdit = (r: AdminCert) => {
    setEditing(r);
    setNewFlag(r.flag);
    setNewText('');
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      const res: any = await updateAdminCert(editing.uuid, {
        flag: newFlag,
        text: newText || undefined,
      });
      if (res?.flags === 0) {
        message.success('已更新');
        setEditing(null);
        fetchList();
      } else {
        message.error(res?.texts || '更新失败');
      }
    } catch (e: any) {
      message.error(e?.texts || e?.message || '更新失败');
    }
  };

  const openDangerConfirm = (opts: {
    title: string;
    hint?: string;
    uuid: string;
    okText: string;
    pickRevokeReason?: boolean;
    run: (reason?: RevokeReason) => Promise<void>;
  }) => {
    let matched = false;
    let reason: RevokeReason = RevokeReason.Unspecified;
    const instance = modal.confirm({
      title: opts.title,
      icon: null,
      okText: opts.okText,
      cancelText: '取消',
      width: 520,
      okButtonProps: { danger: true, disabled: true },
      content: (
        <div>
          <ConfirmIdContent
            expectId={opts.uuid}
            hint={opts.hint}
            onMatchChange={(m) => {
              matched = m;
              instance.update({
                okButtonProps: { danger: true, disabled: !m },
              });
            }}
          />
          {opts.pickRevokeReason && (
            <RevokeReasonSelect
              onChange={(r) => {
                reason = r;
                instance.update({
                  okButtonProps: { danger: true, disabled: !matched },
                });
              }}
            />
          )}
        </div>
      ),
      onOk: async () => {
        try {
          await opts.run(opts.pickRevokeReason ? reason : undefined);
        } catch {
          /* 拦截器已 toast */
        }
      },
    });
  };

  const doRevoke = (r: AdminCert) => {
    openDangerConfirm({
      title: '吊销证书',
      hint: '即将对该证书发起 ACME 吊销请求。不同 CA 对吊销的支持程度不同，失败时会保留原状态。请输入完整订单 ID 并选择吊销原因。',
      uuid: r.uuid,
      okText: '确认吊销',
      pickRevokeReason: true,
      run: async () => {
        const res: any = await revokeAdminCert(r.uuid);
        if (res?.flags === 0) {
          message.success('已吊销');
          fetchList();
        } else {
          message.error(res?.texts || '吊销失败');
          throw new Error(res?.texts);
        }
      },
    });
  };

  const doPurge = (r: AdminCert) => {
    openDangerConfirm({
      title: '清除密钥',
      hint: '将清除此订单的 keys/cert 字段，下载将被禁用。此操作不可恢复，请输入完整订单 ID 以确认。',
      uuid: r.uuid,
      okText: '确认清除',
      run: async () => {
        const res: any = await purgeAdminCert(r.uuid);
        if (res?.flags === 0) {
          message.success('已清除');
          fetchList();
        } else {
          message.error(res?.texts || '清除失败');
          throw new Error(res?.texts);
        }
      },
    });
  };

  const doDelete = (r: AdminCert) => {
    openDangerConfirm({
      title: '删除订单',
      hint: '物理删除订单，不可恢复。请输入完整订单 ID 以确认。',
      uuid: r.uuid,
      okText: '确认删除',
      run: async () => {
        const res: any = await deleteAdminCert(r.uuid);
        if (res?.flags === 0) {
          message.success('已删除');
          fetchList();
        } else {
          message.error(res?.texts || '删除失败');
          throw new Error(res?.texts);
        }
      },
    });
  };

  const columns: ColumnsType<AdminCert> = useMemo(
    () => [
      {
        title: 'UUID',
        dataIndex: 'uuid',
        key: 'uuid',
        width: 160,
        render: (v: string) => (
          <Tooltip title={v}>
            <code style={{ fontSize: 12 }}>{v.slice(0, 10)}…</code>
          </Tooltip>
        ),
      },
      {
        title: '所属邮箱',
        dataIndex: 'mail',
        key: 'mail',
        ellipsis: true,
      },
      {
        title: '域名',
        dataIndex: 'list',
        key: 'list',
        ellipsis: true,
        render: (v: string) => (
          <Tooltip title={parseDomains(v)}>
            <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>
              {parseDomains(v)}
            </span>
          </Tooltip>
        ),
      },
      {
        title: 'CA',
        dataIndex: 'sign',
        key: 'sign',
        width: 120,
        render: (v: any) => signLabel(v),
      },
      {
        title: '状态',
        dataIndex: 'flag',
        key: 'flag',
        width: 90,
        render: (v: number) => flagTag(v),
      },
      {
        title: '签发时间',
        dataIndex: 'time',
        key: 'time',
        width: 170,
        render: (v) => formatTime(v),
      },
      {
        title: '到期时间',
        dataIndex: 'next',
        key: 'next',
        width: 170,
        render: (v) => formatTime(v),
      },
      {
        title: '密钥',
        key: 'has_keys',
        width: 64,
        render: (_v, r) =>
          r.has_keys ? <Tag color="green">有</Tag> : <Tag>无</Tag>,
      },
      {
        title: '操作',
        key: 'ops',
        width: 220,
        render: (_v, r) => (
          <Space size={2} wrap>
            <Tooltip title="修改状态">
              <Button
                size="small"
                type="text"
                icon={<EditOutlined />}
                onClick={() => openEdit(r)}
              />
            </Tooltip>
            <Tooltip title="吊销（flag=5 时可用）">
              <Button
                size="small"
                type="text"
                icon={<StopOutlined />}
                disabled={r.flag !== 5 || !r.has_cert}
                onClick={() => doRevoke(r)}
              />
            </Tooltip>
            <Tooltip title="清除 keys/cert">
              <Button
                size="small"
                type="text"
                icon={<FireOutlined />}
                onClick={() => doPurge(r)}
              />
            </Tooltip>
            <Tooltip title="删除订单">
              <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={() => doDelete(r)}
              />
            </Tooltip>
          </Space>
        ),
      },
    ],
    [],
  );

  return (
    <div style={{ padding: 24 }}>
      <Space className="toolbarRow" style={{ marginBottom: 16, flexWrap: 'wrap' }} size={8}>
        <Input
          allowClear
          style={{ width: 200 }}
          prefix={<SearchOutlined />}
          placeholder="邮箱"
          value={mailFilter}
          onChange={(e) => setMailFilter(e.target.value)}
          onPressEnter={onSearch}
        />
        <Input
          allowClear
          style={{ width: 200 }}
          placeholder="域名关键字"
          value={domainFilter}
          onChange={(e) => setDomainFilter(e.target.value)}
          onPressEnter={onSearch}
        />
        <Radio.Group
          value={flagFilter ?? ''}
          onChange={(e) => setFlagFilter(e.target.value === '' ? undefined : e.target.value)}
          optionType="button"
          buttonStyle="solid"
        >
          <Radio.Button value="">全部状态</Radio.Button>
          {FLAG_OPTIONS.map((o) => (
            <Radio.Button key={o.value} value={o.value}>{o.label}</Radio.Button>
          ))}
        </Radio.Group>
        <Button type="primary" icon={<SearchOutlined />} onClick={onSearch}>
          查询
        </Button>
        <Button icon={<ReloadOutlined />} onClick={() => fetchList()}>
          刷新
        </Button>
      </Space>

      <Table<AdminCert>
        rowKey="uuid"
        loading={loading}
        dataSource={data}
        columns={columns}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, s) => {
            setPage(p);
            setPageSize(s);
          },
        }}
        scroll={data.length ? { x: 1200 } : undefined}
      />

      {/* 修改状态弹窗 =============================================== */}
      <Modal
        open={!!editing}
        title={editing ? `修改证书状态 · ${editing.uuid}` : ''}
        onCancel={() => setEditing(null)}
        onOk={saveEdit}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
              当前状态
            </div>
            {editing ? flagTag(editing.flag) : '-'}
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
              新状态
            </div>
            <Radio.Group
              value={newFlag}
              onChange={(e) => setNewFlag(e.target.value)}
              optionType="button"
              buttonStyle="solid"
            >
              {FLAG_OPTIONS.map((o) => (
                <Radio.Button key={o.value} value={o.value}>{o.label}</Radio.Button>
              ))}
            </Radio.Group>
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
              操作备注（可选，将追加到订单 text）
            </div>
            <Input.TextArea
              rows={3}
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="例如：用户反馈证书异常"
            />
          </div>
        </Space>
      </Modal>
    </div>
  );
}


