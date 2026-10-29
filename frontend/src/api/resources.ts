import {apiGet, apiPost, http} from './request';

export interface WorkflowResource {
  id: string;
  name: string;
  provider: string;
  owner: string;
  grants: string[];
  zones: string[];
  kind?: 'DNS_ACCOUNT' | 'DEPLOY_TARGET';
  scopeMode?: 'zones' | 'account' | 'certificate';
  enabled: boolean;
  config: Record<string, any>;
  credentialsConfigured: boolean;
  available?: boolean;
  connectionChecked?: boolean;
  unavailableReason?: string;
}

export interface DnsProviderOption {
  id: string;
  applicationProvider: string | null;
  displayName: string;
  status: 'ready' | 'requires_test' | 'incompatible' | 'not_implemented' | 'unavailable';
  reason: string;
  deprecated: boolean;
  deprecatedReason: string | null;
  credentials: {name: string; type: string; required: boolean; description: string}[];
  options?: {name: string; type: string; required: boolean; description: string}[];
  resourceSchema?: {
    credentials: {name: string; type: string; required: boolean; description: string}[];
    options: {name: string; type: string; required: boolean; description: string}[];
  };
}

export interface CaCapability {
  id: string;
  name: string;
  available: boolean;
  wildcard: boolean;
  reason: string;
  missing: string[];
  pricing: string;
  registered?: boolean;
  eabConfigured?: boolean;
  needsRegistration?: boolean;
}

export interface DeploymentState {
  targetId: string;
  name: string;
  provider?: string;
  status: 'pending' | 'running' | 'ok' | 'fail';
  attempts: number;
  version?: string;
  updatedAt?: number;
  detail?: string;
  diagnostic?: HttpDiagnostic;
}

export interface HttpDiagnostic {
  method: string;
  url: string;
  action: string;
  status: number;
  statusText: string;
  responseBody: string;
  requestId?: string;
  truncated?: boolean;
}

export function resourceSelectable(resource: WorkflowResource, mail: string | null, domains: string[] = []) {
  const owner = resource.owner === mail?.toLowerCase();
  const automatic = resource.kind === 'DNS_ACCOUNT' && resource.scopeMode === 'account' && !resource.zones.length && !resource.grants.length;
  if (automatic) return resource.enabled && resource.available !== false && owner;
  if (resource.kind === 'DEPLOY_TARGET' && resource.scopeMode === 'certificate'
    && !resource.zones.length && !resource.grants.length) return resource.enabled && resource.available !== false && owner;
  return resource.enabled && resource.available !== false && resource.zones.length > 0 && (owner || resource.grants.includes(mail?.toLowerCase() ?? ''))
    && domains.every((domain) => resource.zones.some((zone) => {
      const name = domain.toLowerCase().replace(/^\*\./, '');
      return name === zone || name.endsWith(`.${zone}`);
    }));
}

export interface DcvState {
  available: boolean;
  domain: string;
  reason: string;
  missing: string[];
}

export const fetchCapabilities = () => apiGet<{flags: number; cas: CaCapability[]; dcv: DcvState}>('/capabilities');
export const fetchResources = (kind: 'dns' | 'targets') => apiGet<{flags: number; items: WorkflowResource[]; encryptionReady: boolean}>(`/resources/${kind}`);
export const fetchDnsProviderCatalog = () => apiGet<{flags: number; providerCount: number; readyCount: number; configurableCount: number; providers: DnsProviderOption[]}>('/resources/dns/providers');
export async function configureDcv(values: {domain: string; token?: string; confirmWrite: boolean}) {
  const response = await http.put('/resources/dcv', values, {timeout: 120000});
  return resourceResult(response.data) as {flags: number; dcv: DcvState};
}
function resourceResult<T extends {flags?: number; texts?: string}>(result: T): T {
  if (result.flags !== 0) throw new Error(result.texts || '\u64cd\u4f5c\u672a\u5b8c\u6210\uff0c\u8bf7\u91cd\u8bd5');
  return result;
}
export async function saveResource(kind: string, values: any, id?: string) {
  const response = id ? await http.put(`/resources/${kind}/${id}`, values) : await http.post(`/resources/${kind}`, values);
  return resourceResult(response.data);
}
export const deleteResource = (kind: string, id: string) => http.delete(`/resources/${kind}/${id}`);
export async function testResource(kind: string, id: string, domain?: string, confirmWrite = false) {
  const config = {timeout: 160000, silent: true};
  const response = await http.post(`/resources/${kind}/${id}/test`, {domain, confirmWrite}, config);
  return resourceResult(response.data);
}
export const fetchDeployments = (uuid: string) => apiGet<{flags: number; items: DeploymentState[]}>(`/resources/orders/${uuid}/deployments`);
export const retryDeployment = (uuid: string, targetId: string) => apiPost(`/resources/orders/${uuid}/deployments/${targetId}/retry`);
export const updateDeploymentSelection = (uuid: string, targetIds: string[]) => http.put(`/resources/orders/${uuid}/deployments`, {targetIds});