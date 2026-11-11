import Phaser from 'phaser';
import { BaseEntity } from './BaseEntity';
import { GameStateStore } from '../state/GameState';
import { GAME_WIDTH, GAME_HEIGHT } from '../config/constants';
import { haptic, HAPTIC } from '../utils/haptics';

export interface PauseOverlayCallbacks {
  onResume: () => void;
  onReplayTutorial: () => void;
}

/**
 * "Rehat Jap" pause overlay. Blocks all game input while visible.
 * Opened from the HUD ⏸ button or automatically when the tab/app goes to the background.
 */
export class PauseOverlay extends BaseEntity {
  private readonly store: GameStateStore;
  private readonly callbacks: PauseOverlayCallbacks;

  private subtitleText!: Phaser.GameObjects.Text;
  private hapticsBtn!: Phaser.GameObjects.Rectangle;
  private hapticsTxt!: Phaser.GameObjects.Text;

  private readonly CARD_W = 300;
  private readonly CARD_H = 318;

  constructor(scene: Phaser.Scene, store: GameStateStore, callbacks: PauseOverlayCallbacks) {
    super(scene, 0, 0);
    this.store = store;
    this.callbacks = callbacks;
    this.setDepth(95);
    this.build();
    this.setVisible(false);
  }

  private build(): void {
    // Full-screen scrim swallows every tap behind the overlay
    const scrim = this.scene.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x020617, 0.78)
      .setInteractive();
    this.add(scrim);

    const cardX = (GAME_WIDTH - this.CARD_W) / 2;
    const cardY = (GAME_HEIGHT - this.CARD_H) / 2;

    const card = this.scene.add.graphics();
    card.fillStyle(0x000000, 0.45);
    card.fillRoundedRect(cardX + 3, cardY + 5, this.CARD_W, this.CARD_H, 18);
    card.fillStyle(0x271914, 1);
    card.fillRoundedRect(cardX, cardY, this.CARD_W, this.CARD_H, 18);
    card.lineStyle(2.5, 0xfbbf24, 1);
    card.strokeRoundedRect(cardX, cardY, this.CARD_W, this.CARD_H, 18);
    // Yellow header strip
    card.fillStyle(0xfacc15, 1);
    card.fillRoundedRect(cardX + 2, cardY + 2, this.CARD_W - 4, 52, { tl: 16, tr: 16, bl: 0, br: 0 });
    this.add(card);

    const title = this.scene.add
      .text(GAME_WIDTH / 2, cardY + 28, '⏸  PAUSED — LEPAK JAP', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '18px',
        fontStyle: 'bold',
        color: '#1c1917',
      })
      .setOrigin(0.5);
    this.add(title);

    this.subtitleText = this.scene.add
      .text(GAME_WIDTH / 2, cardY + 84, '', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '12px',
        color: '#fde68a',
        align: 'center',
        wordWrap: { width: this.CARD_W - 40 },
        lineSpacing: 3,
      })
      .setOrigin(0.5);
    this.add(this.subtitleText);

    // ▶ RESUME
    const resumeY = cardY + 148;
    const resumeBtn = this.scene.add
      .rectangle(GAME_WIDTH / 2, resumeY, this.CARD_W - 40, 52, 0x16a34a, 1)
      .setStrokeStyle(2, 0xbbf7d0, 1)
      .setInteractive({ useHandCursor: true });
    const resumeTxt = this.scene.add
      .text(GAME_WIDTH / 2, resumeY, '▶  RESUME SHIFT', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '16px',
        fontStyle: 'bold',
        color: '#ffffff',
      })
      .setOrigin(0.5);
    this.add([resumeBtn, resumeTxt]);
    resumeBtn.on('pointerdown', () => {
      haptic(HAPTIC.tap, 'tap');
      this.callbacks.onResume();
    });

    // 📳 Haptics toggle
    const hapticsY = cardY + 212;
    this.hapticsBtn = this.scene.add
      .rectangle(GAME_WIDTH / 2, hapticsY, this.CARD_W - 40, 42, 0x0f172a, 1)
      .setStrokeStyle(1.5, 0x64748b, 1)
      .setInteractive({ useHandCursor: true });
    this.hapticsTxt = this.scene.add
      .text(GAME_WIDTH / 2, hapticsY, '', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#e2e8f0',
      })
      .setOrigin(0.5);
    this.add([this.hapticsBtn, this.hapticsTxt]);
    this.hapticsBtn.on('pointerdown', () => {
      const next = !this.store.getState().hapticsEnabled;
      this.store.setHapticsEnabled(next);
      if (next) haptic(HAPTIC.serve, 'hapticsOn');
      this.syncHapticsLabel();
    });

    // 🎓 Replay tutorial
    const tutY = cardY + 268;
    const tutBtn = this.scene.add
      .rectangle(GAME_WIDTH / 2, tutY, this.CARD_W - 40, 42, 0x0f172a, 1)
      .setStrokeStyle(1.5, 0x64748b, 1)
      .setInteractive({ useHandCursor: true });
    const tutTxt = this.scene.add
      .text(GAME_WIDTH / 2, tutY, '🎓  Replay Tutorial', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#e2e8f0',
      })
      .setOrigin(0.5);
    this.add([tutBtn, tutTxt]);
    tutBtn.on('pointerdown', () => {
      haptic(HAPTIC.tap, 'tap');
      this.callbacks.onReplayTutorial();
    });
  }

  private syncHapticsLabel(): void {
    const on = this.store.getState().hapticsEnabled;
    this.hapticsTxt.setText(on ? '📳  Vibration (Haptics): ON' : '📴  Vibration (Haptics): OFF');
    this.hapticsTxt.setColor(on ? '#4ade80' : '#94a3b8');
    this.hapticsBtn.setStrokeStyle(1.5, on ? 0x22c55e : 0x64748b, 1);
  }

  public open(autoPaused = false): void {
    this.subtitleText.setText(
      autoPaused
        ? 'Eh boss, went somewhere ah? 😅\nGame auto-paused — your customers are waiting!'
        : 'Taking a quick breather, boss.\nAll timers paused — nobody is walking out lah!'
    );
    this.syncHapticsLabel();
    this.setVisible(true);
    this.setAlpha(0);
    this.scene.tweens.add({ targets: this, alpha: 1, duration: 140 });
  }

  public close(): void {
    this.setVisible(false);
  }

  public updateEntity(_time: number, _delta: number): void {
    // Static overlay
  }
}
