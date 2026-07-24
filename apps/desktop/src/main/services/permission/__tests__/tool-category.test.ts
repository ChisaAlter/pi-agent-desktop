import { describe, expect, it } from "vitest";
import {
  classifyToolName,
  isCoreTool,
  isModeRequiredTool,
  normalizeToolName,
} from "../tool-category";

describe("tool-category", () => {
  it("normalizeToolName trims and lowercases", () => {
    expect(normalizeToolName("  Read  ")).toBe("read");
    expect(normalizeToolName("BASH")).toBe("bash");
  });

  it("classifies known tool families", () => {
    expect(classifyToolName("read")).toBe("fileRead");
    expect(classifyToolName("Grep")).toBe("fileRead");
    expect(classifyToolName("write")).toBe("fileWrite");
    expect(classifyToolName("apply_patch")).toBe("fileWrite");
    expect(classifyToolName("bash")).toBe("shell");
    expect(classifyToolName("shell")).toBe("shell");
    expect(classifyToolName("webfetch")).toBe("network");
    expect(classifyToolName("custom_http_tool")).toBe("network");
    expect(classifyToolName("my-plugin-tool")).toBe("extension");
  });

  it("identifies core tools", () => {
    expect(isCoreTool("read")).toBe(true);
    expect(isCoreTool("edit")).toBe(true);
    expect(isCoreTool("bash")).toBe(true);
    expect(isCoreTool("webfetch")).toBe(false);
    expect(isCoreTool("unknown")).toBe(false);
  });

  it("requires plan_write only in plan mode", () => {
    expect(isModeRequiredTool("plan_write", "plan")).toBe(true);
    expect(isModeRequiredTool("plan_write", "agent")).toBe(false);
    expect(isModeRequiredTool("write", "plan")).toBe(false);
  });


  // wave-89 residual
  it("classifies additional file/network/shell aliases", () => {
    expect(classifyToolName("glob")).toBe("fileRead");
    expect(classifyToolName("list")).toBe("fileRead");
    expect(classifyToolName("multiedit")).toBe("fileWrite");
    expect(classifyToolName("websearch")).toBe("network");
    expect(classifyToolName("fetch")).toBe("network");
    expect(classifyToolName("HTTP")).toBe("network");
    expect(classifyToolName("agent_http_probe")).toBe("network");
    expect(classifyToolName("shell")).toBe("shell");
  });

  it("treats unknown non-network names as extension", () => {
    expect(classifyToolName("")).toBe("extension");
    expect(classifyToolName("  ")).toBe("extension");
    expect(classifyToolName("skillhub_install")).toBe("extension");
    expect(classifyToolName("plan_write")).toBe("extension");
  });

  it("isCoreTool is false for edit-family variants not in CORE_TOOLS", () => {
    expect(isCoreTool("apply_patch")).toBe(false);
    expect(isCoreTool("multiedit")).toBe(false);
    expect(isCoreTool("shell")).toBe(false);
    expect(isCoreTool("glob")).toBe(true);
  });

  it("isModeRequiredTool is false for compose/build modes", () => {
    expect(isModeRequiredTool("plan_write", "compose")).toBe(false);
    expect(isModeRequiredTool("plan_write", "build")).toBe(false);
    expect(isModeRequiredTool("PLAN_WRITE", "plan")).toBe(true);
  });

  // wave-112 residual
  it("classifies find/ls/edit aliases and keeps core membership tight", () => {
    expect(classifyToolName("find")).toBe("fileRead");
    expect(classifyToolName("ls")).toBe("fileRead");
    expect(classifyToolName("edit")).toBe("fileWrite");
    expect(isCoreTool("find")).toBe(true);
    expect(isCoreTool("ls")).toBe(true);
    expect(isCoreTool("write")).toBe(true);
    expect(isCoreTool("websearch")).toBe(false);
  });

  it("network regex is substring-based for web/http/fetch tokens", () => {
    expect(classifyToolName("my_web_tool")).toBe("network");
    expect(classifyToolName("doFetchNow")).toBe("network");
    expect(classifyToolName("x_http_y")).toBe("network");
    expect(classifyToolName("browser_tab")).toBe("extension");
  });

  // wave-121 residual
  it("normalizeToolName trims internal-only edges and lowercases mixed case", () => {
    expect(normalizeToolName("\tWebFetch\n")).toBe("webfetch");
    expect(normalizeToolName("Apply_Patch")).toBe("apply_patch");
  });

  it("known set membership beats network regex for exact names", () => {
    // exact shell/read names never fall through to network even if they contain substrings
    expect(classifyToolName("bash")).toBe("shell");
    expect(classifyToolName("read")).toBe("fileRead");
    // name containing 'http' substring is network when not in core sets
    expect(classifyToolName("proxy_http_client")).toBe("network");
  });

  it("isCoreTool is false for network and extension tools", () => {
    expect(isCoreTool("webfetch")).toBe(false);
    expect(isCoreTool("http")).toBe(false);
    expect(isCoreTool("custom_plugin")).toBe(false);
    expect(isCoreTool("grep")).toBe(true);
  });

  it("isModeRequiredTool only true for plan + plan_write (trimmed/case-insensitive)", () => {
    expect(isModeRequiredTool("  plan_write  ", "plan")).toBe(true);
    expect(isModeRequiredTool("plan_write", "agent")).toBe(false);
    expect(isModeRequiredTool("plan_read", "plan")).toBe(false);
  });

  // wave-138 residual
  it("classifies multiedit/apply_patch as fileWrite and shell alias as shell", () => {
    expect(classifyToolName("multiedit")).toBe("fileWrite");
    expect(classifyToolName("Apply_Patch")).toBe("fileWrite");
    expect(classifyToolName("SHELL")).toBe("shell");
  });

  it("network regex catches web* and *fetch* extension names", () => {
    expect(classifyToolName("web_scraper")).toBe("network");
    expect(classifyToolName("my_fetch_tool")).toBe("network");
    expect(classifyToolName("HttpClient")).toBe("network");
  });

  it("isCoreTool includes edit/bash but not apply_patch or shell alias", () => {
    expect(isCoreTool("edit")).toBe(true);
    expect(isCoreTool("bash")).toBe(true);
    // product CORE_TOOLS set: apply_patch/shell are write/shell categories but not "core"
    expect(isCoreTool("apply_patch")).toBe(false);
    expect(isCoreTool("shell")).toBe(false);
  });

  it("isModeRequiredTool is false for compose/build modes", () => {
    expect(isModeRequiredTool("plan_write", "compose")).toBe(false);
    expect(isModeRequiredTool("plan_write", "build")).toBe(false);
    expect(isModeRequiredTool("PLAN_WRITE", "plan")).toBe(true);
  });

  // wave-150 residual
  it("normalizeToolName trims and lowercases without collapsing internal spaces", () => {
    expect(normalizeToolName("  READ  ")).toBe("read");
    expect(normalizeToolName("Web Fetch")).toBe("web fetch");
    expect(classifyToolName("  Web Fetch  ")).toBe("network");
  });

  it("fileRead set is exact-name only; similar names fall through to extension", () => {
    expect(classifyToolName("read")).toBe("fileRead");
    expect(classifyToolName("read_file")).toBe("extension");
    expect(classifyToolName("list_dir")).toBe("extension");
    expect(classifyToolName("ls")).toBe("fileRead");
    expect(classifyToolName("find")).toBe("fileRead");
  });

  it("isModeRequiredTool rejects whitespace-only and non-plan_write names", () => {
    expect(isModeRequiredTool("   ", "plan")).toBe(false);
    expect(isModeRequiredTool("plan-write", "plan")).toBe(false);
    expect(isModeRequiredTool("plan_write_v2", "plan")).toBe(false);
    expect(isCoreTool("  Edit  ")).toBe(true);
    expect(isCoreTool("multiedit")).toBe(false);
  });

  // wave-159 residual
  it("classifies network via name set and web|http|fetch regex fallthrough", () => {
    expect(classifyToolName("webfetch")).toBe("network");
    expect(classifyToolName("websearch")).toBe("network");
    expect(classifyToolName("fetch")).toBe("network");
    expect(classifyToolName("http")).toBe("network");
    expect(classifyToolName("my-web-tool")).toBe("network");
    expect(classifyToolName("http_client")).toBe("network");
    expect(classifyToolName("do_fetch_now")).toBe("network");
  });

  it("maps exact fileWrite/shell sets and falls back to extension", () => {
    expect(classifyToolName("write")).toBe("fileWrite");
    expect(classifyToolName("apply_patch")).toBe("fileWrite");
    expect(classifyToolName("multiedit")).toBe("fileWrite");
    expect(classifyToolName("bash")).toBe("shell");
    expect(classifyToolName("shell")).toBe("shell");
    expect(classifyToolName("custom_tool")).toBe("extension");
    expect(classifyToolName("")).toBe("extension");
    expect(classifyToolName("   ")).toBe("extension");
  });

  it("isCoreTool is exact after normalize; isModeRequiredTool plan-only", () => {
    expect(isCoreTool("grep")).toBe(true);
    expect(isCoreTool("glob")).toBe(true);
    expect(isCoreTool("list")).toBe(true);
    expect(isCoreTool("websearch")).toBe(false);
    expect(isModeRequiredTool("plan_write", "plan")).toBe(true);
    expect(isModeRequiredTool("plan_write", "build")).toBe(false);
    expect(isModeRequiredTool("bash", "plan")).toBe(false);
  });

  // wave-183 residual
  it("normalizeToolName only trims ends — internal spaces become non-set names", () => {
    expect(normalizeToolName("  read  ")).toBe("read");
    expect(normalizeToolName("re ad")).toBe("re ad");
    expect(classifyToolName("re ad")).toBe("extension");
    expect(normalizeToolName("\tBASH\n")).toBe("bash");
    expect(classifyToolName("\tBASH\n")).toBe("shell");
  });

  it("CORE_TOOLS excludes apply_patch/multiedit/shell even though fileWrite/shell sets include them", () => {
    expect(isCoreTool("apply_patch")).toBe(false);
    expect(isCoreTool("multiedit")).toBe(false);
    expect(isCoreTool("shell")).toBe(false);
    expect(isCoreTool("write")).toBe(true);
    expect(isCoreTool("edit")).toBe(true);
    expect(classifyToolName("apply_patch")).toBe("fileWrite");
    expect(classifyToolName("shell")).toBe("shell");
  });

  it("isModeRequiredTool only exact plan_write after normalize; compose/build never require it", () => {
    expect(isModeRequiredTool("  PLAN_WRITE  ", "plan")).toBe(true);
    expect(isModeRequiredTool("plan_write", "compose" as never)).toBe(false);
    expect(isModeRequiredTool("plan_write", "agent" as never)).toBe(false);
    expect(isModeRequiredTool("PlanWrite", "plan")).toBe(false); // no underscore after lower
  });

  // wave-212 residual
  it("network regex catches compound names; exact set tools beat extension", () => {
    expect(classifyToolName("MyWebFetch")).toBe("network");
    expect(classifyToolName("http_client")).toBe("network");
    expect(classifyToolName("fetch_models")).toBe("network");
    expect(classifyToolName("ls")).toBe("fileRead");
    expect(classifyToolName("list")).toBe("fileRead");
    expect(classifyToolName("FIND")).toBe("fileRead");
    expect(isCoreTool("  READ  ")).toBe(true);
    expect(isCoreTool("find")).toBe(true);
    expect(isCoreTool("list")).toBe(true);
    expect(isCoreTool("http")).toBe(false);
  });

  // wave-219 residual
  it("fileWrite covers write/edit/apply_patch/multiedit; shell covers bash/shell", () => {
    expect(classifyToolName("write")).toBe("fileWrite");
    expect(classifyToolName("edit")).toBe("fileWrite");
    expect(classifyToolName("apply_patch")).toBe("fileWrite");
    expect(classifyToolName("multiedit")).toBe("fileWrite");
    expect(classifyToolName("bash")).toBe("shell");
    expect(classifyToolName("SHELL")).toBe("shell");
    expect(normalizeToolName("  Grep  ")).toBe("grep");
  });

  it("isModeRequiredTool only plan+plan_write; isCoreTool excludes network/extension", () => {
    expect(isModeRequiredTool("plan_write", "plan")).toBe(true);
    expect(isModeRequiredTool("plan_write", "build")).toBe(false);
    expect(isModeRequiredTool("plan_write", "compose")).toBe(false);
    expect(isModeRequiredTool("write", "plan")).toBe(false);
    expect(isCoreTool("bash")).toBe(true);
    expect(isCoreTool("websearch")).toBe(false);
    expect(isCoreTool("custom_ext")).toBe(false);
    expect(classifyToolName("custom_ext")).toBe("extension");
  });

  // wave-234 residual
  it("normalizeToolName trims only edges; empty and whitespace normalize", () => {
    expect(normalizeToolName("")).toBe("");
    expect(normalizeToolName("   ")).toBe("");
    expect(normalizeToolName("\tBash\n")).toBe("bash");
    expect(normalizeToolName("plan_write")).toBe("plan_write");
  });

  it("network regex catches embedded web/http/fetch after set miss", () => {
    expect(classifyToolName("my_web_tool")).toBe("network");
    expect(classifyToolName("safe_http")).toBe("network");
    expect(classifyToolName("pre_fetch_x")).toBe("network");
    // file sets win before network regex
    expect(classifyToolName("grep")).toBe("fileRead");
    expect(classifyToolName("glob")).toBe("fileRead");
  });

  it("isModeRequiredTool is case-insensitive on tool name via normalize", () => {
    expect(isModeRequiredTool("PLAN_WRITE", "plan")).toBe(true);
    expect(isModeRequiredTool("  plan_write  ", "plan")).toBe(true);
    expect(isModeRequiredTool("plan_write", "explore")).toBe(false);
    expect(isCoreTool("EDIT")).toBe(true);
    expect(isCoreTool("apply_patch")).toBe(false); // write-family but not CORE_TOOLS set
  });

  // wave-244 residual
  it("classifyToolName set membership is exclusive and ordered fileRead→fileWrite→shell→network→extension", () => {
    expect(classifyToolName("read")).toBe("fileRead");
    expect(classifyToolName("write")).toBe("fileWrite");
    expect(classifyToolName("apply_patch")).toBe("fileWrite");
    expect(classifyToolName("multiedit")).toBe("fileWrite");
    expect(classifyToolName("bash")).toBe("shell");
    expect(classifyToolName("shell")).toBe("shell");
    expect(classifyToolName("webfetch")).toBe("network");
    expect(classifyToolName("websearch")).toBe("network");
    expect(classifyToolName("fetch")).toBe("network");
    expect(classifyToolName("http")).toBe("network");
    expect(classifyToolName("plan_write")).toBe("extension");
    expect(classifyToolName("unknown_tool")).toBe("extension");
  });

  it("CORE_TOOLS includes edit/write/bash/read family but not apply_patch/multiedit/network", () => {
    for (const name of ["read", "grep", "find", "ls", "glob", "list", "write", "edit", "bash"]) {
      expect(isCoreTool(name)).toBe(true);
    }
    for (const name of ["apply_patch", "multiedit", "shell", "webfetch", "plan_write", "http"]) {
      expect(isCoreTool(name)).toBe(false);
    }
  });

  // wave-266 residual
  it("normalizeToolName trims and lowercases; empty becomes empty", () => {
    expect(normalizeToolName("  READ  ")).toBe("read");
    expect(normalizeToolName("BaSh")).toBe("bash");
    expect(normalizeToolName("")).toBe("");
    expect(normalizeToolName("   ")).toBe("");
  });

  it("network regex catches web/http/fetch substrings after set checks", () => {
    expect(classifyToolName("my_webfetch_tool")).toBe("network");
    expect(classifyToolName("HTTP_CLIENT")).toBe("network");
    expect(classifyToolName("safe_fetch_data")).toBe("network");
    // explicit set still wins
    expect(classifyToolName("grep")).toBe("fileRead");
    expect(isModeRequiredTool("plan_write", "plan")).toBe(true);
    expect(isModeRequiredTool("plan_write", "build")).toBe(false);
  });

  // wave-275 residual
  it("classifyToolName trims before set lookup; mixed-case shell maps via normalize", () => {
    expect(classifyToolName("  READ  ")).toBe("fileRead");
    expect(classifyToolName("Write")).toBe("fileWrite");
    expect(classifyToolName("BaSh")).toBe("shell");
    expect(classifyToolName("Shell")).toBe("shell");
    expect(classifyToolName("  ")).toBe("extension");
  });

  it("isModeRequiredTool only plan+plan_write; other modes and names false", () => {
    expect(isModeRequiredTool("plan_write", "plan")).toBe(true);
    expect(isModeRequiredTool("plan_write", "build")).toBe(false);
    expect(isModeRequiredTool("plan_write", "compose")).toBe(false);
    expect(isModeRequiredTool("plan_write", "explore")).toBe(false);
    expect(isModeRequiredTool("write", "plan")).toBe(false);
    expect(isModeRequiredTool("bash", "plan")).toBe(false);
    expect(isCoreTool("  list  ")).toBe(true);
    expect(isCoreTool("shell")).toBe(false);
  });

  // wave-286 residual
  it("classify maps write tools and known network set; unknown becomes extension", () => {
    expect(classifyToolName("apply_patch")).toBe("fileWrite");
    expect(classifyToolName("multiedit")).toBe("fileWrite");
    expect(classifyToolName("webfetch")).toBe("network");
    expect(classifyToolName("websearch")).toBe("network");
    expect(classifyToolName("custom_extension_tool")).toBe("extension");
    expect(isCoreTool("grep")).toBe(true);
    expect(isCoreTool("apply_patch")).toBe(false);
  });

  it("normalizeToolName lowercases; isModeRequiredTool is plan_write exclusive", () => {
    expect(normalizeToolName(" Plan_Write ")).toBe("plan_write");
    expect(isModeRequiredTool("PLAN_WRITE", "plan")).toBe(true);
    expect(isModeRequiredTool("plan_write", "build")).toBe(false);
    expect(isModeRequiredTool("write", "plan")).toBe(false);
  });




  // wave-297 residual
  it("network category includes set members and web|http|fetch substring names", () => {
    expect(classifyToolName("fetch")).toBe("network");
    expect(classifyToolName("http")).toBe("network");
    expect(classifyToolName("MyWebClient")).toBe("network");
    expect(classifyToolName("http_request")).toBe("network");
    expect(classifyToolName("fetchData")).toBe("network");
    expect(classifyToolName("browser_open")).toBe("extension");
  });

  it("fileRead set includes find/ls/glob/list; shell is bash|shell only", () => {
    for (const name of ["find", "ls", "glob", "list", "grep", "read"]) {
      expect(classifyToolName(name)).toBe("fileRead");
    }
    expect(classifyToolName("bash")).toBe("shell");
    expect(classifyToolName("shell")).toBe("shell");
    expect(classifyToolName("powershell")).toBe("extension");
    expect(isCoreTool("bash")).toBe(true);
    expect(isCoreTool("shell")).toBe(false);
    expect(isCoreTool("glob")).toBe(true);
  });

  it("isModeRequiredTool ignores case via normalize; non-plan modes never require", () => {
    expect(isModeRequiredTool("  plan_write  ", "plan")).toBe(true);
    expect(isModeRequiredTool("plan_write", "explore")).toBe(false);
    expect(isModeRequiredTool("plan_write", "compose")).toBe(false);
    expect(normalizeToolName("")).toBe("");
  });


  // wave-321 residual
  it("classifyToolName priority: fileRead before write before shell before network before extension", () => {
    expect(classifyToolName("READ")).toBe("fileRead");
    expect(classifyToolName("  Write ")).toBe("fileWrite");
    expect(classifyToolName("apply_patch")).toBe("fileWrite");
    expect(classifyToolName("multiedit")).toBe("fileWrite");
    expect(classifyToolName("BASH")).toBe("shell");
    expect(classifyToolName("webfetch")).toBe("network");
    expect(classifyToolName("websearch")).toBe("network");
    expect(classifyToolName("CustomHttpClient")).toBe("network");
    expect(classifyToolName("calculator")).toBe("extension");
  });

  it("isCoreTool closed set excludes shell synonym and network tools", () => {
    for (const name of ["read", "grep", "find", "ls", "glob", "list", "write", "edit", "bash"]) {
      expect(isCoreTool(name)).toBe(true);
      expect(isCoreTool(name.toUpperCase())).toBe(true);
    }
    expect(isCoreTool("shell")).toBe(false);
    expect(isCoreTool("webfetch")).toBe(false);
    expect(isCoreTool("apply_patch")).toBe(false);
    expect(isCoreTool("plan_write")).toBe(false);
  });

  it("isModeRequiredTool only plan + plan_write after normalize", () => {
    expect(isModeRequiredTool("plan_write", "plan")).toBe(true);
    expect(isModeRequiredTool("Plan_Write", "plan")).toBe(true);
    expect(isModeRequiredTool("plan_write", "build")).toBe(false);
    expect(isModeRequiredTool("write", "plan")).toBe(false);
    expect(normalizeToolName("  MiXeD  ")).toBe("mixed");
  });

});
