import {tcCall} from "./edge/tencent";
import {esaCall} from "./edge/aliyun";
import {accountScope, inScope, type Resource} from "./resources";
import {readBoundedJson} from "./deploy/network";

export interface DnsZone {id: string; name: string}
export interface TxtHandle {
    id: string;
    zone: DnsZone;
    name: string;
    value: string;
    owned: boolean;
}

export class DnsProvider {
    constructor(private account: Resource, private secrets: Record<string, string>) {}

    private async call(action: string, params: Record<string, any> = {}): Promise<any> {
        if (this.account.provider === "dnspod") return tcCall({secretId: this.secrets.secretId,
            secretKey: this.secrets.secretKey}, {service: "dnspod", host: "dnspod.tencentcloudapi.com",
            version: "2021-03-23", action, params, timeout: 10000});
        if (this.account.provider === "alidns") return esaCall({accessKeyId: this.secrets.accessKeyId,
            accessKeySecret: this.secrets.accessKeySecret, endpoint: "alidns.cn-hangzhou.aliyuncs.com"},
        {version: "2015-01-09", action, params, timeout: 10000});
        throw new Error("Unsupported DNS provider");
    }

    private async cf(path: string, method = "GET", body?: object, missingAllowed = false): Promise<any> {
        if (!this.secrets.token) throw new Error("Cloudflare API Token required");
        const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
            method, headers: {Authorization: `Bearer ${this.secrets.token}`, "Content-Type": "application/json"},
            body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000), redirect: "manual",
        });
        if (missingAllowed && response.status === 404) { await response.body?.cancel(); return {result: null}; }
        const data = await readBoundedJson(response, 1048576);
        if (!response.ok || !data.success) throw new Error(`Cloudflare DNS request failed (${response.status}, ${data.errors?.[0]?.code ?? "unknown"})`);
        return data;
    }

    async zone(domain: string): Promise<DnsZone> {
        const name = domain.toLowerCase().replace(/^\*\./, "").replace(/^_acme-challenge\./, "");
        if (!accountScope(this.account) && !inScope(name, this.account.zones)) throw new Error("DNS domain outside account scope");
        const labels = name.split(".");
        for (let offset = 0; offset < labels.length - 1; offset++) {
            const candidate = labels.slice(offset).join(".");
            if (this.account.provider === "cloudflare") {
                const data = await this.cf(`/zones?name=${encodeURIComponent(candidate)}&status=active`);
                const zone = data.result?.find((item: any) => item.name === candidate);
                if (zone) return {id: String(zone.id), name: candidate};
            } else {
                try {
                    const data = await this.call(this.account.provider === "dnspod" ? "DescribeDomain" : "DescribeDomainInfo",
                        this.account.provider === "dnspod" ? {Domain: candidate} : {DomainName: candidate});
                    if (this.account.provider === "dnspod" && data.DomainInfo?.Domain === candidate) {
                        return {id: String(data.DomainInfo.DomainId), name: candidate};
                    }
                    if (this.account.provider === "alidns" && data.DomainName === candidate) {
                        return {id: String(data.DomainId), name: candidate};
                    }
                } catch (error) {
                    if (!/DomainNotExist|DomainNotFound|DomainNotExists|NoDomain|InvalidDomain\.NotFound|ResourceNotFound|InvalidDomainName\.NoExist/i.test((error as Error).message)) throw error;
                }
            }
        }
        throw new Error("No accessible authoritative zone for this domain");
    }

    private relative(zone: DnsZone, name: string): string {
        if (name !== zone.name && !name.endsWith(`.${zone.name}`)) throw new Error("Record outside authoritative zone");
        return name === zone.name ? "@" : name.slice(0, -zone.name.length - 1);
    }

    async present(name: string, value: string, marker: string): Promise<TxtHandle> {
        if (!/^[a-zA-Z0-9_-]{20,256}$/.test(value)) throw new Error("Invalid ACME TXT value");
        const zone = await this.zone(name);
        const relative = this.relative(zone, name);
        let records: any[] = [];
        for (let page = 1; page <= 100; page++) {
            let total = 0;
            if (this.account.provider === "cloudflare") {
                const data = await this.cf(`/zones/${zone.id}/dns_records?type=TXT&name=${encodeURIComponent(name)}&per_page=100&page=${page}`);
                records.push(...data.result.map((item: any) => ({id: item.id, value: item.content, marker: item.comment})));
                total = data.result_info?.total_count ?? records.length;
            } else if (this.account.provider === "dnspod") {
                const data = await this.call("DescribeRecordList", {Domain: zone.name, Subdomain: relative,
                    RecordType: "TXT", Offset: (page - 1) * 100, Limit: 100}).catch((error) => {
                    if (/ResourceNotFound\.NoDataOfRecord/.test(error.message)) return {RecordList: []};
                    throw error;
                });
                records.push(...(data.RecordList ?? []).filter((item: any) => item.Name === relative)
                    .map((item: any) => ({id: item.RecordId, value: item.Value, marker: item.Remark})));
                total = data.RecordCountInfo?.TotalCount ?? records.length;
            } else {
                const data = await this.call("DescribeSubDomainRecords", {SubDomain: name, Type: "TXT", PageNumber: page, PageSize: 100});
                records.push(...(data.DomainRecords?.Record ?? []).filter((item: any) => item.RR === relative)
                    .map((item: any) => ({id: item.RecordId, value: item.Value, marker: item.Remark})));
                total = data.TotalCount ?? records.length;
            }
            if (page * 100 >= total) break;
            if (page === 100) throw new Error("DNS record list exceeds safe limit");
        }
        const existing = records.find((record) => record.value === value);
        if (existing) return {id: String(existing.id), zone, name, value, owned: existing.marker === marker};
        let id: string;
        if (this.account.provider === "cloudflare") {
            id = String((await this.cf(`/zones/${zone.id}/dns_records`, "POST", {
                name, content: value, type: "TXT", ttl: 60, comment: marker,
            })).result.id);
        } else if (this.account.provider === "dnspod") {
            const data = await this.call("CreateRecord", {Domain: zone.name, SubDomain: relative,
                RecordType: "TXT", RecordLine: "\u9ed8\u8ba4", Value: value, TTL: 600, Remark: marker});
            id = String(data.RecordId);
        } else {
            const data = await this.call("AddDomainRecord", {DomainName: zone.name, RR: relative,
                Type: "TXT", Value: value, TTL: 600});
            id = String(data.RecordId);
        }
        if (!id || id === "undefined") throw new Error("DNS provider returned no record id");
        return {id, zone, name, value, owned: true};
    }

    async cleanup(handle: TxtHandle): Promise<void> {
        if (!handle.owned) return;
        if (!accountScope(this.account) && !inScope(handle.name.replace(/^_acme-challenge\./, ""), this.account.zones)) throw new Error("DNS cleanup outside scope");
        if (this.account.provider === "cloudflare") {
            const record = (await this.cf(`/zones/${handle.zone.id}/dns_records/${handle.id}`, "GET", undefined, true)).result;
            if (!record) return;
            if (record.type !== "TXT" || record.name !== handle.name || record.content !== handle.value) {
                throw new Error("DNS record changed; refusing cleanup");
            }
            await this.cf(`/zones/${handle.zone.id}/dns_records/${handle.id}`, "DELETE", undefined, true);
        } else {
            const record = await this.call(this.account.provider === "dnspod" ? "DescribeRecord" : "DescribeDomainRecordInfo",
                this.account.provider === "dnspod" ? {Domain: handle.zone.name, RecordId: Number(handle.id)} : {RecordId: handle.id}).catch((error) => {
                    if (/NoDataOfRecord|RecordNotFound|InvalidRecordId\.NotFound/.test(error.message)) return null;
                    throw error;
                });
            if (!record) return;
            const item = record.RecordInfo ?? record;
            if (item.Value !== handle.value || (item.RecordType ?? item.Type) !== "TXT"
                || (item.SubDomain ?? item.RR) !== this.relative(handle.zone, handle.name)) {
                throw new Error("DNS record changed; refusing cleanup");
            }
            await this.call(this.account.provider === "dnspod" ? "DeleteRecord" : "DeleteDomainRecord",
                this.account.provider === "dnspod" ? {Domain: handle.zone.name, RecordId: Number(handle.id)} : {RecordId: handle.id});
        }
    }
}

function decodeTxtAnswer(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const presentation = value.trim();
    if (!presentation.startsWith('"')) return value;
    const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"/g;
    const chunks = presentation.match(pattern);
    if (!chunks || presentation.replace(pattern, '').trim()) return null;
    try { return chunks.map((chunk) => JSON.parse(chunk)).join(''); }
    catch { return null; }
}

export async function txtPropagated(name: string, expected: string): Promise<boolean> {
    for (const resolver of ["https://cloudflare-dns.com/dns-query", "https://dns.google/resolve"]) {
        const response = await fetch(`${resolver}?${new URLSearchParams({name, type: "TXT"})}`, {
            headers: {Accept: "application/dns-json"}, signal: AbortSignal.timeout(5000), redirect: "manual",
        });
        if (!response.ok) throw new Error(`Public DNS query failed (${new URL(resolver).hostname}, HTTP ${response.status})`);
        const data = await readBoundedJson(response);
        const matched = data.Answer?.some((record: any) => record.type === 16 && decodeTxtAnswer(record.data) === expected);
        if (!matched) return false;
    }
    return true;
}

export function delegationTarget(existing: string | undefined, hash: string, zone: string, pattern?: string): string {
    if (existing) return existing;
    if (!/^[a-f0-9]{16}$/.test(hash) || !/^([a-z0-9-]+\.)+[a-z]{2,63}$/.test(zone)) throw new Error("Administrator DCV zone is not configured");
    const template = pattern || "{hash}.{zone}";
    if (!template.includes("{hash}")) throw new Error("DCV target pattern must contain {hash}");
    const target = template.replaceAll("{hash}", hash).replaceAll("{zone}", zone);
    if (!target.endsWith(`.${zone}`) || !/^([a-z0-9-]+\.)+[a-z]{2,63}$/.test(target) || target.length > 253) {
        throw new Error("DCV target must remain inside the administrator DCV zone");
    }
    return target;
}