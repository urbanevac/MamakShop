import { gameState } from '../state/GameState';

/**
 * Named vibration patterns (milliseconds) used across the game.
 * Short, light pulses for taps; longer buzzes for mistakes.
 */
export const HAPTIC = {
  tap: 8,
  serve: 15,
  combo: [15, 30, 15],
  reject: 40,
  discard: 40,
  burnWarning: [20, 40, 20],
  burned: 60,
  walkout: 60,
} as const;

export type HapticPattern = number | readonly number[];

/** Recent haptic calls (newest last) — handy for verifying on desktop where vibrate is a no-op. */
export const hapticLog: string[] = [];

/**
 * Fires a vibration pattern if the player has haptics enabled and the device supports it.
 * Silently no-ops on desktop browsers / iOS Safari where `navigator.vibrate` is unavailable.
 */
export function haptic(pattern: HapticPattern, label = ''): void {
  if (!gameState.getState().hapticsEnabled) return;

  const entry = `${label || 'haptic'}:${Array.isArray(pattern) ? pattern.join('-') : pattern}`;
  hapticLog.push(entry);
  if (hapticLog.length > 30) hapticLog.shift();

  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern as number | number[]);
    }
  } catch {
    // Some browsers throw if vibrate is called without a user gesture; ignore.
  }
}

if (typeof window !== 'undefined') {
  (window as unknown as { __mamakHaptics: string[] }).__mamakHaptics = hapticLog;
}
