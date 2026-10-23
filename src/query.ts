// 域名记录 #######################

import {dnsAll, dnsAPI, uidDel} from "./agent";
import {a} from "xior/xior-D_RKcIOK";
import {readConf} from "./db/conf";
import {ensureDao} from "./db";

interface DnsResponse {
    Status: number; // 查询响应状态
    Answer: { // 返回的查询完整结果
        name: string; // 查询的域名
        type: string; // 查询的类型
        time: number; // 查询有效期
        data: string; // 查询的结果
    };
}

// 解析域名 ################################################################
export async function queryDNS( // =========================================
    domain: string,/* 待查询的域名 */ record: string = "TXT", // 查询类型TXT
    server: string = "https://dns.google/resolve"): Promise<DnsResponse[]> {
    // 查询参数设置 ========================================================
    const params = new URLSearchParams({name: domain, type: record}); // URL
    console.log(`${server}?${params}`);
    try { // 查询过程 ======================================================
        const response = await fetch(`${server}?${params}`);
        if (!response.ok) { // 如果查询失败了 ==============================
            console.error(`查询域名失败: ${response.status}`);
            return []; // 返回空数据保证不异常 =============================
        } // 解析查询数据 ==================================================
        const data: any = await response.json();
        console.log(data);
        if (!data.Answer) return [];
        let txtRecords: any = data.Answer.map( // 映射查询数据 ======
            (r: any) => ({
                name: r.name, type: r.type, time: r.TTL,
                data: r.data.endsWith('.') ? r.data.substring(0, r.data.length - 1) : r.data,
            }));
        // console.log("txtRecords: ", txtRecords);
        return txtRecords || [];
    } catch (error) {
        console.error('解析数据失败:', error);
        return [];
    }
}

// 解析域名 ################################################################
export async function retryDnsCleanup(env: any): Promise<number> {
    const dao = await ensureDao(env);
    const {rows} = await dao.listApplies({like: {list: "cleanup_pending"}}, {page: 1, pageSize: 100});
    let cleaned = 0;
    for (const row of rows) {
        if (!dao.claimConfLease || !dao.releaseConfLease || !dao.updateApplyListIfUnchanged) continue;
        const lease = `DNS_CLEANUP_LEASE:${row.uuid}`;
        const token = crypto.randomUUID();
        if (!await dao.claimConfLease(lease, token, Date.now() + 120000, Date.now())) continue;
        try {
            const fresh = await dao.getApply(row.uuid);
            if (!fresh) continue;
            const list = JSON.parse(fresh.list || "[]");
            let changed = false;
            let attempts = 0;
            for (const item of list) {
                if (item.dnsStatus !== "cleanup_pending" || attempts++ >= 8) continue;
                try {
                    await (await import("./certs")).cleanupDomainDns(env, row.mail, item);
                    changed = true;
                    cleaned++;
                } catch {}
            }
            if (changed) await dao.updateApplyListIfUnchanged(row.uuid, fresh.list, JSON.stringify(list));
        } finally { await dao.releaseConfLease(lease, token); }
    }
    return cleaned;
}

export async function cleanDNS(env: any) { // ===============
    const retried = await retryDnsCleanup(env);
    let counter: number = 0;
    const suffix = (await readConf(env, "DCV_AGENT") ?? "").trim().toLowerCase();
    if (!suffix) return {flag: true, text: `DNS cleanup completed: ${retried}; legacy DCV zone is not configured`};
    let records: Record<string, any> | any = await dnsAll(env);
    const dao = await ensureDao(env);
    const protectedIds = new Set<string>();
    for (let page = 1; ; page++) {
        const {rows, total} = await dao.listApplies({}, {page, pageSize: 200});
        for (const row of rows) {
            const list = JSON.parse(row.list || "[]");
            for (const item of list) {
                if (item.legacyRecordId) protectedIds.add(item.legacyRecordId);
            }
        }
        if (page * 200 >= total) break;
    }
    if (records['result']) records = records['result']
    for (let single of records) {
        let rec_name: string = single['name'];
        let rec_date: string = single['modified_on'];
        let rec_uuid: string = single['id'];
        let delete_t: string = ''
        if (rec_name.endsWith(`.${suffix}`) && /^[a-f0-9]{16}$/.test(rec_name.slice(0, -suffix.length - 1))
            && single.type === "TXT" && single.comment?.startsWith("DCV-Agent#") && !protectedIds.has(rec_uuid)) {
            let num_date = new Date(rec_date).getTime();
            let now_date = Date.now();
            if (Math.abs(now_date - num_date) >= 7 * 24 * 60 * 60 * 1000) {
                await uidDel(env, rec_uuid)
                delete_t = "Deleted"
                counter += 1
            }
            console.log(rec_uuid, rec_date, rec_name, delete_t)
        }
    }
    return {"flag": true, "text": `已经清理\`${counter}\`个DNS记录`}
}
