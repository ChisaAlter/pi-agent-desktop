// SSRF 防护单元测试 — 锁定 `isSafeUrl` 现有语义。
//
// 设计决策 (来自 ssrf-guard.ts 顶部注释): 允许 localhost / RFC1918 私网,
// 因为 Pi Desktop 用户经常在本地跑模型 (Ollama / LocalAI); 真正要挡的是
// 云实例元数据端点, 那才是会泄露凭证的 SSRF 风险。本测试把这一语义
// 表驱动锁定, 防止后续重构悄悄改变行为。

import { describe, expect, it } from "vitest";
import { isSafeUrl } from "../ssrf-guard";

type Case = { label: string; url: string; expected: boolean };

const ALLOWED: Case[] = [
    { label: "公网 HTTPS API", url: "https://api.openai.com/v1/chat/completions", expected: true },
    { label: "公网 HTTP", url: "http://example.com/path", expected: true },
    { label: "localhost (本地模型)", url: "http://127.0.0.1:11434/v1", expected: true },
    { label: "localhost 主机名", url: "http://localhost:11434", expected: true },
    { label: "IPv6 loopback (本地模型)", url: "http://[::1]:11434/v1", expected: true },
    { label: "RFC1918 私网 10.x", url: "http://10.0.0.1:8080", expected: true },
    { label: "RFC1918 私网 192.168.x", url: "http://192.168.1.10:8080", expected: true },
    { label: "RFC1918 私网 172.16.x", url: "http://172.16.0.1:8080", expected: true },
    { label: "带查询字符串的合法 URL", url: "https://api.anthropic.com/v1/messages?beta=true", expected: true },
    { label: "带 userinfo 的 HTTPS", url: "https://user:pass@api.example.com/v1", expected: true },
    { label: "metadata 主机名子域不误伤", url: "https://metadata.google.internal.evil.com/", expected: true },
    // wave-84 residual allow edges
    { label: "公网带路径与 fragment", url: "https://example.com/a/b#section", expected: true },
    { label: "0.0.0.0 绑定地址 (本地)", url: "http://0.0.0.0:8080", expected: true },
];

const BLOCKED: Case[] = [
    { label: "AWS/Azure/GCP 元数据 IPv4", url: "http://169.254.169.254/latest/meta-data/", expected: false },
    { label: "GCP 元数据主机名", url: "http://metadata.google.internal/computeMetadata/v1/", expected: false },
    { label: "GCP 元数据主机名 (大小写)", url: "http://Metadata.Google.Internal/computeMetadata/v1/", expected: false },
    { label: "169.254.0.0/16 链路本地任意地址", url: "http://169.254.0.1/", expected: false },
    { label: "169.254.255.255 链路本地上界", url: "http://169.254.255.255/", expected: false },
    { label: "AWS IMDS IPv6 端点", url: "http://[fd00:ec2::254]/", expected: false },
    { label: "AWS IMDS IPv6 带端口", url: "http://[fd00:ec2::254]:80/", expected: false },
    { label: "IPv6 链路本地 fe80::1", url: "http://[fe80::1]/", expected: false },
    { label: "IPv6 链路本地 fe89::", url: "http://[fe89::1]/", expected: false },
    { label: "HTTPS 元数据仍按主机拒绝", url: "https://169.254.169.254/latest/meta-data/", expected: false },
    { label: "file:// 协议", url: "file:///C:/Users/secret/config.json", expected: false },
    { label: "javascript: 协议", url: "javascript:alert(1)", expected: false },
    { label: "data: 协议", url: "data:text/plain;base64,aGVsbG8=", expected: false },
    { label: "非 URL 字符串", url: "not a url", expected: false },
    { label: "空字符串", url: "", expected: false },
    { label: "仅协议", url: "http://", expected: false },
    { label: "ftp 协议", url: "ftp://example.com/file", expected: false },
    // wave-84 residual edges
    { label: "WS 协议", url: "ws://example.com/socket", expected: false },
    { label: "WSS 协议", url: "wss://example.com/socket", expected: false },
    { label: "blob 协议", url: "blob:https://example.com/uuid", expected: false },
    { label: "IPv6 链路本地 fea0", url: "http://[fea0::1]/", expected: false },
    { label: "IPv6 链路本地 febf", url: "http://[febf::abcd]/", expected: false },
    { label: "metadata host with port", url: "http://metadata.google.internal:80/computeMetadata/v1/", expected: false },
];

describe("isSafeUrl", () => {
    describe.each(ALLOWED)("允许 $label", ({ url, expected }) => {
        it(`returns ${expected} for ${url}`, () => {
            expect(isSafeUrl(url)).toBe(expected);
        });
    });

    describe.each(BLOCKED)("拒绝 $label", ({ url, expected }) => {
        it(`returns ${expected} for ${url}`, () => {
            expect(isSafeUrl(url)).toBe(expected);
        });
    });

    // wave-96 residual
    it("blocks AWS IMDS with userinfo and path tricks", () => {
        expect(isSafeUrl("http://user@169.254.169.254/latest/meta-data/")).toBe(false);
        expect(isSafeUrl("http://169.254.169.254:80/latest/meta-data/")).toBe(false);
        expect(isSafeUrl("https://169.254.169.254")).toBe(false);
    });

    it("allows non-metadata 169.x that is not 169.254/16", () => {
        // 169.253.x is not link-local 169.254/16 — current guard only blocks 169.254
        expect(isSafeUrl("http://169.253.1.1/")).toBe(true);
        expect(isSafeUrl("http://168.254.1.1/")).toBe(true);
    });

    it("allows IPv6 non-link-local public-style hosts", () => {
        expect(isSafeUrl("http://[2001:db8::1]/")).toBe(true);
        expect(isSafeUrl("https://[2001:db8::1]:443/path")).toBe(true);
    });

    it("blocks uppercase protocol variants that URL normalizes or rejects", () => {
        // WHATWG URL lowercases protocol; HTTPS/HTTP still allowed for safe hosts
        expect(isSafeUrl("HTTPS://example.com")).toBe(true);
        expect(isSafeUrl("HTTP://localhost")).toBe(true);
        expect(isSafeUrl("FILE:///etc/passwd")).toBe(false);
    });

    // wave-115 residual
    it("blocks bare fd00:ec2::254 hostname variants without brackets when present", () => {
        // URL parser may keep hostname without brackets for some IPv6 forms; product checks both
        expect(isSafeUrl("http://[fd00:ec2::254]/")).toBe(false);
        expect(isSafeUrl("http://[fd00:ec2::254]:80/latest")).toBe(false);
    });

    it("allows fe70 and fec0 which are outside fe80::/10 link-local band", () => {
        // fe[89ab] only — fe70 / fec0 should remain allowed under current guard
        expect(isSafeUrl("http://[fe70::1]/")).toBe(true);
        expect(isSafeUrl("http://[fec0::1]/")).toBe(true);
    });

    it("rejects whitespace-only and protocol-relative inputs", () => {
        expect(isSafeUrl("   ")).toBe(false);
        expect(isSafeUrl("//example.com/path")).toBe(false);
        // WHATWG URL treats http:///no-host as empty host + path; product currently allows it
        expect(isSafeUrl("http:///no-host")).toBe(true);
    });

    // wave-125 residual
    it("blocks AWS/Azure/GCP metadata host and full 169.254/16 range edges", () => {
        expect(isSafeUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
        expect(isSafeUrl("http://169.254.0.0/")).toBe(false);
        expect(isSafeUrl("http://169.254.255.255/")).toBe(false);
        expect(isSafeUrl("http://metadata.google.internal/computeMetadata/v1/")).toBe(false);
        expect(isSafeUrl("https://METADATA.GOOGLE.INTERNAL/")).toBe(false);
    });

    it("blocks IPv6 link-local fe80/fe9/fea/feb and allows public hosts with ports", () => {
        expect(isSafeUrl("http://[fe80::1]/")).toBe(false);
        expect(isSafeUrl("http://[fe9a::abcd]/")).toBe(false);
        expect(isSafeUrl("http://[feaa::1]/")).toBe(false);
        expect(isSafeUrl("http://[febf::1]/")).toBe(false);
        expect(isSafeUrl("https://api.example.com:8443/v1")).toBe(true);
        expect(isSafeUrl("http://127.0.0.1:0/")).toBe(true);
    });

    it("rejects non-http schemes and malformed inputs", () => {
        expect(isSafeUrl("ftp://example.com")).toBe(false);
        expect(isSafeUrl("ws://example.com")).toBe(false);
        expect(isSafeUrl("not a url")).toBe(false);
        expect(isSafeUrl("")).toBe(false);
    });

    // wave-131 residual
    it("allows public https with query/hash and custom ports", () => {
        expect(isSafeUrl("https://example.com/path?q=1#frag")).toBe(true);
        expect(isSafeUrl("http://example.com:8080/health")).toBe(true);
    });

    it("allows loopback and 0.0.0.0 for local model providers (by design)", () => {
        // product: only cloud metadata + 169.254/16 + fe80::/10 are blocked; localhost is allowed
        expect(isSafeUrl("http://[::1]/")).toBe(true);
        expect(isSafeUrl("http://[::ffff:127.0.0.1]/")).toBe(true);
        expect(isSafeUrl("http://0.0.0.0/")).toBe(true);
        expect(isSafeUrl("http://127.0.0.1:11434/")).toBe(true);
    });

    it("blocks data and blob schemes", () => {
        expect(isSafeUrl("data:text/html,hi")).toBe(false);
        expect(isSafeUrl("blob:https://example.com/uuid")).toBe(false);
    });

    // wave-148 residual
    it("blocks AWS IMDS IPv6 metadata host forms", () => {
        expect(isSafeUrl("http://fd00:ec2::254/")).toBe(false);
        expect(isSafeUrl("http://[fd00:ec2::254]/")).toBe(false);
        expect(isSafeUrl("http://[fd00:ec2::254]:80/")).toBe(false);
    });

    it("allows private RFC1918 and localhost hostnames by design", () => {
        expect(isSafeUrl("http://10.0.0.5/")).toBe(true);
        expect(isSafeUrl("http://192.168.1.10:3000/")).toBe(true);
        expect(isSafeUrl("http://172.16.0.1/")).toBe(true);
        expect(isSafeUrl("http://localhost:11434/api/tags")).toBe(true);
    });

    it("blocks uppercase metadata host and mixed-case link-local", () => {
        expect(isSafeUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
        expect(isSafeUrl("HTTP://Metadata.Google.Internal/")).toBe(false);
        // product: only fe80/fe9/fea/feb link-local prefix is blocked for IPv6
        expect(isSafeUrl("http://[FE80::ABCD]/")).toBe(false);
    });

    it("rejects file/javascript schemes and bare host tokens", () => {
        expect(isSafeUrl("file:///C:/Windows/System32")).toBe(false);
        expect(isSafeUrl("javascript:alert(1)")).toBe(false);
        expect(isSafeUrl("example.com")).toBe(false);
    });

    // wave-154 residual
    it("rejects empty/whitespace and about:blank style schemes", () => {
        expect(isSafeUrl("")).toBe(false);
        expect(isSafeUrl("   ")).toBe(false);
        expect(isSafeUrl("about:blank")).toBe(false);
        expect(isSafeUrl("ftp://example.com/")).toBe(false);
        expect(isSafeUrl("ws://example.com/")).toBe(false);
    });

    it("blocks link-local 169.254 with custom ports and paths", () => {
        expect(isSafeUrl("http://169.254.1.1:8080/latest")).toBe(false);
        expect(isSafeUrl("https://169.254.169.254/latest/meta-data/iam")).toBe(false);
        // adjacent non-link-local stays allowed by design
        expect(isSafeUrl("http://169.253.1.1/")).toBe(true);
        expect(isSafeUrl("http://170.254.1.1/")).toBe(true);
    });

    it("allows userinfo and trailing-dot hostnames for public hosts", () => {
        // product only checks protocol + hostname metadata lists; userinfo is ok
        expect(isSafeUrl("https://user:pass@example.com/v1")).toBe(true);
        expect(isSafeUrl("http://example.com./")).toBe(true);
    });

    it("blocks fe80 variants and allows non-link-local IPv6", () => {
        expect(isSafeUrl("http://[fe80::1]/")).toBe(false);
        expect(isSafeUrl("http://[FEA0::1]/")).toBe(false);
        expect(isSafeUrl("http://[febf::1]/")).toBe(false);
        // fe70 is outside fe80/fe9/fea/feb link-local band used by product
        expect(isSafeUrl("http://[fe70::1]/")).toBe(true);
        expect(isSafeUrl("http://[2001:db8::1]/")).toBe(true);
    });

    // wave-160 residual
    it("blocks exact metadata hostnames case-insensitively and allows near-misses", () => {
        expect(isSafeUrl("http://Metadata.Google.Internal/")).toBe(false);
        expect(isSafeUrl("http://169.254.169.254")).toBe(false);
        // not exact metadata hostname list entry
        expect(isSafeUrl("http://metadata.google.internal.evil.com/")).toBe(true);
        expect(isSafeUrl("http://169.254.169.254.nip.io/")).toBe(true);
    });

    it("allows private RFC1918 and loopback by design", () => {
        expect(isSafeUrl("http://127.0.0.1:11434/")).toBe(true);
        expect(isSafeUrl("http://localhost:8080/")).toBe(true);
        expect(isSafeUrl("http://10.0.0.5/")).toBe(true);
        expect(isSafeUrl("http://192.168.1.1/")).toBe(true);
        expect(isSafeUrl("http://172.16.0.1/")).toBe(true);
    });

    it("blocks AWS IMDS IPv6 metadata forms and allows other ULA", () => {
        expect(isSafeUrl("http://[fd00:ec2::254]/")).toBe(false);
        // product checks hostname string against list including bracketed form
        expect(isSafeUrl("http://fd00:ec2::254/")).toBe(false);
        expect(isSafeUrl("http://[fd00:1234::1]/")).toBe(true);
    });

    it("rejects malformed URLs without throw", () => {
        expect(isSafeUrl("http://")).toBe(false);
        expect(isSafeUrl("not a url")).toBe(false);
        expect(isSafeUrl("://missing-scheme")).toBe(false);
    });

    // wave-179 residual
    it("blocks 169.254.0.0/16 endpoints including edges and https+port", () => {
        expect(isSafeUrl("http://169.254.0.0/")).toBe(false);
        expect(isSafeUrl("https://169.254.255.255:443/path?x=1")).toBe(false);
        expect(isSafeUrl("http://169.254.169.254:80/latest/meta-data")).toBe(false);
        // not link-local: 169.255 and 168.254
        expect(isSafeUrl("http://169.255.0.1/")).toBe(true);
        expect(isSafeUrl("http://168.254.0.1/")).toBe(true);
    });

    it("blocks mixed-case IPv6 link-local fe80/fe9/fea/feb and allows fec0", () => {
        expect(isSafeUrl("http://[FE80::ABCD]/")).toBe(false);
        expect(isSafeUrl("http://[fe9f::1]/")).toBe(false);
        expect(isSafeUrl("http://[FeB0::1]/")).toBe(false);
        // fec0 is outside fe[89ab] band
        expect(isSafeUrl("http://[fec0::1]/")).toBe(true);
    });

    it("allows query/hash/userinfo on public hosts and still blocks metadata with them", () => {
        expect(isSafeUrl("https://example.com/path?api=1#frag")).toBe(true);
        expect(isSafeUrl("http://user@example.com:8080/v1")).toBe(true);
        expect(isSafeUrl("http://metadata.google.internal/computeMetadata/v1?a=1")).toBe(false);
        expect(isSafeUrl("https://169.254.169.254/latest#x")).toBe(false);
    });

    // wave-188 residual
    it("allows RFC1918 and localhost variants; blocks only exact metadata hostnames", () => {
        expect(isSafeUrl("http://127.0.0.1")).toBe(true);
        expect(isSafeUrl("http://localhost")).toBe(true);
        expect(isSafeUrl("http://[::1]/")).toBe(true);
        expect(isSafeUrl("http://172.31.255.255")).toBe(true);
        // subdomain of metadata host is not in the exact-host list
        expect(isSafeUrl("http://metadata.google.internal.evil.com/")).toBe(true);
        expect(isSafeUrl("http://evil-169.254.169.254.example.com/")).toBe(true);
        expect(isSafeUrl("http://169.254.169.254.nip.io/")).toBe(true);
    });

    it("rejects non-http(s) schemes and whitespace-only without throw", () => {
        expect(isSafeUrl("   ")).toBe(false);
        expect(isSafeUrl("http")).toBe(false);
        expect(isSafeUrl("https")).toBe(false);
        expect(isSafeUrl("gopher://example.com")).toBe(false);
        expect(isSafeUrl("about:blank")).toBe(false);
    });

    // wave-194 residual
    it("blocks AWS IMDS IPv6 fd00:ec2::254 host forms", () => {
        expect(isSafeUrl("http://[fd00:ec2::254]/")).toBe(false);
        expect(isSafeUrl("http://[fd00:ec2::254]:80/latest")).toBe(false);
        // bare hostname forms listed in product (when URL parser keeps brackets stripped)
        expect(isSafeUrl("http://fd00:ec2::254/")).toBe(false);
    });

    it("allows public hosts with uppercase scheme-insensitive host and blocks METADATA host exact", () => {
        expect(isSafeUrl("HTTP://Example.COM/path")).toBe(true);
        expect(isSafeUrl("https://METADATA.GOOGLE.INTERNAL/")).toBe(false);
        expect(isSafeUrl("http://169.254.169.254")).toBe(false);
        expect(isSafeUrl("https://api.openai.com/v1")).toBe(true);
    });

    it("rejects empty string and malformed brackets without throw", () => {
        expect(isSafeUrl("")).toBe(false);
        expect(isSafeUrl("http://[::1")).toBe(false);
        expect(isSafeUrl("http://%")).toBe(false);
    });

    // wave-198 residual
    it("allows localhost and private LAN while blocking any 169.254 link-local IPv4", () => {
        expect(isSafeUrl("http://localhost:11434/")).toBe(true);
        expect(isSafeUrl("http://127.0.0.1:8080/")).toBe(true);
        expect(isSafeUrl("http://10.0.0.5/api")).toBe(true);
        expect(isSafeUrl("http://192.168.1.10/")).toBe(true);
        expect(isSafeUrl("http://169.254.0.1/")).toBe(false);
        expect(isSafeUrl("http://169.254.255.255/")).toBe(false);
    });

    it("blocks fe80 link-local IPv6 variants and allows public IPv6 host", () => {
        expect(isSafeUrl("http://[fe80::1]/")).toBe(false);
        expect(isSafeUrl("http://[fe8a::abcd]/")).toBe(false);
        expect(isSafeUrl("http://[fe9f::2]/")).toBe(false);
        expect(isSafeUrl("http://[2001:db8::1]/")).toBe(true);
    });

    // wave-202 residual
    it("blocks metadata hosts case-insensitively over https and with ports; allows userinfo on public hosts", () => {
        expect(isSafeUrl("https://Metadata.Google.Internal/computeMetadata/v1/")).toBe(false);
        expect(isSafeUrl("https://169.254.169.254/latest/meta-data/")).toBe(false);
        expect(isSafeUrl("http://169.254.169.254:8080/")).toBe(false);
        expect(isSafeUrl("https://user:pass@api.example.com/v1")).toBe(true);
        expect(isSafeUrl("http://user@169.254.169.254/latest")).toBe(false);
    });

    it("allows 0.0.0.0 and IPv6 loopback; rejects non-url and file scheme", () => {
        expect(isSafeUrl("http://0.0.0.0:8080/")).toBe(true);
        expect(isSafeUrl("http://[::1]:11434/v1")).toBe(true);
        expect(isSafeUrl("file:///C:/windows/system32")).toBe(false);
        expect(isSafeUrl("://broken")).toBe(false);
        expect(isSafeUrl("http://exa mple.com")).toBe(false);
    });

    // wave-206 residual
    it("blocks only exact metadata hosts/IMDS; bare 'metadata' hostname is allowed", () => {
        // product: exact list metadata.google.internal + 169.254.169.254 (+ 169.254/16)
        expect(isSafeUrl("http://metadata.google.internal/")).toBe(false);
        // bare host "metadata" is not in the exact list → allowed (local model style)
        expect(isSafeUrl("http://metadata/computeMetadata/v1/")).toBe(true);
        expect(isSafeUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
        expect(isSafeUrl("http://[fd00:ec2::254]/")).toBe(false);
        expect(isSafeUrl("https://api.github.com/repos/x")).toBe(true);
    });

    it("allows localhost by design; rejects non-http schemes and empty", () => {
        // product intentionally allows localhost/private for local model providers
        expect(isSafeUrl("http://LocalHost/")).toBe(true);
        expect(isSafeUrl("http://127.0.0.1:3000/")).toBe(true);
        expect(isSafeUrl("https://example.com/path?q=1#frag")).toBe(true);
        expect(isSafeUrl("ftp://example.com/x")).toBe(false);
        expect(isSafeUrl("")).toBe(false);
    });

    // wave-211 residual
    it("blocks fe80/fe9/fea/feb link-local; allows fe7x and public; rejects data/blob/ws", () => {
        expect(isSafeUrl("http://[fe80::abcd]/")).toBe(false);
        expect(isSafeUrl("http://[fe90::1]/")).toBe(false);
        expect(isSafeUrl("http://[fea0::1]/")).toBe(false);
        expect(isSafeUrl("http://[febf::1]/")).toBe(false);
        // fe70 is outside fe80::/10 product regex fe[89ab]
        expect(isSafeUrl("http://[fe70::1]/")).toBe(true);
        expect(isSafeUrl("data:text/plain,hi")).toBe(false);
        expect(isSafeUrl("blob:https://example.com/uuid")).toBe(false);
        expect(isSafeUrl("ws://example.com/socket")).toBe(false);
        expect(isSafeUrl("wss://example.com/socket")).toBe(false);
    });

    it("rejects whitespace-only and javascript; allows trailing-dot hostnames", () => {
        expect(isSafeUrl("   ")).toBe(false);
        expect(isSafeUrl("javascript:alert(1)")).toBe(false);
        // URL parser accepts absolute http host with trailing dot
        expect(isSafeUrl("http://example.com./path")).toBe(true);
        expect(isSafeUrl("http://169.254.1.1")).toBe(false);
        expect(isSafeUrl("http://168.254.1.1")).toBe(true);
    });

    // wave-217 residual
    it("blocks entire 169.254.0.0/16 and metadata host case-insensitively over http(s)", () => {
        expect(isSafeUrl("http://169.254.0.1/")).toBe(false);
        expect(isSafeUrl("https://169.254.255.255/latest")).toBe(false);
        expect(isSafeUrl("http://169.254.169.254")).toBe(false);
        // adjacent non-link-local octets remain allowed
        expect(isSafeUrl("http://169.253.1.1")).toBe(true);
        expect(isSafeUrl("http://170.254.1.1")).toBe(true);
        expect(isSafeUrl("http://METADATA.GOOGLE.INTERNAL/computeMetadata/v1")).toBe(false);
        expect(isSafeUrl("https://Metadata.Google.Internal/")).toBe(false);
    });

    it("allows private/local model hosts by design; rejects file/about schemes", () => {
        expect(isSafeUrl("http://10.0.0.5:11434/api")).toBe(true);
        expect(isSafeUrl("http://192.168.1.10/v1")).toBe(true);
        expect(isSafeUrl("http://[::1]/")).toBe(true);
        expect(isSafeUrl("file:///c:/secrets")).toBe(false);
        expect(isSafeUrl("about:blank")).toBe(false);
        expect(isSafeUrl("http://[fd00:ec2::254]/")).toBe(false);
    });

    // wave-243 residual
    it("blocks fe80::/10 link-local IPv6 with and without brackets", () => {
        expect(isSafeUrl("http://[fe80::1]/")).toBe(false);
        expect(isSafeUrl("http://[fe8a::abcd]/")).toBe(false);
        expect(isSafeUrl("http://[feb0::1]/")).toBe(false);
        // fe70 is outside fe80-febf
        expect(isSafeUrl("http://[fe70::1]/")).toBe(true);
        expect(isSafeUrl("http://[fec0::1]/")).toBe(true);
        expect(isSafeUrl("http://fd00:ec2::254")).toBe(false);
        expect(isSafeUrl("http://[fd00:ec2::254]:80")).toBe(false);
    });

    it("rejects non-http(s) schemes and malformed URLs; allows localhost by design", () => {
        expect(isSafeUrl("ftp://example.com")).toBe(false);
        expect(isSafeUrl("data:text/plain,hi")).toBe(false);
        expect(isSafeUrl("not a url")).toBe(false);
        expect(isSafeUrl("")).toBe(false);
        expect(isSafeUrl("http://localhost:11434")).toBe(true);
        expect(isSafeUrl("http://127.0.0.1:8080")).toBe(true);
        expect(isSafeUrl("https://example.com:443/path?q=1#h")).toBe(true);
    });

    // wave-251 residual
    it("blocks 169.254.0.0/16 link-local including non-metadata hosts; allows 169.255.x", () => {
        expect(isSafeUrl("http://169.254.0.1/")).toBe(false);
        expect(isSafeUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
        expect(isSafeUrl("http://169.254.1.1:80/")).toBe(false);
        // adjacent /16 is not link-local metadata range
        expect(isSafeUrl("http://169.255.0.1/")).toBe(true);
        expect(isSafeUrl("http://168.254.0.1/")).toBe(true);
    });

    it("hostname case-insensitive metadata block; userinfo and path do not bypass", () => {
        expect(isSafeUrl("https://METADATA.GOOGLE.INTERNAL/computeMetadata/v1")).toBe(false);
        expect(isSafeUrl("http://user:pass@169.254.169.254/")).toBe(false);
        expect(isSafeUrl("http://user:pass@example.com/")).toBe(true);
        expect(isSafeUrl("https://Example.COM:8443/v1")).toBe(true);
    });

    // wave-260 residual
    it("blocks AWS IPv6 IMDS and fe80 link-local; allows public IPv6-looking hostnames that are not metadata", () => {
        expect(isSafeUrl("http://[fd00:ec2::254]/")).toBe(false);
        expect(isSafeUrl("http://fd00:ec2::254/")).toBe(false);
        expect(isSafeUrl("http://[fe80::1]/")).toBe(false);
        expect(isSafeUrl("http://[fe90::1]/")).toBe(false);
        expect(isSafeUrl("https://example.com")).toBe(true);
        expect(isSafeUrl("http://[2001:db8::1]/")).toBe(true);
    });

    it("rejects non-http(s) and malformed; URL parser may accept padded https", () => {
        expect(isSafeUrl("ftp://example.com")).toBe(false);
        expect(isSafeUrl("file:///etc/passwd")).toBe(false);
        expect(isSafeUrl("https://")).toBe(false);
        // product: `new URL` accepts leading/trailing spaces → still safe https
        expect(isSafeUrl("  https://example.com  ")).toBe(true);
    });


    // wave-271 residual
    it("allows private RFC1918 and [::1]; blocks only link-local 169.254 and metadata hosts", () => {
        expect(isSafeUrl("http://10.1.2.3:11434")).toBe(true);
        expect(isSafeUrl("http://172.16.0.5:8080")).toBe(true);
        expect(isSafeUrl("http://192.168.0.1")).toBe(true);
        expect(isSafeUrl("http://[::1]:11434")).toBe(true);
        expect(isSafeUrl("http://169.254.10.20/anything")).toBe(false);
        expect(isSafeUrl("http://metadata.google.internal")).toBe(false);
        expect(isSafeUrl("https://169.254.169.254")).toBe(false);
    });

    it("rejects javascript/file/ws schemes; allows https with userinfo on public host", () => {
        expect(isSafeUrl("javascript:alert(1)")).toBe(false);
        expect(isSafeUrl("file:///C:/Windows/system.ini")).toBe(false);
        expect(isSafeUrl("ws://example.com")).toBe(false);
        expect(isSafeUrl("https://user:pass@api.example.com/v1")).toBe(true);
    });


    // wave-276 residual
    it("allows localhost and 127.0.0.1 for local models; blocks fe80 and fe9x variants", () => {
        expect(isSafeUrl("http://localhost:11434")).toBe(true);
        expect(isSafeUrl("http://127.0.0.1:11434/api")).toBe(true);
        expect(isSafeUrl("http://[fe80::abcd]")).toBe(false);
        expect(isSafeUrl("http://[fe9a::1]")).toBe(false);
        expect(isSafeUrl("http://[feb0::1]")).toBe(false);
        expect(isSafeUrl("http://[fec0::1]")).toBe(true); // outside fe80::/10 product check
    });

    it("rejects empty and non-URL strings; accepts https default port public host", () => {
        expect(isSafeUrl("")).toBe(false);
        expect(isSafeUrl("not a url")).toBe(false);
        expect(isSafeUrl("https://api.example.com")).toBe(true);
        expect(isSafeUrl("http://api.example.com:80/path?q=1")).toBe(true);
    });

    // wave-284 residual
    it("blocks AWS IMDS IPv6 fd00:ec2::254 forms; allows public IPv4/IPv6 hostnames", () => {
        expect(isSafeUrl("http://[fd00:ec2::254]/latest/meta-data/")).toBe(false);
        expect(isSafeUrl("http://fd00:ec2::254/latest/meta-data/")).toBe(false);
        expect(isSafeUrl("https://example.com/path")).toBe(true);
        expect(isSafeUrl("http://[2001:db8::1]/health")).toBe(true);
        expect(isSafeUrl("ftp://example.com")).toBe(false);
        expect(isSafeUrl("data:text/plain,hi")).toBe(false);
    });

    it("169.254 any host blocked including with port; 169.255 allowed", () => {
        expect(isSafeUrl("http://169.254.1.1:80/")).toBe(false);
        expect(isSafeUrl("https://169.254.169.254:443/")).toBe(false);
        expect(isSafeUrl("http://169.255.0.1")).toBe(true);
        expect(isSafeUrl("http://168.254.0.1")).toBe(true);
    });




    // wave-295 residual
    it("hostname lowercased for metadata list; IPv4 link-local any third octet blocked", () => {
        expect(isSafeUrl("http://METADATA.GOOGLE.INTERNAL/computeMetadata/v1/")).toBe(false);
        expect(isSafeUrl("HTTP://169.254.169.254/latest")).toBe(false);
        expect(isSafeUrl("http://169.254.0.1")).toBe(false);
        expect(isSafeUrl("http://169.254.255.255")).toBe(false);
        expect(isSafeUrl("http://169.253.0.1")).toBe(true);
        expect(isSafeUrl("http://8.8.8.8")).toBe(true);
    });

    it("IPv6 link-local fe8x-febx blocked; fe7 and fec allowed by product regex", () => {
        expect(isSafeUrl("http://[fe80::1]")).toBe(false);
        expect(isSafeUrl("http://[fe90::1]")).toBe(false);
        expect(isSafeUrl("http://[fea0::1]")).toBe(false);
        expect(isSafeUrl("http://[febf::1]")).toBe(false);
        expect(isSafeUrl("http://[fe70::1]")).toBe(true);
        expect(isSafeUrl("http://[fec0::1]")).toBe(true);
    });

    it("rejects non-http(s) and malformed; allows localhost variants used by local models", () => {
        expect(isSafeUrl("file:///etc/passwd")).toBe(false);
        expect(isSafeUrl("javascript:alert(1)")).toBe(false);
        expect(isSafeUrl("http://")).toBe(false);
        expect(isSafeUrl("http://localhost")).toBe(true);
        expect(isSafeUrl("http://127.0.0.1")).toBe(true);
        expect(isSafeUrl("https://127.0.0.1:8443/v1")).toBe(true);
    });



    // wave-313 residual
    it("allows local model endpoints; blocks metadata.google.internal case-insensitively and link-local", () => {
        expect(isSafeUrl("http://localhost:11434/api/tags")).toBe(true);
        expect(isSafeUrl("http://127.0.0.1:8080/v1/models")).toBe(true);
        expect(isSafeUrl("https://ollama.local:11434/")).toBe(true);
        expect(isSafeUrl("http://metadata.google.internal/computeMetadata/v1/")).toBe(false);
        expect(isSafeUrl("http://Metadata.Google.Internal/")).toBe(false);
        expect(isSafeUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
        expect(isSafeUrl("http://169.254.42.42")).toBe(false);
    });

    it("protocol and parse failures; IPv6 fe80 blocked; public https allowed", () => {
        expect(isSafeUrl("ws://example.com")).toBe(false);
        expect(isSafeUrl("http://[fe80::abcd]")).toBe(false);
        expect(isSafeUrl("http://fe80::1")).toBe(false);
        expect(isSafeUrl("https://api.openai.com/v1")).toBe(true);
        expect(isSafeUrl("not-a-url")).toBe(false);
        expect(isSafeUrl("")).toBe(false);
        expect(isSafeUrl("http://[fd00:ec2::254]/latest")).toBe(false);
    });
});
