// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSoundVolume,
  isSoundEnabled,
  playCompleteSound,
  playErrorSound,
  playMessageSound,
  setSoundEnabled,
  setSoundVolume,
} from "./sounds";

function createLocalStorageMock(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

function stubAudioContext() {
  const close = vi.fn(async () => undefined);
  const stop = vi.fn();
  const start = vi.fn();
  const connect = vi.fn();
  const exponentialRampToValueAtTime = vi.fn();
  const oscillator = {
    type: "sine" as OscillatorType,
    frequency: { value: 0 },
    connect,
    start,
    stop,
  };
  const gainNode = {
    gain: { value: 0, exponentialRampToValueAtTime },
    connect,
  };
  const createOscillator = vi.fn(() => oscillator);
  const createGain = vi.fn(() => gainNode);
  const AudioContextMock = vi.fn(function AudioContext(this: {
    createOscillator: typeof createOscillator;
    createGain: typeof createGain;
    destination: object;
    currentTime: number;
    close: typeof close;
  }) {
    this.createOscillator = createOscillator;
    this.createGain = createGain;
    this.destination = {};
    this.currentTime = 0;
    this.close = close;
  });
  vi.stubGlobal("AudioContext", AudioContextMock);
  return { AudioContextMock, oscillator, gainNode, createOscillator, createGain, close, start, stop };
}

describe("sounds settings", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createLocalStorageMock(),
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("defaults to enabled with volume 0.5", () => {
    expect(isSoundEnabled()).toBe(true);
    expect(getSoundVolume()).toBe(0.5);
  });

  it("persists enable/disable", () => {
    setSoundEnabled(false);
    expect(isSoundEnabled()).toBe(false);
    setSoundEnabled(true);
    expect(isSoundEnabled()).toBe(true);
  });

  it("clamps volume to [0, 1]", () => {
    setSoundVolume(1.5);
    expect(getSoundVolume()).toBe(1);
    setSoundVolume(-0.2);
    expect(getSoundVolume()).toBe(0);
    setSoundVolume(0.33);
    expect(getSoundVolume()).toBe(0.33);
  });

  it("does not open AudioContext when sound is disabled", () => {
    const AudioContextMock = vi.fn();
    vi.stubGlobal("AudioContext", AudioContextMock);
    setSoundEnabled(false);
    playMessageSound();
    playErrorSound();
    playCompleteSound();
    expect(AudioContextMock).not.toHaveBeenCalled();
  });

  it("plays tones through AudioContext when enabled", () => {
    const { AudioContextMock, start, stop, close, gainNode } = stubAudioContext();

    setSoundEnabled(true);
    setSoundVolume(0.8);
    playMessageSound();
    expect(AudioContextMock).toHaveBeenCalled();
    expect(start).toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
    expect(gainNode.gain.exponentialRampToValueAtTime).toHaveBeenCalled();
    // volume * 0.3 gain scale
    expect(gainNode.gain.value).toBeCloseTo(0.24);

    vi.runAllTimers();
    expect(close).toHaveBeenCalled();
  });

  // wave-109 residual
  it("falls back to defaults when localStorage JSON is corrupt", () => {
    window.localStorage.setItem("pi-desktop-sound-settings", "{not-json");
    expect(isSoundEnabled()).toBe(true);
    expect(getSoundVolume()).toBe(0.5);
  });

  it("swallows AudioContext construction failures", () => {
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function AudioContextBlocked() {
        throw new Error("AudioContext blocked");
      }),
    );
    setSoundEnabled(true);
    expect(() => playMessageSound()).not.toThrow();
    expect(() => playErrorSound()).not.toThrow();
  });

  it("playCompleteSound schedules three tones", () => {
    const { AudioContextMock } = stubAudioContext();
    setSoundEnabled(true);
    playCompleteSound();
    expect(AudioContextMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(AudioContextMock).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(100);
    expect(AudioContextMock).toHaveBeenCalledTimes(3);
  });

  it("playErrorSound uses square oscillator type", () => {
    const { oscillator } = stubAudioContext();
    setSoundEnabled(true);
    playErrorSound();
    expect(oscillator.type).toBe("square");
    expect(oscillator.frequency.value).toBe(300);
  });

  it("preserves volume when toggling enabled", () => {
    setSoundVolume(0.7);
    setSoundEnabled(false);
    setSoundEnabled(true);
    expect(getSoundVolume()).toBe(0.7);
  });

  // wave-122 residual
  it("clamps volume to 0..1 inclusive", () => {
    setSoundVolume(-0.5);
    expect(getSoundVolume()).toBe(0);
    setSoundVolume(1.5);
    expect(getSoundVolume()).toBe(1);
    setSoundVolume(0);
    expect(getSoundVolume()).toBe(0);
    setSoundVolume(1);
    expect(getSoundVolume()).toBe(1);
  });

  it("does not construct AudioContext when sound is disabled", () => {
    const { AudioContextMock } = stubAudioContext();
    setSoundEnabled(false);
    playMessageSound();
    playErrorSound();
    playCompleteSound();
    expect(AudioContextMock).not.toHaveBeenCalled();
  });

  it("playMessageSound uses 800Hz sine by default", () => {
    const { AudioContextMock, oscillator } = stubAudioContext();
    setSoundEnabled(true);
    playMessageSound();
    expect(AudioContextMock).toHaveBeenCalledTimes(1);
    expect(oscillator.type).toBe("sine");
    expect(oscillator.frequency.value).toBe(800);
  });

  it("falls back to defaults when localStorage is missing", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: undefined,
    });
    expect(isSoundEnabled()).toBe(true);
    expect(getSoundVolume()).toBe(0.5);
    expect(() => setSoundEnabled(false)).not.toThrow();
  });

  // wave-127 residual
  it("falls back when stored sound settings JSON is corrupt", () => {
    window.localStorage.setItem("pi-desktop-sound-settings", "{not-json");
    expect(isSoundEnabled()).toBe(true);
    expect(getSoundVolume()).toBe(0.5);
  });

  it("playErrorSound uses square 300Hz and playComplete schedules multi-tone", () => {
    const { AudioContextMock, oscillator } = stubAudioContext();
    setSoundEnabled(true);
    playErrorSound();
    expect(AudioContextMock).toHaveBeenCalledTimes(1);
    expect(oscillator.type).toBe("square");
    expect(oscillator.frequency.value).toBe(300);

    AudioContextMock.mockClear();
    playCompleteSound();
    expect(AudioContextMock).toHaveBeenCalledTimes(1);
    // first complete tone is 523Hz sine
    expect(oscillator.frequency.value).toBe(523);
    vi.advanceTimersByTime(100);
    expect(AudioContextMock).toHaveBeenCalledTimes(2);
    expect(oscillator.frequency.value).toBe(659);
    vi.advanceTimersByTime(100);
    expect(AudioContextMock).toHaveBeenCalledTimes(3);
    expect(oscillator.frequency.value).toBe(784);
  });

  it("setSoundVolume clamps to unit interval including endpoints", () => {
    setSoundVolume(0);
    expect(getSoundVolume()).toBe(0);
    setSoundVolume(1);
    expect(getSoundVolume()).toBe(1);
  });

  // wave-135 residual
  it("setSoundVolume clamps below 0 and above 1", () => {
    setSoundVolume(-2);
    expect(getSoundVolume()).toBe(0);
    setSoundVolume(5);
    expect(getSoundVolume()).toBe(1);
  });

  it("preserves volume when toggling enabled and skips tones when disabled", () => {
    const { AudioContextMock } = stubAudioContext();
    setSoundVolume(0.25);
    setSoundEnabled(false);
    expect(isSoundEnabled()).toBe(false);
    expect(getSoundVolume()).toBe(0.25);
    playMessageSound();
    playErrorSound();
    playCompleteSound();
    expect(AudioContextMock).not.toHaveBeenCalled();
    setSoundEnabled(true);
    expect(getSoundVolume()).toBe(0.25);
    playMessageSound();
    expect(AudioContextMock).toHaveBeenCalledTimes(1);
  });

  it("partial stored settings keep enabled false without inventing volume", () => {
    window.localStorage.setItem("pi-desktop-sound-settings", JSON.stringify({ enabled: false }));
    expect(isSoundEnabled()).toBe(false);
    const volume = getSoundVolume();
    expect(volume === undefined || typeof volume === "number").toBe(true);
  });

  // wave-147 residual
  it("falls back to defaults when stored JSON is invalid", () => {
    window.localStorage.setItem("pi-desktop-sound-settings", "{not-json");
    expect(isSoundEnabled()).toBe(true);
    expect(getSoundVolume()).toBe(0.5);
  });

  it("setSoundEnabled preserves prior volume and setSoundVolume preserves enabled", () => {
    setSoundVolume(0.4);
    setSoundEnabled(false);
    expect(getSoundVolume()).toBe(0.4);
    expect(isSoundEnabled()).toBe(false);
    setSoundVolume(0.7);
    expect(isSoundEnabled()).toBe(false);
    expect(getSoundVolume()).toBe(0.7);
  });

  it("does not throw when AudioContext construction fails", () => {
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: class {
        constructor() {
          throw new Error("no audio");
        }
      },
    });
    setSoundEnabled(true);
    expect(() => playMessageSound()).not.toThrow();
    expect(() => playErrorSound()).not.toThrow();
    expect(() => playCompleteSound()).not.toThrow();
  });

  // wave-155 residual
  it("setSoundVolume(0) and setSoundVolume(1) are accepted boundary values", () => {
    setSoundVolume(0);
    expect(getSoundVolume()).toBe(0);
    setSoundVolume(1);
    expect(getSoundVolume()).toBe(1);
    setSoundVolume(0.5);
    expect(getSoundVolume()).toBe(0.5);
  });

  it("defaults to enabled true and volume 0.5 when storage is empty", () => {
    window.localStorage.removeItem("pi-desktop-sound-settings");
    expect(isSoundEnabled()).toBe(true);
    expect(getSoundVolume()).toBe(0.5);
  });

  it("persists full settings object after setSoundEnabled", () => {
    setSoundVolume(0.33);
    setSoundEnabled(false);
    const raw = window.localStorage.getItem("pi-desktop-sound-settings");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { enabled: boolean; volume: number };
    expect(parsed.enabled).toBe(false);
    expect(parsed.volume).toBe(0.33);
  });

  // wave-162 residual
  it("clamps volume below 0 and above 1; NaN persists via JSON as null", () => {
    setSoundVolume(-1);
    expect(getSoundVolume()).toBe(0);
    setSoundVolume(2);
    expect(getSoundVolume()).toBe(1);
    // Math.max(0, Math.min(1, NaN)) → NaN, then JSON.stringify stores null
    setSoundVolume(Number.NaN);
    expect(getSoundVolume()).toBeNull();
  });

  it("setSoundEnabled(false) prevents play helpers from throwing", () => {
    setSoundEnabled(false);
    expect(() => playMessageSound()).not.toThrow();
    expect(() => playErrorSound()).not.toThrow();
    expect(() => playCompleteSound()).not.toThrow();
  });

  it("re-enabling after disable restores enabled true in storage", () => {
    setSoundEnabled(false);
    setSoundEnabled(true);
    expect(isSoundEnabled()).toBe(true);
    const parsed = JSON.parse(window.localStorage.getItem("pi-desktop-sound-settings")!) as {
      enabled: boolean;
    };
    expect(parsed.enabled).toBe(true);
  });

  // wave-176 residual
  it("falls back to defaults when storage holds invalid JSON", () => {
    window.localStorage.setItem("pi-desktop-sound-settings", "{not-json");
    expect(isSoundEnabled()).toBe(true);
    expect(getSoundVolume()).toBe(0.5);
  });

  it("preserves volume when toggling enabled and clamps volume 0", () => {
    setSoundVolume(0.25);
    setSoundEnabled(false);
    expect(getSoundVolume()).toBe(0.25);
    setSoundVolume(0);
    expect(getSoundVolume()).toBe(0);
    setSoundEnabled(true);
    expect(isSoundEnabled()).toBe(true);
    expect(getSoundVolume()).toBe(0);
    // play with volume 0 must not throw
    expect(() => playMessageSound()).not.toThrow();
  });

  it("partial stored settings are used as-is without merging defaults", () => {
    // product: JSON.parse result is returned raw — missing volume/enabled may be undefined
    window.localStorage.setItem("pi-desktop-sound-settings", JSON.stringify({ enabled: false }));
    expect(isSoundEnabled()).toBe(false);
    expect(getSoundVolume()).toBeUndefined();
    window.localStorage.setItem("pi-desktop-sound-settings", JSON.stringify({ volume: 0.8 }));
    expect(getSoundVolume()).toBe(0.8);
    expect(isSoundEnabled()).toBeUndefined();
  });

  // wave-182 residual
  it("setSoundVolume clamps above 1 and below 0 without affecting enabled", () => {
    setSoundEnabled(true);
    setSoundVolume(1.5);
    expect(getSoundVolume()).toBe(1);
    setSoundVolume(-3);
    expect(getSoundVolume()).toBe(0);
    expect(isSoundEnabled()).toBe(true);
  });

  it("setSoundEnabled(false) blocks play helpers without throwing", () => {
    setSoundEnabled(false);
    setSoundVolume(1);
    expect(() => playMessageSound()).not.toThrow();
    expect(() => playCompleteSound()).not.toThrow();
    expect(() => playErrorSound()).not.toThrow();
  });

  it("empty-string storage falls back to defaults (not valid JSON object)", () => {
    window.localStorage.setItem("pi-desktop-sound-settings", "");
    // JSON.parse("") throws → catch → defaults
    expect(isSoundEnabled()).toBe(true);
    expect(getSoundVolume()).toBe(0.5);
  });

  // wave-191 residual
  it("setSoundVolume accepts boundary 0 and 1; NaN persists as null via JSON", () => {
    setSoundEnabled(true);
    setSoundVolume(0);
    expect(getSoundVolume()).toBe(0);
    setSoundVolume(1);
    expect(getSoundVolume()).toBe(1);
    // product: Math.max(0, Math.min(1, NaN)) → NaN, JSON.stringify stores null
    setSoundVolume(Number.NaN);
    expect(getSoundVolume()).toBeNull();
  });

  it("malformed JSON storage falls back to enabled true and volume 0.5", () => {
    window.localStorage.setItem("pi-desktop-sound-settings", "{not-json");
    expect(isSoundEnabled()).toBe(true);
    expect(getSoundVolume()).toBe(0.5);
  });

  // wave-196 residual
  it("setSoundEnabled preserves volume; setSoundVolume preserves enabled", () => {
    setSoundEnabled(true);
    setSoundVolume(0.25);
    setSoundEnabled(false);
    expect(isSoundEnabled()).toBe(false);
    expect(getSoundVolume()).toBe(0.25);
    setSoundVolume(0.9);
    expect(isSoundEnabled()).toBe(false);
    expect(getSoundVolume()).toBe(0.9);
    setSoundEnabled(true);
    expect(isSoundEnabled()).toBe(true);
    expect(getSoundVolume()).toBe(0.9);
  });

  it("defaults apply when storage key is missing after clear", () => {
    window.localStorage.removeItem("pi-desktop-sound-settings");
    expect(isSoundEnabled()).toBe(true);
    expect(getSoundVolume()).toBe(0.5);
  });

  // wave-203 residual
  it("setSoundVolume clamps above 1 down to 1 and below 0 up to 0", () => {
    setSoundVolume(1.5);
    expect(getSoundVolume()).toBe(1);
    setSoundVolume(99);
    expect(getSoundVolume()).toBe(1);
    setSoundVolume(-0.01);
    expect(getSoundVolume()).toBe(0);
  });

  it("partial storage JSON keeps provided fields; missing fields stay undefined (product)", () => {
    // product JSON.parse returns object as-is — no field-level defaults merge
    window.localStorage.setItem("pi-desktop-sound-settings", JSON.stringify({ enabled: false }));
    expect(isSoundEnabled()).toBe(false);
    // volume key absent → undefined from parsed object
    expect(getSoundVolume()).toBeUndefined();
    window.localStorage.setItem("pi-desktop-sound-settings", JSON.stringify({ volume: 0.2 }));
    expect(getSoundVolume()).toBe(0.2);
    // enabled key absent → undefined (falsy)
    expect(isSoundEnabled()).toBeFalsy();
  });

  // wave-209 residual
  it("setSoundEnabled preserves volume; setSoundVolume preserves enabled", () => {
    setSoundVolume(0.33);
    setSoundEnabled(false);
    expect(isSoundEnabled()).toBe(false);
    expect(getSoundVolume()).toBeCloseTo(0.33);
    setSoundEnabled(true);
    expect(isSoundEnabled()).toBe(true);
    expect(getSoundVolume()).toBeCloseTo(0.33);
    setSoundVolume(0);
    expect(isSoundEnabled()).toBe(true);
    expect(getSoundVolume()).toBe(0);
  });

  it("invalid JSON falls back to defaults; volume boundary 0 and 1 stick", () => {
    window.localStorage.setItem("pi-desktop-sound-settings", "{not-json");
    expect(isSoundEnabled()).toBe(true);
    expect(getSoundVolume()).toBe(0.5);
    setSoundVolume(0);
    expect(getSoundVolume()).toBe(0);
    setSoundVolume(1);
    expect(getSoundVolume()).toBe(1);
  });


  // wave-215 residual
  it("setSoundVolume clamps below 0 and above 1", () => {
    setSoundVolume(-5);
    expect(getSoundVolume()).toBe(0);
    setSoundVolume(5);
    expect(getSoundVolume()).toBe(1);
    setSoundVolume(0.25);
    expect(getSoundVolume()).toBeCloseTo(0.25);
  });

  it("malformed stored object still parses when JSON valid; missing fields stay falsy/undefined", () => {
    window.localStorage.setItem(
      "pi-desktop-sound-settings",
      JSON.stringify({ enabled: false }),
    );
    expect(isSoundEnabled()).toBe(false);
    expect(getSoundVolume()).toBeUndefined();
    window.localStorage.setItem(
      "pi-desktop-sound-settings",
      JSON.stringify({ volume: 0.9 }),
    );
    expect(getSoundVolume()).toBeCloseTo(0.9);
    expect(isSoundEnabled()).toBeFalsy();
  });

  it("play helpers no-op when disabled without throwing", () => {
    setSoundEnabled(false);
    expect(() => playMessageSound()).not.toThrow();
    expect(() => playCompleteSound()).not.toThrow();
    expect(() => playErrorSound()).not.toThrow();
  });


  // wave-220 residual
  it("volume clamp 0..1; out-of-range values store clamped; enabled default true", () => {
    setSoundVolume(-5);
    expect(getSoundVolume()).toBe(0);
    setSoundVolume(2);
    expect(getSoundVolume()).toBe(1);
    setSoundVolume(0.25);
    expect(getSoundVolume()).toBeCloseTo(0.25);
    window.localStorage.removeItem("pi-desktop-sound-settings");
    expect(isSoundEnabled()).toBe(true);
    expect(getSoundVolume()).toBeCloseTo(0.5);
  });

  it("partial JSON missing fields still readable; invalid JSON falls back to defaults", () => {
    window.localStorage.setItem("pi-desktop-sound-settings", JSON.stringify({ enabled: false }));
    expect(isSoundEnabled()).toBe(false);
    window.localStorage.setItem("pi-desktop-sound-settings", "{not-json");
    expect(isSoundEnabled()).toBe(true);
    expect(getSoundVolume()).toBeCloseTo(0.5);
  });

  // wave-257 residual
  it("setSoundEnabled preserves volume; setSoundVolume preserves enabled", () => {
    setSoundVolume(0.4);
    setSoundEnabled(false);
    expect(getSoundVolume()).toBeCloseTo(0.4);
    expect(isSoundEnabled()).toBe(false);
    setSoundVolume(0.8);
    expect(isSoundEnabled()).toBe(false);
    expect(getSoundVolume()).toBeCloseTo(0.8);
    setSoundEnabled(true);
    expect(getSoundVolume()).toBeCloseTo(0.8);
  });

  it("boundary volume 0 and 1 are accepted; empty object uses undefined fields", () => {
    setSoundVolume(0);
    expect(getSoundVolume()).toBe(0);
    setSoundVolume(1);
    expect(getSoundVolume()).toBe(1);
    window.localStorage.setItem("pi-desktop-sound-settings", "{}");
    expect(isSoundEnabled()).toBeFalsy();
    expect(getSoundVolume()).toBeUndefined();
  });

  // wave-268 residual
  it("setSoundVolume clamps below 0 and above 1", () => {
    setSoundVolume(-0.5);
    expect(getSoundVolume()).toBe(0);
    setSoundVolume(1.5);
    expect(getSoundVolume()).toBe(1);
    setSoundVolume(0.25);
    expect(getSoundVolume()).toBeCloseTo(0.25);
  });

  it("isSoundEnabled defaults true when storage missing", () => {
    window.localStorage.removeItem("pi-desktop-sound-settings");
    expect(isSoundEnabled()).toBe(true);
    expect(getSoundVolume()).toBeCloseTo(0.5);
  });

  // wave-281 residual
  it("setSoundEnabled(true) after disable restores without changing volume clamp", () => {
    setSoundVolume(0.33);
    setSoundEnabled(false);
    setSoundEnabled(true);
    expect(isSoundEnabled()).toBe(true);
    expect(getSoundVolume()).toBeCloseTo(0.33);
  });

  it("malformed JSON in storage falls back to defaults enabled true volume 0.5", () => {
    window.localStorage.setItem("pi-desktop-sound-settings", "{not-json");
    expect(isSoundEnabled()).toBe(true);
    expect(getSoundVolume()).toBeCloseTo(0.5);
  });



  // wave-291 residual
  it("setSoundVolume clamps to [0,1]; partial storage keeps enabled default semantics", () => {
    setSoundVolume(-10);
    expect(getSoundVolume()).toBe(0);
    setSoundVolume(10);
    expect(getSoundVolume()).toBe(1);
    setSoundVolume(0.42);
    expect(getSoundVolume()).toBeCloseTo(0.42);
    // product JSON parse of partial object
    window.localStorage.setItem("pi-desktop-sound-settings", JSON.stringify({ volume: 0.8 }));
    // missing enabled → undefined/falsy when reading settings.enabled directly via isSoundEnabled
    // product returns parsed object as-is; enabled undefined is falsy
    expect(isSoundEnabled()).toBeFalsy();
    expect(getSoundVolume()).toBeCloseTo(0.8);
  });

  it("setSoundEnabled preserves volume; disabled still stores volume for later", () => {
    setSoundVolume(0.7);
    setSoundEnabled(false);
    expect(isSoundEnabled()).toBe(false);
    expect(getSoundVolume()).toBeCloseTo(0.7);
    setSoundEnabled(true);
    expect(isSoundEnabled()).toBe(true);
    expect(getSoundVolume()).toBeCloseTo(0.7);
  });



  // wave-315 residual
  it("default settings enabled true volume 0.5 when key missing; setSoundVolume clamps edges", () => {
    window.localStorage.removeItem("pi-desktop-sound-settings");
    expect(isSoundEnabled()).toBe(true);
    expect(getSoundVolume()).toBeCloseTo(0.5);
    // product clamps via Math.max/min then JSON-serializes; NaN becomes null in storage
    setSoundVolume(Number.NaN);
    // JSON.stringify({volume: NaN}) stores null; getSettings returns null volume
    expect(getSoundVolume()).toBeNull();
    setSoundVolume(0.5);
    expect(getSoundVolume()).toBeCloseTo(0.5);
    setSoundVolume(0);
    expect(getSoundVolume()).toBe(0);
    setSoundVolume(1);
    expect(getSoundVolume()).toBe(1);
  });

  it("setSoundEnabled(false) persists and isSoundEnabled false; volume independent", () => {
    setSoundVolume(0.25);
    setSoundEnabled(false);
    const raw = window.localStorage.getItem("pi-desktop-sound-settings");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.enabled).toBe(false);
    expect(parsed.volume).toBeCloseTo(0.25);
    expect(isSoundEnabled()).toBe(false);
    setSoundEnabled(true);
    expect(isSoundEnabled()).toBe(true);
    expect(getSoundVolume()).toBeCloseTo(0.25);
  });
});
