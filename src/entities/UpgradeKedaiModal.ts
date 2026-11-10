import Phaser from 'phaser';
import { BaseEntity } from './BaseEntity';
import { GameStateStore } from '../state/GameState';
import { GAME_WIDTH, GAME_HEIGHT } from '../config/constants';

export class UpgradeKedaiModal extends BaseEntity {
  private readonly store: GameStateStore;
  private readonly onCloseModal?: () => void;
  private unsubscribers: Array<() => void> = [];

  private subtitleText!: Phaser.GameObjects.Text;
  private cashDisplay!: Phaser.GameObjects.Text;

  private tier2BtnBg!: Phaser.GameObjects.Rectangle;
  private tier2BtnText!: Phaser.GameObjects.Text;

  private tier3BtnBg!: Phaser.GameObjects.Rectangle;
  private tier3BtnText!: Phaser.GameObjects.Text;

  constructor(
    scene: Phaser.Scene,
    store: GameStateStore,
    onCloseModal?: () => void
  ) {
    super(scene, 0, 0);
    this.store = store;
    this.onCloseModal = onCloseModal;

    this.buildModal();
    this.bindEvents();
    this.setVisible(false);
    this.setDepth(100);
  }

  private buildModal(): void {
    // Full-screen dark backdrop blocker
    const backdrop = this.scene.add
      .rectangle(
        GAME_WIDTH / 2,
        GAME_HEIGHT / 2,
        GAME_WIDTH,
        GAME_HEIGHT,
        0x090d16,
        0.82
      )
      .setInteractive();
    this.add(backdrop);

    const modalX = 18;
    const modalY = 76;
    const modalW = GAME_WIDTH - 36; // 354
    const modalH = 692;

    const panel = this.scene.add.graphics();
    panel.fillStyle(0x1e293b, 0.99);
    panel.fillRoundedRect(modalX, modalY, modalW, modalH, 16);
    panel.lineStyle(3, 0xfacc15, 1);
    panel.strokeRoundedRect(modalX, modalY, modalW, modalH, 16);

    // Header banner
    panel.fillStyle(0xfacc15, 1);
    panel.fillRoundedRect(modalX + 2, modalY + 2, modalW - 4, 48, {
      tl: 14,
      tr: 14,
      bl: 0,
      br: 0,
    });
    this.add(panel);

    const headerTitle = this.scene.add
      .text(GAME_WIDTH / 2, modalY + 26, '🏪 UPGRADE KEDAI MAMAK', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '17px',
        fontStyle: 'bold',
        color: '#1c1917',
      })
      .setOrigin(0.5);
    this.add(headerTitle);

    this.subtitleText = this.scene.add
      .text(GAME_WIDTH / 2, modalY + 68, 'Expand your stall & unlock new menu items!', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#fde68a',
      })
      .setOrigin(0.5);
    this.add(this.subtitleText);

    this.cashDisplay = this.scene.add
      .text(GAME_WIDTH / 2, modalY + 92, 'Available Cash: RM 50.00', {
        fontFamily: 'monospace',
        fontSize: '14px',
        fontStyle: 'bold',
        color: '#34d399',
      })
      .setOrigin(0.5);
    this.add(this.cashDisplay);

    // --- Upgrade Card 1: "Kedai Bawah Pokok" (RM 300) ---
    this.buildUpgradeCard1(modalX + 14, modalY + 118, modalW - 28, 224);

    // --- Upgrade Card 2: "Corner Lot Mamak" (RM 1,200) ---
    this.buildUpgradeCard2(modalX + 14, modalY + 356, modalW - 28, 224);

    // --- Footer Buttons: Test Grant Button + Continue / Close Button ---
    const grantBtn = this.scene.add
      .rectangle(106, modalY + 610, 146, 30, 0x334155, 1)
      .setStrokeStyle(1, 0x94a3b8)
      .setInteractive({ useHandCursor: true });
    this.add(grantBtn);

    const grantTxt = this.scene.add
      .text(106, modalY + 610, '+RM 500 Dev Grant', {
        fontFamily: 'monospace',
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#cbd5e1',
      })
      .setOrigin(0.5);
    this.add(grantTxt);

    grantBtn.on('pointerdown', () => {
      this.store.addCash(500);
    });

    const closeBtn = this.scene.add
      .rectangle(GAME_WIDTH / 2, modalY + 656, modalW - 28, 42, 0xd97706, 1)
      .setStrokeStyle(2, 0xfef08a, 1)
      .setInteractive({ useHandCursor: true });
    this.add(closeBtn);

    const closeTxt = this.scene.add
      .text(GAME_WIDTH / 2, modalY + 656, 'CONTINUE TO STALL ▶', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '14px',
        fontStyle: 'bold',
        color: '#ffffff',
      })
      .setOrigin(0.5);
    this.add(closeTxt);

    closeBtn.on('pointerdown', () => {
      this.close();
    });
  }

  private buildUpgradeCard1(x: number, y: number, w: number, h: number): void {
    const card = this.scene.add.graphics();
    card.fillStyle(0x0f172a, 0.96);
    card.fillRoundedRect(x, y, w, h, 12);
    card.lineStyle(2, 0x22c55e, 0.85);
    card.strokeRoundedRect(x, y, w, h, 12);

    // Mini canopy + tree icon preview
    card.fillStyle(0x15803d, 1);
    card.fillCircle(x + 36, y + 32, 16);
    card.fillStyle(0x78350f, 1);
    card.fillRect(x + 33, y + 42, 6, 12);
    this.add(card);

    const title = this.scene.add.text(
      x + 64,
      y + 16,
      'TIER 2: KEDAI BAWAH POKOK',
      {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '13.5px',
        fontStyle: 'bold',
        color: '#4ade80',
      }
    );
    const costLabel = this.scene.add.text(x + 64, y + 36, 'Cost: RM 300.00', {
      fontFamily: 'monospace',
      fontSize: '12px',
      fontStyle: 'bold',
      color: '#fde047',
    });

    const perks = this.scene.add.text(
      x + 16,
      y + 64,
      [
        '• Canopy stall under shady tree w/ 4 plastic tables',
        '• Max waiting customers increased: 2 → 4',
        '• Unlocks Milo Ais (RM 3.50) & Maggi Goreng (RM 6.00)',
        '• Doubles Griddle capacity (cook 2 dishes at once!)',
      ].join('\n'),
      {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '11.5px',
        color: '#e2e8f0',
        lineSpacing: 6,
      }
    );

    // Buy button at center-bottom of Card 1: logical (195, 386)
    this.tier2BtnBg = this.scene.add
      .rectangle(x + w / 2, y + h - 28, w - 32, 38, 0x16a34a, 1)
      .setStrokeStyle(1.5, 0xfef08a, 0.9)
      .setInteractive({ useHandCursor: true });

    this.tier2BtnText = this.scene.add
      .text(x + w / 2, y + h - 28, 'BUY UPGRADE (RM 300)', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    this.add([title, costLabel, perks, this.tier2BtnBg, this.tier2BtnText]);

    this.tier2BtnBg.on('pointerdown', () => {
      if (this.store.upgradeToTier2()) {
        this.syncState();
      }
    });
  }

  private buildUpgradeCard2(x: number, y: number, w: number, h: number): void {
    const card = this.scene.add.graphics();
    card.fillStyle(0x0f172a, 0.96);
    card.fillRoundedRect(x, y, w, h, 12);
    card.lineStyle(2, 0x38bdf8, 0.85);
    card.strokeRoundedRect(x, y, w, h, 12);

    // Mini shophouse + football icon preview
    card.fillStyle(0x0284c7, 1);
    card.fillRoundedRect(x + 20, y + 20, 32, 30, 4);
    card.fillStyle(0xfef08a, 1);
    card.fillRect(x + 25, y + 26, 8, 8);
    card.fillRect(x + 38, y + 26, 8, 8);
    this.add(card);

    const title = this.scene.add.text(
      x + 64,
      y + 16,
      'TIER 3: CORNER LOT MAMAK',
      {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '13.5px',
        fontStyle: 'bold',
        color: '#38bdf8',
      }
    );
    const costLabel = this.scene.add.text(
      x + 64,
      y + 36,
      'Cost: RM 1,200.00',
      {
        fontFamily: 'monospace',
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#fde047',
      }
    );

    const perks = this.scene.add.text(
      x + 16,
      y + 64,
      [
        '• Bright shophouse corner lot w/ football banners',
        '• Unlocks Roti Telur (RM 4.50) & Nasi Kandar (RM 9.50)',
        '• Unlocks "Ane Helper" (automatically brews & pulls',
        '  drinks directly onto the Serving Tray!)',
      ].join('\n'),
      {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '11.5px',
        color: '#e2e8f0',
        lineSpacing: 6,
      }
    );

    // Buy button at center-bottom of Card 2: logical (195, 624)
    this.tier3BtnBg = this.scene.add
      .rectangle(x + w / 2, y + h - 28, w - 32, 38, 0x0284c7, 1)
      .setStrokeStyle(1.5, 0xfef08a, 0.9)
      .setInteractive({ useHandCursor: true });

    this.tier3BtnText = this.scene.add
      .text(x + w / 2, y + h - 28, 'BUY UPGRADE (RM 1,200)', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    this.add([title, costLabel, perks, this.tier3BtnBg, this.tier3BtnText]);

    this.tier3BtnBg.on('pointerdown', () => {
      if (this.store.upgradeToTier3()) {
        this.syncState();
      }
    });
  }

  private bindEvents(): void {
    this.unsubscribers.push(
      this.store.on('change', () => {
        if (this.visible) {
          this.syncState();
        }
      })
    );
  }

  public open(reason?: string): void {
    if (reason) {
      this.subtitleText.setText(reason);
    } else {
      this.subtitleText.setText('Expand your stall & unlock new menu items!');
    }
    this.syncState();
    this.setVisible(true);
  }

  public close(): void {
    this.setVisible(false);
    this.onCloseModal?.();
  }

  private syncState(): void {
    const state = this.store.getState();
    this.cashDisplay.setText(`Available Cash: RM ${state.cash.toFixed(2)}`);

    // Tier 2 Button State
    if (state.tier.level >= 2) {
      this.tier2BtnBg.setFillStyle(0x334155, 1);
      this.tier2BtnText.setText('✓ UNLOCKED (KEDAI BAWAH POKOK)').setColor('#4ade80');
    } else if (state.cash >= 300) {
      this.tier2BtnBg.setFillStyle(0x16a34a, 1);
      this.tier2BtnText.setText('BUY UPGRADE (RM 300)').setColor('#ffffff');
    } else {
      this.tier2BtnBg.setFillStyle(0x475569, 1);
      this.tier2BtnText
        .setText(`NEED RM ${(300 - state.cash).toFixed(2)} MORE`)
        .setColor('#cbd5e1');
    }

    // Tier 3 Button State
    if (state.tier.level >= 3) {
      this.tier3BtnBg.setFillStyle(0x334155, 1);
      this.tier3BtnText.setText('✓ UNLOCKED (CORNER LOT MAMAK)').setColor('#38bdf8');
    } else if (state.cash >= 1200) {
      this.tier3BtnBg.setFillStyle(0x0284c7, 1);
      this.tier3BtnText.setText('BUY UPGRADE (RM 1,200)').setColor('#ffffff');
    } else {
      this.tier3BtnBg.setFillStyle(0x475569, 1);
      this.tier3BtnText
        .setText(`NEED RM ${(1200 - state.cash).toFixed(2)} MORE`)
        .setColor('#cbd5e1');
    }
  }

  public updateEntity(_time: number, _delta: number): void {
    // Static modal overlay
  }

  public override destroy(fromScene?: boolean): void {
    this.unsubscribers.forEach((u) => u());
    this.unsubscribers = [];
    super.destroy(fromScene);
  }
}
