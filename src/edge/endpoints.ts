export type CloudMarket = 'mainland' | 'international';

export function cloudMarket(value?: string): CloudMarket {
    if (value === undefined || value === '' || value === 'mainland') return 'mainland';
    if (value === 'international') return value;
    throw new Error('请选择中国站或国际站');
}

export function esaEndpoint(market?: string, legacy?: string): string {
    const selected = cloudMarket(market);
    const host = selected === 'international' ? 'esa.ap-southeast-1.aliyuncs.com' : 'esa.cn-hangzhou.aliyuncs.com';
    if (!legacy || legacy === 'esa.aliyuncs.com') return host;
    if (!['esa.cn-hangzhou.aliyuncs.com', 'esa.ap-southeast-1.aliyuncs.com', 'alidns.cn-hangzhou.aliyuncs.com'].includes(legacy)) {
        throw new Error('不支持的阿里云 API 地址');
    }
    if (market && legacy !== 'alidns.cn-hangzhou.aliyuncs.com' && legacy !== host) throw new Error('账号站点与 API 地址不匹配');
    return legacy;
}

export function tencentEndpoint(service: 'teo' | 'ssl', market?: string): string {
    const selected = cloudMarket(market);
    return service === 'ssl' ? 'ssl.tencentcloudapi.com' : selected === 'international'
        ? 'teo.intl.tencentcloudapi.com' : 'teo.tencentcloudapi.com';
}