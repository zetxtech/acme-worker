import {useEffect, useRef, useState} from 'react';
import {Alert, App, Button, Checkbox, Collapse, Form, Input, InputNumber, Modal, Popconfirm, Radio, Select, Space, Switch, Table, Tag, Tooltip} from 'antd';
import {Cable, ChevronRight, Pencil, Plus, RefreshCw, Trash2} from 'lucide-react';
import type {DefaultOptionType} from 'antd/es/select';
import PageShell from '@components/Layout/PageShell';
import {deleteResource, fetchDnsProviderCatalog, fetchResources, saveResource, testResource, type DnsProviderOption, type WorkflowResource} from '@api/resources';
import {useAuthStore} from '@stores/useAuthStore';

const providers = {
  targets: [{value: 'nginx', label: 'Nginx (SSH)'}, {value: 'traefik', label: 'Traefik (SSH)'}, {value: 'ssh', label: 'SSH / SFTP'}, {value: 'https', label: 'HTTPS'}, {value: 'edgeone', label: 'EdgeOne'}, {value: 'esa', label: '\u963f\u91cc\u4e91 ESA'}],
};
const labels: Record<string, string> = {
  host: '\u670d\u52a1\u5668\u5730\u5740', port: '\u7aef\u53e3', username: '\u7528\u6237\u540d', fingerprint: 'SSH \u4e3b\u673a\u6307\u7eb9 (SHA256)',
  timeout: '\u8d85\u65f6 (\u6beb\u79d2)', format: '\u8bc1\u4e66\u683c\u5f0f', certificatePath: '\u8bc1\u4e66\u5b8c\u6574\u94fe\u8def\u5f84', privateKeyPath: '\u79c1\u94a5\u8def\u5f84',
  pfxPath: 'PFX \u6587\u4ef6\u8def\u5f84', privateKeyMode: '\u79c1\u94a5\u6587\u4ef6\u6743\u9650', testCommand: '\u68c0\u67e5\u547d\u4ee4', reloadCommand: '\u91cd\u8f7d\u547d\u4ee4',
  traefikMode: 'Traefik \u5b58\u50a8\u65b9\u5f0f', dynamicPath: '\u52a8\u6001 TLS \u914d\u7f6e\u8def\u5f84', acmePath: 'acme.json \u8def\u5f84', resolver: 'Resolver',
  url: '\u63a5\u6536\u5730\u5740', method: '\u8bf7\u6c42\u65b9\u5f0f', zone_id: 'Zone ID', site_id: 'Site ID', hosts: '\u52a0\u901f\u57df\u540d', region: '\u5730\u57df', alias: '\u8bc1\u4e66\u540d\u524d\u7f00', cert_name: '\u8bc1\u4e66\u540d\u524d\u7f00',
  mode: '上传后操作', certificate_id: '已有云证书 ID（可选）',
  token: 'API Token', secretId: 'SecretId', secretKey: 'SecretKey', accessKeyId: 'AccessKeyId', accessKeySecret: 'AccessKeySecret',
  password: '\u767b\u5f55\u5bc6\u7801', privateKey: 'SSH \u79c1\u94a5', passphrase: '\u79c1\u94a5\u5bc6\u7801', pfxPassword: 'PFX \u5bc6\u7801',
  authToken: '\u8ba4\u8bc1 Token', authorization: 'Authorization', hmacSecret: '\u7b7e\u540d\u5bc6\u94a5 (HMAC)',
};

function defaults(provider: string): Record<string, any> {
  if (provider === 'edgeone') return {mode: 'upload'};
  if (provider === 'https') return {method: 'POST', timeout: 10000};
  if (['ssh', 'nginx', 'traefik'].includes(provider)) return {port: 22, timeout: 25000, format: 'pem', privateKeyMode: '0600',
    certificatePath: provider === 'traefik' ? '/etc/traefik/tls/fullchain.pem' : '/etc/nginx/tls/fullchain.pem',
    privateKeyPath: provider === 'traefik' ? '/etc/traefik/tls/privkey.pem' : '/etc/nginx/tls/privkey.pem',
    ...(provider === 'nginx' ? {testCommand: 'nginx -t', reloadCommand: 'nginx -s reload'} : {}),
    ...(provider === 'traefik' ? {traefikMode: 'pem', dynamicPath: '/etc/traefik/dynamic/certificates.yml'} : {})};
  return {};
}

export default function Resources({kind}: {kind: 'dns' | 'targets'}) {
  const {message} = App.useApp();
  const isAdmin = useAuthStore((state) => state.isAdmin);
  const email = useAuthStore((state) => state.email);
  const [items, setItems] = useState<WorkflowResource[]>([]);
  const [dnsProviders, setDnsProviders] = useState<DnsProviderOption[]>([]);
  const [dnsProviderCount, setDnsProviderCount] = useState({total: 0, ready: 0});
  const [ready, setReady] = useState<boolean>();
  const [loadError, setLoadError] = useState(false);
  const [catalogError, setCatalogError] = useState(false);
  const requestId = useRef(0);
  const currentKind = useRef(kind);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string>();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<WorkflowResource>();
  const [checking, setChecking] = useState<WorkflowResource>();
  const [checkForm] = Form.useForm();
  const [form] = Form.useForm();
  const provider = Form.useWatch('provider', form) ?? (kind === 'dns' ? 'cloudflare' : 'nginx');
  const format = Form.useWatch(['config', 'format'], form);
  const traefikMode = Form.useWatch(['config', 'traefikMode'], form);
  const scopeMode = Form.useWatch('scopeMode', form) ?? 'account';
  const sharing = Form.useWatch('sharing', form) ?? 'private';
  const edgeMode = Form.useWatch(['config', 'mode'], form) ?? 'upload';
  const cloudTarget = kind === 'targets' && ['esa', 'edgeone'].includes(provider);
  const dnsSchema = dnsProviders.find((item) => item.applicationProvider === provider)?.resourceSchema;
  const fieldLabel = (field: string) => labels[field] ?? field;
  const credentialHelp = (field: string) => {
    if (kind !== 'dns') return undefined;
    const upstream = dnsSchema?.credentials.find((item) => item.name === field)?.description;
    if (/^(CLOUDFLARE_.*TOKEN|token)$/i.test(field)) {
      return 'Cloudflare：控制台 → 我的个人资料 → API 令牌 → 创建令牌 → 使用「编辑区域 DNS」模板；\u9700\u5305\u542b\u533a\u57df\u8bfb\u53d6\uff08Zone Read\uff09\u4e0e DNS \u7f16\u8f91\uff08DNS Edit\uff09\u6743\u9650\uff0c\u5e76\u5c06\u8d44\u6e90\u9650\u5236\u5230\u9700\u7ba1\u7406\u7684\u533a\u57df\u3002'
        + (upstream ? `（\u4e0a\u6e38\u8bf4\u660e\uff1a${upstream}）` : '');
    }
    return upstream;
  };

  const load = async () => {
    const target = currentKind.current;
    const sequence = ++requestId.current;
    setLoading(true);
    setLoadError(false);
    try {
      const response = await fetchResources(target);
      if (response.flags !== 0) throw new Error('Resource load failed');
      if (sequence !== requestId.current || target !== currentKind.current) return;
      setItems(response.items); setReady(response.encryptionReady);
    } catch {
      if (sequence === requestId.current && target === currentKind.current) { setLoadError(true); setReady(undefined); }
    } finally { if (sequence === requestId.current && target === currentKind.current) setLoading(false); }
  };
  useEffect(() => { void load(); return () => { requestId.current++; }; }, [kind]);
  const loadCatalog = () => {
    setCatalogError(false);
    fetchDnsProviderCatalog().then((catalog) => {
      if (catalog.flags !== 0) throw new Error('Provider load failed');
      setDnsProviders(catalog.providers);
      setDnsProviderCount({total: catalog.providerCount, ready: catalog.providers.filter((item) => ['ready', 'requires_test'].includes(item.status)).length});
    }).catch(() => { setCatalogError(true); });
  };
  useEffect(() => { if (kind === 'dns') loadCatalog(); }, [kind]);

  const edit = (resource?: WorkflowResource) => {
    setEditing(resource);
    form.resetFields();
    const selected = resource?.provider ?? (kind === 'dns' ? 'cloudflare' : 'nginx');
    form.setFieldsValue(resource ? {...resource, scopeMode: resource.scopeMode ?? 'zones', sharing: resource.grants.length ? 'shared' : 'private', secrets: {}, clearSecrets: false}
      : {provider: selected, enabled: true, scopeMode: kind === 'dns' ? 'account' : ['edgeone', 'esa'].includes(selected) ? 'certificate' : 'zones', sharing: 'private', zones: [], grants: [], config: defaults(selected), secrets: {}});
    setOpen(true);
  };
  const save = async () => {
    try {
      const values = await form.validateFields();
      const {sharing: visibility, ...body} = values;
      if (visibility !== 'shared') body.grants = [];
      if (kind === 'dns' && body.scopeMode === 'account') body.zones = [];
      if (cloudTarget && visibility !== 'shared' && body.scopeMode !== 'zones') { body.scopeMode = 'certificate'; body.zones = []; }
      setSaving(true);
      await saveResource(kind, body, editing?.id); setOpen(false);
      message.success(kind === 'dns' ? '\u8d26\u6237\u5df2\u4fdd\u5b58' : '\u5df2\u4fdd\u5b58');
      await load();
    } catch (error: any) { if (!error.errorFields) message.error(error.message || '\u4fdd\u5b58\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5'); }
    finally { setSaving(false); }
  };
  const test = async (resource: WorkflowResource, domain?: string, confirmWrite = false) => {
    setTesting(resource.id);
    try { const result = await testResource(kind, resource.id, domain, confirmWrite); message.success(result.zone?.writable
      ? '\u5df2\u9a8c\u8bc1 DNS \u5199\u5165\u3001\u4f20\u64ad\u548c\u6e05\u7406' : result.zone ? `\u5df2\u627e\u5230\u533a\u57df ${result.zone.name}` : '\u8fde\u63a5\u901a\u8fc7\uff0c\u672a\u4fee\u6539\u8bc1\u4e66'); await load(); }
    finally { setTesting(undefined); }
  };
  const startCheck = async () => {
    try {
      const values = await checkForm.validateFields();
      await test(checking!, values.domain, values.confirmWrite === true);
      setChecking(undefined);
    } catch (error: any) { if (!error.errorFields) message.error(error.message || '\u68c0\u67e5\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5'); }
  };
  const configFields = kind === 'dns' ? (dnsSchema?.options.map((field) => field.name) ?? []) : provider === 'https' ? ['url', 'method', 'timeout'] : provider === 'edgeone' ? ['mode', 'certificate_id', ...(edgeMode === 'bind' ? ['zone_id', 'hosts'] : []), 'region', 'alias']
    : provider === 'esa' ? ['site_id', 'certificate_id', 'cert_name'] : ['ssh', 'nginx', 'traefik'].includes(provider)
      ? ['host', 'port', 'username', 'fingerprint', 'timeout', ...(provider === 'ssh' ? ['format'] : []),
        ...(provider === 'traefik' ? ['traefikMode'] : []),
        ...(provider === 'traefik' && traefikMode === 'acme-json' ? ['acmePath', 'resolver']
          : format === 'pfx' ? ['pfxPath'] : ['certificatePath', 'privateKeyPath', 'privateKeyMode', ...(provider === 'traefik' ? ['dynamicPath'] : [])]),
        'testCommand', 'reloadCommand'] : [];
  const secretFields = kind === 'dns' && dnsSchema ? dnsSchema.credentials.map((field) => field.name) : provider === 'cloudflare' ? ['token'] : ['dnspod', 'edgeone'].includes(provider) ? ['secretId', 'secretKey']
    : ['alidns', 'esa'].includes(provider) ? ['accessKeyId', 'accessKeySecret'] : provider === 'https' ? ['authToken', 'authorization', 'hmacSecret']
      : ['password', 'privateKey', 'passphrase', ...(format === 'pfx' ? ['pfxPassword'] : [])];
  const choices: Record<string, {label: string; value: string}[]> = {
    mode: [{value: 'upload', label: '仅上传到腾讯云 SSL 控制台'}, {value: 'bind', label: '上传并绑定 EdgeOne 域名'}],
    method: [{value: 'POST', label: 'POST'}, {value: 'PUT', label: 'PUT'}], format: [{value: 'pem', label: 'PEM'}, {value: 'pfx', label: 'PFX'}],
    privateKeyMode: [{value: '0600', label: '0600'}, {value: '0640', label: '0640'}],
    traefikMode: [{value: 'pem', label: '\u52a8\u6001 PEM'}, {value: 'acme-json', label: 'acme.json'}],
  };
  const dnsOptions = dnsProviders.map((item) => ({
    value: item.applicationProvider ?? item.id,
    disabled: !['ready', 'requires_test'].includes(item.status),
    title: item.status === 'incompatible' ? '\u5f53\u524d\u8fd0\u884c\u73af\u5883\u4e0d\u652f\u6301\u6b64\u670d\u52a1\u5546' : item.status === 'unavailable' ? '\u6b64 DNS \u670d\u52a1\u6682\u4e0d\u53ef\u7528\uff0c\u8bf7\u8054\u7cfb\u7ba1\u7406\u5458' : undefined,
    label: item.displayName,
  }));
  const providerOptions: DefaultOptionType[] = kind === 'dns' ? [
    {label: '\u53ef\u914d\u7f6e', options: dnsOptions.filter((item) => !item.disabled)},
    {label: '\u6682\u4e0d\u53ef\u7528', options: dnsOptions.filter((item) => item.disabled && dnsProviders.find((provider) => provider.applicationProvider === item.value)?.status !== 'incompatible')},
    {label: '\u4e0d\u517c\u5bb9', options: dnsOptions.filter((item) => dnsProviders.find((provider) => provider.applicationProvider === item.value)?.status === 'incompatible')},
  ] : providers.targets;
  const configInputs = configFields.map((field) => <Form.Item key={field} data-dns-field={kind === 'dns' ? field : undefined} name={['config', field]}
    label={<span style={{whiteSpace: 'normal', overflowWrap: 'anywhere'}}>{fieldLabel(field)}</span>}
    tooltip={kind === 'dns' ? dnsSchema?.options.find((item) => item.name === field)?.description : undefined}
    rules={[{required: ['host', 'username', 'fingerprint', 'url', 'certificatePath', 'privateKeyPath', 'pfxPath', 'acmePath', 'resolver', 'dynamicPath'].includes(field)}]}>
    {choices[field] ? <Select options={choices[field]}/> : field === 'hosts' ? <Select mode="tags" open={false} tokenSeparators={[',', ' ']}/>
      : ['port', 'timeout'].includes(field) ? <InputNumber min={1} max={field === 'port' ? 65535 : 28000} style={{width: '100%'}}/>
        : <Input placeholder={field === 'fingerprint' ? 'SHA256:...' : undefined} autoComplete="off"/>}
  </Form.Item>);

  return <PageShell>
    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20}}>
      <h2 style={{fontSize: 22, margin: 0}}>{kind === 'dns' ? 'DNS 验证账号' : '\u90e8\u7f72\u76ee\u6807'}</h2>
      <Space><Tooltip title={'\u5237\u65b0'}><Button aria-label={'\u5237\u65b0'} icon={<RefreshCw size={16}/>} loading={loading} onClick={() => void load()}/></Tooltip>
        <Button type="primary" icon={<Plus size={16}/>} disabled={ready !== true || kind === 'dns' && !dnsProviders.length} onClick={() => edit()}>{'\u65b0\u5efa'}</Button></Space>
    </div>
    {ready === false && !loadError && <Alert type="warning" showIcon message={'\u6682\u65f6\u65e0\u6cd5\u5b89\u5168\u4fdd\u5b58\u8d26\u6237'}
      description={isAdmin ? '\u8bf7\u68c0\u67e5\u7ad9\u70b9\u7684\u51ed\u636e\u4fdd\u62a4\u8bbe\u7f6e\uff0c\u6062\u590d\u540e\u91cd\u8bd5\u3002' : '\u8bf7\u8054\u7cfb\u7ba1\u7406\u5458\u6062\u590d\u540e\u91cd\u8bd5\u3002'}
      action={<Button onClick={() => void load()}>{'\u91cd\u8bd5'}</Button>} style={{marginBottom: 16}}/>}
    {loadError && <Alert type="error" showIcon message={'\u8d44\u6e90\u52a0\u8f7d\u5931\u8d25'} action={<Button onClick={() => void load()}>{'\u91cd\u8bd5'}</Button>} style={{marginBottom: 16}}/>}
    {kind === 'dns' && catalogError && <Alert type="error" showIcon message={'\u670d\u52a1\u5546\u5217\u8868\u52a0\u8f7d\u5931\u8d25'} action={<Button onClick={loadCatalog}>{'\u91cd\u8bd5'}</Button>} style={{marginBottom: 16}}/>}
    <Table rowKey="id" dataSource={items} loading={loading} pagination={{pageSize: 8}} scroll={items.length ? {x: 760} : undefined} columns={[
      {title: '\u540d\u79f0', dataIndex: 'name'}, {title: '\u670d\u52a1\u5546', dataIndex: 'provider', render: (value: string) => dnsProviders.find((item) => item.applicationProvider === value)?.displayName ?? providers.targets.find((item) => item.value === value)?.label ?? value.replace(/^lego:/, '')},
      {title: '适用范围', dataIndex: 'zones', render: (zones: string[], item) => item.scopeMode === 'certificate' ? '所选证书'
        : !zones.length && item.scopeMode === 'account' ? '\u6309\u7533\u8bf7\u57df\u540d\u81ea\u52a8\u67e5\u627e' : <Space wrap>{zones.map((zone) => <Tag key={zone}>{zone}</Tag>)}</Space>},
      {title: '\u72b6\u6001', render: (_, item) => <Tag color={!item.enabled ? 'default' : kind === 'dns' && (!item.connectionChecked || item.available === false) ? 'default' : 'green'}>{!item.enabled ? '\u5df2\u505c\u7528' : kind === 'dns' && (!item.connectionChecked || item.available === false) ? '\u5f85\u68c0\u67e5' : '\u6b63\u5e38'}</Tag>},
      {title: '\u64cd\u4f5c', key: 'actions', width: 148, render: (_, item) => <Space>
        <Tooltip title={'\u68c0\u67e5\u8fde\u63a5'}><Button aria-label={'\u68c0\u67e5\u8fde\u63a5'} icon={<Cable size={15}/>} loading={testing === item.id} onClick={() => {
          if (kind === 'dns') { checkForm.resetFields(); checkForm.setFieldsValue({domain: item.zones[0] ?? '', confirmWrite: false}); setChecking(item); }
          else void test(item).catch((error) => message.error(error.message || '\u68c0\u67e5\u5931\u8d25'));
        }}/></Tooltip>
        {(isAdmin || item.owner === email) && <><Tooltip title={'\u7f16\u8f91'}><Button aria-label={'\u7f16\u8f91'} icon={<Pencil size={15}/>} disabled={!ready} onClick={() => edit(item)}/></Tooltip>
          <Popconfirm title={'\u5220\u9664\u6b64\u8d44\u6e90\uff1f'} onConfirm={async () => { await deleteResource(kind, item.id); await load(); }}><Button danger aria-label={'\u5220\u9664'} icon={<Trash2 size={15}/>}/></Popconfirm></>}
      </Space>},
    ]}/>
    <Modal forceRender open={open} title={editing ? '\u7f16\u8f91\u8d44\u6e90' : '\u65b0\u5efa\u8d44\u6e90'} onCancel={() => setOpen(false)} onOk={() => void save()}
      confirmLoading={saving} okButtonProps={{disabled: !ready}} okText={'\u4fdd\u5b58'} cancelText={'\u53d6\u6d88'} width={680} styles={{body: {maxHeight: '70vh', overflowY: 'auto', paddingRight: 8}}}>
      <Form form={form} layout="vertical">
        <Form.Item name="name" label={kind === 'dns' ? '\u8d26\u6237\u540d' : '\u540d\u79f0'} rules={[{required: true, max: 100}]}><Input/></Form.Item>
        <Form.Item name="provider" label={kind === 'dns' ? 'DNS \u670d\u52a1\u5546' : '\u7c7b\u578b'} rules={[{required: true}]}><Select disabled={!!editing} showSearch optionFilterProp="label" options={providerOptions}
          onChange={(value) => {
            form.setFieldValue('config', defaults(value)); form.setFieldValue('secrets', {}); form.setFieldValue('clearSecrets', false);
            if (kind === 'targets') { form.setFieldValue('scopeMode', ['esa', 'edgeone'].includes(value) ? 'certificate' : 'zones'); form.setFieldValue('zones', []); }
          }}/></Form.Item>
        {provider === 'esa' && <Alert type="info" showIcon style={{marginBottom: 16}} message="证书上传至 ESA 站点，无需单独绑定域名"
          description="首次上传后会保存云端证书 ID，续期使用原 ID 更新。已有证书可填写 ID 接管。"/>}
        {provider === 'edgeone' && <Alert type="info" showIcon style={{marginBottom: 16}} message="证书先上传腾讯云 SSL 控制台，可选择是否绑定 EdgeOne 域名"
          description={<>每个域名最多使用一张 RSA 和一张 ECC 证书，不支持 SM2。更新旧证书关联时将等待云端任务完成，不删除旧证书。<a href="https://console.tencentcloud.com/ssl" target="_blank" rel="noreferrer">打开 SSL 控制台</a></>}/>}
        {kind === 'dns' && provider.startsWith('lego:') && <Alert type="info" showIcon style={{marginBottom: 16}}
          message={'\u4fdd\u5b58\u540e\u8bf7\u70b9\u51fb\u201c\u68c0\u67e5\u8fde\u63a5\u201d\uff0c\u9009\u62e9\u5b9e\u9645\u57df\u540d\u5e76\u786e\u8ba4\u540e\u518d\u5f00\u59cb\u68c0\u67e5\u3002'}/>}
        {provider === 'traefik' && traefikMode === 'acme-json' && <Alert style={{marginBottom: 16}} type="warning" showIcon message={'\u5c06\u5408\u5e76\u6240\u9009 resolver \u4e2d\u7684\u8bc1\u4e66\u3002\u8bf7\u786e\u8ba4 Traefik \u4e0d\u4f1a\u540c\u65f6\u5199\u5165\u8be5\u6587\u4ef6\u3002'}/>}
        {provider === 'traefik' && traefikMode === 'acme-json' && <Form.Item name={['config', 'externalWriterStopped']} valuePropName="checked"
          rules={[{validator: (_, value) => value === true ? Promise.resolve() : Promise.reject(new Error('\u8bf7\u5148\u505c\u6b62\u5176\u4ed6\u5199\u5165\u65b9'))}]}>
          <Checkbox>{'\u5df2\u505c\u6b62 Traefik \u53ca\u5176\u4ed6\u7a0b\u5e8f\u5199\u5165 acme.json'}</Checkbox>
        </Form.Item>}
        {kind === 'targets' && configInputs}
        {editing && <Form.Item name="clearSecrets" valuePropName="checked"><Checkbox>{'\u66ff\u6362\u5168\u90e8\u5df2\u4fdd\u5b58\u51ed\u636e'}</Checkbox></Form.Item>}
        {secretFields.map((field) => <Form.Item key={field} data-dns-field={kind === 'dns' ? field : undefined} name={['secrets', field]}
          label={<span style={{whiteSpace: 'normal', overflowWrap: 'anywhere'}}>{fieldLabel(field)}</span>}
          tooltip={kind === 'dns' ? credentialHelp(field) : undefined}
          rules={[{required: kind === 'dns' && !editing && !!dnsSchema?.credentials.find((item) => item.name === field)?.required},
            {validator: async () => {
              if (field === 'password' && !editing && ['ssh', 'nginx', 'traefik'].includes(provider)
                && !form.getFieldValue(['secrets', 'password']) && !form.getFieldValue(['secrets', 'privateKey'])) {
                throw new Error('\u8bf7\u586b\u5199\u767b\u5f55\u5bc6\u7801\u6216 SSH \u79c1\u94a5');
              }
            }}]}>
          {field === 'privateKey' ? <Input.TextArea rows={4} autoComplete="off" placeholder={editing ? '\u7559\u7a7a\u4fdd\u7559\u73b0\u6709\u51ed\u636e' : undefined}/>
            : <Input.Password autoComplete="new-password" placeholder={editing ? '\u7559\u7a7a\u4fdd\u7559\u73b0\u6709\u51ed\u636e' : undefined}/>}
        </Form.Item>)}
        {kind === 'targets' && !cloudTarget && <Form.Item name="zones" label={'\u90e8\u7f72\u54ea\u4e9b\u57df\u540d'} rules={[{required: true}]}><Select mode="tags" open={false} tokenSeparators={[',', ' ']} placeholder="example.com"/></Form.Item>}
        <Collapse key={editing?.id ?? `${kind}-new`} defaultActiveKey={[]}
          expandIcon={({isActive}) => <ChevronRight aria-hidden="true" size={16} style={{transform: isActive ? 'rotate(90deg)' : undefined}}/>}
          items={[{key: 'advanced', label: '\u9ad8\u7ea7\u8bbe\u7f6e', forceRender: true, children: <>
          <Form.Item name="sharing" label={'\u4f7f\u7528\u6743\u9650'}><Radio.Group disabled={!isAdmin} options={[
            {value: 'private', label: '\u4ec5\u81ea\u5df1\u4f7f\u7528'}, ...(isAdmin || sharing === 'shared' ? [{value: 'shared', label: '\u5171\u4eab\u7ed9\u6307\u5b9a\u7528\u6237'}] : [])]}
            onChange={(event) => { if (event.target.value === 'shared') form.setFieldValue('scopeMode', 'zones'); }}/></Form.Item>
          {kind === 'dns' && <Form.Item name="scopeMode" label={'\u57df\u540d\u9650\u5236'}><Radio.Group options={[
            {value: 'account', label: '\u6309\u7533\u8bf7\u57df\u540d\u81ea\u52a8\u67e5\u627e', disabled: sharing === 'shared'}, {value: 'zones', label: '\u4ec5\u9650\u6307\u5b9a\u57df\u540d'}]}/></Form.Item>}
          {kind === 'dns' && scopeMode === 'zones' && <Form.Item name="zones" label={'\u5141\u8bb8\u4f7f\u7528\u7684\u57df\u540d'} rules={[{required: true}]}><Select mode="tags" open={false} tokenSeparators={[',', ' ']} placeholder="example.com"/></Form.Item>}
          {cloudTarget && <Form.Item name="scopeMode" label="适用证书范围"><Radio.Group options={[
            {value: 'certificate', label: '仅自己的所选证书', disabled: sharing === 'shared'}, {value: 'zones', label: '限制指定域名'}]}/></Form.Item>}
          {cloudTarget && scopeMode === 'zones' && <Form.Item name="zones" label="允许证书中的域名" rules={[{required: true}]}><Select mode="tags" open={false} tokenSeparators={[',', ' ']}/></Form.Item>}
          {isAdmin && sharing === 'shared' && <Form.Item name="grants" label={'\u5171\u4eab\u7ed9\u54ea\u4e9b\u7528\u6237'} rules={[{required: true}]}><Select mode="tags" open={false} tokenSeparators={[',', ' ']}/></Form.Item>}
          {kind === 'dns' && configInputs}
          <Form.Item name="enabled" label={'\u542f\u7528'} valuePropName="checked"><Switch/></Form.Item>
        </>}]} style={{marginTop: 16}}/>
      </Form>
    </Modal>
    <Modal forceRender open={!!checking} title={'\u68c0\u67e5\u8fde\u63a5'} onCancel={() => { if (!testing) setChecking(undefined); }} onOk={() => void startCheck()}
      confirmLoading={!!testing} closable={!testing} maskClosable={!testing} cancelButtonProps={{disabled: !!testing}} okText={'\u5f00\u59cb\u68c0\u67e5'} cancelText={'\u53d6\u6d88'}>
      <Alert type="info" showIcon style={{marginBottom: 16}} message={checking?.provider.startsWith('lego:')
        ? '\u5c06\u5728\u6240\u9009\u57df\u540d\u4e0b\u4e34\u65f6\u5199\u5165 TXT \u8bb0\u5f55\uff0c\u68c0\u67e5\u4f20\u64ad\u540e\u6e05\u7406\u3002\u8bf7\u9009\u62e9\u7531\u6b64\u8d26\u6237\u7ba1\u7406\u7684\u5b9e\u9645\u57df\u540d\u3002'
        : '\u4ec5\u68c0\u67e5\u8fde\u63a5\u5e76\u67e5\u627e\u6240\u9009\u57df\u540d\u533a\u57df\uff0c\u4e0d\u5199\u5165 DNS \u8bb0\u5f55\u3002'}/>
      <Form form={checkForm} name="check" layout="vertical">
        <Form.Item name="domain" label={'\u68c0\u67e5\u54ea\u4e2a\u57df\u540d'} rules={[{required: true, message: '\u8bf7\u586b\u5199\u5b9e\u9645\u57df\u540d'},
          {pattern: /^([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z0-9-]{2,63}$/, message: '\u8bf7\u586b\u5199\u6709\u6548\u57df\u540d'}]}><Input placeholder="example.com" maxLength={253}/></Form.Item>
        {checking?.provider.startsWith('lego:') && <Form.Item name="confirmWrite" valuePropName="checked" rules={[{validator: (_, value) => value === true ? Promise.resolve() : Promise.reject(new Error('\u8bf7\u786e\u8ba4\u5141\u8bb8\u4e34\u65f6 TXT \u5199\u5165\u548c\u6e05\u7406'))}]}>
          <Checkbox>{'\u5141\u8bb8\u4e34\u65f6\u5199\u5165 TXT \u5e76\u5728\u68c0\u67e5\u540e\u6e05\u7406'}</Checkbox>
        </Form.Item>}
      </Form>
    </Modal>
  </PageShell>;
}