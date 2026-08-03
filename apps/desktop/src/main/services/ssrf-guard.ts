// SSRF 防护: 共享 URL 安全校验
// 只阻断云实例元数据端点，允许本地模型提供商（Ollama、LocalAI 等）
// 设计决策：Pi Desktop 用户经常在本地运行模型，阻止 localhost/private IP 会破坏正常使用。
// 真正的 SSRF 风险在于云提供商元数据端点，可泄露凭证。

/**
 * 校验 URL 是否安全 (SSRF 防护).
 * 只允许 http/https 协议；阻断云实例元数据端点与链路本地地址。
 *
 * URL 会先经过 WHATWG parser 的规范化，因此十进制/十六进制/八进制
 * IPv4、尾随点和 IPv4-mapped IPv6 形式也会落到同一组检查中。
 */
export function isSafeUrl(urlString: string): boolean {
    try {
        const url = new URL(urlString);
        // 只允许 http 和 https 协议
        if (url.protocol !== "http:" && url.protocol !== "https:") return false;
        const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
        // 阻止云实例元数据端点（SSRF 主要风险）
        const metadataHostnames = [
            "169.254.169.254",   // AWS / Azure / GCP 元数据
            "metadata.google.internal", // GCP 元数据
        ];
        if (metadataHostnames.includes(hostname)) return false;
        // 阻止 169.254.0.0/16 link-local 段（链路本地地址，包含云元数据）
        const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
        if (ipv4Match) {
            const [, a, b, c, d] = ipv4Match.map(Number);
            if ([a, b, c, d].some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
            if (a === 169 && b === 254) return false; // 169.254.0.0/16 链路本地（含云元数据）
        }
        // URL parser 会把 IPv4-mapped IPv6 规范化为十六进制；阻止映射后的
        // metadata/link-local 地址，避免用 [::ffff:169.254.x.x] 绕过 IPv4 检查。
        const stripped = hostname.replace(/^\[|\]$/g, "");
        if (/^::ffff:(?:a9fe:[0-9a-f]{1,4}|169\.254\.)/i.test(stripped)) return false;
        // 阻止 IPv6 元数据端点 (AWS IMDSv2 IPv6 / 链路本地)
        const ipv6Metadata = [
            "fd00:ec2::254",     // AWS IMDS IPv6
            "[fd00:ec2::254]",
            "[fd00:ec2::254]:80",
        ];
        if (ipv6Metadata.includes(hostname)) return false;
        // IPv6 链路本地 fe80::/10 — 形如 fe80::... 或 [fe80::...]
        if (/^fe[89ab][0-9a-f]:/i.test(stripped)) return false;
        return true;
    } catch {
        return false;
    }
}

function isRedirectStatus(status: number): boolean {
    return status >= 300 && status < 400;
}

/**
 * Fetch a URL while validating every manually-followed redirect.
 * Redirects to local metadata/link-local addresses are rejected before a
 * second request is made. Manual mode also prevents fetch from following an
 * unsafe Location header implicitly.
 */
export async function fetchWithSafeRedirects(
    url: string,
    init: RequestInit = {},
    maxRedirects = 5,
): Promise<Response> {
    let currentUrl = url;
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
        if (!isSafeUrl(currentUrl)) throw new Error("不安全的 URL: 禁止访问云元数据地址或非 HTTP(S) 协议");
        const response = await fetch(currentUrl, { ...init, redirect: "manual" });
        if (!isRedirectStatus(response.status)) {
            if (response.url && !isSafeUrl(response.url)) {
                throw new Error("不安全的重定向目标");
            }
            return response;
        }
        if (redirectCount === maxRedirects) throw new Error("重定向次数超过限制");
        const location = response.headers?.get("location");
        if (!location) throw new Error("重定向响应缺少 Location");
        currentUrl = new URL(location, currentUrl).toString();
    }
    throw new Error("重定向次数超过限制");
}
