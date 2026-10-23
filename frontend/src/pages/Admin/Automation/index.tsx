/**
 * 管理员 - 自动化 /admin/automation
 * 三块内容：
 *   1. 触发器端点：访问 /trigger/<name>?token=... 即执行所选任务（等同于 cron）
 *   2. 边缘证书下发：把签发的证书自动同步到腾讯云 EdgeOne / 阿里云 ESA
 *   3. 自动任务与执行日志
 */
import { useCallback, useEffect, useState } from 'react';
import {
  App as AntdApp,
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ApiOutlined,
  CloudSyncOutlined,
  DeleteOutlined,
  EditOutlined,
  ExperimentOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  SyncOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  createTarget,
  createTrigger,
  deleteTarget,
  deleteTrigger,
  fetchAutomation,
  runJobsNow,
  runTrigger,
  saveSchedule,
  syncTarget,
  testTarget,
  updateTarget,
  updateTrigger,
  type AutoLogItem,
  type EdgeTargetView,
  type JobDef,
  type ScheduleInfo,
  type TriggerDef,
} from '@api/automation';
import PageShell from '@components/Layout/PageShell';

function formatTime(ts?: number | null) {
  if (!ts) return '-';
  try {
    return new Date(ts).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return String(ts);
  }
}

function StatusTag({ status }: { status?: string }) {
  if (status === 'ok') return <Tag color="green">成功</Tag>;
  if (status === 'fail') return <Tag color="red">失败</Tag>;
  if (status === 'skip') return <Tag>跳过</Tag>;
  return <Tag>{status || '-'}</Tag>;
}

const TARGET_TYPE_LABEL: Record<string, string> = {
  edgeone: '腾讯云 EdgeOne',
  esa: '阿里云 ESA',
};

export default function AdminAutomationPage() {
  const { message, modal } = AntdApp.useApp();

  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<JobDef[]>([]);
  const [triggers, setTriggers] = useState<TriggerDef[]>([]);
  const [targets, setTargets] = useState<EdgeTargetView[]>([]);
  const [schedule, setSchedule] = useState<ScheduleInfo | null>(null);
  const [log, setLog] = useState<AutoLogItem[]>([]);

  const [scheduleForm] = Form.useForm();
  const [triggerForm] = Form.useForm();
  const [targetForm] = Form.useForm();

  const [triggerModal, setTriggerModal] = useState<{ open: boolean; item?: TriggerDef }>({ open: false });
  const [targetModal, setTargetModal] = useState<{ open: boolean; item?: EdgeTargetView }>({ open: false });
  const [targetType, setTargetType] = useState<'edgeone' | 'esa'>('edgeone');
  const [busy, setBusy] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAutomation();
      if (res.flags === 0) {
        setJobs(res.jobs || []);
        setTriggers(res.triggers || []);
        setTargets(res.targets || []);
        setSchedule(res.schedule);
        setLog(res.log || []);
        scheduleForm.setFieldsValue({
          enabled: res.schedule?.enabled,
          interval_minutes: res.schedule?.interval_minutes ?? 60,
          renew_days_before: res.schedule?.renew_days_before ?? 30,
          jobs: res.schedule?.jobs ?? [],
        });
      } else {
        message.error('加载失败');
      }
    } catch (e: any) {
      message.error(e?.texts || e?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [message, scheduleForm]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const jobOptions = jobs.map((j) => ({ label: j.title, value: j.id }));
  const jobTitle = (id: string) => jobs.find((j) => j.id === id)?.title || id;

  /* --------------------------- 触发器 --------------------------- */

  const openTrigger = (item?: TriggerDef) => {
    setTriggerModal({ open: true, item });
    triggerForm.setFieldsValue({
      name: item?.name ?? '',
      jobs: item?.jobs ?? ['cron'],
      note: item?.note ?? '',
      enabled: item?.enabled ?? true,
    });
  };

  const submitTrigger = async () => {
    const values = await triggerForm.validateFields();
    try {
      if (triggerModal.item) {
        await updateTrigger(triggerModal.item.id, {
          name: values.name,
          jobs: values.jobs,
          note: values.note,
          enabled: values.enabled,
        });
        message.success('已保存');
      } else {
        await createTrigger({ name: values.name, jobs: values.jobs, note: values.note });
        message.success('触发器已创建');
      }
      setTriggerModal({ open: false });
      load();
    } catch (e: any) {
      message.error(e?.texts || e?.message || '保存失败');
    }
  };

  const doRunTrigger = async (item: TriggerDef, force = false) => {
    setBusy(item.id);
    try {
      const res: any = await runTrigger(item.id, force);
      if (res.status === 'ok') message.success(res.texts || '执行完成');
      else message.warning(res.texts || '执行完成，但存在失败任务');
      load();
    } catch (e: any) {
      message.error(e?.texts || e?.message || '执行失败');
    } finally {
      setBusy('');
    }
  };

  const doRotateToken = async (item: TriggerDef) => {
    try {
      await updateTrigger(item.id, { rotate_token: true });
      message.success('已重置令牌，请更新调用方');
      load();
    } catch (e: any) {
      message.error(e?.texts || e?.message || '操作失败');
    }
  };

  const doDeleteTrigger = (item: TriggerDef) => {
    modal.confirm({
      title: '删除触发器端点',
      content: `确认删除 ${item.name}？已配置的外部调度将立即失效。`,
      okButtonProps: { danger: true },
      onOk: async () => {
        await deleteTrigger(item.id);
        message.success('已删除');
        load();
      },
    });
  };

  /* --------------------------- 下发目标 --------------------------- */

  const openTarget = (item?: EdgeTargetView) => {
    const type = item?.type ?? 'edgeone';
    setTargetType(type);
    setTargetModal({ open: true, item });
    targetForm.resetFields();
    targetForm.setFieldsValue({
      type,
      name: item?.name ?? '',
      domains: (item?.domains ?? []).join(', '),
      enabled: item?.enabled ?? true,
      auto: item?.auto ?? true,
      edgeone: item?.edgeone
        ? { ...item.edgeone, secret_key: '' }
        : { secret_id: '', secret_key: '', region: '', zone_id: '', hosts: '', alias: '' },
      esa: item?.esa
        ? { ...item.esa, access_key_secret: '' }
        : { access_key_id: '', access_key_secret: '', endpoint: '', site_id: '', cert_name: '' },
    });
  };

  const submitTarget = async () => {
    const values = await targetForm.validateFields();
    const domains = String(values.domains || '')
      .split(/[\s,]+/)
      .map((s: string) => s.trim())
      .filter(Boolean);
    const payload: Record<string, any> = {
      type: targetType,
      name: values.name,
      domains,
      enabled: values.enabled,
      auto: values.auto,
    };
    if (targetType === 'edgeone') {
      payload.edgeone = {
        secret_id: values.edgeone?.secret_id ?? '',
        secret_key: values.edgeone?.secret_key ?? '',
        region: values.edgeone?.region ?? '',
        zone_id: values.edgeone?.zone_id ?? '',
        alias: values.edgeone?.alias ?? '',
        hosts: String(values.edgeone?.hosts || '')
          .split(/[\s,]+/)
          .map((s: string) => s.trim())
          .filter(Boolean),
      };
    } else {
      payload.esa = {
        access_key_id: values.esa?.access_key_id ?? '',
        access_key_secret: values.esa?.access_key_secret ?? '',
        endpoint: values.esa?.endpoint ?? '',
        site_id: values.esa?.site_id ?? '',
        cert_name: values.esa?.cert_name ?? '',
      };
    }
    try {
      if (targetModal.item) {
        await updateTarget(targetModal.item.id, payload);
        message.success('已保存');
      } else {
        await createTarget(payload);
        message.success('已添加');
      }
      setTargetModal({ open: false });
      load();
    } catch (e: any) {
      message.error(e?.texts || e?.message || '保存失败');
    }
  };

  const doTestTarget = async (item: EdgeTargetView) => {
    setBusy(item.id);
    try {
      const res: any = await testTarget(item.id);
      message.success(res.texts || '连接成功');
      load();
    } catch (e: any) {
      message.error(e?.texts || e?.message || '连接失败');
    } finally {
      setBusy('');
    }
  };

  const doSyncTarget = async (item: EdgeTargetView, force = false) => {
    setBusy(item.id);
    try {
      const res: any = await syncTarget(item.id, force);
      if (res.flags === 0) message.success(res.texts);
      else message.warning(res.texts);
      load();
    } catch (e: any) {
      message.error(e?.texts || e?.message || '下发失败');
    } finally {
      setBusy('');
    }
  };

  const doDeleteTarget = (item: EdgeTargetView) => {
    modal.confirm({
      title: '删除下发目标',
      content: `确认删除「${item.name}」？删除后证书不会再自动同步到该平台。`,
      okButtonProps: { danger: true },
      onOk: async () => {
        await deleteTarget(item.id);
        message.success('已删除');
        load();
      },
    });
  };

  /* --------------------------- 任务与定时 --------------------------- */

  const submitSchedule = async () => {
    const values = await scheduleForm.validateFields();
    try {
      await saveSchedule({
        enabled: values.enabled,
        interval_minutes: values.interval_minutes,
        renew_days_before: values.renew_days_before,
        jobs: values.jobs,
      });
      message.success('已保存');
      load();
    } catch (e: any) {
      message.error(e?.texts || e?.message || '保存失败');
    }
  };

  const doRunNow = async () => {
    const values = scheduleForm.getFieldsValue();
    if (!values.jobs || values.jobs.length === 0) {
      message.warning('请先勾选要执行的任务');
      return;
    }
    setBusy('run-now');
    try {
      const res: any = await runJobsNow(values.jobs);
      if (res.status === 'ok') message.success(res.texts);
      else message.warning(res.texts);
      load();
    } catch (e: any) {
      message.error(e?.texts || e?.message || '执行失败');
    } finally {
      setBusy('');
    }
  };

  /* --------------------------- 表格 --------------------------- */

  const triggerColumns: ColumnsType<TriggerDef> = [
    {
      title: '端点名称',
      dataIndex: 'name',
      render: (v: string, r) => (
        <Space size={6}>
          <Typography.Text strong>{v}</Typography.Text>
          {r.enabled ? <Tag color="green">启用</Tag> : <Tag color="red">停用</Tag>}
        </Space>
      ),
    },
    {
      title: '调用地址',
      dataIndex: 'url',
      render: (v: string) => (
        <Typography.Text
          style={{ fontSize: 12, maxWidth: 420 }}
          ellipsis={{ tooltip: v }}
          copyable={{ text: v }}
        >
          {v}
        </Typography.Text>
      ),
    },
    {
      title: '任务',
      dataIndex: 'jobs',
      width: 260,
      render: (list: string[]) => (
        <Space size={4} wrap>
          {(list || []).map((j) => (
            <Tag key={j}>{jobTitle(j)}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '最近执行',
      dataIndex: 'last_run',
      width: 200,
      render: (v: number, r) => (
        <Space direction="vertical" size={0}>
          <span>{formatTime(v)}</span>
          <Space size={4}>
            <StatusTag status={r.last_status} />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              共 {r.runs ?? 0} 次
            </Typography.Text>
          </Space>
        </Space>
      ),
    },
    {
      title: '操作',
      width: 260,
      render: (_: any, r) => (
        <Space size={4} wrap>
          <Button
            size="small"
            type="primary"
            ghost
            icon={<PlayCircleOutlined />}
            loading={busy === r.id}
            onClick={() => doRunTrigger(r)}
          >
            立即执行
          </Button>
          {(r.jobs || []).includes('cron') && (
            <Tooltip title="忽略定时任务的开关与最小间隔，立即执行一次">
              <Button
                size="small"
                icon={<ThunderboltOutlined />}
                loading={busy === r.id}
                onClick={() => doRunTrigger(r, true)}
              >
                强制
              </Button>
            </Tooltip>
          )}
          <Button size="small" icon={<EditOutlined />} onClick={() => openTrigger(r)}>
            编辑
          </Button>
          <Tooltip title="重置令牌">
            <Button size="small" icon={<ReloadOutlined />} onClick={() => doRotateToken(r)} />
          </Tooltip>
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => doDeleteTrigger(r)} />
        </Space>
      ),
    },
  ];

  const targetColumns: ColumnsType<EdgeTargetView> = [
    {
      title: '名称',
      dataIndex: 'name',
      render: (v: string, r) => (
        <Space size={6}>
          <Typography.Text strong>{v}</Typography.Text>
          <Tag color={r.type === 'edgeone' ? 'blue' : 'orange'}>
            {TARGET_TYPE_LABEL[r.type] || r.type}
          </Tag>
        </Space>
      ),
    },
    {
      title: '适用域名',
      dataIndex: 'domains',
      render: (list: string[]) =>
        list && list.length ? (
          <Space size={4} wrap>
            {list.map((d) => (
              <Tag key={d}>{d}</Tag>
            ))}
          </Space>
        ) : (
          <Typography.Text type="secondary">全部订单</Typography.Text>
        ),
    },
    {
      title: '状态',
      width: 200,
      render: (_: any, r) => (
        <Space direction="vertical" size={0}>
          <Space size={4}>
            {r.enabled ? <Tag color="green">启用</Tag> : <Tag color="red">停用</Tag>}
            {r.auto ? <Tag color="blue">自动下发</Tag> : <Tag>仅手动</Tag>}
          </Space>
          <Space size={4}>
            <StatusTag status={r.last_status} />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {formatTime(r.last_run)}
            </Typography.Text>
          </Space>
        </Space>
      ),
    },
    {
      title: '最近结果',
      dataIndex: 'last_detail',
      render: (v: string) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis={{ tooltip: v }}>
          {v || '-'}
        </Typography.Text>
      ),
    },
    {
      title: '操作',
      width: 300,
      render: (_: any, r) => (
        <Space size={4} wrap>
          <Button
            size="small"
            icon={<ExperimentOutlined />}
            loading={busy === r.id}
            onClick={() => doTestTarget(r)}
          >
            测试连接
          </Button>
          <Button
            size="small"
            type="primary"
            ghost
            icon={<CloudSyncOutlined />}
            loading={busy === r.id}
            onClick={() => doSyncTarget(r)}
          >
            补下发
          </Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => openTarget(r)}>
            编辑
          </Button>
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => doDeleteTarget(r)} />
        </Space>
      ),
    },
  ];

  const logColumns: ColumnsType<AutoLogItem> = [
    {
      title: '时间',
      dataIndex: 't',
      width: 180,
      render: (v: number) => formatTime(v),
    },
    {
      title: '来源',
      dataIndex: 'kind',
      width: 160,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: '对象',
      dataIndex: 'target',
      width: 180,
      render: (v: string, r) => v || r.order || '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v: string) => <StatusTag status={v} />,
    },
    {
      title: '详情',
      dataIndex: 'detail',
      render: (v: string) => (
        <Typography.Text style={{ fontSize: 12 }} ellipsis={{ tooltip: v }}>
          {v}
        </Typography.Text>
      ),
    },
  ];

  return (
    <PageShell>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="触发器端点：访问即执行，可完整模拟 Cloudflare 定时触发"
          description={
            <span>
              用任意外部调度器（Uptime 监控、GitHub Actions、cron-job.org 等）定时请求下面的地址，
              效果等同于 Cloudflare 定时任务。任务里勾选「模拟 Cloudflare 定时触发」时，该地址会按
              「自动任务」中配置的开关、最小间隔与任务清单执行；在地址后追加 <code>&amp;force=1</code>
              可忽略开关与间隔节流立即执行一次。Cloudflare 免费套餐每个账号仅允许 5 个 cron 触发器，
              因此推荐用这种方式驱动证书推进、自动续期与边缘证书下发。
            </span>
          }
        />

        {/* ---------------- 触发器 ---------------- */}
        <Card
          title={
            <Space>
              <ApiOutlined />
              触发器端点
            </Space>
          }
          extra={
            <Space>
              <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
                刷新
              </Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => openTrigger()}>
                新建端点
              </Button>
            </Space>
          }
        >
          <Table
            rowKey="id"
            size="small"
            loading={loading}
            columns={triggerColumns}
            dataSource={triggers}
            pagination={false}
            locale={{ emptyText: '还没有触发器端点，点击右上角新建' }}
          />
        </Card>

        {/* ---------------- 边缘下发 ---------------- */}
        <Card
          title={
            <Space>
              <CloudSyncOutlined />
              边缘证书下发
            </Space>
          }
          extra={
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openTarget()}>
              添加目标
            </Button>
          }
        >
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="证书签发或自动续期成功后会自动下发到启用的目标；下发失败不会影响证书签发，可由「补下发」或定时任务重试。"
          />
          <Table
            rowKey="id"
            size="small"
            loading={loading}
            columns={targetColumns}
            dataSource={targets}
            pagination={false}
            locale={{ emptyText: '还没有下发目标，点击右上角添加' }}
          />
        </Card>

        {/* ---------------- 自动任务 ---------------- */}
        <Card
          title={
            <Space>
              <SyncOutlined />
              自动任务
            </Space>
          }
        >
          <Form form={scheduleForm} layout="vertical">
            <Row gutter={16}>
              <Col xs={24} md={6}>
                <Form.Item
                  name="enabled"
                  label="Cloudflare 定时触发"
                  valuePropName="checked"
                  tooltip="仅在账号仍有 cron 配额时生效；没有配额时请用触发器端点"
                >
                  <Switch />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item name="interval_minutes" label="最小执行间隔（分钟）">
                  <InputNumber min={1} max={1440} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={6}>
                <Form.Item
                  name="renew_days_before"
                  label="提前续期天数"
                  tooltip="证书到期前多少天开始自动续期"
                >
                  <InputNumber min={1} max={90} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="jobs" label="执行任务">
              <Checkbox.Group options={jobOptions} />
            </Form.Item>
            <Space>
              <Button type="primary" icon={<SaveOutlined />} onClick={submitSchedule}>
                保存配置
              </Button>
              <Button
                icon={<PlayCircleOutlined />}
                loading={busy === 'run-now'}
                onClick={doRunNow}
              >
                立即执行所选任务
              </Button>
            </Space>
          </Form>
          <Divider style={{ margin: '16px 0 12px' }} />
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            {jobs.map((j) => (
              <Typography.Text key={j.id} type="secondary" style={{ fontSize: 12 }}>
                <Typography.Text strong style={{ fontSize: 12 }}>
                  {j.title}
                </Typography.Text>
                {' — '}
                {j.desc}
              </Typography.Text>
            ))}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              上次定时执行：{formatTime(schedule?.last_run)}
            </Typography.Text>
          </Space>
        </Card>

        {/* ---------------- 日志 ---------------- */}
        <Card title="执行日志" extra={<Button size="small" onClick={load}>刷新</Button>}>
          <Table
            rowKey={(r) => `${r.t}-${r.kind}-${r.detail}`}
            size="small"
            loading={loading}
            columns={logColumns}
            dataSource={log}
            pagination={{ pageSize: 10, size: 'small' }}
            locale={{ emptyText: '暂无记录' }}
          />
        </Card>
      </Space>

      {/* ---------------- 触发器弹窗 ---------------- */}
      <Modal
        title={triggerModal.item ? '编辑触发器端点' : '新建触发器端点'}
        open={triggerModal.open}
        onCancel={() => setTriggerModal({ open: false })}
        onOk={submitTrigger}
        okText="保存"
        destroyOnClose
      >
        <Form form={triggerForm} layout="vertical">
          <Form.Item
            name="name"
            label="端点名称"
            rules={[
              { required: true, message: '请输入端点名称' },
              { pattern: /^[A-Za-z0-9_-]+$/, message: '仅支持字母、数字、- 和 _' },
            ]}
            extra="调用地址为 /trigger/<名称>?token=<令牌>；勾选「模拟 Cloudflare 定时触发」后该地址即等同于 cron，追加 &force=1 可忽略节流"
          >
            <Input placeholder="acme-tasks" />
          </Form.Item>
          <Form.Item name="jobs" label="执行任务" rules={[{ required: true, message: '请选择任务' }]}>
            <Checkbox.Group options={jobOptions} />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input placeholder="例如：每小时由 Uptime 监控调用" />
          </Form.Item>
          {triggerModal.item && (
            <Form.Item name="enabled" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
        </Form>
      </Modal>

      {/* ---------------- 下发目标弹窗 ---------------- */}
      <Modal
        title={targetModal.item ? '编辑下发目标' : '添加下发目标'}
        open={targetModal.open}
        onCancel={() => setTargetModal({ open: false })}
        onOk={submitTarget}
        okText="保存"
        width={680}
        destroyOnClose
      >
        <Form form={targetForm} layout="vertical">
          <Form.Item name="type" label="平台">
            <Radio.Group
              disabled={!!targetModal.item}
              onChange={(e) => setTargetType(e.target.value)}
            >
              <Radio.Button value="edgeone">腾讯云 EdgeOne</Radio.Button>
              <Radio.Button value="esa">阿里云 ESA</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="name" label="目标名称" rules={[{ required: true, message: '请输入名称' }]}>
                <Input placeholder="例如：主站 EdgeOne" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="enabled" label="启用" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="auto" label="自动下发" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="domains"
            label="适用域名"
            extra="留空表示对所有订单生效；支持精确域名、*.example.com 通配，多个用逗号分隔"
          >
            <Input placeholder="example.com, *.example.com" />
          </Form.Item>

          {targetType === 'edgeone' ? (
            <>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    name={['edgeone', 'secret_id']}
                    label="SecretId"
                    rules={[{ required: true, message: '请输入 SecretId' }]}
                  >
                    <Input placeholder="AKID..." autoComplete="off" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    name={['edgeone', 'secret_key']}
                    label="SecretKey"
                    extra={
                      targetModal.item?.edgeone?.has_secret_key
                        ? '留空表示保持原值'
                        : undefined
                    }
                  >
                    <Input.Password placeholder="留空则保持原值" autoComplete="off" />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    name={['edgeone', 'zone_id']}
                    label="站点 ID（可选）"
                    extra="留空将按证书域名自动匹配站点"
                  >
                    <Input placeholder="zone-xxxxxxxxxxxx" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    name={['edgeone', 'hosts']}
                    label="加速域名（可选）"
                    extra="留空将按证书域名在站点内自动匹配，多个用逗号分隔"
                  >
                    <Input placeholder="www.example.com, cdn.example.com" />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name={['edgeone', 'alias']} label="证书备注名前缀（可选）">
                <Input placeholder="certhub" />
              </Form.Item>
            </>
          ) : (
            <>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    name={['esa', 'access_key_id']}
                    label="AccessKeyId"
                    rules={[{ required: true, message: '请输入 AccessKeyId' }]}
                  >
                    <Input placeholder="LTAI..." autoComplete="off" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    name={['esa', 'access_key_secret']}
                    label="AccessKeySecret"
                    extra={
                      targetModal.item?.esa?.has_access_key_secret
                        ? '留空表示保持原值'
                        : undefined
                    }
                  >
                    <Input.Password placeholder="留空则保持原值" autoComplete="off" />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    name={['esa', 'site_id']}
                    label="站点 ID（可选）"
                    extra="留空将按证书域名自动匹配站点"
                  >
                    <Input placeholder="1234567890123" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name={['esa', 'endpoint']} label="接口域名（可选）">
                    <Input placeholder="esa.aliyuncs.com" />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name={['esa', 'cert_name']} label="证书名称前缀（可选）">
                <Input placeholder="certhub" />
              </Form.Item>
            </>
          )}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {targetType === 'edgeone'
              ? '需要具备 teo:DescribeZones / teo:DescribeAccelerationDomains / teo:ModifyHostsCertificate 与 ssl:UploadCertificate 权限。'
              : '需要具备 esa:ListSites / esa:SetCertificate 权限。上传后证书会按域名自动匹配站点内的边缘证书。'}
          </Typography.Text>
        </Form>
      </Modal>
    </PageShell>
  );
}
