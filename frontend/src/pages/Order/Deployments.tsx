import {useEffect, useState} from 'react';
import {App, Button, Modal, Select, Space, Table, Tag, Tooltip} from 'antd';
import {RefreshCw, Settings2} from 'lucide-react';
import {fetchDeployments, fetchResources, resourceSelectable, retryDeployment, updateDeploymentSelection, type DeploymentState, type WorkflowResource} from '@api/resources';
import type {Order} from '@api/types';
import RequestDetails from '@components/molecules/RequestDetails';

export default function Deployments({order}: {order: Order}) {
  const {message} = App.useApp();
  const [items, setItems] = useState<DeploymentState[]>([]);
  const [resources, setResources] = useState<WorkflowResource[]>([]);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const load = async () => {
    setLoading(true);
    try { const response = await fetchDeployments(order.uuid); setItems(response.items); }
    finally { setLoading(false); }
  };
  useEffect(() => { load().catch(() => {}); }, [order.uuid, order.flag, order.work?.updatedAt]);
  useEffect(() => {
    if (order.flag !== 5 || !items.some((item) => ['pending', 'running'].includes(item.status))) return;
    const timer = setInterval(() => { if (!document.hidden && navigator.onLine) void load().catch(() => {}); }, 4000);
    return () => clearInterval(timer);
  }, [order.uuid, order.flag, items.some((item) => ['pending', 'running'].includes(item.status))]);
  const retry = async (id: string) => {
    setRetrying(id);
    try {
      const result = await retryDeployment(order.uuid, id);
      message.info('已安排后台部署');
      await load();
    } finally { setRetrying(undefined); }
  };
  const edit = async () => {
    const response = await fetchResources('targets');
    setResources(response.items.filter((resource) => resourceSelectable(resource, order.mail, order.list.map((item) => item.name))));
    setSelected(items.map((item) => item.targetId));
    setEditing(true);
  };
  const labels = {pending: '\u5f85\u90e8\u7f72', running: '\u90e8\u7f72\u4e2d', ok: '\u5df2\u90e8\u7f72', fail: '\u90e8\u7f72\u5931\u8d25'};
  return <section style={{minWidth: 0, borderTop: '1px solid var(--line-dashed)', paddingTop: 16}}>
    <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 12}}>
      <h3 style={{fontSize: 16, margin: 0}}>{'\u90e8\u7f72\u72b6\u6001'}</h3>
      <Space><Tooltip title={'\u5237\u65b0'}><Button aria-label={'\u5237\u65b0\u90e8\u7f72\u72b6\u6001'} icon={<RefreshCw size={14}/>} loading={loading} onClick={() => load().catch(() => {})}/></Tooltip>
        <Button icon={<Settings2 size={14}/>} onClick={() => edit().catch(() => {})}>{'\u9009\u62e9\u76ee\u6807'}</Button></Space>
    </div>
    {items.length ? <Table rowKey="targetId" size="small" dataSource={items} loading={loading} pagination={false} scroll={{x: 640}} columns={[
      {title: '\u76ee\u6807', dataIndex: 'name'}, {title: '\u72b6\u6001', dataIndex: 'status', render: (status: DeploymentState['status']) => <Tag color={status === 'ok' ? 'green' : status === 'fail' ? 'red' : 'default'}>{labels[status]}</Tag>},
      {title: '\u7248\u672c', dataIndex: 'version', render: (version?: string) => version?.slice(0, 10) ?? '-'},
      {title: '\u5c1d\u8bd5', dataIndex: 'attempts'}, {title: '\u8be6\u60c5', dataIndex: 'detail', width: 260,
        render: (detail: string | undefined, item) => <RequestDetails summary={detail} diagnostic={item.diagnostic}/>},
      {title: '\u64cd\u4f5c', key: 'retry', render: (_, item) => <Tooltip title={'\u91cd\u8bd5\u6b64\u76ee\u6807'}><span><Button aria-label={'\u91cd\u8bd5\u6b64\u76ee\u6807'} icon={<RefreshCw size={14}/>}
        disabled={order.flag !== 5 || item.status !== 'fail'} loading={retrying === item.targetId} onClick={() => retry(item.targetId).catch(() => {})}/></span></Tooltip>},
      ]}/> : <p style={{color: 'var(--text-2)', margin: 0}}>未设置自动部署，签发后可下载证书。</p>}
    <Modal open={editing} title={'\u9009\u62e9\u90e8\u7f72\u76ee\u6807'} onCancel={() => setEditing(false)} okText={'\u4fdd\u5b58'} cancelText={'\u53d6\u6d88'}
      onOk={async () => { await updateDeploymentSelection(order.uuid, selected); setEditing(false); await load(); }}>
      <Select mode="multiple" style={{width: '100%'}} value={selected} onChange={setSelected} options={resources.map((resource) => ({value: resource.id, label: resource.name}))}/>
    </Modal>
  </section>;
}