/**
 * Player-facing settings, persisted to localStorage.
 * - master volume scales the Web Audio master gain
 * - reduce visual intensity suppresses screen shake / glitch flicker
 */

const VOLUME_KEY = 'hollowland_volume';
const INTENSITY_KEY = 'hollowland_reduce_intensity';

export interface Settings {
  volume: number;
  reduceIntensity: boolean;
}

function readNumber(key: string, fallback: number, min: number, max: number): number {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  } catch {
    return fallback;
  }
}

function readBool(key: string, fallback: boolean): boolean {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === '1' || raw === 'true';
  } catch {
    return fallback;
  }
}

function write(key: string, value: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable; settings simply won't persist.
  }
}

export const DEFAULT_SETTINGS: Settings = { volume: 0.8, reduceIntensity: false };

export function loadSettings(): Settings {
  return {
    volume: readNumber(VOLUME_KEY, DEFAULT_SETTINGS.volume, 0, 1),
    reduceIntensity: readBool(INTENSITY_KEY, DEFAULT_SETTINGS.reduceIntensity),
  };
}

export function saveVolume(volume: number): number {
  const clamped = Math.min(1, Math.max(0, volume));
  write(VOLUME_KEY, String(clamped));
  return clamped;
}

export function saveReduceIntensity(value: boolean): boolean {
  write(INTENSITY_KEY, value ? '1' : '0');
  return value;
}
