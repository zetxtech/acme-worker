import {useEffect, useState} from 'react';
import {Alert, App, Button, Input, Space, Table, Tag, Tooltip} from 'antd';
import {Copy, RefreshCw} from 'lucide-react';
import PageShell from '@components/Layout/PageShell';
import SectionHeader from '@components/Layout/SectionHeader';
import {apiGet} from '@api/request';

interface Maintenance {
  flags: number;
  endpoint: {url: string};
  log: {t: number; status: string; detail: string}[];
}

export default function Automation() {
  const {message} = App.useApp();
  const [data, setData] = useState<Maintenance>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const load = async () => {
    setLoading(true);
    try { setData(await apiGet<Maintenance>('/admin/automation')); setError(false); }
    catch { setError(true); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  return <PageShell maxWidth={1200}>
    <SectionHeader title="后台维护" extra={<Tooltip title="刷新状态"><Button aria-label="刷新维护状态" icon={<RefreshCw size={16}/>} loading={loading} onClick={() => void load()}/></Tooltip>}/>
    {error && <Alert type="error" showIcon message="无法读取维护状态" action={<Button onClick={() => void load()}>重试</Button>}/>}
    <section style={{marginBottom: 24}}>
      <h3 style={{fontSize: 16, marginBottom: 12}}>定时调用地址</h3>
      <Space.Compact style={{width: '100%'}}>
        <Input.Password readOnly value={data?.endpoint?.url ?? ''} aria-label="固定 cron 调用地址"/>
        <Tooltip title="复制调用地址"><Button aria-label="复制调用地址" icon={<Copy size={16}/>} disabled={!data?.endpoint?.url}
          onClick={async () => { try { await navigator.clipboard.writeText(data!.endpoint.url); message.success('已复制'); } catch { message.error('复制失败'); } }}/></Tooltip>
      </Space.Compact>
    </section>
    <h3 style={{fontSize: 16, marginBottom: 12}}>最近运行</h3>
    <Table rowKey={(_, index) => String(index)} loading={loading} dataSource={data?.log ?? []} pagination={{pageSize: 10}}
      columns={[
        {title: '时间', dataIndex: 't', width: 190, render: (value: number) => new Date(value).toLocaleString()},
        {title: '结果', dataIndex: 'status', width: 100, render: (value: string) => <Tag color={value === 'ok' ? 'green' : 'red'}>{value === 'ok' ? '正常' : '需检查'}</Tag>},
        {title: '详情', dataIndex: 'detail', render: (value: string) => <span style={{overflowWrap: 'anywhere'}}>{value}</span>},
      ]}/>
  </PageShell>;
}
