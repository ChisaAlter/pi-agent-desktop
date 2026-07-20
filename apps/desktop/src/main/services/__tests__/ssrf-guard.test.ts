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
    { label: "RFC1918 私网 10.x", url: "http://10.0.0.1:8080", expected: true },
    { label: "RFC1918 私网 192.168.x", url: "http://192.168.1.10:8080", expected: true },
    { label: "RFC1918 私网 172.16.x", url: "http://172.16.0.1:8080", expected: true },
    { label: "带查询字符串的合法 URL", url: "https://api.anthropic.com/v1/messages?beta=true", expected: true },
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
});