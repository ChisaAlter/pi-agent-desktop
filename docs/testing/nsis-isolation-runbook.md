# NSIS Install / Uninstall / Upgrade Isolation Runbook

> **Current operational runbook.** The isolation result is current only when re-run: the maintained developer host is blocked for installer mutation. See [`../current/testing-and-qa.md`](../current/testing-and-qa.md) for the source-of-truth QA boundary.

**Purpose:** Execute matrix IDs **K-004 / K-014 / K-015** (install, uninstall, upgrade) without mutating the developer host.

**Host gate (wave-10, 2026-07-21):**

| Check | Result |
|---|---|
| Admin elevation | **False** |
| `WindowsSandbox.exe` | **Missing** |
| Docker | **Missing** |
| Host Pi Desktop | **1.0.13** installed (`%LocalAppData%\Programs\Pi Desktop`) |
| Decision | **BLOCKED** — do **not** run setup.exe / Uninstall on this host |

Static inventory (no install): `/tmp/nsis-static-inventory-wave10.txt`, `/tmp/nsis-isolation-gate-wave10.txt`.

Artifacts under `apps/desktop/dist/`:

| File | Size (bytes) | SHA256 |
|---|---:|---|
| Pi-Desktop-1.0.11-setup.exe | 151102446 | `8C5B48F24D6F6DD0D7B8C944F34FB641A25B2FB1579C8D7485D830D72C7F7FB2` |
| Pi-Desktop-1.0.12-setup.exe | 133067985 | `E0A1E01798218AF0F8875FF29BE530ECECA608DA119A47E73FBB112D9B484DEF` |
| Pi-Desktop-1.0.13-setup.exe | 159103822 | `174D82ABABB2679DC777FC23659A8029EC2781C109DBDBEF2D42905C27BF0316` |

`latest.yml` → version **1.0.13**, path `Pi-Desktop-1.0.13-setup.exe`.

NSIS config (`electron-builder.yml`): `oneClick: false`, `perMachine: false` (per-user), `allowToChangeInstallationDirectory: true`, `deleteAppDataOnUninstall: false`.

---

## Host preflight (automation)

```powershell
# Capability probe (no install)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/nsis-isolation-probe.ps1

# Safety: smoke script MUST refuse when production install exists
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/nsis-sandbox-smoke.ps1 `
  -DistDir apps/desktop/dist `
  -EvidenceDir $env:TEMP\nsis-evidence-host-refuse
# Expected: REFUSE + throw (host install present)
```

Wave-11 host probe (`/tmp/nsis-isolation-gate-wave11.txt`): admin=False, Sandbox missing, docker/VBox missing, host Pi Desktop 1.0.13, create_user denied → **BLOCKED**.

## When isolation becomes available

### Option A — Windows Sandbox (preferred)

1. Enable **Windows Sandbox** (admin, host):  
   `Enable-WindowsOptionalFeature -Online -FeatureName Containers-DisposableClientVM -All`  
   Reboot if required. Confirm: `Test-Path $env:SystemRoot\System32\WindowsSandbox.exe`
2. Launch packaged config (maps `dist` + `scripts` read-only):

```text
WindowsSandbox.exe C:\Ai\pi-desktop\docs\testing\PiDesktop-NSIS.wsb
```

   Logon runs `scripts/nsis-sandbox-smoke.ps1` automatically:
   - K-014: silent install (prefers 1.0.12 if present for upgrade path)
   - K-015: silent upgrade to 1.0.13 when 1.0.12 was base
   - Launch smoke (~8s) then stop
   - K-004: silent uninstall; fail if exe still present
   - Writes `Desktop\nsis-evidence\summary.json` + log

3. **Before closing Sandbox**, copy `Desktop\nsis-evidence\` to the host (Sandbox discards state).

4. Manual alternative inside a clean Sandbox session:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\WDAGUtilityAccount\Desktop\scripts\nsis-sandbox-smoke.ps1 `
  -DistDir C:\Users\WDAGUtilityAccount\Desktop\dist `
  -EvidenceDir C:\Users\WDAGUtilityAccount\Desktop\nsis-evidence
```

### Option B — Dedicated admin VM / spare Windows box

Same silent flags; never point at a machine with production sessions you need.

### Silent flags notes

- electron-builder NSIS typically supports `/S` (silent). Prefer **per-user** (`/currentuser`) matching `perMachine: false`.
- If wizard UI is required for a path, use interactive install **only** inside Sandbox/VM.
- **Do not** use host production install directory for experiments.

### Pass criteria (matrix)

| ID | Pass when |
|---|---|
| K-014 | Clean machine: setup.exe installs; app launches; version matches artifact; shortcuts present |
| K-015 | Older install upgrades to newer; settings/userData preserved as product intent; app launches at new version |
| K-004 | Uninstall removes app binaries; re-install works; document AppData retention (`deleteAppDataOnUninstall: false`) |

Until the above evidence exists, IDs stay **BLOCKED**. Artifact inventory E2E alone does **not** promote them to PASS.

---

## Explicit non-goals on blocked hosts

- Running `Pi-Desktop-*-setup.exe` against host with existing 1.0.13 production install
- Running `Uninstall Pi Desktop.exe` on host
- Claiming K-004/K-014/K-015 PASS from `win-unpacked` portable launch or unit tests
