/**
 * 管理员 - 自动化（触发器端点 / 边缘证书下发）API
 */
import { apiGet, apiPost, http } from './request';

export interface JobDef {
  id: string;
  title: string;
  desc: string;
}

export interface TriggerDef {
  id: string;
  name: string;
  token: string;
  enabled: boolean;
  jobs: string[];
  note?: string;
  last_run?: number;
  last_status?: string;
  last_detail?: string;
  runs?: number;
  url?: string;
}

export interface EdgeOneConfigView {
  secret_id: string;
  secret_key: string;
  has_secret_key: boolean;
  region: string;
  zone_id: string;
  hosts: string[];
  alias: string;
}

export interface EsaConfigView {
  access_key_id: string;
  access_key_secret: string;
  has_access_key_secret: boolean;
  endpoint: string;
  site_id: string;
  cert_name: string;
}

export interface EdgeTargetView {
  id: string;
  type: 'edgeone' | 'esa';
  name: string;
  enabled: boolean;
  auto: boolean;
  domains: string[];
  edgeone?: EdgeOneConfigView;
  esa?: EsaConfigView;
  last_run?: number;
  last_status?: string;
  last_detail?: string;
}

export interface ScheduleInfo {
  enabled: boolean;
  interval_minutes: number;
  jobs: string[];
  last_run: number;
  renew_days_before: number;
}

export interface AutoLogItem {
  t: number;
  kind: string;
  target?: string;
  order?: string;
  status: string;
  detail: string;
}

export interface AutomationOverview {
  flags: number;
  jobs: JobDef[];
  triggers: TriggerDef[];
  targets: EdgeTargetView[];
  schedule: ScheduleInfo;
  log: AutoLogItem[];
}

export interface PushResultView {
  targetId: string;
  targetName: string;
  type: string;
  status: 'ok' | 'skip' | 'fail';
  detail: string;
  hosts?: string[];
  certId?: string;
}

export async function fetchAutomation(): Promise<AutomationOverview> {
  return await apiGet<AutomationOverview>('/admin/automation');
}

/* ------------------------- 触发器 ------------------------- */

export async function createTrigger(body: {
  name: string;
  jobs: string[];
  note?: string;
}) {
  return await apiPost('/admin/automation/triggers', body);
}

export async function updateTrigger(
  id: string,
  patch: Partial<{ name: string; jobs: string[]; enabled: boolean; note: string; rotate_token: boolean }>,
) {
  const res = await http.patch(`/admin/automation/triggers/${encodeURIComponent(id)}`, patch);
  return res.data;
}

export async function deleteTrigger(id: string) {
  const res = await http.delete(`/admin/automation/triggers/${encodeURIComponent(id)}`);
  return res.data;
}

export async function runTrigger(id: string, force = false) {
  return await apiPost(`/admin/automation/triggers/${encodeURIComponent(id)}/run`, { force });
}

/* ------------------------- 下发目标 ------------------------- */

export async function createTarget(body: Record<string, any>) {
  return await apiPost('/admin/automation/targets', body);
}

export async function updateTarget(id: string, patch: Record<string, any>) {
  const res = await http.patch(`/admin/automation/targets/${encodeURIComponent(id)}`, patch);
  return res.data;
}

export async function deleteTarget(id: string) {
  const res = await http.delete(`/admin/automation/targets/${encodeURIComponent(id)}`);
  return res.data;
}

export async function testTarget(id: string) {
  return await apiPost(`/admin/automation/targets/${encodeURIComponent(id)}/test`, {});
}

export async function syncTarget(id: string, force = false) {
  return await apiPost(`/admin/automation/targets/${encodeURIComponent(id)}/sync`, { force });
}

/* ------------------------- 定时任务 / 日志 ------------------------- */

export async function saveSchedule(body: Partial<{
  enabled: boolean;
  interval_minutes: number;
  jobs: string[];
  renew_days_before: number;
}>) {
  const res = await http.put('/admin/automation/schedule', body);
  return res.data;
}

export async function runJobsNow(jobs: string[]) {
  return await apiPost('/admin/automation/run', { jobs });
}

export async function fetchAutomationLog(): Promise<{ flags: number; items: AutoLogItem[] }> {
  return await apiGet('/admin/automation/log');
}

export async function pushOrderEdge(uuid: string, force = false) {
  return await apiPost(`/admin/automation/orders/${encodeURIComponent(uuid)}/push`, { force });
}
