import { describe, expect, it } from "vitest";
import type { Session } from "../stores/session-store";
import type { Workspace } from "../stores/workspace-store";
import {
  groupSessionsByWorkspace,
  sessionActivityTime,
  sessionDepth,
  sessionMatches,
  sortSessionsByActivity,
} from "./session-grouping";

function session(partial: Partial<Session> & Pick<Session, "id" | "workspaceId">): Session {
  return {
    title: partial.id,
    messages: [],
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...partial,
  } as Session;
}

describe("sessionMatches", () => {
  it("matches generated ui text when message content is empty", () => {
    const s = {
      id: "s1",
      title: "Generated UI session",
      workspaceId: "w1",
      createdAt: new Date(0),
      updatedAt: new Date(0),
      messages: [
        {
          id: "m1",
          role: "assistant",
          content: "",
          timestamp: new Date(0),
          generatedUi: {
            version: "v1",
            id: "ui-grouping",
            title: "交付结果",
            sections: [
              { id: "summary", kind: "summary", content: "已生成 docs/report.md" },
            ],
          },
        },
      ],
    } satisfies Session;

    expect(sessionMatches(s, "report.md")).toBe(true);
  });

  // wave-109 residual
  it("empty/whitespace query matches all sessions", () => {
    const s = session({ id: "empty-q", workspaceId: "w1", title: "Alpha" });
    expect(sessionMatches(s, "")).toBe(true);
    expect(sessionMatches(s, "   ")).toBe(true);
  });

  it("matches title/summary/preview/tags and skips unloaded messages", () => {
    const s = session({
      id: "meta",
      workspaceId: "w1",
      title: "Refactor pipeline",
      summary: "tighten IPC validation",
      firstUserMessagePreview: "please harden schemas",
      tags: ["security", "ipc"],
      messagesLoaded: false,
      messages: [
        {
          id: "hidden",
          role: "user",
          content: "secret body that must not match",
          timestamp: new Date(0),
        },
      ],
    } as Session);

    expect(sessionMatches(s, "pipeline")).toBe(true);
    expect(sessionMatches(s, "IPC")).toBe(true);
    expect(sessionMatches(s, "schemas")).toBe(true);
    expect(sessionMatches(s, "security")).toBe(true);
    expect(sessionMatches(s, "secret body")).toBe(false);
  });

  it("matches thinking text when messages are loaded", () => {
    const s = session({
      id: "think",
      workspaceId: "w1",
      messages: [
        {
          id: "m1",
          role: "assistant",
          content: "done",
          thinking: "consider SSRF guard edges",
          timestamp: new Date(0),
        },
      ],
    } as Session);
    expect(sessionMatches(s, "ssrf")).toBe(true);
    expect(sessionMatches(s, "missing-token")).toBe(false);
  });
});

describe("sessionDepth", () => {
  it("caps depth at 4 and breaks parent cycles", () => {
    const root = session({ id: "root", workspaceId: "w1" });
    const c1 = session({ id: "c1", workspaceId: "w1", parentSessionId: "root" });
    const c2 = session({ id: "c2", workspaceId: "w1", parentSessionId: "c1" });
    const c3 = session({ id: "c3", workspaceId: "w1", parentSessionId: "c2" });
    const c4 = session({ id: "c4", workspaceId: "w1", parentSessionId: "c3" });
    const c5 = session({ id: "c5", workspaceId: "w1", parentSessionId: "c4" });
    const byId = new Map(
      [root, c1, c2, c3, c4, c5].map((item) => [item.id, item]),
    );
    expect(sessionDepth(root, byId)).toBe(0);
    expect(sessionDepth(c1, byId)).toBe(1);
    expect(sessionDepth(c5, byId)).toBe(4);

    const loopA = session({ id: "a", workspaceId: "w1", parentSessionId: "b" });
    const loopB = session({ id: "b", workspaceId: "w1", parentSessionId: "a" });
    const loopMap = new Map([
      ["a", loopA],
      ["b", loopB],
    ]);
    // Walk a→b→a; second hop records "a" then stops on next parent already seen.
    // Depth is hops taken (2), not capped unless chain length > 4.
    expect(sessionDepth(loopA, loopMap)).toBe(2);
  });

  // wave-109 residual
  it("returns 0 when parentSessionId is missing from map", () => {
    const orphan = session({ id: "orphan", workspaceId: "w1", parentSessionId: "ghost" });
    expect(sessionDepth(orphan, new Map([["orphan", orphan]]))).toBe(0);
  });
});

describe("sessionActivityTime", () => {
  it("prefers updatedAt over createdAt", () => {
    const updated = new Date("2026-07-21T10:00:00");
    const created = new Date("2026-07-01T10:00:00");
    expect(sessionActivityTime(session({ id: "x", workspaceId: "w1", createdAt: created, updatedAt: updated }))).toEqual(
      updated,
    );
    expect(
      sessionActivityTime(session({ id: "y", workspaceId: "w1", createdAt: created, updatedAt: undefined as unknown as Date })),
    ).toEqual(created);
  });
});

describe("groupSessionsByWorkspace", () => {
  it("groups and omits empty workspaces", () => {
    const workspaces: Workspace[] = [
      {
        id: "w1",
        name: "Alpha",
        path: "C:\\a",
        createdAt: new Date(0),
        lastActiveAt: new Date(0),
      },
      {
        id: "w2",
        name: "Beta",
        path: "C:\\b",
        createdAt: new Date(0),
        lastActiveAt: new Date(0),
      },
      {
        id: "w3",
        name: "Empty",
        path: "C:\\c",
        createdAt: new Date(0),
        lastActiveAt: new Date(0),
      },
    ];
    const sessions = [
      session({ id: "s-late", workspaceId: "w1", updatedAt: new Date(200) }),
      session({ id: "s-early", workspaceId: "w1", updatedAt: new Date(100) }),
      session({ id: "s-beta", workspaceId: "w2", updatedAt: new Date(50) }),
    ];
    const groups = groupSessionsByWorkspace(sessions, workspaces);
    expect(groups.map((g) => g.workspace.id)).toEqual(["w1", "w2"]);
    expect(groups[0]?.sessions.map((s) => s.id)).toEqual(["s-late", "s-early"]);
  });
});

describe("sortSessionsByActivity", () => {
  // wave-109 residual
  it("prefers favorites, then keeps parent before child, then activity desc", () => {
    const parent = session({
      id: "parent",
      workspaceId: "w1",
      updatedAt: new Date(100),
    });
    const child = session({
      id: "child",
      workspaceId: "w1",
      parentSessionId: "parent",
      updatedAt: new Date(300),
    });
    const favoriteOld = session({
      id: "fav",
      workspaceId: "w1",
      favorite: true,
      updatedAt: new Date(10),
    });
    const plainNew = session({
      id: "plain",
      workspaceId: "w1",
      updatedAt: new Date(400),
    });
    const byId = new Map(
      [parent, child, favoriteOld, plainNew].map((item) => [item.id, item]),
    );
    const sorted = sortSessionsByActivity(
      [plainNew, child, parent, favoriteOld],
      byId,
    );
    expect(sorted.map((s) => s.id)).toEqual(["fav", "plain", "parent", "child"]);
  });
});

// wave-118 residual
describe("session-grouping residual", () => {
  it("sessionMatches is case-insensitive and trims query", () => {
    const s = session({
      id: "case",
      workspaceId: "w1",
      title: "Hello World",
      tags: ["IPC"],
    });
    expect(sessionMatches(s, "  hello  ")).toBe(true);
    expect(sessionMatches(s, "ipc")).toBe(true);
    expect(sessionMatches(s, "goodbye")).toBe(false);
  });

  it("sessionMatches does not throw when tags are undefined", () => {
    const s = session({ id: "no-tags", workspaceId: "w1", title: "plain", tags: undefined });
    expect(sessionMatches(s, "plain")).toBe(true);
    expect(sessionMatches(s, "missing")).toBe(false);
  });

  it("sortSessionsByActivity ranks siblings by activity when depths equal", () => {
    const older = session({ id: "old", workspaceId: "w1", updatedAt: new Date(10) });
    const newer = session({ id: "new", workspaceId: "w1", updatedAt: new Date(99) });
    const byId = new Map([
      ["old", older],
      ["new", newer],
    ]);
    expect(sortSessionsByActivity([older, newer], byId).map((s) => s.id)).toEqual(["new", "old"]);
  });

  it("groupSessionsByWorkspace preserves workspace input order and drops empties", () => {
    const workspaces: Workspace[] = [
      {
        id: "w-empty",
        name: "Empty",
        path: "C:\\e",
        createdAt: new Date(0),
        lastActiveAt: new Date(0),
      },
      {
        id: "w-live",
        name: "Live",
        path: "C:\\l",
        createdAt: new Date(0),
        lastActiveAt: new Date(0),
      },
    ];
    const groups = groupSessionsByWorkspace(
      [session({ id: "s1", workspaceId: "w-live", updatedAt: new Date(1) })],
      workspaces,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.workspace.id).toBe("w-live");
  });

  it("sessionDepth stops at missing intermediate parent without walking forever", () => {
    const leaf = session({ id: "leaf", workspaceId: "w1", parentSessionId: "missing-mid" });
    const byId = new Map([["leaf", leaf]]);
    expect(sessionDepth(leaf, byId)).toBe(0);
  });

  // wave-127 residual
  it("sessionMatches treats blank query as match-all and is case-insensitive", () => {
    const s = session({
      id: "s1",
      workspaceId: "w1",
      title: "Alpha Plan",
      summary: "build things",
    });
    expect(sessionMatches(s, "")).toBe(true);
    expect(sessionMatches(s, "   ")).toBe(true);
    expect(sessionMatches(s, "alpha")).toBe(true);
    expect(sessionMatches(s, "BUILD")).toBe(true);
    expect(sessionMatches(s, "missing-token")).toBe(false);
  });

  it("sortSessionsByActivity prefers favorites then newer activity", () => {
    const a = session({
      id: "a",
      workspaceId: "w1",
      favorite: false,
      updatedAt: new Date(100),
    });
    const b = session({
      id: "b",
      workspaceId: "w1",
      favorite: true,
      updatedAt: new Date(50),
    });
    const c = session({
      id: "c",
      workspaceId: "w1",
      favorite: false,
      updatedAt: new Date(200),
    });
    const byId = new Map([
      ["a", a],
      ["b", b],
      ["c", c],
    ]);
    const sorted = sortSessionsByActivity([a, b, c], byId);
    expect(sorted.map((s) => s.id)).toEqual(["b", "c", "a"]);
  });

  it("sessionDepth caps at 4 for long parent chains", () => {
    const chain = ["r0", "r1", "r2", "r3", "r4", "r5"].map((id, i) =>
      session({
        id,
        workspaceId: "w1",
        parentSessionId: i === 0 ? undefined : `r${i - 1}`,
      }),
    );
    const byId = new Map(chain.map((s) => [s.id, s]));
    expect(sessionDepth(chain[5]!, byId)).toBe(4);
  });

  // wave-144 residual
  it("sessionMatches uses tags and firstUserMessagePreview", () => {
    const s = session({
      id: "tag-s",
      workspaceId: "w1",
      title: "plain",
      tags: ["hotfix", "release"],
      firstUserMessagePreview: "please ship v1.0.14",
    });
    expect(sessionMatches(s, "hotfix")).toBe(true);
    expect(sessionMatches(s, "v1.0.14")).toBe(true);
    expect(sessionMatches(s, "missing")).toBe(false);
  });

  it("sessionMatches skips message body when messagesLoaded is false", () => {
    const s = session({
      id: "lazy",
      workspaceId: "w1",
      title: "Lazy",
      messagesLoaded: false,
      messages: [
        {
          id: "m1",
          role: "user",
          content: "secret-token-in-body",
          timestamp: new Date(0),
        },
      ],
    } as Session);
    expect(sessionMatches(s, "secret-token-in-body")).toBe(false);
    expect(sessionMatches(s, "Lazy")).toBe(true);
  });

  it("sessionDepth detects cycles without infinite loop", () => {
    const a = session({ id: "a", workspaceId: "w1", parentSessionId: "b" });
    const b = session({ id: "b", workspaceId: "w1", parentSessionId: "a" });
    const byId = new Map([
      ["a", a],
      ["b", b],
    ]);
    // product: walks each unseen parent once then stops when parent id already seen
    // a→b→a: depth becomes 2 before cycle break (cap only applies at 4)
    expect(sessionDepth(a, byId)).toBe(2);
    expect(sessionDepth(b, byId)).toBe(2);
  });

  it("sessionActivityTime falls back to createdAt when updatedAt missing", () => {
    const s = session({
      id: "s",
      workspaceId: "w1",
      createdAt: new Date(1234),
      updatedAt: undefined as never,
    });
    // force missing updatedAt
    const bare = { ...s } as Session;
    delete (bare as { updatedAt?: Date }).updatedAt;
    expect(sessionActivityTime(bare).getTime()).toBe(1234);
  });

  it("groupSessionsByWorkspace sorts each workspace by activity and keeps workspace order", () => {
    const workspaces: Workspace[] = [
      {
        id: "w1",
        name: "One",
        path: "C:/1",
        createdAt: new Date(0),
        lastActiveAt: new Date(0),
      },
      {
        id: "w2",
        name: "Two",
        path: "C:/2",
        createdAt: new Date(0),
        lastActiveAt: new Date(0),
      },
    ];
    const sessions = [
      session({ id: "s-old", workspaceId: "w1", favorite: false, updatedAt: new Date(1) }),
      session({ id: "s-fav", workspaceId: "w1", favorite: true, updatedAt: new Date(0) }),
      session({ id: "s2", workspaceId: "w2", updatedAt: new Date(9) }),
    ];
    const groups = groupSessionsByWorkspace(sessions, workspaces);
    expect(groups.map((g) => g.workspace.id)).toEqual(["w1", "w2"]);
    expect(groups[0]?.sessions.map((s) => s.id)).toEqual(["s-fav", "s-old"]);
    expect(groups[1]?.sessions.map((s) => s.id)).toEqual(["s2"]);
  });

  // wave-158 residual
  it("sessionDepth caps at 4 and two-node cycles stop after both parents walked", () => {
    const chain = [
      session({ id: "d0", workspaceId: "w1", parentSessionId: "d1" }),
      session({ id: "d1", workspaceId: "w1", parentSessionId: "d2" }),
      session({ id: "d2", workspaceId: "w1", parentSessionId: "d3" }),
      session({ id: "d3", workspaceId: "w1", parentSessionId: "d4" }),
      session({ id: "d4", workspaceId: "w1", parentSessionId: "d5" }),
      session({ id: "d5", workspaceId: "w1" }),
    ];
    const byId = new Map(chain.map((s) => [s.id, s]));
    expect(sessionDepth(chain[0]!, byId)).toBe(4);

    // A→B→A: walk adds B then A, then parent B already in seen → depth 2
    const cycleA = session({ id: "cA", workspaceId: "w1", parentSessionId: "cB" });
    const cycleB = session({ id: "cB", workspaceId: "w1", parentSessionId: "cA" });
    const cycleMap = new Map([
      [cycleA.id, cycleA],
      [cycleB.id, cycleB],
    ]);
    expect(sessionDepth(cycleA, cycleMap)).toBe(2);
    expect(sessionDepth(cycleB, cycleMap)).toBe(2);
  });

  it("groupSessionsByWorkspace drops empty workspaces and orphan sessions", () => {
    const workspaces: Workspace[] = [
      {
        id: "empty",
        name: "Empty",
        path: "C:/e",
        createdAt: new Date(0),
        lastActiveAt: new Date(0),
      },
      {
        id: "keep",
        name: "Keep",
        path: "C:/k",
        createdAt: new Date(0),
        lastActiveAt: new Date(0),
      },
    ];
    const sessions = [
      session({ id: "orphan", workspaceId: "missing" }),
      session({ id: "kept", workspaceId: "keep", updatedAt: new Date(5) }),
    ];
    const groups = groupSessionsByWorkspace(sessions, workspaces);
    expect(groups.map((g) => g.workspace.id)).toEqual(["keep"]);
    expect(groups[0]?.sessions.map((s) => s.id)).toEqual(["kept"]);
  });

  it("sortSessionsByActivity parent-before-child when activity does not create cycles", () => {
    // parent newer than child so activity + parent-child rules agree
    const parent = session({ id: "p", workspaceId: "w1", updatedAt: new Date(9) });
    const child = session({
      id: "c",
      workspaceId: "w1",
      parentSessionId: "p",
      updatedAt: new Date(1),
    });
    const byId = new Map([
      [parent.id, parent],
      [child.id, child],
    ]);
    expect(sortSessionsByActivity([child, parent], byId).map((s) => s.id)).toEqual(["p", "c"]);
    expect(sortSessionsByActivity([parent, child], byId).map((s) => s.id)).toEqual(["p", "c"]);
  });

  // wave-176 residual
  it("sessionMatches treats whitespace-only query as match-all and is case-insensitive", () => {
    const s = session({
      id: "m1",
      workspaceId: "w1",
      title: "Hello World",
      tags: ["BugFix"],
    });
    expect(sessionMatches(s, "")).toBe(true);
    expect(sessionMatches(s, "   ")).toBe(true);
    expect(sessionMatches(s, "\t")).toBe(true);
    expect(sessionMatches(s, "hello")).toBe(true);
    expect(sessionMatches(s, "bugfix")).toBe(true);
    expect(sessionMatches(s, "missing")).toBe(false);
  });

  it("sessionMatches skips message bodies when messagesLoaded is false", () => {
    const s = session({
      id: "m2",
      workspaceId: "w1",
      title: "TitleOnly",
      messagesLoaded: false,
      messages: [{ role: "user", content: "secret-in-body", createdAt: new Date(0) } as never],
    });
    expect(sessionMatches(s, "TitleOnly")).toBe(true);
    expect(sessionMatches(s, "secret-in-body")).toBe(false);
  });

  it("sessionActivityTime prefers updatedAt and falls back to createdAt", () => {
    const created = new Date("2026-01-01T00:00:00.000Z");
    const updated = new Date("2026-06-01T00:00:00.000Z");
    const withUpdated = session({ id: "a1", workspaceId: "w1", createdAt: created, updatedAt: updated });
    const withoutUpdated = session({ id: "a2", workspaceId: "w1", createdAt: created, updatedAt: undefined as never });
    expect(sessionActivityTime(withUpdated).getTime()).toBe(updated.getTime());
    expect(sessionActivityTime(withoutUpdated).getTime()).toBe(created.getTime());
  });

  // wave-181 residual
  it("sessionDepth caps at 4 even for longer parent chains", () => {
    const chain = ["s0", "s1", "s2", "s3", "s4", "s5"].map((id, i, arr) =>
      session({
        id,
        workspaceId: "w1",
        parentSessionId: i === 0 ? undefined : arr[i - 1],
      }),
    );
    const byId = new Map(chain.map((s) => [s.id, s]));
    expect(sessionDepth(chain[0]!, byId)).toBe(0);
    expect(sessionDepth(chain[1]!, byId)).toBe(1);
    expect(sessionDepth(chain[4]!, byId)).toBe(4);
    expect(sessionDepth(chain[5]!, byId)).toBe(4); // capped
  });

  it("sessionDepth breaks cycles via seen set without infinite loop", () => {
    // product: from a → b → a(seen stop) walks two edges → depth 2
    const a = session({ id: "a", workspaceId: "w1", parentSessionId: "b" });
    const b = session({ id: "b", workspaceId: "w1", parentSessionId: "a" });
    const byId = new Map([
      ["a", a],
      ["b", b],
    ]);
    expect(sessionDepth(a, byId)).toBe(2);
    expect(sessionDepth(b, byId)).toBe(2);
  });

  it("sessionMatches finds firstUserMessagePreview and summary independently of title", () => {
    const s = session({
      id: "p1",
      workspaceId: "w1",
      title: "T",
      summary: "alpha-summary",
      firstUserMessagePreview: "preview-token",
    });
    expect(sessionMatches(s, "alpha-summary")).toBe(true);
    expect(sessionMatches(s, "preview-token")).toBe(true);
    expect(sessionMatches(s, "missing-token")).toBe(false);
  });

  // wave-192 residual
  it("sortSessionsByActivity ranks same-parent siblings by depth then activity", () => {
    const parent = session({ id: "p", workspaceId: "w1", updatedAt: new Date(1) });
    const childShallow = session({
      id: "c1",
      workspaceId: "w1",
      parentSessionId: "p",
      updatedAt: new Date(50),
    });
    const childDeep = session({
      id: "c2",
      workspaceId: "w1",
      parentSessionId: "c1",
      updatedAt: new Date(200),
    });
    // same parent as childShallow: sibling with newer activity should still respect parent-before-child
    const sibling = session({
      id: "c1b",
      workspaceId: "w1",
      parentSessionId: "p",
      updatedAt: new Date(300),
    });
    const byId = new Map(
      [parent, childShallow, childDeep, sibling].map((s) => [s.id, s]),
    );
    const sorted = sortSessionsByActivity(
      [childDeep, sibling, childShallow, parent],
      byId,
    );
    // favorites none; parent before its children; among same parent depth order then activity
    expect(sorted[0]?.id).toBe("p");
    expect(sorted.map((s) => s.id)).toContain("c1");
    expect(sorted.map((s) => s.id)).toContain("c1b");
    // parent before child when either is the other's parent
    expect(sorted.indexOf(parent)).toBeLessThan(sorted.indexOf(childShallow));
    expect(sorted.indexOf(childShallow)).toBeLessThan(sorted.indexOf(childDeep));
  });

  it("groupSessionsByWorkspace returns empty for empty sessions and empty workspaces", () => {
    expect(groupSessionsByWorkspace([], [])).toEqual([]);
    expect(
      groupSessionsByWorkspace(
        [session({ id: "orphan", workspaceId: "missing" })],
        [],
      ),
    ).toEqual([]);
    const ws: Workspace = {
      id: "w1",
      name: "Only",
      path: "C:\\only",
      createdAt: new Date(0),
      lastActiveAt: new Date(0),
    };
    expect(groupSessionsByWorkspace([], [ws])).toEqual([]);
  });

  it("sessionMatches does not scan messages when messagesLoaded is explicitly false even with thinking", () => {
    const s = session({
      id: "lazy-think",
      workspaceId: "w1",
      title: "T",
      messagesLoaded: false,
      messages: [
        {
          id: "m1",
          role: "assistant",
          content: "visible-if-loaded",
          thinking: "hidden-think-token",
          timestamp: new Date(0),
        },
      ],
    } as Session);
    expect(sessionMatches(s, "hidden-think-token")).toBe(false);
    expect(sessionMatches(s, "visible-if-loaded")).toBe(false);
    expect(sessionMatches(s, "T")).toBe(true);
  });

  // wave-198 residual
  it("sessionMatches is case-insensitive on title; empty/whitespace query matches all", () => {
    const s = session({ id: "c1", workspaceId: "w1", title: "Hello World" });
    expect(sessionMatches(s, "")).toBe(true);
    expect(sessionMatches(s, "   ")).toBe(true);
    expect(sessionMatches(s, "hello")).toBe(true);
    expect(sessionMatches(s, "WORLD")).toBe(true);
    expect(sessionMatches(s, "nope")).toBe(false);
  });

  it("groupSessionsByWorkspace keeps only workspaces that have sessions", () => {
    const wsA: Workspace = {
      id: "a",
      name: "A",
      path: "C:\\a",
      createdAt: new Date(0),
      lastActiveAt: new Date(0),
    };
    const wsB: Workspace = {
      id: "b",
      name: "B",
      path: "C:\\b",
      createdAt: new Date(0),
      lastActiveAt: new Date(0),
    };
    const groups = groupSessionsByWorkspace(
      [session({ id: "s1", workspaceId: "a", title: "only-a" })],
      [wsA, wsB],
    );
    expect(groups.map((g) => g.workspace.id)).toEqual(["a"]);
    expect(groups[0]?.sessions).toHaveLength(1);
  });

  // wave-202 residual
  it("favorite false/undefined treated as non-favorite; parent precedes direct child regardless of activity", () => {
    const parent = session({
      id: "p",
      workspaceId: "w1",
      favorite: false,
      updatedAt: new Date(10),
    });
    const child = session({
      id: "c",
      workspaceId: "w1",
      parentSessionId: "p",
      favorite: undefined,
      updatedAt: new Date(999),
    });
    const byId = new Map([
      ["p", parent],
      ["c", child],
    ]);
    expect(sortSessionsByActivity([child, parent], byId).map((s) => s.id)).toEqual(["p", "c"]);
  });

  it("sessionMatches scans thinking when messagesLoaded is not false; group preserves multi-session sort", () => {
    const s = session({
      id: "think",
      workspaceId: "w1",
      title: "T",
      messages: [
        {
          id: "m1",
          role: "assistant",
          content: "body",
          thinking: "hidden-reasoner-token",
          timestamp: new Date(0),
        },
      ],
    } as Session);
    expect(sessionMatches(s, "hidden-reasoner-token")).toBe(true);
    expect(sessionMatches(s, "body")).toBe(true);

    const ws: Workspace = {
      id: "w1",
      name: "W",
      path: "C:\\w",
      createdAt: new Date(0),
      lastActiveAt: new Date(0),
    };
    const older = session({ id: "old", workspaceId: "w1", updatedAt: new Date(1) });
    const newer = session({ id: "new", workspaceId: "w1", updatedAt: new Date(9) });
    const groups = groupSessionsByWorkspace([older, newer], [ws]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.sessions.map((item) => item.id)).toEqual(["new", "old"]);
  });

  // wave-208 residual
  it("sessionDepth caps at 4 and stops on missing/cycle parent links", () => {
    const byId = new Map<string, Session>();
    const chain = ["d0", "d1", "d2", "d3", "d4", "d5"].map((id, index) =>
      session({
        id,
        workspaceId: "w1",
        parentSessionId: index === 0 ? undefined : `d${index - 1}`,
      }),
    );
    for (const s of chain) byId.set(s.id, s);
    expect(sessionDepth(byId.get("d0")!, byId)).toBe(0);
    expect(sessionDepth(byId.get("d1")!, byId)).toBe(1);
    expect(sessionDepth(byId.get("d4")!, byId)).toBe(4);
    expect(sessionDepth(byId.get("d5")!, byId)).toBe(4); // capped

    const orphan = session({ id: "orphan", workspaceId: "w1", parentSessionId: "missing" });
    expect(sessionDepth(orphan, byId)).toBe(0);

    const a = session({ id: "cyc-a", workspaceId: "w1", parentSessionId: "cyc-b" });
    const b = session({ id: "cyc-b", workspaceId: "w1", parentSessionId: "cyc-a" });
    const cycleMap = new Map([
      ["cyc-a", a],
      ["cyc-b", b],
    ]);
    // two-node cycle walks both parents once before seen stops → depth 2
    expect(sessionDepth(a, cycleMap)).toBe(2);
    expect(sessionDepth(b, cycleMap)).toBe(2);
  });

  it("favorite sessions sort first; empty workspaces drop from groups", () => {
    const wsEmpty: Workspace = {
      id: "empty",
      name: "E",
      path: "C:\\e",
      createdAt: new Date(0),
      lastActiveAt: new Date(0),
    };
    const ws: Workspace = {
      id: "w1",
      name: "W",
      path: "C:\\w",
      createdAt: new Date(0),
      lastActiveAt: new Date(0),
    };
    const fav = session({
      id: "fav",
      workspaceId: "w1",
      favorite: true,
      updatedAt: new Date(1),
    });
    const plain = session({
      id: "plain",
      workspaceId: "w1",
      favorite: false,
      updatedAt: new Date(99),
    });
    const byId = new Map([
      ["fav", fav],
      ["plain", plain],
    ]);
    expect(sortSessionsByActivity([plain, fav], byId).map((s) => s.id)).toEqual(["fav", "plain"]);
    const groups = groupSessionsByWorkspace([fav, plain], [wsEmpty, ws]);
    expect(groups.map((g) => g.workspace.id)).toEqual(["w1"]);
    expect(groups[0]?.sessions.map((s) => s.id)).toEqual(["fav", "plain"]);
  });

  it("sessionActivityTime prefers updatedAt; sessionMatches is case-insensitive", () => {
    const s = session({
      id: "act",
      workspaceId: "w1",
      title: "CamelCaseToken",
      createdAt: new Date(10),
      updatedAt: new Date(50),
    });
    expect(sessionActivityTime(s).getTime()).toBe(50);
    expect(sessionMatches(s, "camelcasetoken")).toBe(true);
    expect(sessionMatches(s, "CAMEL")).toBe(true);
    expect(sessionMatches(s, "nope")).toBe(false);
  });


  // wave-214 residual
  it("sessionMatches includes thinking text when messages are loaded", () => {
    const s = session({
      id: "think",
      workspaceId: "w1",
      title: "plain",
      messagesLoaded: true,
      messages: [
        {
          id: "m1",
          role: "assistant",
          content: "visible body",
          thinking: "hidden rationale about OAuth tokens",
          timestamp: new Date(0),
        } as Session["messages"][number],
      ],
    });
    expect(sessionMatches(s, "oauth")).toBe(true);
    expect(sessionMatches(s, "tokens")).toBe(true);
    expect(sessionMatches(s, "missing-word")).toBe(false);
  });

  it("sortSessionsByActivity prefers parent over child and activity among siblings", () => {
    const parent = session({
      id: "parent",
      workspaceId: "w1",
      updatedAt: new Date(10),
    });
    const child = session({
      id: "child",
      workspaceId: "w1",
      parentSessionId: "parent",
      updatedAt: new Date(99),
    });
    const siblingOld = session({
      id: "sib-old",
      workspaceId: "w1",
      updatedAt: new Date(5),
    });
    const siblingNew = session({
      id: "sib-new",
      workspaceId: "w1",
      updatedAt: new Date(50),
    });
    const byId = new Map([
      ["parent", parent],
      ["child", child],
      ["sib-old", siblingOld],
      ["sib-new", siblingNew],
    ]);
    // parent/child relationship: parent comes before child regardless of activity
    expect(sortSessionsByActivity([child, parent], byId).map((s) => s.id)).toEqual([
      "parent",
      "child",
    ]);
    // siblings: newer activity first
    expect(sortSessionsByActivity([siblingOld, siblingNew], byId).map((s) => s.id)).toEqual([
      "sib-new",
      "sib-old",
    ]);
  });

  it("groupSessionsByWorkspace preserves workspace order and filters empties", () => {
    const wsA: Workspace = {
      id: "a",
      name: "A",
      path: "C:\a",
      createdAt: new Date(0),
      lastActiveAt: new Date(0),
    };
    const wsB: Workspace = {
      id: "b",
      name: "B",
      path: "C:\b",
      createdAt: new Date(0),
      lastActiveAt: new Date(0),
    };
    const wsC: Workspace = {
      id: "c",
      name: "C",
      path: "C:\c",
      createdAt: new Date(0),
      lastActiveAt: new Date(0),
    };
    const sB = session({ id: "sb", workspaceId: "b", updatedAt: new Date(1) });
    const sA = session({ id: "sa", workspaceId: "a", updatedAt: new Date(1) });
    const groups = groupSessionsByWorkspace([sB, sA], [wsA, wsB, wsC]);
    expect(groups.map((g) => g.workspace.id)).toEqual(["a", "b"]);
    expect(groups.find((g) => g.workspace.id === "c")).toBeUndefined();
  });


  // wave-221 residual
  it("sessionMatches empty/whitespace query is true; unloaded messages skip bodies", () => {
    const s = session({
      id: "m1",
      workspaceId: "w1",
      title: "Alpha",
      summary: "beta",
      firstUserMessagePreview: "gamma",
      tags: ["tagZ"],
      messagesLoaded: false,
      messages: [{ id: "x", role: "user", content: "SECRET_BODY", timestamp: new Date(1) }] as never,
    });
    expect(sessionMatches(s, "")).toBe(true);
    expect(sessionMatches(s, "   ")).toBe(true);
    expect(sessionMatches(s, "Alpha")).toBe(true);
    expect(sessionMatches(s, "tagz")).toBe(true);
    expect(sessionMatches(s, "SECRET_BODY")).toBe(false);
    s.messagesLoaded = true;
    expect(sessionMatches(s, "SECRET_BODY")).toBe(true);
  });

  it("sessionDepth caps at 4 and breaks cycles via seen set", () => {
    const a = session({ id: "a", workspaceId: "w", parentSessionId: "b" });
    const b = session({ id: "b", workspaceId: "w", parentSessionId: "c" });
    const c = session({ id: "c", workspaceId: "w", parentSessionId: "d" });
    const d = session({ id: "d", workspaceId: "w", parentSessionId: "e" });
    const e = session({ id: "e", workspaceId: "w", parentSessionId: "f" });
    const f = session({ id: "f", workspaceId: "w", parentSessionId: "a" }); // cycle
    const byId = new Map([a, b, c, d, e, f].map((s) => [s.id, s]));
    expect(sessionDepth(a, byId)).toBe(4);
    expect(sessionDepth(session({ id: "root", workspaceId: "w" }), byId)).toBe(0);
  });

  it("sortSessionsByActivity prefers favorites then newer activity", () => {
    const older = session({ id: "old", workspaceId: "w", updatedAt: new Date(1), favorite: false });
    const newer = session({ id: "new", workspaceId: "w", updatedAt: new Date(9), favorite: false });
    const favOld = session({ id: "fav", workspaceId: "w", updatedAt: new Date(0), favorite: true });
    const byId = new Map([older, newer, favOld].map((s) => [s.id, s]));
    expect(sortSessionsByActivity([older, newer, favOld], byId).map((s) => s.id)).toEqual([
      "fav",
      "new",
      "old",
    ]);
  });
});

// wave-256 residual
describe("session-grouping residual (wave-256)", () => {
  it("groupSessionsByWorkspace drops empty workspaces and sorts within groups", () => {
    const wsA = { id: "wa", name: "A", path: "C:/a" } as Workspace;
    const wsB = { id: "wb", name: "B", path: "C:/b" } as Workspace;
    const wsEmpty = { id: "we", name: "E", path: "C:/e" } as Workspace;
    const s1 = session({ id: "s1", workspaceId: "wa", updatedAt: new Date(1) });
    const s2 = session({ id: "s2", workspaceId: "wa", updatedAt: new Date(9) });
    const s3 = session({ id: "s3", workspaceId: "wb", updatedAt: new Date(5) });
    const groups = groupSessionsByWorkspace([s1, s2, s3], [wsEmpty, wsA, wsB]);
    expect(groups.map((g) => g.workspace.id)).toEqual(["wa", "wb"]);
    expect(groups[0].sessions.map((s) => s.id)).toEqual(["s2", "s1"]);
    expect(groups[1].sessions.map((s) => s.id)).toEqual(["s3"]);
  });

  it("sessionActivityTime prefers updatedAt; parent child sort places parent before child", () => {
    const parent = session({ id: "p", workspaceId: "w", updatedAt: new Date(5) });
    const child = session({
      id: "c",
      workspaceId: "w",
      parentSessionId: "p",
      updatedAt: new Date(9),
    });
    const byId = new Map([parent, child].map((s) => [s.id, s]));
    expect(sessionActivityTime(parent).getTime()).toBe(5);
    const noUpdated = session({ id: "x", workspaceId: "w", createdAt: new Date(3) });
    // product: updatedAt ?? createdAt — session() defaults updatedAt to Date(0)
    expect(sessionActivityTime({ ...noUpdated, updatedAt: undefined as never }).getTime()).toBe(3);
    expect(sortSessionsByActivity([child, parent], byId).map((s) => s.id)).toEqual(["p", "c"]);
  });
});


// wave-267 residual
describe("session-grouping residual (wave-267)", () => {
  it("sessionMatches empty query matches all; trims and lowercases", () => {
    const s = session({
      id: "s1",
      workspaceId: "w1",
      title: "Hello World",
      summary: "Summary",
      firstUserMessagePreview: "preview",
      tags: ["TagA"],
      messagesLoaded: true,
    });
    expect(sessionMatches(s, "")).toBe(true);
    expect(sessionMatches(s, "  ")).toBe(true);
    expect(sessionMatches(s, "hello")).toBe(true);
    expect(sessionMatches(s, "TAGA")).toBe(true);
    expect(sessionMatches(s, "missing")).toBe(false);
  });

  it("groupSessionsByWorkspace preserves workspaces list order among non-empty groups", () => {
    const workspaces = [
      { id: "w2", name: "B", path: "C:/b" },
      { id: "w1", name: "A", path: "C:/a" },
      { id: "w3", name: "C", path: "C:/c" },
    ] as Workspace[];
    const sessions = [
      session({ id: "s1", workspaceId: "w1", updatedAt: new Date(10) }),
      session({ id: "s2", workspaceId: "w2", updatedAt: new Date(20) }),
    ];
    const groups = groupSessionsByWorkspace(sessions, workspaces);
    expect(groups.map((g) => g.workspace.id)).toEqual(["w2", "w1"]);
    expect(groups.every((g) => g.sessions.length > 0)).toBe(true);
  });
});


// wave-281 residual
describe("session-grouping residual (wave-281)", () => {
  it("sessionDepth caps at 4 and detects parent cycles as finite", () => {
    const a = session({ id: "a", parentSessionId: "b", workspaceId: "w" });
    const b = session({ id: "b", parentSessionId: "c", workspaceId: "w" });
    const c = session({ id: "c", parentSessionId: "d", workspaceId: "w" });
    const d = session({ id: "d", parentSessionId: "e", workspaceId: "w" });
    const e = session({ id: "e", parentSessionId: "f", workspaceId: "w" });
    const f = session({ id: "f", workspaceId: "w" });
    const byId = new Map([a, b, c, d, e, f].map((s) => [s.id, s]));
    expect(sessionDepth(a, byId)).toBe(4);
    // cycle
    const x = session({ id: "x", parentSessionId: "y", workspaceId: "w" });
    const y = session({ id: "y", parentSessionId: "x", workspaceId: "w" });
    const cycle = new Map([["x", x], ["y", y]]);
    expect(sessionDepth(x, cycle)).toBeLessThanOrEqual(4);
  });

  it("groupSessionsByWorkspace drops empty workspaces; activity prefers favorite", () => {
    const workspaces = [
      { id: "w1", name: "A", path: "C:/a" },
      { id: "empty", name: "E", path: "C:/e" },
    ] as Workspace[];
    const sessions = [
      session({ id: "s1", workspaceId: "w1", updatedAt: new Date(1), favorite: false }),
      session({ id: "s2", workspaceId: "w1", updatedAt: new Date(2), favorite: true }),
    ];
    const groups = groupSessionsByWorkspace(sessions, workspaces);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.workspace.id).toBe("w1");
    expect(groups[0]?.sessions.map((s) => s.id)).toEqual(["s2", "s1"]);
  });
});



// wave-290 residual
describe("session-grouping residual (wave-290)", () => {
  it("sessionMatches scans title/summary/preview/tags; skips messages when not loaded", () => {
    const unloaded = session({
      id: "u1",
      workspaceId: "w",
      title: "Alpha",
      summary: "sum-X",
      firstUserMessagePreview: "preview-Y",
      tags: ["tagZ"],
      messagesLoaded: false,
      messages: [{ role: "user", content: "SECRET_MSG" } as never],
    });
    expect(sessionMatches(unloaded, "alpha")).toBe(true);
    expect(sessionMatches(unloaded, "sum-x")).toBe(true);
    expect(sessionMatches(unloaded, "preview-y")).toBe(true);
    expect(sessionMatches(unloaded, "tagz")).toBe(true);
    expect(sessionMatches(unloaded, "SECRET_MSG")).toBe(false);

    const loaded = session({
      id: "l1",
      workspaceId: "w",
      title: "T",
      messagesLoaded: true,
      messages: [{ role: "user", content: "SECRET_MSG" } as never],
    });
    expect(sessionMatches(loaded, "SECRET_MSG")).toBe(true);
  });

  it("groupSessionsByWorkspace sorts favorites first per workspace; empty groups dropped", () => {
    const workspaces = [
      { id: "w1", name: "A", path: "C:/a" },
      { id: "w2", name: "B", path: "C:/b" },
      { id: "w3", name: "C", path: "C:/c" },
    ] as Workspace[];
    const sessions = [
      session({ id: "s1", workspaceId: "w1", updatedAt: new Date(1), favorite: false }),
      session({ id: "s2", workspaceId: "w1", updatedAt: new Date(2), favorite: true }),
      session({ id: "s3", workspaceId: "w2", updatedAt: new Date(3), favorite: false }),
    ];
    const groups = groupSessionsByWorkspace(sessions, workspaces);
    expect(groups.map((g) => g.workspace.id)).toEqual(["w1", "w2"]);
    expect(groups[0]?.sessions.map((s) => s.id)).toEqual(["s2", "s1"]);
    expect(groups[1]?.sessions.map((s) => s.id)).toEqual(["s3"]);
  });
});


// wave-299 residual
describe("session-grouping residual (wave-299)", () => {
  it("sessionDepth caps at 4 and breaks parent cycles via seen set", () => {
    const s5 = session({ id: "s5", workspaceId: "w", parentSessionId: "s4" });
    const s4 = session({ id: "s4", workspaceId: "w", parentSessionId: "s3" });
    const s3 = session({ id: "s3", workspaceId: "w", parentSessionId: "s2" });
    const s2 = session({ id: "s2", workspaceId: "w", parentSessionId: "s1" });
    const s1 = session({ id: "s1", workspaceId: "w", parentSessionId: "s0" });
    const s0 = session({ id: "s0", workspaceId: "w" });
    const byId = new Map(
      [s0, s1, s2, s3, s4, s5].map((s) => [s.id, s]),
    );
    expect(sessionDepth(s0, byId)).toBe(0);
    expect(sessionDepth(s1, byId)).toBe(1);
    expect(sessionDepth(s5, byId)).toBe(4); // cap

    // cycle: a->b->a
    const a = session({ id: "a", workspaceId: "w", parentSessionId: "b" });
    const b = session({ id: "b", workspaceId: "w", parentSessionId: "a" });
    const cycleMap = new Map([
      ["a", a],
      ["b", b],
    ]);
    expect(sessionDepth(a, cycleMap)).toBeLessThanOrEqual(4);
    expect(sessionDepth(a, cycleMap)).toBeGreaterThan(0);
  });

  it("sessionActivityTime prefers updatedAt; falls back to createdAt", () => {
    const created = new Date("2026-01-01T00:00:00.000Z");
    const updated = new Date("2026-07-01T00:00:00.000Z");
    const s = session({
      id: "x",
      workspaceId: "w",
      createdAt: created,
      updatedAt: updated,
    });
    expect(sessionActivityTime(s).getTime()).toBe(updated.getTime());
    const s2 = session({
      id: "y",
      workspaceId: "w",
      createdAt: created,
      updatedAt: undefined as never,
    });
    // if updatedAt missing, product uses createdAt via ??
    const t = sessionActivityTime({ ...s2, updatedAt: undefined } as never);
    expect(t.getTime()).toBe(created.getTime());
  });

  it("sessionMatches empty query always true; trims and lowercases", () => {
    const s = session({ id: "m", workspaceId: "w", title: "Hello World" });
    expect(sessionMatches(s, "")).toBe(true);
    expect(sessionMatches(s, "   ")).toBe(true);
    expect(sessionMatches(s, " hello ")).toBe(true);
    expect(sessionMatches(s, "WORLD")).toBe(true);
    expect(sessionMatches(s, "nope")).toBe(false);
  });
});

// wave-312 residual
describe("session-grouping residual (wave-312)", () => {
  it("groupSessionsByWorkspace drops empty workspaces; preserves workspace order of input", () => {
    const workspaces = [
      { id: "w1", name: "A", path: "C:/a" } as Workspace,
      { id: "w2", name: "B", path: "C:/b" } as Workspace,
      { id: "w3", name: "C", path: "C:/c" } as Workspace,
    ];
    const sessions = [
      session({ id: "s2", workspaceId: "w2", updatedAt: new Date(2) }),
      session({ id: "s1", workspaceId: "w1", updatedAt: new Date(1) }),
    ];
    const groups = groupSessionsByWorkspace(sessions, workspaces);
    expect(groups.map((g) => g.workspace.id)).toEqual(["w1", "w2"]);
    expect(groups.find((g) => g.workspace.id === "w3")).toBeUndefined();
    expect(groups[0]?.sessions[0]?.id).toBe("s1");
    expect(groups[1]?.sessions[0]?.id).toBe("s2");
  });

  it("sortSessionsByActivity favorites first; parent after child relationship; depth cap 4", () => {
    const root = session({ id: "root", workspaceId: "w", favorite: false, updatedAt: new Date(10) });
    const fav = session({ id: "fav", workspaceId: "w", favorite: true, updatedAt: new Date(1) });
    const child = session({ id: "child", workspaceId: "w", parentSessionId: "root", updatedAt: new Date(20) });
    const byId = new Map([
      ["root", root],
      ["fav", fav],
      ["child", child],
    ]);
    const sorted = sortSessionsByActivity([root, child, fav], byId);
    expect(sorted[0]?.id).toBe("fav");
    // child with parentSessionId === root.id sorts after root (return 1 when a.parent === b.id)
    const pair = sortSessionsByActivity([child, root], byId);
    expect(pair.map((s) => s.id)).toEqual(["root", "child"]);

    // depth chain longer than 4 capped
    const chain: Session[] = [];
    for (let i = 0; i < 6; i++) {
      chain.push(
        session({
          id: `d${i}`,
          workspaceId: "w",
          parentSessionId: i === 0 ? undefined : `d${i - 1}`,
        }),
      );
    }
    const map = new Map(chain.map((s) => [s.id, s]));
    expect(sessionDepth(chain[5]!, map)).toBe(4);
  });

  it("sessionMatches skips message bodies when messagesLoaded false; includes thinking when loaded", () => {
    const hidden = session({
      id: "h",
      workspaceId: "w",
      title: "TitleOnly",
      messagesLoaded: false,
      messages: [
        { id: "m", role: "user", content: "hidden-needle", timestamp: new Date(0), thinking: "think-needle" } as never,
      ],
    });
    expect(sessionMatches(hidden, "hidden-needle")).toBe(false);
    expect(sessionMatches(hidden, "think-needle")).toBe(false);
    expect(sessionMatches(hidden, "titleonly")).toBe(true);
    const loaded = session({
      id: "l",
      workspaceId: "w",
      messagesLoaded: true,
      messages: [
        { id: "m", role: "assistant", content: "body", timestamp: new Date(0), thinking: "plan-step" } as never,
      ],
    });
    expect(sessionMatches(loaded, "plan-step")).toBe(true);
  });
});
