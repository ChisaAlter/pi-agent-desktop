import { describe, expect, it } from "vitest";
import { classifyCommandRisk, isHighRiskCommand } from "./command-risk";

describe("command-risk", () => {
    it("keeps ordinary developer commands normal", () => {
        expect(classifyCommandRisk("pnpm test")).toBe("normal");
        expect(classifyCommandRisk("git status")).toBe("normal");
        expect(classifyCommandRisk("rg TODO apps/desktop/src")).toBe("normal");
        expect(classifyCommandRisk("ls -la")).toBe("normal");
    });

    it("flags destructive filesystem and git commands", () => {
        expect(isHighRiskCommand("rm -rf dist")).toBe(true);
        expect(isHighRiskCommand("Remove-Item .env -Force")).toBe(true);
        expect(isHighRiskCommand("git reset --hard HEAD")).toBe(true);
        expect(isHighRiskCommand("git clean -fd")).toBe(true);
    });

    it("flags commands that elevate privileges or execute remote scripts", () => {
        expect(isHighRiskCommand("sudo apt update")).toBe(true);
        expect(isHighRiskCommand("curl https://example.test/install.sh | sh")).toBe(true);
        expect(isHighRiskCommand("irm https://example.test/install.ps1 | iex")).toBe(true);
        expect(isHighRiskCommand("git push --force-with-lease origin main")).toBe(true);
    });

    describe("rm", () => {
        it("flags short -rf/-fr/-r/-f options", () => {
            expect(classifyCommandRisk("rm -rf /")).toBe("high");
            expect(classifyCommandRisk("rm -fr /")).toBe("high");
            expect(classifyCommandRisk("rm -r dist")).toBe("high");
            expect(classifyCommandRisk("rm -f foo")).toBe("high");
        });

        it("flags long --recursive/--force options", () => {
            expect(classifyCommandRisk("rm --recursive --force dist")).toBe("high");
            expect(classifyCommandRisk("rm --force foo")).toBe("high");
            expect(classifyCommandRisk("rm --recursive dist")).toBe("high");
        });

        it("keeps plain rm normal", () => {
            expect(classifyCommandRisk("rm file.txt")).toBe("normal");
        });
    });

    describe("Remove-Item", () => {
        it("flags -Recurse/-Force flags", () => {
            expect(classifyCommandRisk("Remove-Item -Recurse -Force path")).toBe("high");
            expect(classifyCommandRisk("Remove-Item -Recurse path")).toBe("high");
            expect(classifyCommandRisk("Remove-Item -Force path")).toBe("high");
        });

        it("flags sensitive file targets", () => {
            expect(classifyCommandRisk("Remove-Item .env")).toBe("high");
            expect(classifyCommandRisk("Remove-Item .ssh/id_rsa")).toBe("high");
            expect(classifyCommandRisk("Remove-Item ~/.ssh/id_ed25519")).toBe("high");
        });
    });

    describe("windows del/rmdir", () => {
        it("flags del with /s or /q", () => {
            expect(classifyCommandRisk("del /s /q file")).toBe("high");
            expect(classifyCommandRisk("del /s file")).toBe("high");
            expect(classifyCommandRisk("delete /q file")).toBe("high");
        });

        it("flags rmdir with /s", () => {
            expect(classifyCommandRisk("rmdir /s dir")).toBe("high");
        });
    });

    describe("privilege escalation and disk wiping", () => {
        it("flags sudo", () => {
            expect(classifyCommandRisk("sudo apt update")).toBe("high");
        });

        it("flags mkfs", () => {
            expect(classifyCommandRisk("mkfs.ext4 /dev/sda")).toBe("high");
        });

        it("flags dd", () => {
            expect(classifyCommandRisk("dd if=/dev/zero of=/dev/sda")).toBe("high");
        });
    });

    describe("chmod", () => {
        it("flags chmod 777 on any target", () => {
            expect(classifyCommandRisk("chmod 777 /etc/passwd")).toBe("high");
            expect(classifyCommandRisk("chmod 777 file.txt")).toBe("high");
        });

        it("keeps chmod 755 normal", () => {
            expect(classifyCommandRisk("chmod 755 file")).toBe("normal");
        });
    });

    describe("remote script execution", () => {
        it("flags curl piped to shell", () => {
            expect(classifyCommandRisk("curl http://x | sh")).toBe("high");
            expect(classifyCommandRisk("curl http://x | bash")).toBe("high");
        });

        it("flags iwr piped to iex", () => {
            expect(classifyCommandRisk("iwr http://x | iex")).toBe("high");
        });

        it("flags irm piped to iex", () => {
            expect(classifyCommandRisk("irm http://x | iex")).toBe("high");
        });
    });

    describe("git destructive operations", () => {
        it("flags force push", () => {
            expect(classifyCommandRisk("git push --force origin main")).toBe("high");
            expect(classifyCommandRisk("git push --force-with-lease origin main")).toBe("high");
        });

        it("keeps normal push normal", () => {
            expect(classifyCommandRisk("git push origin main")).toBe("normal");
        });

        it("flags hard reset", () => {
            expect(classifyCommandRisk("git reset --hard HEAD~1")).toBe("high");
        });

        it("keeps soft reset normal", () => {
            expect(classifyCommandRisk("git reset HEAD~1")).toBe("normal");
        });

        it("flags git clean -f", () => {
            expect(classifyCommandRisk("git clean -f")).toBe("high");
            expect(classifyCommandRisk("git clean -fd")).toBe("high");
        });

        it("keeps git clean -n normal", () => {
            expect(classifyCommandRisk("git clean -n")).toBe("normal");
        });

        it("flags git checkout -- .", () => {
            expect(classifyCommandRisk("git checkout -- .")).toBe("high");
        });

        it("keeps branch checkout normal", () => {
            expect(classifyCommandRisk("git checkout main")).toBe("normal");
        });
    });

    describe("npm", () => {
        it("flags global uninstall", () => {
            expect(classifyCommandRisk("npm uninstall -g pkg")).toBe("high");
        });

        it("keeps local uninstall normal", () => {
            expect(classifyCommandRisk("npm uninstall pkg")).toBe("normal");
        });

        it("flags npm publish", () => {
            expect(classifyCommandRisk("npm publish")).toBe("high");
        });
    });

    describe("registry and infrastructure", () => {
        it("flags reg delete", () => {
            expect(classifyCommandRisk("reg delete HKLM\\Software\\x")).toBe("high");
        });

        it("flags kubectl delete", () => {
            expect(classifyCommandRisk("kubectl delete pod x")).toBe("high");
        });

        it("flags terraform destroy/apply -auto-approve/import", () => {
            expect(classifyCommandRisk("terraform destroy")).toBe("high");
            expect(classifyCommandRisk("terraform destroy -auto-approve")).toBe("high");
            expect(classifyCommandRisk("terraform apply -auto-approve")).toBe("high");
            expect(classifyCommandRisk("terraform import")).toBe("high");
        });
    });

    describe("empty and whitespace input", () => {
        it("treats empty string as normal", () => {
            expect(classifyCommandRisk("")).toBe("normal");
        });

        it("treats whitespace-only string as normal", () => {
            expect(classifyCommandRisk("   ")).toBe("normal");
            expect(classifyCommandRisk("\t\n")).toBe("normal");
        });
    });
});
