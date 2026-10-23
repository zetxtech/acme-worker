import {Bindings} from "./index";
import {readConf} from "./db/conf";
import {unseal} from "./resources";

/**
 * 读取 DCV 相关配置：Confs → env → ""
 * 单次请求周期内多次访问同一 key 由 readConf 内部缓存兜底，性能与直读 env 接近。
 */
async function dcv(env: Bindings, name: "DCV_ZONES" | "DCV_EMAIL" | "DCV_TOKEN"): Promise<string> {
    return (await readConf(env as any, name)) ?? "";
}

async function authentication(env: Bindings): Promise<Record<string, string>> {
    const encrypted = await readConf(env, "DCV_API_TOKEN_ENCRYPTED");
    if (encrypted) {
        const credentials = await unseal(env.AUTOMATION_KEY, "DCV_AUTH", encrypted);
        if (!credentials.token) throw new Error("Cloudflare DCV credentials are unavailable");
        return {Authorization: `Bearer ${credentials.token}`};
    }
    const token = (await readConf(env, "DCV_API_TOKEN"))?.trim();
    if (token) return {Authorization: `Bearer ${token}`};
    const [email, key] = await Promise.all([dcv(env, "DCV_EMAIL"), dcv(env, "DCV_TOKEN")]);
    if (!email || !key) throw new Error("Cloudflare DCV credentials are not configured");
    return {"X-Auth-Email": email, "X-Auth-Key": key};
}

export async function dnsAdd(env: Bindings, domain_item: any, domain_name: string) {
    const zones = await dcv(env, "DCV_ZONES");
    return dnsAPI(
        "POST", `https://api.cloudflare.com/client/v4/zones/${zones}/dns_records`,
        {
            'Content-Type': 'application/json',
            ...await authentication(env),
        },
        JSON.stringify({
            comment: 'DCV-Agent#' + Date.now() + '@' + domain_name,
            content: domain_item['auth'],
            name: domain_item['auto'],
            ttl: 60,
            type: 'TXT'
        }))
}

export async function dnsDel(env: Bindings, domain_name: string, domain_type: string = "TXT") {
    let domain_uuid: string = await dnsUID(env, domain_name, domain_type);
    return await uidDel(env, domain_uuid);

}

export async function dnsUID(env: Bindings, domain_name: string, domain_type: string = "TXT") {
    let domain_list: Record<string, any> = await dnsAll(env);
    let domain_uuid = "";
    for (const domain_item of domain_list['result']) {
        // console.log(domain_item['name'], domain_name);
        if (domain_item['name'] === domain_name
            && domain_item.type == domain_type) {
            domain_uuid = domain_item['id'];
            break;
        }
    }
    return domain_uuid;
}

export async function dnsAll(env: Bindings) {
    const zones = await dcv(env, "DCV_ZONES");
    return dnsAPI(
        "GET", `https://api.cloudflare.com/client/v4/zones/${zones}/dns_records`,
        {
            ...await authentication(env),
        }, undefined)
}

export async function uidDel(env: Bindings, domain_uuid: string) {
    const zones = await dcv(env, "DCV_ZONES");
    return dnsAPI(
        "DELETE", `https://api.cloudflare.com/client/v4/zones/${zones}/dns_records/${domain_uuid}`,
        {
            ...await authentication(env),
        }, undefined)
}

export async function dnsAPI(method: string = "POST",
                             url: string,
                             header: Record<string, any>,
                             body: BodyInit | null | undefined) {
    try {
        console.log(method, url);
        const response = await fetch(url,
            {
                method: method,
                headers: header,
                body: body,
                signal: AbortSignal.timeout(15000),
                redirect: "error",
            }
        );
        const data: Record<string, any> = await response.json();
        // console.log('Result:', data);
        return data;
    } catch (error) {
        return {success: false, errors: [{message: "Cloudflare DNS request failed"}]};
    }
}
