// SSRF 防护: 共享 URL 安全校验
// 只阻断云实例元数据端点，允许本地模型提供商（Ollama、LocalAI 等）
// 设计决策：Pi Desktop 用户经常在本地运行模型，阻止 localhost/private IP 会破坏正常使用。
// 真正的 SSRF 风险在于云提供商元数据端点，可泄露凭证。

/**
 * 校验 URL 是否安全 (SSRF 防护).
 * 只允许 http/https 协议；阻断云实例元数据端点与链路本地地址。
 */
export function isSafeUrl(urlString: string): boolean {
    try {
        const url = new URL(urlString);
        // 只允许 http 和 https 协议
        if (url.protocol !== "http:" && url.protocol !== "https:") return false;
        const hostname = url.hostname.toLowerCase();
        // 阻止云实例元数据端点（SSRF 主要风险）
        const metadataHostnames = [
            "169.254.169.254",   // AWS / Azure / GCP 元数据
            "metadata.google.internal", // GCP 元数据
        ];
        if (metadataHostnames.includes(hostname)) return false;
        // 阻止 169.254.0.0/16 link-local 段（链路本地地址，包含云元数据）
        const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
        if (ipv4Match) {
            const [, a, b] = ipv4Match.map(Number);
            if (a === 169 && b === 254) return false; // 169.254.0.0/16 链路本地（含云元数据）
        }
        // 阻止 IPv6 元数据端点 (AWS IMDSv2 IPv6 / 链路本地)
        const ipv6Metadata = [
            "fd00:ec2::254",     // AWS IMDS IPv6
            "[fd00:ec2::254]",
            "[fd00:ec2::254]:80",
        ];
        if (ipv6Metadata.includes(hostname)) return false;
        // IPv6 链路本地 fe80::/10 — 形如 fe80::... 或 [fe80::...]
        const stripped = hostname.replace(/^\[|\]$/g, "");
        if (/^fe[89ab][0-9a-f]:/i.test(stripped)) return false;
        return true;
    } catch {
        return false;
    }
}
