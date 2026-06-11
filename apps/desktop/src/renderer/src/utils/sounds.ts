const STORAGE_KEY = "pi-desktop-sound-settings";

interface SoundSettings {
  enabled: boolean;
  volume: number;
}

function getSettings(): SoundSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored) as SoundSettings;
  } catch { /* ignore */ }
  return { enabled: true, volume: 0.5 };
}

function saveSettings(settings: SoundSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch { /* ignore */ }
}

function playTone(frequency: number, duration: number, type: OscillatorType = "sine"): void {
  const settings = getSettings();
  if (!settings.enabled) return;

  try {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gainNode.gain.value = settings.volume * 0.3;

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.start();
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000);
    oscillator.stop(ctx.currentTime + duration / 1000);

    setTimeout(() => ctx.close(), duration + 100);
  } catch { /* ignore */ }
}

export function playMessageSound(): void {
  playTone(800, 150);
}

export function playCompleteSound(): void {
  playTone(523, 100);
  setTimeout(() => playTone(659, 100), 100);
  setTimeout(() => playTone(784, 150), 200);
}

export function playErrorSound(): void {
  playTone(300, 200, "square");
}

export function isSoundEnabled(): boolean {
  return getSettings().enabled;
}

export function setSoundEnabled(enabled: boolean): void {
  const settings = getSettings();
  saveSettings({ ...settings, enabled });
}

export function getSoundVolume(): number {
  return getSettings().volume;
}

export function setSoundVolume(volume: number): void {
  const settings = getSettings();
  saveSettings({ ...settings, volume: Math.max(0, Math.min(1, volume)) });
}
