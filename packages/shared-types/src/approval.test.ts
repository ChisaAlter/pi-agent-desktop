import { describe, expect, it } from "vitest";
import type { ApprovalRequest, ApprovalResponse, DeferredEdit, FileReview, RiskLevel } from "./approval";

describe("approval types residual", () => {
  // wave-225 residual
  it("RiskLevel is the three-tier union used by classifier", () => {
    const levels: RiskLevel[] = ["high", "edit", "read"];
    expect(levels).toHaveLength(3);
    expect(new Set(levels).size).toBe(3);
  });

  it("ApprovalRequest/Response round-trip requestId", () => {
    const req: ApprovalRequest = {
      requestId: "r1",
      method: "confirm",
      title: "Run bash",
      message: "rm?",
    };
    const res: ApprovalResponse = { requestId: req.requestId, approved: false };
    expect(res.requestId).toBe("r1");
    expect(res.approved).toBe(false);
    const select: ApprovalRequest = { requestId: "r2", method: "select", title: "Pick" };
    expect(select.method).toBe("select");
  });

  it("DeferredEdit and FileReview share changeId/toolCallId/filePath timestamps", () => {
    const deferred: DeferredEdit = {
      changeId: "c1",
      toolCallId: "t1",
      filePath: "src/a.ts",
      op: "write",
      timestamp: 1,
    };
    const review: FileReview = {
      changeId: deferred.changeId,
      toolCallId: deferred.toolCallId,
      filePath: deferred.filePath,
      diff: "@@\n+x",
      newContent: "x",
      timestamp: 2,
    };
    expect(review.diff).toContain("+x");
    expect(deferred.op).toBe("write");
    expect(review.timestamp).toBeGreaterThan(deferred.timestamp);
  });

  // wave-252 residual
  it("DeferredEdit op is write|edit only; ApprovalResponse approved is boolean", () => {
    const edit: DeferredEdit = {
      changeId: "c2",
      toolCallId: "t2",
      filePath: "src/b.ts",
      op: "edit",
      timestamp: 10,
    };
    expect(edit.op).toBe("edit");
    const ops: Array<DeferredEdit["op"]> = ["write", "edit"];
    expect(ops).toHaveLength(2);

    const approved: ApprovalResponse = { requestId: "r3", approved: true };
    const denied: ApprovalResponse = { requestId: "r3", approved: false };
    expect(approved.approved).not.toBe(denied.approved);
    expect(approved.requestId).toBe(denied.requestId);

    const confirm: ApprovalRequest = {
      requestId: "r4",
      method: "confirm",
      title: "T",
      message: undefined,
    };
    expect(confirm.message).toBeUndefined();
    expect(confirm.method).toBe("confirm");
  });

  // wave-262 residual
  it("RiskLevel union accepts high/edit/read only as string literals", () => {
    const levels: RiskLevel[] = ["high", "edit", "read"];
    expect(levels).toEqual(["high", "edit", "read"]);
    // product ApprovalRequest methods are confirm|select only; risk lives on classifier, not request
    const req: ApprovalRequest = {
      requestId: "r-wave262",
      method: "confirm",
      title: "Run",
      message: "bash rm",
    };
    const risk: RiskLevel = "high";
    expect(req.method).toBe("confirm");
    expect(risk).toBe("high");
    expect(req.message).toBe("bash rm");
  });

  it("DeferredEdit requires changeId/toolCallId/filePath/op/timestamp", () => {
    const d: DeferredEdit = {
      changeId: "ch",
      toolCallId: "tc",
      filePath: "a.ts",
      op: "write",
      timestamp: 1,
    };
    expect(d.op).toBe("write");
    expect(typeof d.timestamp).toBe("number");
    expect(d.changeId).toBe("ch");
    expect(d.toolCallId).toBe("tc");
    expect(d.filePath).toBe("a.ts");
  });


  // wave-268 residual
  it("FileReview requires diff and newContent; ApprovalResponse approved boolean only", () => {
    const review: FileReview = {
      changeId: "c",
      toolCallId: "t",
      filePath: "f.ts",
      diff: "@@\n+line",
      newContent: "line",
      timestamp: 99,
    };
    expect(review.diff).toContain("+line");
    expect(review.newContent).toBe("line");
    const res: ApprovalResponse = { requestId: "r", approved: true };
    expect(res.approved).toBe(true);
  });

  it("ApprovalRequest select method does not require message", () => {
    const req: ApprovalRequest = {
      requestId: "sel",
      method: "select",
      title: "Choose",
    };
    expect(req.method).toBe("select");
    expect(req.message).toBeUndefined();
  });

  // wave-279 residual
  it("ApprovalRequest confirm method allows optional message", () => {
    const req: ApprovalRequest = {
      requestId: "r1",
      method: "confirm",
      title: "Run shell",
      message: "rm -rf?",
    };
    expect(req.method).toBe("confirm");
    expect(req.message).toBe("rm -rf?");
  });

  it("ApprovalResponse can deny; DeferredEdit op edit is distinct from write", () => {
    const res: ApprovalResponse = { requestId: "r2", approved: false };
    expect(res.approved).toBe(false);
    const d: DeferredEdit = {
      changeId: "c2",
      toolCallId: "t2",
      filePath: "b.ts",
      op: "edit",
      timestamp: 2,
    };
    expect(d.op).toBe("edit");
  });

  // wave-286 residual
  it("FileReview carries unified diff and newContent fields", () => {
    const review: FileReview = {
      changeId: "ch1",
      toolCallId: "tc1",
      filePath: "src/a.ts",
      diff: "@@ -1 +1 @@\n-a\n+b\n",
      newContent: "b\n",
      timestamp: 99,
    };
    expect(review.diff).toContain("@@");
    expect(review.newContent).toBe("b\n");
    expect(review.filePath).toBe("src/a.ts");
  });

  it("select ApprovalRequest omits message; DeferredEdit write op is allowed", () => {
    const req: ApprovalRequest = { requestId: "sel-286", method: "select", title: "Pick one" };
    expect(req.message).toBeUndefined();
    const d: DeferredEdit = {
      changeId: "c3",
      toolCallId: "t3",
      filePath: "c.ts",
      op: "write",
      timestamp: 3,
    };
    expect(d.op).toBe("write");
  });





  // wave-303 residual
  it("RiskLevel is high|edit|read; ApprovalRequest methods confirm|select", () => {
    const levels: RiskLevel[] = ["high", "edit", "read"];
    expect(levels).toEqual(["high", "edit", "read"]);
    const confirm: ApprovalRequest = {
      requestId: "r-303",
      method: "confirm",
      title: "Run",
      message: "detail",
    };
    const select: ApprovalRequest = { requestId: "r-303b", method: "select", title: "Choose" };
    expect(confirm.method).toBe("confirm");
    expect(select.method).toBe("select");
    expect(select.message).toBeUndefined();
  });

  it("ApprovalResponse approved boolean; DeferredEdit op write|edit; FileReview links changeId", () => {
    const res: ApprovalResponse = { requestId: "r1", approved: true };
    expect(res.approved).toBe(true);
    const deferred: DeferredEdit = {
      changeId: "c-303",
      toolCallId: "tc-303",
      filePath: "a.ts",
      op: "write",
      timestamp: 1,
    };
    const review: FileReview = {
      changeId: deferred.changeId,
      toolCallId: deferred.toolCallId,
      filePath: deferred.filePath,
      diff: "+x",
      newContent: "x",
      timestamp: 2,
    };
    expect(review.changeId).toBe("c-303");
    expect(deferred.op === "write" || deferred.op === "edit").toBe(true);
  });


  // wave-319 residual
  it("RiskLevel closed set high|edit|read; ApprovalRequest methods confirm|select", () => {
    const levels: RiskLevel[] = ["high", "edit", "read"];
    expect(levels).toEqual(["high", "edit", "read"]);
    const confirm: ApprovalRequest = {
      requestId: "r-319",
      method: "confirm",
      title: "Run",
      message: "detail",
    };
    const select: ApprovalRequest = { requestId: "r-319b", method: "select", title: "Choose" };
    expect(confirm.message).toBe("detail");
    expect(select.message).toBeUndefined();
  });

  it("ApprovalResponse approved boolean; DeferredEdit op write|edit; FileReview carries diff+newContent", () => {
    const res: ApprovalResponse = { requestId: "r1", approved: true };
    expect(res.approved).toBe(true);
    const deferred: DeferredEdit = {
      changeId: "c-319",
      toolCallId: "tc-319",
      filePath: "src/x.ts",
      op: "edit",
      timestamp: 10,
    };
    const review: FileReview = {
      changeId: deferred.changeId,
      toolCallId: deferred.toolCallId,
      filePath: deferred.filePath,
      diff: ["@@ -1 +1 @@", "-a", "+b", ""].join(String.fromCharCode(10)),
      newContent: "b" + String.fromCharCode(10),
      timestamp: 11,
    };
    expect(deferred.op).toBe("edit");
    expect(review.diff).toContain("+b");
    expect(review.newContent).toBe("b" + String.fromCharCode(10));
    expect(review.changeId).toBe("c-319");
  });


});
