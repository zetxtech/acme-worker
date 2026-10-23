/**
 * API 文档页面 /account/apidoc
 *
 * 严格禁止直接在页面上渲染明文 token；仅通过「显示一次」交互临时展示 30s。
 */
import { useEffect, useRef, useState } from 'react';
import {
  App as AntdApp,
  Alert,
  Button,
  Card,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { CopyOutlined, EyeOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  fetchApiTokenInfo,
  rotateApiToken,
  type ApiTokenInfo,
} from '@api/account';

const { Paragraph, Text } = Typography;

const ENDPOINTS: Array<{
  method: string;
  path: string;
  desc: string;
}> = [
  { method: 'POST', path: '/api/v1/orders', desc: '提交证书申请' },
  { method: 'GET', path: '/api/v1/orders', desc: '列出订单' },
  { method: 'GET', path: '/api/v1/orders/:uuid', desc: '查询单个订单' },
  { method: 'GET', path: '/api/v1/orders/:uuid/pem', desc: '下载 fullchain+privkey（JSON）' },
  { method: 'GET', path: '/api/v1/orders/:uuid/zip', desc: '下载证书压缩包' },
  { method: 'GET', path: '/api/v1/orders/:uuid/pfx', desc: '下载 PFX（密码在 X-PFX-Password 头）' },
  { method: 'POST', path: '/api/v1/orders/:uuid/revoke', desc: '吊销证书' },
];

const ERROR_CODES: Array<{ code: string; status: number; desc: string }> = [
  { code: 'UNAUTHORIZED', status: 401, desc: '鉴权失败或缺少鉴权头' },
  { code: 'ACCOUNT_INACTIVE', status: 403, desc: '账号未激活或已禁用' },
  { code: 'CAPTCHA_REQUIRED', status: 403, desc: '站点开启人机验证，开放 API 的提交类接口被禁用' },
  { code: 'MONTHLY_LIMIT_EXCEEDED', status: 429, desc: '本月申请次数已达上限' },
  { code: 'QUOTA_EXCEEDED', status: 403, desc: '已达到证书配额上限' },
  { code: 'RATE_LIMITED', status: 429, desc: '请求过于频繁（默认 60 次/分钟）' },
  { code: 'NOT_FOUND', status: 404, desc: '订单不存在或无权访问' },
  { code: 'NOT_READY', status: 404, desc: '证书尚未签发或已被清除' },
  { code: 'BAD_REQUEST', status: 400, desc: '请求格式非法' },
  { code: 'REVOKE_FAILED', status: 500, desc: 'CA 吊销失败（详见 message）' },
];

function curlSample(mail: string, path: string): string {
  const base = typeof window !== 'undefined' ? window.location.origin : 'https://your-site';
  return [
    `curl -X POST "${base}${path}" \\`,
    `  -H "X-API-Mail: ${mail || 'you@example.com'}" \\`,
    `  -H "X-API-Token: <your-api-token>" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"domains":[{"name":"example.com","type":"dns-self"}],"globals":{"ca":"lets-encrypt","encryption":"eccp256"}}'`,
  ].join('\n');
}

export default function ApiDocPage() {
  const { message, modal } = AntdApp.useApp();
  const [info, setInfo] = useState<ApiTokenInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [revealedToken, setRevealedToken] = useState<string>('');
  const revealTimerRef = useRef<number | null>(null);

  const loadInfo = async () => {
    setLoading(true);
    try {
      const res = await fetchApiTokenInfo(false);
      setInfo(res);
    } catch (e: any) {
      message.error(e?.texts || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInfo();
    return () => {
      if (revealTimerRef.current) window.clearTimeout(revealTimerRef.current);
    };
  }, []);

  const doReveal = async () => {
    try {
      const r = await fetchApiTokenInfo(true);
      if (r.token) {
        setRevealedToken(r.token);
        // 30 秒后自动隐藏
        if (revealTimerRef.current) window.clearTimeout(revealTimerRef.current);
        revealTimerRef.current = window.setTimeout(() => {
          setRevealedToken('');
        }, 30_000);
      } else {
        message.info('尚未生成 API token');
      }
    } catch (e: any) {
      message.error(e?.texts || '读取失败');
    }
  };

  const doRotate = () => {
    modal.confirm({
      title: '重置 API Token？',
      content:
        '重置后旧 token 将立即失效，当前正在使用该 token 的自动化任务会出现 401 错误，请谨慎操作。',
      okType: 'danger',
      onOk: async () => {
        try {
          const r = await rotateApiToken();
          message.success('已重置，下面展示一次新 token，请立即复制保存');
          setRevealedToken(r.token);
          if (revealTimerRef.current) window.clearTimeout(revealTimerRef.current);
          revealTimerRef.current = window.setTimeout(() => {
            setRevealedToken('');
          }, 30_000);
          loadInfo();
        } catch (e: any) {
          message.error(e?.texts || '重置失败');
        }
      },
    });
  };

  const copyCurl = async (path: string) => {
    try {
      await navigator.clipboard.writeText(curlSample(info?.mail ?? '', path));
      message.success('已复制示例 curl 到剪贴板');
    } catch {
      message.error('浏览器不支持复制');
    }
  };

  const baseUrl =
    typeof window !== 'undefined' ? window.location.origin : 'https://your-site';

  return (
    <div style={{ padding: 24, maxWidth: 980, margin: '0 auto' }}>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        API 文档
      </Typography.Title>
      <Paragraph>
        通过开放 API，你可以将证书申请与下载接入到 CI / 自动化脚本中。
        所有接口走 HTTPS，鉴权使用 <Text code>X-API-Mail</Text> 与{' '}
        <Text code>X-API-Token</Text>。
      </Paragraph>

      {/* 鉴权卡片 ============================================ */}
      <Card
        title="我的 API 凭证"
        style={{ marginBottom: 16 }}
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={loadInfo} loading={loading}>
              刷新
            </Button>
            <Button danger onClick={doRotate}>
              重置 Token
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div>
            <Text type="secondary">邮箱（X-API-Mail）：</Text>
            <Text copyable code>{info?.mail || '-'}</Text>
          </div>
          <div>
            <Text type="secondary">Token 指纹：</Text>
            {info?.configured ? (
              <Tag color="green">{info.fingerprint}</Tag>
            ) : (
              <Tag color="default">未生成</Tag>
            )}
            <Button
              size="small"
              icon={<EyeOutlined />}
              onClick={doReveal}
              disabled={!info?.configured}
              style={{ marginLeft: 8 }}
            >
              显示一次（30 秒）
            </Button>
          </div>
          {revealedToken && (
            <Alert
              type="warning"
              showIcon
              message="仅本次会话可见"
              description={
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  <Paragraph
                    copyable={{ text: revealedToken }}
                    style={{
                      fontFamily: 'var(--font-mono, monospace)',
                      margin: 0,
                      wordBreak: 'break-all',
                    }}
                  >
                    {revealedToken}
                  </Paragraph>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    将在 30 秒后自动隐藏。
                  </Text>
                </Space>
              }
            />
          )}
        </Space>
      </Card>

      {/* 基础信息 ============================================ */}
      <Card title="基础信息" style={{ marginBottom: 16 }}>
        <Paragraph>
          基础 URL：<Text copyable code>{baseUrl}</Text>
        </Paragraph>
        <Paragraph>
          鉴权方式（任选其一）：
        </Paragraph>
        <Paragraph>
          <Text code>X-API-Mail: you@example.com</Text>
          <br />
          <Text code>X-API-Token: &lt;your-api-token&gt;</Text>
        </Paragraph>
        <Paragraph>或</Paragraph>
        <Paragraph>
          <Text code>Authorization: Bearer you@example.com:&lt;your-api-token&gt;</Text>
        </Paragraph>
        <Paragraph>
          速率限制默认 60 次/分钟，可由管理员在「系统管理 → 开放 API」中调整。
        </Paragraph>
      </Card>

      {/* 端点列表 ============================================ */}
      <Card title="端点" style={{ marginBottom: 16 }}>
        <Table
          rowKey={(r) => `${r.method}_${r.path}`}
          pagination={false}
          dataSource={ENDPOINTS}
          columns={[
            {
              title: '方法',
              dataIndex: 'method',
              width: 80,
              render: (v) => (
                <Tag color={v === 'GET' ? 'blue' : v === 'POST' ? 'green' : 'default'}>
                  {v}
                </Tag>
              ),
            },
            {
              title: '路径',
              dataIndex: 'path',
              render: (v) => <Text code>{v}</Text>,
            },
            { title: '说明', dataIndex: 'desc' },
            {
              title: '',
              key: 'curl',
              width: 130,
              align: 'center',
              render: (_v, r) => (
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => copyCurl(r.path)}
                >
                  复制 curl
                </Button>
              ),
            },
          ]}
        />
      </Card>

      {/* 错误码 ============================================ */}
      <Card title="错误码表" style={{ marginBottom: 16 }}>
        <Table
          rowKey="code"
          pagination={false}
          dataSource={ERROR_CODES}
          columns={[
            {
              title: 'code',
              dataIndex: 'code',
              width: 260,
              render: (v) => <Text code>{v}</Text>,
            },
            { title: 'HTTP', dataIndex: 'status', width: 80 },
            { title: '说明', dataIndex: 'desc' },
          ]}
        />
      </Card>
    </div>
  );
}
