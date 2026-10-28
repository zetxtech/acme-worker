/**
 * 管理员 - 系统管理 /admin/system
 * 分组：
 *   - 站点
 *   - 邮件
 *   - 通知开关
 *   - 注册策略
 *   - 默认变量（vars 覆盖）
 *   - 防滥用（Captcha / 月度上限）
 *   - 开放 API
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Checkbox,
  Col,
  Divider,
  Input,
  InputNumber,
  Modal,
  Row,
  Radio,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  DeleteOutlined,
  ExperimentOutlined,
  ReloadOutlined,
  SaveOutlined,
  SendOutlined,
} from '@ant-design/icons';
import {
  fetchAdminConfs,
  saveAdminConf,
  deleteAdminConf,
  testMail,
  testCaptcha,
} from '@api/adminConfs';
import { useBootstrapStore } from '@stores/useBootstrapStore';
import { configureDcv, fetchCapabilities, type DcvState } from '@api/resources';
import styles from './System.module.css';

type Items = Record<string, any>;
type Touched = Record<string, boolean>;

/** 一个统一的"保存/回退"按钮组 */
function ItemActions({
  name,
  disabled,
  onSave,
  onReset,
}: {
  name: string;
  disabled?: boolean;
  onSave: () => void;
  onReset: () => void;
}) {
  return (
    <Space size={4}>
      <Tooltip title="保存此项">
        <Button
          size="small"
          type="text"
          icon={<SaveOutlined />}
          disabled={disabled}
          onClick={onSave}
        />
      </Tooltip>
      <Tooltip title={`回退到环境变量 / 默认值（删除 Confs.${name}）`}>
        <Button
          size="small"
          type="text"
          danger
          icon={<DeleteOutlined />}
          onClick={onReset}
        />
      </Tooltip>
    </Space>
  );
}

function isBoolString(v: any): boolean {
  if (typeof v === 'boolean') return true;
  const s = String(v).toLowerCase();
  return s === 'true' || s === 'false' || s === '1' || s === '0';
}

function toBool(v: any): boolean {
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'on';
}

export default function AdminSystemPage() {
  const { message, modal } = AntdApp.useApp();
  const refreshBootstrap = useBootstrapStore((s) => s.refresh);

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Items>({});
  const [secretKeys, setSecretKeys] = useState<Set<string>>(new Set());
  const [configuredSecrets, setConfiguredSecrets] = useState<Record<string, boolean>>({});
  const [dirty, setDirty] = useState<Touched>({});

  // DCV 托管设置向导
  const [dcv, setDcv] = useState<DcvState>();
  const [dcvOpen, setDcvOpen] = useState(false);
  const [dcvBusy, setDcvBusy] = useState(false);
  const [dcvDomain, setDcvDomain] = useState('');
  const [dcvToken, setDcvToken] = useState('');
  const [dcvConfirm, setDcvConfirm] = useState(false);
  const [dcvError, setDcvError] = useState('');

  const loadDcv = async () => {
    try {
      const result: any = await fetchCapabilities();
      if (result.flags === 0) setDcv(result.dcv);
    } catch { /* 保留上一次状态 */ }
  };

  const saveDcv = async () => {
    setDcvError('');
    if (!dcvDomain.trim()) { setDcvError('请填写托管域名'); return; }
    if (!dcvConfirm) { setDcvError('请先确认允许临时 TXT 写入与清理'); return; }
    setDcvBusy(true);
    try {
      const result = await configureDcv({ domain: dcvDomain.trim(), token: dcvToken.trim() || undefined, confirmWrite: true });
      setDcv(result.dcv);
      setDcvOpen(false);
      message.success('DCV 托管已启用');
    } catch (e: any) {
      setDcvError(e?.texts || e?.message || '启用失败，请检查 Token 权限');
    } finally { setDcvBusy(false); }
  };

  // 邮件测试弹窗
  const [mailTestOpen, setMailTestOpen] = useState(false);
  const [mailTo, setMailTo] = useState('');
  const [mailTesting, setMailTesting] = useState(false);

  // 验证码测试弹窗
  const [captchaTestOpen, setCaptchaTestOpen] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaTesting, setCaptchaTesting] = useState(false);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const res = await fetchAdminConfs();
      if (res.flags === 0) {
        setItems(res.items);
        setSecretKeys(new Set(res.secret_keys));
        setConfiguredSecrets(Object.fromEntries(res.secret_keys.map((key) => [key, !!res.items[key]?.configured])));
        setDirty({});
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
    fetchAll();
    void loadDcv();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markDirty = (name: string, value: any) => {
    setItems((prev) => ({ ...prev, [name]: value }));
    setDirty((prev) => ({ ...prev, [name]: true }));
  };

  const onSaveOne = async (name: string) => {
    try {
      const raw = items[name];
      const res: any = await saveAdminConf(name, raw);
      if (res?.flags === 0) {
        message.success(`${name} 已保存`);
        setDirty((prev) => ({ ...prev, [name]: false }));
        if (secretKeys.has(name) && String(raw ?? '').trim()) {
          setConfiguredSecrets((prev) => ({...prev, [name]: true}));
          setItems((prev) => ({...prev, [name]: {configured: true}}));
        }
        // 若保存影响 bootstrap 返回值（站点标题、邮件开关、验证码、注册策略）
        refreshBootstrap();
      } else {
        message.error(res?.texts || '保存失败');
      }
    } catch (e: any) {
      message.error(e?.texts || e?.message || '保存失败');
    }
  };

  const onResetOne = (name: string) => {
    modal.confirm({
      title: `回退 ${name}？`,
      content: '将删除数据库中该项配置，回退到环境变量或代码默认值。',
      okType: 'danger',
      onOk: async () => {
        const res: any = await deleteAdminConf(name);
        if (res?.flags === 0) {
          message.success('已回退');
          fetchAll();
          refreshBootstrap();
        } else {
          message.error(res?.texts || '回退失败');
        }
      },
    });
  };

  /** 渲染 boolean 项 */
  const renderBool = (name: string, label: string, help?: string) => {
    const val = toBool(items[name]);
    return (
      <Row className={styles.settingRow} data-setting={name} align="middle" gutter={12} style={{ marginBottom: 12 }}>
        <Col flex="220px">
          <Space>
            <span>{label}</span>
            {dirty[name] && <Tag color="gold">未保存</Tag>}
          </Space>
          {help && (
            <div style={{ fontSize: 12, color: '#6b7280' }}>{help}</div>
          )}
        </Col>
        <Col flex="auto">
          <Switch
            checked={val}
            onChange={(v) => markDirty(name, v)}
          />
        </Col>
        <Col>
          <ItemActions
            name={name}
            disabled={!dirty[name]}
            onSave={() => onSaveOne(name)}
            onReset={() => onResetOne(name)}
          />
        </Col>
      </Row>
    );
  };

  /** 渲染字符串项 */
  const renderText = (
    name: string,
    label: string,
    opts?: { help?: string; placeholder?: string; textarea?: boolean },
  ) => {
    const isSecret = secretKeys.has(name);
    const configured = configuredSecrets[name] ?? false;
    const val = isSecret ? dirty[name] && typeof items[name] === 'string' ? items[name] : '' : (items[name] ?? '');
    const placeholder = isSecret ? configured ? '已配置，留空保留现有值' : '未配置，请填写'
      : opts?.placeholder || '未配置';
    return (
      <Row className={styles.settingRow} data-setting={name} align="top" gutter={12} style={{ marginBottom: 12 }}>
        <Col flex="220px">
          <Space>
            <label htmlFor={`setting-${name}`}>{label}</label>
            {dirty[name] && <Tag color="gold">未保存</Tag>}
          </Space>
          {opts?.help && (
            <div style={{ fontSize: 12, color: '#6b7280' }}>{opts.help}</div>
          )}
        </Col>
        <Col flex="auto">
          {opts?.textarea ? (
            <Input.TextArea
              id={`setting-${name}`}
              rows={3}
              value={val}
              placeholder={placeholder}
              onChange={(e) => markDirty(name, e.target.value)}
            />
          ) : isSecret ? (
            <Input.Password
              id={`setting-${name}`}
              value={val}
              placeholder={placeholder}
              onChange={(e) => markDirty(name, e.target.value)}
              autoComplete="off"
            />
          ) : (
            <Input
              id={`setting-${name}`}
              value={val}
              placeholder={placeholder}
              onChange={(e) => markDirty(name, e.target.value)}
              autoComplete="off"
            />
          )}
        </Col>
        <Col>
          <ItemActions
            name={name}
            disabled={!dirty[name]}
            onSave={() => onSaveOne(name)}
            onReset={() => onResetOne(name)}
          />
        </Col>
      </Row>
    );
  };

  /** 渲染 number 项 */
  const renderNumber = (
    name: string,
    label: string,
    opts?: { help?: string; min?: number; max?: number },
  ) => {
    const val = Number(items[name] ?? 0);
    return (
      <Row className={styles.settingRow} data-setting={name} align="middle" gutter={12} style={{ marginBottom: 12 }}>
        <Col flex="220px">
          <Space>
            <span>{label}</span>
            {dirty[name] && <Tag color="gold">未保存</Tag>}
          </Space>
          {opts?.help && (
            <div style={{ fontSize: 12, color: '#6b7280' }}>{opts.help}</div>
          )}
        </Col>
        <Col flex="auto">
          <InputNumber
            value={val}
            min={opts?.min}
            max={opts?.max}
            style={{ width: 200 }}
            onChange={(v) => markDirty(name, v)}
          />
        </Col>
        <Col>
          <ItemActions
            name={name}
            disabled={!dirty[name]}
            onSave={() => onSaveOne(name)}
            onReset={() => onResetOne(name)}
          />
        </Col>
      </Row>
    );
  };

  /** 渲染单选项 */
  const renderSelect = (
    name: string,
    label: string,
    options: { value: string; label: string }[],
    help?: string,
  ) => {
    const val = String(items[name] ?? '');
    return (
      <Row className={styles.settingRow} data-setting={name} align="middle" gutter={12} style={{ marginBottom: 12 }}>
        <Col flex="220px">
          <Space>
            <span>{label}</span>
            {dirty[name] && <Tag color="gold">未保存</Tag>}
          </Space>
          {help && <div style={{ fontSize: 12, color: '#6b7280' }}>{help}</div>}
        </Col>
        <Col flex="auto">
          <Radio.Group
            value={val}
            onChange={(e) => markDirty(name, e.target.value)}
            optionType="button"
            buttonStyle="solid"
          >
            {options.map((o) => (
              <Radio.Button key={o.value} value={o.value}>{o.label}</Radio.Button>
            ))}
          </Radio.Group>
        </Col>
        <Col>
          <ItemActions
            name={name}
            disabled={!dirty[name]}
            onSave={() => onSaveOne(name)}
            onReset={() => onResetOne(name)}
          />
        </Col>
      </Row>
    );
  };

  /** 关闭邮件功能前的二次确认 */
  const handleMailEnabledSave = async () => {
    const next = toBool(items.MAIL_ENABLED);
    if (!next) {
      modal.confirm({
        title: '确认关闭邮箱功能？',
        content:
          '关闭后将停用：注册验证码、密码重置验证码、以及全部证书状态通知邮件。',
        okType: 'danger',
        onOk: () => onSaveOne('MAIL_ENABLED'),
      });
    } else {
      onSaveOne('MAIL_ENABLED');
    }
  };

  const doMailTest = async () => {
    if (!mailTo.trim()) {
      message.error('请输入收件地址');
      return;
    }
    setMailTesting(true);
    try {
      const res: any = await testMail(mailTo.trim());
      if (res?.flags === 0) message.success('测试邮件已发送，请查收');
      else message.error(res?.texts || '发送失败');
    } catch (e: any) {
      message.error(e?.texts || e?.message || '发送失败');
    } finally {
      setMailTesting(false);
    }
  };

  const doCaptchaTest = async () => {
    if (!captchaToken.trim()) {
      message.error('请先在其它标签页获取一次验证码 token 并粘贴到此处');
      return;
    }
    setCaptchaTesting(true);
    try {
      const res: any = await testCaptcha(captchaToken.trim());
      if (res?.flags === 0) message.success('验证通过');
      else {
        const codes = (res?.provider_error_codes ?? []).join(', ');
        message.error(
          '验证失败' + (codes ? ` · provider 错误码：${codes}` : ''),
        );
      }
    } catch (e: any) {
      message.error(e?.texts || e?.message || '测试失败');
    } finally {
      setCaptchaTesting(false);
    }
  };

  const mailEnabledBtnSave = useMemo(
    () => (
      <Button
        size="small"
        type="text"
        icon={<SaveOutlined />}
        disabled={!dirty.MAIL_ENABLED}
        onClick={handleMailEnabledSave}
      />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dirty.MAIL_ENABLED, items.MAIL_ENABLED],
  );

  return (
    <div className={styles.page}>
      <Space style={{ marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          系统管理
        </Typography.Title>
        <Button icon={<ReloadOutlined />} onClick={fetchAll} loading={loading}>
          刷新
        </Button>
      </Space>

      {/* 站点 =================================================== */}
      <Card title="站点" style={{ marginBottom: 16 }}>
        {renderText('SITE_TITLE', '站点标题', {
          help: '显示于侧边栏与浏览器标签',
        })}
        {renderText('SITE_HOST', '站点域名', {
          help: '用于邮件与前端链接生成',
        })}
      </Card>

      {/* 邮件 =================================================== */}
      <Card title="邮件" style={{ marginBottom: 16 }}>
        <Row className={styles.settingRow} align="middle" gutter={12} style={{ marginBottom: 12 }}>
          <Col flex="220px">
            <Space>
              <span>启用邮箱功能</span>
              {dirty.MAIL_ENABLED && <Tag color="gold">未保存</Tag>}
            </Space>
            <div style={{ fontSize: 12, color: '#6b7280' }}>
              关闭将禁用验证码与所有邮件通知
            </div>
          </Col>
          <Col flex="auto">
            <Switch
              checked={toBool(items.MAIL_ENABLED)}
              onChange={(v) => markDirty('MAIL_ENABLED', v)}
            />
          </Col>
          <Col>
            <Space>
              {mailEnabledBtnSave}
              <Tooltip title="回退到环境变量 / 默认值">
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => onResetOne('MAIL_ENABLED')}
                />
              </Tooltip>
            </Space>
          </Col>
        </Row>

        {renderText('MAIL_KEYS', 'Resend API Key', {
          help: '对应环境变量 MAIL_KEYS（Resend 控制台生成）',
        })}
        {renderText('MAIL_SEND', '发件地址', {
          placeholder: 'noreply@your-domain.com',
          help: '对应环境变量 MAIL_SEND',
        })}
        <Divider style={{ margin: '12px 0' }} />
        {renderBool(
          'NOTIFY_ON_SUCCESS',
          '证书签发成功通知',
          'flag 变为 5 时发送',
        )}
        {renderBool('NOTIFY_ON_FAIL', '证书签发失败通知')}
        {renderBool('NOTIFY_ON_EXPIRE7', '证书过期前 7 天提醒')}
        {renderBool('NOTIFY_ON_EXPIRED', '证书已过期通知')}
        <Divider style={{ margin: '12px 0' }} />
        <Button
          icon={<SendOutlined />}
          onClick={() => setMailTestOpen(true)}
        >
          发送测试邮件
        </Button>
      </Card>

      {/* 注册策略 =================================================== */}
      <Card title="注册策略" style={{ marginBottom: 16 }}>
        {renderBool(
          'REGISTER_ALLOW',
          '允许注册',
          '关闭后登录页将隐藏注册 Tab',
        )}
        {renderText('REGISTER_CODE', '注册邀请码', {
          help: '留空表示不校验邀请码',
        })}
        {renderNumber('DEFAULT_QUOTA', '新用户默认配额', {
          min: -1,
          help: '-1 表示不限制；修改不影响存量用户',
        })}
      </Card>

      {/* DCV（Cloudflare DNS 代理）============================= */}
      <Card
        title="DCV 托管（Cloudflare DNS 代理）"
        style={{ marginBottom: 16 }}
        extra={
          <Button
            onClick={() => {
              setDcvDomain(dcv?.domain || '');
              setDcvToken('');
              setDcvConfirm(false);
              setDcvError('');
              setDcvOpen(true);
            }}
          >
            {dcv?.available ? '重新配置' : '启用 DCV 托管'}
          </Button>
        }
      >
        <Alert
          type={dcv?.available ? 'success' : 'warning'}
          showIcon
          style={{ marginBottom: 12 }}
          message={
            dcv?.available
              ? `已启用：委派域名 ${dcv.domain}`
              : '未启用：申请页的「DCV 托管」验证方式不可选'
          }
          description={
            dcv?.available
              ? '用户只需首次添加一次 CNAME，后续续期由平台自动维护验证记录。'
              : '配置一个专用子域名后，用户首次添加一次 CNAME 即可自动续期，不必反复添加 TXT 记录。'
          }
        />
        {renderText('DCV_AGENT', 'DCV_AGENT', {
          help: '用于 dns-auto 模式下的验证子域后缀，由上方设置向导自动填写',
        })}
        {renderText('DCV_ZONES', 'DCV_ZONES', {
          help: '托管 DCV 子域的 Zone ID，由设置向导自动识别',
        })}
        {renderText('DCV_EMAIL', 'DCV_EMAIL', {
          help: '仅旧版 Global API Key 方式需要；使用 API Token 时留空',
        })}
        {renderText('DCV_TOKEN', 'DCV_TOKEN', {
          help: '仅旧版 Global API Key 方式需要；使用 API Token 时留空',
        })}
      </Card>

      <Modal
        open={dcvOpen}
        title="启用 DCV 托管"
        onCancel={() => { if (!dcvBusy) setDcvOpen(false); }}
        onOk={() => void saveDcv()}
        confirmLoading={dcvBusy}
        okText="启用"
        cancelText="取消"
        closable={!dcvBusy}
        maskClosable={!dcvBusy}
        cancelButtonProps={{ disabled: dcvBusy }}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="建议使用专用子域名（如 dcv.example.com）"
          description="启用时会先在该子域名下写入并清理一条测试 TXT 记录，确认 Token 具备权限后才保存，不会影响其他记录。"
        />
        <Row className={styles.dialogRow} align="middle" gutter={12} style={{ marginBottom: 12 }}>
          <Col flex="120px">托管域名</Col>
          <Col flex="auto">
            <Input value={dcvDomain} onChange={(e) => setDcvDomain(e.target.value)} placeholder="dcv.example.com" maxLength={253} />
          </Col>
        </Row>
        <Row className={styles.dialogRow} align="middle" gutter={12} style={{ marginBottom: 12 }}>
          <Col flex="120px">
            API Token
            <Tooltip title="Cloudflare 控制台 → 我的个人资料 → API 令牌 → 创建令牌 → 选择「编辑区域 DNS」模板；权限需包含 Zone Read（读取区域）与 DNS Edit（编辑 DNS）；资源限制到该子域名所在的区域。页面只显示一次 Token，请及时复制。">
              <span style={{ marginLeft: 4, cursor: 'help' }}>?</span>
            </Tooltip>
          </Col>
          <Col flex="auto">
            <Input.Password value={dcvToken} onChange={(e) => setDcvToken(e.target.value)} placeholder={dcv?.available ? '留空则保留现有 Token' : '粘贴 Cloudflare DNS API Token'} autoComplete="new-password" />
          </Col>
        </Row>
        {dcvError && <Alert type="error" showIcon style={{ marginBottom: 12 }} message={dcvError} />}
        <Checkbox checked={dcvConfirm} onChange={(e) => setDcvConfirm(e.target.checked)}>
          允许临时写入并清理 TXT 记录以验证权限
        </Checkbox>
      </Modal>

      {/* 证书提供商 · 三家 CA ==================================== */}
      <Card
        title="证书提供商（CA）"
        style={{ marginBottom: 16 }}
        extra={
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            EAB 仅在首次注册账户时使用；*_KeyTS 留空时自动生成并保存，请勿更换
          </Typography.Text>
        }
      >
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          Google Trust Services
        </Typography.Title>
        {renderBool('GTS_useIt', '启用 GTS', '关闭后前端隐藏该选项')}
        {renderText('GTS_keyMC', 'GTS_keyMC（HMAC Key）', {
          help: 'Google 的 EAB 只能使用一次，且需在创建后 7 天内完成注册；账户注册成功后长期有效，无需再改',
        })}
        {renderText('GTS_keyID', 'GTS_keyID（EAB KID）', {
          help: '仅在首次注册账户时需要；账户已注册后可留空',
        })}
        {renderText('GTS_KeyTS', 'GTS_KeyTS（账户私钥 PEM）', {
          textarea: true,
          help: '留空则自动生成；更换私钥会被视为新账户，需重新使用一份 EAB',
        })}
        <Divider />
        <Typography.Title level={5}>SSL.com</Typography.Title>
        {renderBool('SSL_useIt', '启用 SSL.com')}
        {renderText('SSL_keyMC', 'SSL_keyMC（HMAC Key）', {
          help: 'EAB 可重复使用；账户注册后只需保留账户私钥',
        })}
        {renderText('SSL_keyID', 'SSL_keyID（EAB KID）')}
        {renderText('SSL_KeyTS', 'SSL_KeyTS（账户私钥 PEM）', {
          textarea: true,
          help: '留空则自动生成；更换私钥会被视为新账户',
        })}
        <Divider />
        <Typography.Title level={5}>ZeroSSL</Typography.Title>
        {renderBool('ZRO_useIt', '启用 ZeroSSL')}
        {renderText('ZRO_keyMC', 'ZRO_keyMC（HMAC Key）', {
          help: 'EAB 可重复使用；账户注册后只需保留账户私钥',
        })}
        {renderText('ZRO_keyID', 'ZRO_keyID（EAB KID）')}
        {renderText('ZRO_KeyTS', 'ZRO_KeyTS（账户私钥 PEM）', {
          textarea: true,
          help: '留空则自动生成；更换私钥会被视为新账户',
        })}
      </Card>

      {/* 防滥用 =================================================== */}
      <Card title="申请防滥用" style={{ marginBottom: 16 }}>
        {renderBool(
          'CERT_CAPTCHA_ENABLED',
          '申请证书需要人机验证',
          '开启后前端必须完成验证；开放 API 将无法提交申请',
        )}
        {renderBool(
          'BASE_CAPTCHA_ENABLED',
          '登录/注册/找回密码需要人机验证',
          '开启后登录、注册、找回密码发送邮件验证码前必须完成人机验证',
        )}
        {renderSelect(
          'CERT_CAPTCHA_PROVIDER',
          '验证码提供商',
          [
            { value: 'turnstile', label: 'Cloudflare Turnstile' },
            { value: 'hcaptcha', label: 'hCaptcha' },
            { value: 'recaptcha', label: 'reCAPTCHA v2' },
          ],
          '修改后请同步更新下方 Site Key / Secret Key',
        )}
        {renderText('SITE_KEYS', 'Site Key（SITE_KEYS）', {
          help: '前端 widget 使用；也兼容旧键 CERT_CAPTCHA_SITE_KEY',
        })}
        {renderText('AUTH_KEYS', 'Secret Key（AUTH_KEYS）', {
          help: '服务端校验使用；也兼容旧键 CERT_CAPTCHA_SECRET_KEY',
        })}
        <Button
          icon={<ExperimentOutlined />}
          onClick={() => setCaptchaTestOpen(true)}
        >
          测试验证码
        </Button>
        <Divider style={{ margin: '12px 0' }} />
        {renderNumber('MONTHLY_APPLY_LIMIT', '每月申请上限', {
          min: 0,
          help: '0 表示不限制；以 UTC 自然月为窗口',
        })}
      </Card>

      {/* 开放 API =================================================== */}
      <Card title="开放 API" style={{ marginBottom: 16 }}>
        {renderNumber('API_RATE_LIMIT', '速率限制（次/分钟）', {
          min: 1,
          max: 10000,
        })}
      </Card>

      {/* 邮件测试弹窗 =============================================== */}
      <Modal
        open={mailTestOpen}
        title="发送测试邮件"
        onCancel={() => setMailTestOpen(false)}
        onOk={doMailTest}
        okText="发送"
        confirmLoading={mailTesting}
        destroyOnClose
      >
        <Typography.Paragraph>
          调用当前配置的 <code>MAIL_KEYS</code> 与 <code>MAIL_SEND</code>{' '}
          发送一封测试邮件。
        </Typography.Paragraph>
        <Input
          placeholder="收件地址"
          value={mailTo}
          onChange={(e) => setMailTo(e.target.value)}
        />
      </Modal>

      {/* 验证码测试弹窗 =========================================== */}
      <Modal
        open={captchaTestOpen}
        title="测试验证码"
        onCancel={() => setCaptchaTestOpen(false)}
        onOk={doCaptchaTest}
        okText="提交校验"
        confirmLoading={captchaTesting}
        destroyOnClose
      >
        <Typography.Paragraph>
          请粘贴一个由当前 provider 生成的 <code>response token</code>
          。 本接口仅使用服务端 secret 发起一次真实校验请求，用于验证 secret
          配置是否正确。
        </Typography.Paragraph>
        <Input.TextArea
          rows={3}
          placeholder="把验证码 token 粘贴到此处"
          value={captchaToken}
          onChange={(e) => setCaptchaToken(e.target.value)}
        />
      </Modal>
    </div>
  );
}
