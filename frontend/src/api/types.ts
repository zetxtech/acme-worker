/* ============================================================
 * API 类型定义
 * ============================================================ */

/** 通用响应 */
export interface ApiResp<T = any> {
  flags: number; // 0 表示成功
  texts?: string; // 提示文案
  // 其他额外字段（由各接口补充）
  [key: string]: any;
  _data?: T;
}

/** 域名条目（申请时） */
export interface DomainItem {
  name: string;
  wild: boolean;
  root: boolean;
  type: 'dns-self' | 'dns-auto' | 'dns-api' | 'web-self';
  dnsAccountId?: string;
  dnsStatus?: string;
  dnsAttempts?: number;
  dnsNextAttempt?: number;
  token?: string;
  isIP?: boolean;
  // 后端返回额外字段
  flag?: number;
  text?: string;
  auth?: string;
  auto?: string;
}

/** 证书主体 */
export interface CertSubject {
  C?: string;
  S?: string;
  ST?: string;
  O?: string;
  OU?: string;
}

/** 申请表单 */
export interface ApplyPayload {
  targetIds?: string[];
  domains: DomainItem[];
  globals: {
    ca: string;
    auto_renew: boolean;
    encryption: string;
  };
  subject: CertSubject;
}

/** 订单数据（后端存储结构） */
export interface OrderRaw {
  uuid: string;
  mail: string;
  sign: string;
  type: string;
  auto: boolean | number;
  flag: number;
  time: number;
  next: number;
  main: string; // JSON 字符串
  list: string; // JSON 字符串（DomainItem[]）
  keys: string;
  cert: string;
  text: string;
  data?: string;
}

/** 订单（解析后） */
export interface Order extends Omit<OrderRaw, 'main' | 'list' | 'data'> {
  main: CertSubject;
  list: DomainItem[];
  data?: any;
}

/** 订单操作 */
export type OrderAction =
  | 'verify'
  | 'reload'
  | 'modify'
  | 'cancel'
  | 'single'
  | 'process'
  | 'ca_get'
  | 'ca_key'
  | 're_new'
  | 'rm_key'
  | 'edge_push'
  | 'ca_del';

/** Nonce 响应 */
export interface NonceResp {
  nonce: string;
  flags?: number;
  texts?: string;
}

/** 用户数据 */
export interface UserInfo {
  mail: string;
  keys?: string;
  apis?: string;
}
