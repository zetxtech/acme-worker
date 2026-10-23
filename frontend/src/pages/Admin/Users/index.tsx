/**
 * 管理员 - 用户管理页面 /admin/users
 */
import { useEffect, useMemo, useState } from 'react';
import {
  App as AntdApp,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
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
  KeyOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import {
  listAdminUsers,
  updateAdminUser,
  resetAdminUserPassword,
  deleteAdminUser,
  type AdminUser,
} from '@api/admin';
import { useAuthStore } from '@stores/useAuthStore';
import { sha256 } from '@utils/crypto';

function flagLabel(flag: string) {
  switch (String(flag)) {
    case '0':
      return <Tag color="gold">未激活</Tag>;
    case '1':
      return <Tag color="green">正常</Tag>;
    case '2':
      return <Tag color="red">已禁用</Tag>;
    default:
      return <Tag>未知({flag})</Tag>;
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

export default function AdminUsersPage() {
  const { message, modal } = AntdApp.useApp();
  const self = useAuthStore((s) => s.email);

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // 过滤器
  const [mailFilter, setMailFilter] = useState('');
  const [flagFilter, setFlagFilter] = useState<string | undefined>();
  const [adminFilter, setAdminFilter] = useState<string | undefined>();

  // 编辑抽屉
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [editForm] = Form.useForm();

  // 重置密码弹窗
  const [pwdTarget, setPwdTarget] = useState<AdminUser | null>(null);
  const [pwdForm] = Form.useForm();

  const fetchList = async () => {
    setLoading(true);
    try {
      const res = await listAdminUsers({
        page,
        page_size: pageSize,
        mail: mailFilter || undefined,
        flag: flagFilter,
        is_admin:
          adminFilter === '1' ? 1 : adminFilter === '0' ? 0 : undefined,
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

  const openEdit = (u: AdminUser) => {
    setEditing(u);
    editForm.setFieldsValue({
      flag: u.flag,
      is_admin: u.is_admin,
      quota: u.quota,
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      const v = await editForm.validateFields();
      if (
        self &&
        editing.mail.toLowerCase() === self.toLowerCase() &&
        Number(v.is_admin) === 0
      ) {
        message.warning('不能取消自身的管理员身份');
        return;
      }
      const res: any = await updateAdminUser(editing.mail, {
        flag: String(v.flag),
        is_admin: Number(v.is_admin) === 1 ? 1 : 0,
        quota: Number(v.quota),
      });
      if (res?.flags === 0) {
        message.success('已保存');
        setEditing(null);
        fetchList();
      } else {
        message.error(res?.texts || '保存失败');
      }
    } catch (e: any) {
      if (e?.errorFields) return; // 表单校验失败
      message.error(e?.texts || e?.message || '保存失败');
    }
  };

  const openPwd = (u: AdminUser) => {
    setPwdTarget(u);
    pwdForm.resetFields();
  };

  const savePwd = async () => {
    if (!pwdTarget) return;
    try {
      const v = await pwdForm.validateFields();
      if (v.pass !== v.confirm) {
        message.error('两次输入的密码不一致');
        return;
      }
      const hashed = await sha256(v.pass);
      const res: any = await resetAdminUserPassword(pwdTarget.mail, hashed);
      if (res?.flags === 0) {
        message.success('密码已重置，请线下告知用户新密码');
        setPwdTarget(null);
      } else {
        message.error(res?.texts || '重置失败');
      }
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.texts || e?.message || '重置失败');
    }
  };

  const confirmDelete = (u: AdminUser) => {
    let inputVal = '';
    modal.confirm({
      title: `删除用户 ${u.mail}`,
      content: (
        <div>
          <p style={{ color: '#b45309' }}>
            此操作将不可恢复，同时会删除该用户名下的所有证书申请记录。
          </p>
          <p>请在下方输入目标邮箱以确认：</p>
          <Input
            placeholder={u.mail}
            onChange={(e) => (inputVal = e.target.value.trim())}
          />
        </div>
      ),
      okType: 'danger',
      okText: '确认删除',
      onOk: async () => {
        if (inputVal.toLowerCase() !== u.mail.toLowerCase()) {
          message.error('输入的邮箱与目标不匹配');
          throw new Error('mismatch');
        }
        try {
          const res: any = await deleteAdminUser(u.mail, inputVal);
          if (res?.flags === 0) {
            message.success('已删除');
            fetchList();
          } else {
            message.error(res?.texts || '删除失败');
            throw new Error(res?.texts);
          }
        } catch (e: any) {
          throw e;
        }
      },
    });
  };

  const columns: ColumnsType<AdminUser> = useMemo(
    () => [
      {
        title: '邮箱',
        dataIndex: 'mail',
        key: 'mail',
        render: (v: string, r) => (
          <Space size={6}>
            <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>{v}</span>
            {r.is_admin === 1 && <Tag color="purple">管理员</Tag>}
            {self && v.toLowerCase() === self.toLowerCase() && (
              <Tag color="blue">自己</Tag>
            )}
          </Space>
        ),
      },
      {
        title: '状态',
        dataIndex: 'flag',
        key: 'flag',
        width: 88,
        render: (v: string) => flagLabel(v),
      },
      {
        title: '配额',
        dataIndex: 'quota',
        key: 'quota',
        width: 80,
        render: (v: number) => (v < 0 ? <Tag>不限</Tag> : v),
      },
      {
        title: '有效证书',
        dataIndex: 'active_certs',
        key: 'active_certs',
        width: 90,
      },
      {
        title: '当月申请',
        dataIndex: 'month_applies',
        key: 'month_applies',
        width: 90,
      },
      {
        title: '注册时间',
        dataIndex: 'time',
        key: 'time',
        width: 180,
        render: (v) => formatTime(v),
      },
      {
        title: '操作',
        key: 'ops',
        width: 220,
        render: (_v, r) => (
          <Space size={2} wrap>
            <Tooltip title="编辑">
              <Button
                size="small"
                type="text"
                icon={<EditOutlined />}
                onClick={() => openEdit(r)}
              />
            </Tooltip>
            <Tooltip title="重置密码">
              <Button
                size="small"
                type="text"
                icon={<KeyOutlined />}
                onClick={() => openPwd(r)}
              />
            </Tooltip>
            <Tooltip title="删除">
              <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={() => confirmDelete(r)}
              />
            </Tooltip>
          </Space>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [self],
  );

  return (
    <div style={{ padding: 24 }}>
      <Space
        className="toolbarRow"
        style={{ marginBottom: 16, flexWrap: 'wrap' }}
        size={8}
      >
        <Input
          allowClear
          style={{ width: 240 }}
          prefix={<SearchOutlined />}
          placeholder="按邮箱模糊搜索"
          value={mailFilter}
          onChange={(e) => setMailFilter(e.target.value)}
          onPressEnter={onSearch}
        />
        <Radio.Group
          value={flagFilter ?? ''}
          onChange={(e) => setFlagFilter(e.target.value || undefined)}
          optionType="button"
          buttonStyle="solid"
        >
          <Radio.Button value="">全部状态</Radio.Button>
          <Radio.Button value="0">未激活</Radio.Button>
          <Radio.Button value="1">正常</Radio.Button>
          <Radio.Button value="2">已禁用</Radio.Button>
        </Radio.Group>
        <Radio.Group
          value={adminFilter ?? ''}
          onChange={(e) => setAdminFilter(e.target.value || undefined)}
          optionType="button"
          buttonStyle="solid"
        >
          <Radio.Button value="">全部用户</Radio.Button>
          <Radio.Button value="1">仅管理员</Radio.Button>
          <Radio.Button value="0">仅普通用户</Radio.Button>
        </Radio.Group>
        <Button type="primary" icon={<SearchOutlined />} onClick={onSearch}>
          查询
        </Button>
        <Button icon={<ReloadOutlined />} onClick={() => fetchList()}>
          刷新
        </Button>
      </Space>

      <Table<AdminUser>
        rowKey="mail"
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
        scroll={{ x: 1000 }}
      />

      {/* 编辑抽屉 ===================================================== */}
      <Drawer
        open={!!editing}
        title={editing ? `编辑用户 · ${editing.mail}` : ''}
        onClose={() => setEditing(null)}
        width={420}
        destroyOnClose
        footer={
          <Space style={{ float: 'right' }}>
            <Button onClick={() => setEditing(null)}>取消</Button>
            <Button type="primary" onClick={saveEdit}>
              保存
            </Button>
          </Space>
        }
      >
        <Form form={editForm} layout="vertical">
          <Form.Item
            label="账号状态"
            name="flag"
            rules={[{ required: true }]}
          >
            <Radio.Group optionType="button" buttonStyle="solid">
              <Radio.Button value="0">未激活</Radio.Button>
              <Radio.Button value="1">正常</Radio.Button>
              <Radio.Button value="2">已禁用</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item
            label="是否管理员"
            name="is_admin"
            rules={[{ required: true }]}
          >
            <Radio.Group optionType="button" buttonStyle="solid">
              <Radio.Button value={0}>否</Radio.Button>
              <Radio.Button value={1}>是</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item
            label="证书配额（-1 表示不限制）"
            name="quota"
            rules={[{ required: true, type: 'number', min: -1 }]}
          >
            <InputNumber style={{ width: '100%' }} min={-1} />
          </Form.Item>
        </Form>
      </Drawer>

      {/* 重置密码弹窗 ================================================ */}
      <Modal
        open={!!pwdTarget}
        title={pwdTarget ? `重置密码 · ${pwdTarget.mail}` : ''}
        onCancel={() => setPwdTarget(null)}
        onOk={savePwd}
        okText="确定重置"
        destroyOnClose
      >
        <Form form={pwdForm} layout="vertical">
          <Form.Item
            label="新密码"
            name="pass"
            rules={[{ required: true, min: 8, message: '至少 8 位' }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            label="再次输入"
            name="confirm"
            dependencies={['pass']}
            rules={[
              { required: true, message: '请再次输入新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('pass') === value)
                    return Promise.resolve();
                  return Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <p style={{ color: '#6b7280', fontSize: 12 }}>
            密码仅会以 SHA256 形式存储，请通过线下安全渠道告知用户。
          </p>
        </Form>
      </Modal>
    </div>
  );
}
