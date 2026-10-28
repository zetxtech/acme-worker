import {Popover} from 'antd';
import {Info} from 'lucide-react';
import type {HttpDiagnostic} from '@api/resources';

export default function RequestDetails({summary, diagnostic}: {summary?: string; diagnostic?: HttpDiagnostic}) {
  if (!diagnostic) return <span style={{overflowWrap: 'anywhere'}}>{summary || '-'}</span>;
  const content = <div style={{width: 'min(440px, calc(100vw - 48px))', overflowWrap: 'anywhere', lineHeight: 1.6}}>
    <strong>请求与响应</strong>
    <div style={{fontFamily: 'var(--font-display)', marginBlock: 8}}>{diagnostic.method} {diagnostic.url}</div>
    <div>动作：{diagnostic.action}</div>
    <div>状态：{diagnostic.status || '未收到响应'} {diagnostic.statusText}</div>
    {diagnostic.requestId && <div>请求 ID：{diagnostic.requestId}</div>}
    <div style={{marginTop: 8}}>响应 Body</div>
    <pre style={{maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', padding: 10,
      borderRadius: 6, background: 'var(--bg-code)', color: 'var(--text-1)', fontSize: 12}}>{diagnostic.responseBody || '（空响应）'}</pre>
    {diagnostic.truncated && <div>响应过长，仅显示前 8 KiB。</div>}
    <div style={{fontSize: 12, color: 'var(--text-2)', marginTop: 8}}>凭据与私钥已隐藏。</div>
  </div>;
  return <Popover content={content} trigger={['hover', 'focus', 'click']} zIndex={2100}>
    <button type="button" aria-label="查看请求和响应详情" style={{display: 'inline-flex', alignItems: 'center', gap: 6,
      color: 'inherit', textAlign: 'left', whiteSpace: 'normal', overflowWrap: 'anywhere', cursor: 'help'}}>
      <span>{summary || '查看请求详情'}</span><Info size={14} aria-hidden="true"/>
    </button>
  </Popover>;
}