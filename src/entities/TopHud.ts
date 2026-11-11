import Phaser from 'phaser';
import { BaseEntity } from './BaseEntity';
import { GameStateStore, TimeOfDayPhase } from '../state/GameState';
import { GAME_WIDTH } from '../config/constants';

export class TopHud extends BaseEntity {
  private store: GameStateStore;
  private unsubscribers: Array<() => void> = [];

  private tierText!: Phaser.GameObjects.Text;
  private cashText!: Phaser.GameObjects.Text;
  private comboBadge!: Phaser.GameObjects.Text;
  private dayText!: Phaser.GameObjects.Text;
  private phaseBadgeBg!: Phaser.GameObjects.Graphics;
  private phaseText!: Phaser.GameObjects.Text;
  private dayProgressBarFill!: Phaser.GameObjects.Graphics;

  private repLabel!: Phaser.GameObjects.Text;
  private repValueText!: Phaser.GameObjects.Text;
  private repBarFill!: Phaser.GameObjects.Graphics;

  private readonly HUD_X = 14;
  private readonly HUD_Y = 10;
  private readonly HUD_WIDTH = GAME_WIDTH - 28; // 362px
  private readonly HUD_HEIGHT = 100;

  private readonly REP_BAR_X = 112;
  private readonly REP_BAR_Y = 82;
  private readonly REP_BAR_WIDTH = 200;
  private readonly REP_BAR_HEIGHT = 11;

  private readonly onOpenUpgradeModal?: () => void;
  private readonly onPause?: () => void;

  constructor(
    scene: Phaser.Scene,
    store: GameStateStore,
    onOpenUpgradeModal?: () => void,
    onPause?: () => void
  ) {
    super(scene, 0, 0);
    this.store = store;
    this.onOpenUpgradeModal = onOpenUpgradeModal;
    this.onPause = onPause;

    this.buildHud();
    this.bindEvents();
    this.syncAll();
  }

  /** World-space bounds of the pause button (also used by the tutorial spotlight). */
  public getPauseButtonRect(): { x: number; y: number; w: number; h: number } {
    return { x: 240, y: this.HUD_Y + 32, w: 34, h: 26 };
  }

  private buildHud(): void {
    const panel = this.scene.add.graphics();
    panel.fillStyle(0x271914, 0.96);
    panel.fillRoundedRect(
      this.HUD_X,
      this.HUD_Y,
      this.HUD_WIDTH,
      this.HUD_HEIGHT,
      14
    );
    panel.lineStyle(2, 0xd97706, 0.85);
    panel.strokeRoundedRect(
      this.HUD_X,
      this.HUD_Y,
      this.HUD_WIDTH,
      this.HUD_HEIGHT,
      14
    );
    this.add(panel);

    this.tierText = this.scene.add.text(
      this.HUD_X + 14,
      this.HUD_Y + 12,
      'Tier 1: Gerai Tepi Jalan',
      {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#fbbf24',
      }
    );
    this.add(this.tierText);

    // Combo Streak Badge (appears at 2+ consecutive serves)
    this.comboBadge = this.scene.add
      .text(204, this.HUD_Y + 18, '🔥 3x COMBO', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '9.5px',
        fontStyle: 'bold',
        color: '#fef08a',
        backgroundColor: '#dc2626',
        padding: { x: 5, y: 2 },
      })
      .setOrigin(0.5)
      .setVisible(false);
    this.add(this.comboBadge);

    this.phaseBadgeBg = this.scene.add.graphics();
    this.add(this.phaseBadgeBg);

    this.phaseText = this.scene.add
      .text(this.HUD_X + this.HUD_WIDTH - 14, this.HUD_Y + 18, '🌅 Morning', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#fef3c7',
      })
      .setOrigin(1, 0.5);
    this.add(this.phaseText);

    this.cashText = this.scene.add.text(
      this.HUD_X + 14,
      this.HUD_Y + 34,
      'RM 50.00',
      {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '20px',
        fontStyle: 'bold',
        color: '#34d399',
      }
    );
    this.add(this.cashText);

    // Shop / Upgrade Kedai Button
    const shopBtn = this.scene.add
      .rectangle(192, this.HUD_Y + 45, 84, 26, 0xd97706, 1)
      .setStrokeStyle(1.5, 0xfef08a, 0.95)
      .setInteractive({ useHandCursor: true });
    this.add(shopBtn);

    const shopBtnLabel = this.scene.add
      .text(192, this.HUD_Y + 45, '🏪 UPGRADE', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#fffbeb',
      })
      .setOrigin(0.5);
    this.add(shopBtnLabel);

    shopBtn.on('pointerdown', () => {
      this.scene.tweens.add({
        targets: [shopBtn, shopBtnLabel],
        scaleX: 0.94,
        scaleY: 0.94,
        duration: 70,
        yoyo: true,
      });
      this.onOpenUpgradeModal?.();
    });

    // Pause Button (⏸) — opens the "Rehat Jap" pause overlay
    const pauseRect = this.getPauseButtonRect();
    const pauseBtn = this.scene.add
      .rectangle(
        pauseRect.x + pauseRect.w / 2,
        pauseRect.y + pauseRect.h / 2,
        pauseRect.w,
        pauseRect.h,
        0x3f2a1e,
        1
      )
      .setStrokeStyle(1.5, 0xfbbf24, 0.95)
      .setInteractive({ useHandCursor: true });
    this.add(pauseBtn);

    const pauseIcon = this.scene.add.graphics();
    const pcx = pauseRect.x + pauseRect.w / 2;
    const pcy = pauseRect.y + pauseRect.h / 2;
    pauseIcon.fillStyle(0xfef3c7, 1);
    pauseIcon.fillRoundedRect(pcx - 6, pcy - 7, 4, 14, 1.5);
    pauseIcon.fillRoundedRect(pcx + 2, pcy - 7, 4, 14, 1.5);
    this.add(pauseIcon);

    pauseBtn.on('pointerdown', () => {
      this.scene.tweens.add({
        targets: pauseBtn,
        scaleX: 0.94,
        scaleY: 0.94,
        duration: 70,
        yoyo: true,
      });
      this.onPause?.();
    });

    this.dayText = this.scene.add
      .text(
        this.HUD_X + this.HUD_WIDTH - 14,
        this.HUD_Y + 38,
        'DAY 1 (90s)',
        {
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: '12.5px',
          fontStyle: 'bold',
          color: '#fde68a',
        }
      )
      .setOrigin(1, 0);
    this.add(this.dayText);

    const dayBarTrack = this.scene.add.graphics();
    dayBarTrack.fillStyle(0x140d0b, 1);
    dayBarTrack.fillRoundedRect(
      this.HUD_X + this.HUD_WIDTH - 94,
      this.HUD_Y + 57,
      80,
      5,
      2.5
    );
    this.add(dayBarTrack);

    this.dayProgressBarFill = this.scene.add.graphics();
    this.add(this.dayProgressBarFill);

    this.repLabel = this.scene.add
      .text(this.HUD_X + 14, this.REP_BAR_Y + 6, 'REPUTATION', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '10.5px',
        fontStyle: 'bold',
        color: '#d6d3d1',
      })
      .setOrigin(0, 0.5);
    this.add(this.repLabel);

    const repTrack = this.scene.add.graphics();
    repTrack.fillStyle(0x140d0b, 1);
    repTrack.fillRoundedRect(
      this.REP_BAR_X,
      this.REP_BAR_Y,
      this.REP_BAR_WIDTH,
      this.REP_BAR_HEIGHT,
      6
    );
    repTrack.lineStyle(1, 0x57534e, 0.8);
    repTrack.strokeRoundedRect(
      this.REP_BAR_X,
      this.REP_BAR_Y,
      this.REP_BAR_WIDTH,
      this.REP_BAR_HEIGHT,
      6
    );
    this.add(repTrack);

    this.repBarFill = this.scene.add.graphics();
    this.add(this.repBarFill);

    this.repValueText = this.scene.add
      .text(
        this.HUD_X + this.HUD_WIDTH - 14,
        this.REP_BAR_Y + 6,
        '70/100',
        {
          fontFamily: 'monospace',
          fontSize: '12px',
          fontStyle: 'bold',
          color: '#fef3c7',
        }
      )
      .setOrigin(1, 0.5);
    this.add(this.repValueText);
  }

  private bindEvents(): void {
    this.unsubscribers.push(
      this.store.on('cashChanged', (cash, delta) => {
        this.updateCashDisplay(cash);
        this.spawnFloatingCashFeedback(delta);
      }),
      this.store.on('reputationChanged', (rep) => {
        this.updateReputationDisplay(rep);
      }),
      this.store.on('dayChanged', () => {
        this.syncDayDisplay();
      }),
      this.store.on('dayTick', () => {
        this.syncDayDisplay();
      }),
      this.store.on('tierChanged', (tier) => {
        this.tierText.setText(`Tier ${tier.level}: ${tier.name}`);
      }),
      this.store.on('comboChanged', (streak) => {
        this.updateComboDisplay(streak);
      })
    );
  }

  private syncAll(): void {
    const state = this.store.getState();
    this.tierText.setText(`Tier ${state.tier.level}: ${state.tier.name}`);
    this.updateCashDisplay(state.cash);
    this.updateReputationDisplay(state.reputation);
    this.updateComboDisplay(state.comboStreak);
    this.syncDayDisplay();
  }

  private updateComboDisplay(streak: number): void {
    if (streak >= 2) {
      this.comboBadge.setText(`🔥 ${streak}x STREAK`).setVisible(true);
    } else {
      this.comboBadge.setVisible(false);
    }
  }

  private updateCashDisplay(cash: number): void {
    this.cashText.setText(`RM ${cash.toFixed(2)}`);
  }

  private spawnFloatingCashFeedback(delta: number): void {
    if (delta === 0) return;
    const sign = delta > 0 ? '+' : '-';
    const color = delta > 0 ? '#34d399' : '#f87171';
    const floatText = this.scene.add.text(
      this.cashText.x + 12,
      this.cashText.y - 10,
      `${sign}RM ${Math.abs(delta).toFixed(2)}`,
      {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '12px',
        fontStyle: 'bold',
        color,
      }
    );
    this.add(floatText);

    this.scene.tweens.add({
      targets: floatText,
      y: floatText.y - 16,
      alpha: 0,
      duration: 750,
      ease: 'Cubic.easeOut',
      onComplete: () => floatText.destroy(),
    });
  }

  private updateReputationDisplay(reputation: number): void {
    const clamped = Math.max(0, Math.min(100, reputation));
    const ratio = clamped / 100;
    const fillWidth = Math.max(0, (this.REP_BAR_WIDTH - 2) * ratio);

    let barColor = 0x22c55e;
    if (clamped < 35) {
      barColor = 0xef4444;
    } else if (clamped < 65) {
      barColor = 0xf59e0b;
    }

    this.repBarFill.clear();
    if (fillWidth > 0) {
      this.repBarFill.fillStyle(barColor, 1);
      this.repBarFill.fillRoundedRect(
        this.REP_BAR_X + 1,
        this.REP_BAR_Y + 1,
        fillWidth,
        this.REP_BAR_HEIGHT - 2,
        5
      );
    }

    this.repValueText.setText(`${clamped}/100`);
    if (clamped >= 80) {
      this.repLabel.setText('🔥 VIRAL 1.25x').setColor('#4ade80');
    } else if (clamped < 30) {
      this.repLabel.setText('⚠️ LOW REP').setColor('#f87171');
    } else {
      this.repLabel.setText('REPUTATION').setColor('#d6d3d1');
    }
  }

  private syncDayDisplay(): void {
    const state = this.store.getState();
    const remainingSec = Math.max(
      0,
      Math.ceil(state.dayDurationSeconds - state.dayElapsedSeconds)
    );
    this.dayText.setText(`DAY ${state.day} (${remainingSec}s)`);

    const icon = this.getPhaseIcon(state.phase);
    this.phaseText.setText(`${icon} ${state.phase}`);

    const badgeWidth = this.phaseText.width + 16;
    const badgeX = this.HUD_X + this.HUD_WIDTH - 6 - badgeWidth;
    const badgeY = this.HUD_Y + 8;

    this.phaseBadgeBg.clear();
    this.phaseBadgeBg.fillStyle(state.isNight ? 0x1e1b4b : 0x78350f, 0.9);
    this.phaseBadgeBg.fillRoundedRect(badgeX, badgeY, badgeWidth, 20, 6);
    this.phaseBadgeBg.lineStyle(
      1,
      state.isNight ? 0x818cf8 : 0xfbbf24,
      0.7
    );
    this.phaseBadgeBg.strokeRoundedRect(badgeX, badgeY, badgeWidth, 20, 6);

    const progress = Math.min(
      1,
      Math.max(0, state.dayElapsedSeconds / state.dayDurationSeconds)
    );
    this.dayProgressBarFill.clear();
    this.dayProgressBarFill.fillStyle(
      state.isNight ? 0x818cf8 : 0xfbbf24,
      1
    );
    this.dayProgressBarFill.fillRoundedRect(
      this.HUD_X + this.HUD_WIDTH - 94,
      this.HUD_Y + 57,
      Math.max(2, 80 * progress),
      5,
      2.5
    );
  }

  private getPhaseIcon(phase: TimeOfDayPhase): string {
    switch (phase) {
      case 'Morning':
        return '🌅';
      case 'Afternoon':
        return '☀️';
      case 'Evening':
        return '🌇';
      case 'Night':
        return '🌙';
    }
  }

  public updateEntity(_time: number, delta: number): void {
    this.store.advanceTime(delta / 1000);
    this.store.updateStations(delta);
  }

  public override destroy(fromScene?: boolean): void {
    this.unsubscribers.forEach((unsub) => unsub());
    this.unsubscribers = [];
    super.destroy(fromScene);
  }
}
