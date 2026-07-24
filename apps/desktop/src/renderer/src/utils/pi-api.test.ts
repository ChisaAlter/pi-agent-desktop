// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { getPiAPI } from "./pi-api";

describe("getPiAPI", () => {
  afterEach(() => {
    // @ts-expect-error test cleanup
    delete window.piAPI;
  });

  it("returns undefined when piAPI is not exposed", () => {
    expect(getPiAPI()).toBeUndefined();
  });

  it("returns window.piAPI when present", () => {
    const api = { listSessions: vi.fn() } as never;
    window.piAPI = api;
    expect(getPiAPI()).toBe(api);
  });

  // wave-105 residual
  it("returns the same reference across repeated calls", () => {
    const api = { listSessions: vi.fn() } as never;
    window.piAPI = api;
    expect(getPiAPI()).toBe(getPiAPI());
    expect(getPiAPI()).toBe(api);
  });

  // wave-125 residual
  it("returns undefined when piAPI is explicitly set to undefined", () => {
    // @ts-expect-error intentional
    window.piAPI = undefined;
    expect(getPiAPI()).toBeUndefined();
  });

  // wave-130 residual
  it("returns undefined after piAPI is deleted following prior exposure", () => {
    const api = { listSessions: vi.fn() } as never;
    window.piAPI = api;
    expect(getPiAPI()).toBe(api);
    // @ts-expect-error intentional
    delete window.piAPI;
    expect(getPiAPI()).toBeUndefined();
  });

  // wave-146 residual
  it("tracks reassignment of window.piAPI after prior exposure", () => {
    const first = { id: "a" } as never;
    const second = { id: "b" } as never;
    window.piAPI = first;
    expect(getPiAPI()).toBe(first);
    window.piAPI = second;
    expect(getPiAPI()).toBe(second);
  });

  it("returns null when piAPI is set to null (product does not coerce)", () => {
    // @ts-expect-error intentional null assignment
    window.piAPI = null;
    expect(getPiAPI()).toBeNull();
  });

  // wave-167 residual
  it("returns falsy values as-is without coercing to undefined", () => {
    // @ts-expect-error intentional
    window.piAPI = false;
    expect(getPiAPI()).toBe(false);
    // @ts-expect-error intentional
    window.piAPI = 0;
    expect(getPiAPI()).toBe(0);
    // @ts-expect-error intentional
    window.piAPI = "";
    expect(getPiAPI()).toBe("");
  });

  // wave-189 residual
  it("returns empty object and frozen api references as-is", () => {
    const empty = {} as never;
    window.piAPI = empty;
    expect(getPiAPI()).toBe(empty);
    const frozen = Object.freeze({ listSessions: () => [] }) as never;
    window.piAPI = frozen;
    expect(getPiAPI()).toBe(frozen);
  });

  // wave-194 residual
  it("returns arrays and functions as-is when assigned to piAPI", () => {
    const arr = [] as never;
    window.piAPI = arr;
    expect(getPiAPI()).toBe(arr);
    const fn = (() => undefined) as never;
    window.piAPI = fn;
    expect(getPiAPI()).toBe(fn);
  });

  it("does not cache previous value after reassignment to undefined", () => {
    const api = { listSessions: vi.fn() } as never;
    window.piAPI = api;
    expect(getPiAPI()).toBe(api);
    // @ts-expect-error intentional
    window.piAPI = undefined;
    expect(getPiAPI()).toBeUndefined();
  });

  // wave-200 residual
  it("returns primitives and null when assigned (no shape validation)", () => {
    window.piAPI = 0 as never;
    expect(getPiAPI()).toBe(0);
    window.piAPI = "" as never;
    expect(getPiAPI()).toBe("");
    window.piAPI = null as never;
    expect(getPiAPI()).toBeNull();
  });

  it("reads live window.piAPI each call (no memoization)", () => {
    const a = { id: "a" } as never;
    const b = { id: "b" } as never;
    window.piAPI = a;
    expect(getPiAPI()).toBe(a);
    window.piAPI = b;
    expect(getPiAPI()).toBe(b);
    expect(getPiAPI()).not.toBe(a);
  });

  // wave-204 residual
  it("returns nested objects by reference (no clone)", () => {
    const nested = { listSessions: vi.fn(), nested: { a: 1 } };
    window.piAPI = nested as never;
    const got = getPiAPI() as unknown as typeof nested;
    expect(got).toBe(nested);
    expect(got.nested).toBe(nested.nested);
  });

  it("symbol and bigint values pass through when assigned", () => {
    const sym = Symbol("pi");
    window.piAPI = sym as never;
    expect(getPiAPI()).toBe(sym);
    window.piAPI = 10n as never;
    expect(getPiAPI()).toBe(10n);
  });

  // wave-210 residual
  it("boolean and function values pass through; delete yields undefined", () => {
    window.piAPI = true as never;
    expect(getPiAPI()).toBe(true);
    window.piAPI = false as never;
    expect(getPiAPI()).toBe(false);
    const fn = () => "pi";
    window.piAPI = fn as never;
    expect(getPiAPI()).toBe(fn);
    // @ts-expect-error intentional delete
    delete window.piAPI;
    expect(getPiAPI()).toBeUndefined();
  });

  // wave-222 residual
  it("null assignment yields null; reassignment after delete works", () => {
    window.piAPI = null as never;
    expect(getPiAPI()).toBeNull();
    // @ts-expect-error intentional delete
    delete window.piAPI;
    expect(getPiAPI()).toBeUndefined();
    const api = { ping: () => 1 };
    window.piAPI = api as never;
    expect(getPiAPI()).toBe(api);
  });

  // wave-258 residual
  it("returns same object identity; empty object and array pass through", () => {
    const api = { stop: () => undefined };
    window.piAPI = api as never;
    expect(getPiAPI()).toBe(api);
    window.piAPI = {} as never;
    expect(getPiAPI()).toEqual({});
    window.piAPI = [] as never;
    expect(getPiAPI()).toEqual([]);
  });

  it("number and string assignments pass through without coercion", () => {
    window.piAPI = 0 as never;
    expect(getPiAPI()).toBe(0);
    window.piAPI = "bridge" as never;
    expect(getPiAPI()).toBe("bridge");
  });

  // wave-272 residual
  it("Symbol and BigInt pass through; reassign after null restores", () => {
    const sym = Symbol("pi");
    window.piAPI = sym as never;
    expect(getPiAPI()).toBe(sym);
    window.piAPI = 10n as never;
    expect(getPiAPI()).toBe(10n);
    window.piAPI = null as never;
    expect(getPiAPI()).toBeNull();
    const api = { agentsAbort: () => undefined };
    window.piAPI = api as never;
    expect(getPiAPI()).toBe(api);
  });

  it("undefined explicit assignment yields undefined", () => {
    window.piAPI = undefined as never;
    expect(getPiAPI()).toBeUndefined();
  });

});
