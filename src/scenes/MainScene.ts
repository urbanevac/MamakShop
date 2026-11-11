import Phaser from 'phaser';
import { gameState, RecipeId } from '../state/GameState';
import { TopHud } from '../entities/TopHud';
import { Customer, CustomerArchetype } from '../entities/Customer';
import { FoodTrayItem, ServeResult } from '../entities/FoodTrayItem';
import { PrepStationDock, ScreenRect } from '../entities/PrepStationDock';
import { UpgradeKedaiModal } from '../entities/UpgradeKedaiModal';
import { PauseOverlay } from '../entities/PauseOverlay';
import { TutorialCoach, TutorialEvent } from '../entities/TutorialCoach';
import { getRecipeDef } from '../config/recipes';
import { GAME_WIDTH, GAME_HEIGHT } from '../config/constants';
import { haptic, HAPTIC } from '../utils/haptics';

interface SeatPosition {
  seatIndex: number;
  x: number;
  y: number;
  spawnX: number;
}

const TIER_1_SEATS: SeatPosition[] = [
  { seatIndex: 0, x: 112, y: 304, spawnX: -60 },
  { seatIndex: 1, x: 278, y: 304, spawnX: GAME_WIDTH + 60 },
];

const TIER_2_SEATS: SeatPosition[] = [
  { seatIndex: 0, x: 52, y: 308, spawnX: -60 },
  { seatIndex: 1, x: 147, y: 308, spawnX: -60 },
  { seatIndex: 2, x: 243, y: 308, spawnX: GAME_WIDTH + 60 },
  { seatIndex: 3, x: 338, y: 308, spawnX: GAME_WIDTH + 60 },
];

// 3 Serving Tray Slots + Trash Bin on the right edge (x = 342)
const SERVING_TRAY_SLOTS: Array<{ x: number; y: number }> = [
  { x: 64, y: 406 },
  { x: 158, y: 406 },
  { x: 252, y: 406 },
];

const TRASH_BIN_POS = { x: 342, y: 406 };

export class MainScene extends Phaser.Scene {
  private envContainer!: Phaser.GameObjects.Container;
  private topHud!: TopHud;
  private prepDock!: PrepStationDock;
  private upgradeModal!: UpgradeKedaiModal;
  private pauseOverlay!: PauseOverlay;
  private tutorial: TutorialCoach | null = null;
  private isPaused = false;
  private previewTarget: Customer | null = null;
  private unsubscribers: Array<() => void> = [];

  private customers: Array<Customer | null> = [null, null, null, null];
  private servingTray: Array<FoodTrayItem | null> = [null, null, null];
  private trayHeaderText!: Phaser.GameObjects.Text;
  private trashBinBg!: Phaser.GameObjects.Rectangle;
  private spawnCooldownMs = 600;

  constructor() {
    super({ key: 'MainScene' });
  }

  create(): void {
    // Reset per-run fields (the constructor only runs once; scene.restart() re-runs create())
    this.customers = [null, null, null, null];
    this.servingTray = [null, null, null];
    this.spawnCooldownMs = 600;
    this.isPaused = false;
    this.tutorial = null;
    this.previewTarget = null;
    this.unsubscribers = [];

    this.envContainer = this.add.container(0, 0);
    this.drawEnvironmentForTier(gameState.getState().tier.level);

    // Top HUD with "🏪 UPGRADE" Shop button and ⏸ Pause button
    this.topHud = new TopHud(
      this,
      gameState,
      () => {
        this.upgradeModal.open();
      },
      () => this.pauseGame(false)
    );
    this.topHud.setDepth(30);

    // Bottom Interactive Prep Station Dock
    this.prepDock = new PrepStationDock(this, gameState, {
      canAddToServingTray: () => this.servingTray.some((slot) => slot === null),
      canAneAutoBrewDrink: () => this.shouldAneAutoBrewDrink(),
      onPlateItem: (recipeId) => this.addItemToServingTray(recipeId),
      onStationMessage: (x, y, text, color) => this.showPopup(x, y, text, color),
      getNeededDrinkRecipe: () => this.findNeededDrinkRecipe(),
      onStationEvent: (event) => this.emitTutorialEvent(event),
    });
    this.prepDock.setDepth(20);

    // "Upgrade Kedai" Modal Overlay (opens via Shop button or at end of each 90s shift)
    this.upgradeModal = new UpgradeKedaiModal(this, gameState);

    // "Rehat Jap" Pause Overlay
    this.pauseOverlay = new PauseOverlay(this, gameState, {
      onResume: () => this.resumeGame(),
      onReplayTutorial: () => {
        gameState.setTutorialDone(false);
        this.scene.restart();
      },
    });

    // React to Tier Upgrades (update background visuals & seat layout)
    this.unsubscribers.push(
      gameState.on('tierChanged', (tier) => {
        this.drawEnvironmentForTier(tier.level);
        this.repositionExistingCustomers();
        this.showPopup(
          GAME_WIDTH / 2,
          240,
          `🎉 Upgraded to ${tier.name}!`,
          '#facc15'
        );
      }),

      // Automatically open "Upgrade Kedai" modal with Shift Receipt at the end of each shift
      gameState.on('shiftEnded', (completedDay, nextDay, summary) => {
        this.upgradeModal.open(
          `🌙 Day ${completedDay} Shift Complete! Ready for Day ${nextDay}`,
          summary
        );
      }),

      // Fresh save → restart the scene so the stall, customers and tutorial start clean
      gameState.on('gameReset', () => {
        this.time.delayedCall(60, () => this.scene.restart());
      })
    );

    // Auto-pause when the tab / app goes to the background (phone call, app switch...)
    const onHidden = () => this.pauseGame(true);
    this.game.events.on(Phaser.Core.Events.HIDDEN, onHidden);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(Phaser.Core.Events.HIDDEN, onHidden);
      this.unsubscribers.forEach((u) => u());
      this.unsubscribers = [];
    });

    if (!gameState.getState().tutorialDone) {
      this.startTutorial();
    } else {
      // Spawn first customer immediately
      this.spawnCustomerInSeat(0);
    }
  }

  // ===========================================================================
  // Pause / Resume
  // ===========================================================================

  private pauseGame(autoPaused: boolean): void {
    if (this.isPaused) return;
    // The upgrade modal already freezes the game; don't stack overlays on top of it
    if (this.upgradeModal?.visible) return;
    this.isPaused = true;
    this.clearPreviewTarget();
    this.pauseOverlay.open(autoPaused);
  }

  private resumeGame(): void {
    if (!this.isPaused) return;
    this.isPaused = false;
    this.pauseOverlay.close();
  }

  // ===========================================================================
  // "Hari Pertama" Tutorial
  // ===========================================================================

  private startTutorial(): void {
    this.prepDock.setTutorialMode(true);
    this.tutorial = new TutorialCoach(this, {
      getTargetRect: (target) => this.getTutorialTargetRect(target),
      getServePath: () => this.getTutorialServePath(),
      spawnTutorialCustomer: (seatIndex, order) => {
        if (this.customers[seatIndex]) return;
        const cust = this.spawnCustomerInSeat(seatIndex, [order], 'regular');
        if (cust) cust.patienceFrozen = true;
      },
      finishTutorial: () => this.finishTutorial(),
    });
  }

  private finishTutorial(): void {
    this.tutorial = null;
    gameState.setTutorialDone(true);
    this.prepDock.setTutorialMode(false);
    this.customers.forEach((c) => {
      if (c) c.patienceFrozen = false;
    });
    this.spawnCooldownMs = 900;
  }

  private emitTutorialEvent(event: TutorialEvent): void {
    this.tutorial?.handleEvent(event);
  }

  private getTutorialTargetRect(target: string): ScreenRect {
    if (target === 'trash') {
      return { x: TRASH_BIN_POS.x - 32, y: TRASH_BIN_POS.y - 30, w: 64, h: 60 };
    }
    if (target === 'pause') {
      return this.topHud.getPauseButtonRect();
    }
    return this.prepDock.getTargetRect(target as 'kettle' | 'cup' | 'dough' | 'griddle');
  }

  private getTutorialServePath(): { from: { x: number; y: number }; to: { x: number; y: number } } | null {
    const seats = this.getActiveSeats();
    for (const item of this.servingTray) {
      if (!item) continue;
      for (const cust of this.customers) {
        if (!cust || !cust.remainingItems.includes(item.recipeId)) continue;
        const seat = seats[cust.seatIndex];
        if (!seat) continue;
        return {
          from: { x: SERVING_TRAY_SLOTS[item.trayIndex].x, y: SERVING_TRAY_SLOTS[item.trayIndex].y },
          to: { x: seat.x, y: seat.y - 20 },
        };
      }
    }
    return null;
  }

  private getActiveSeats(): SeatPosition[] {
    const maxCust = gameState.getState().maxCustomers;
    return maxCust >= 4 ? TIER_2_SEATS : TIER_1_SEATS;
  }

  private repositionExistingCustomers(): void {
    const seats = this.getActiveSeats();
    this.customers.forEach((cust, idx) => {
      if (cust && seats[idx]) {
        cust.setScale(seats.length >= 4 ? 0.78 : 1);
        this.tweens.add({
          targets: cust,
          x: seats[idx].x,
          y: seats[idx].y,
          duration: 300,
          ease: 'Sine.easeOut',
        });
      }
    });
  }

  /**
   * Smart Ane Helper logic:
   * - Never fills the last empty tray slot with an unrequested drink (prevents Tray Deadlock).
   * - Caps drinks on the tray to at most 2 slots so at least 1 slot is always free for food.
   */
  private shouldAneAutoBrewDrink(): boolean {
    const emptyCount = this.servingTray.filter((s) => s === null).length;
    if (emptyCount === 0) return false;

    const drinksOnTray = this.servingTray.filter(
      (s) => s !== null && getRecipeDef(s.recipeId).category === 'drink'
    ).length;

    // Never exceed 2 drinks on the 3-slot tray
    if (drinksOnTray >= 2) return false;

    // Check if a waiting customer actually needs a drink right now
    const unlockedDrinks = gameState
      .getState()
      .unlockedRecipes.filter((id) => getRecipeDef(id).category === 'drink');
    const customerNeedsDrink = this.customers.some(
      (cust) =>
        cust &&
        cust.customerState === 'waiting' &&
        cust.remainingItems.some((id) => unlockedDrinks.includes(id))
    );

    // Keep 1 standby drink ready, or up to 2 if customers are actively requesting drinks
    if (drinksOnTray === 0) return true;
    return customerNeedsDrink && emptyCount >= 2;
  }

  private findNeededDrinkRecipe(): RecipeId {
    const unlockedDrinks = gameState
      .getState()
      .unlockedRecipes.filter((id) => getRecipeDef(id).category === 'drink');

    for (const cust of this.customers) {
      if (!cust || cust.customerState !== 'waiting') continue;
      for (const req of cust.remainingItems) {
        if (unlockedDrinks.includes(req)) {
          return req;
        }
      }
    }
    return unlockedDrinks[0] ?? 'teh_tarik';
  }

  private drawEnvironmentForTier(tierLevel: number): void {
    this.envContainer.removeAll(true);
    const env = this.add.graphics();
    this.envContainer.add(env);

    if (tierLevel === 1) {
      this.drawTier1RoadsideStall(env);
    } else if (tierLevel === 2) {
      this.drawTier2KedaiBawahPokok(env);
    } else {
      this.drawTier3CornerLotMamak(env);
    }

    // Warm tungsten Mamak bulb string lights hanging under the awning
    const lightY = 154;
    env.lineStyle(1.2, 0x78350f, 0.7);
    env.lineBetween(18, lightY - 4, GAME_WIDTH - 18, lightY - 4);
    for (let i = 0; i < 6; i++) {
      const lx = 38 + i * 62;
      env.fillStyle(0xfef08a, 0.22);
      env.fillCircle(lx, lightY, 10);
      env.fillStyle(0xfde047, 0.95);
      env.fillCircle(lx, lightY, 3.2);
    }

    // Stainless Steel Silver Serving Tray Counter (3 plated slots + 1 Trash Bin)
    const counterY = 350;
    const counterH = 96;

    env.fillStyle(0x090d16, 0.55);
    env.fillRect(10, counterY + 6, GAME_WIDTH - 20, counterH);

    env.fillStyle(0x94a3b8, 1);
    env.fillRoundedRect(10, counterY, GAME_WIDTH - 20, counterH, 8);

    env.fillStyle(0xcbd5e1, 1);
    env.fillRoundedRect(10, counterY, GAME_WIDTH - 20, 24, {
      tl: 8,
      tr: 8,
      bl: 0,
      br: 0,
    });

    env.lineStyle(2, 0xf8fafc, 0.85);
    env.lineBetween(14, counterY + 4, GAME_WIDTH - 14, counterY + 4);
    env.lineStyle(2, 0x475569, 1);
    env.strokeRoundedRect(10, counterY, GAME_WIDTH - 20, counterH, 8);
    env.lineBetween(10, counterY + 24, GAME_WIDTH - 10, counterY + 24);

    SERVING_TRAY_SLOTS.forEach((pos, idx) => {
      env.fillStyle(0x64748b, 0.65);
      env.fillRoundedRect(pos.x - 43, pos.y - 27, 86, 54, 10);
      env.lineStyle(1.5, 0xe2e8f0, 0.75);
      env.strokeRoundedRect(pos.x - 43, pos.y - 27, 86, 54, 10);

      const slotTxt = this.add
        .text(pos.x, pos.y, `TRAY ${idx + 1}`, {
          fontFamily: 'monospace',
          fontSize: '10px',
          fontStyle: 'bold',
          color: '#cbd5e1',
        })
        .setOrigin(0.5)
        .setAlpha(0.55);
      this.envContainer.add(slotTxt);
    });

    // --- Trash / Discard Bin on Right Side of Counter (Logical 342, 406) ---
    this.trashBinBg = this.add
      .rectangle(TRASH_BIN_POS.x, TRASH_BIN_POS.y, 64, 54, 0x450a0a, 0.9)
      .setStrokeStyle(1.5, 0xf87171, 0.9)
      .setInteractive({ useHandCursor: true });
    this.envContainer.add(this.trashBinBg);

    const trashIcon = this.add
      .text(TRASH_BIN_POS.x, TRASH_BIN_POS.y - 8, '🗑️', {
        fontSize: '17px',
      })
      .setOrigin(0.5);
    const trashLabel = this.add
      .text(TRASH_BIN_POS.x, TRASH_BIN_POS.y + 13, 'DISCARD\n(-50% RM)', {
        fontFamily: 'monospace',
        fontSize: '8px',
        fontStyle: 'bold',
        color: '#fca5a5',
        align: 'center',
        lineSpacing: -1,
      })
      .setOrigin(0.5);
    this.envContainer.add([trashIcon, trashLabel]);

    // Tapping the Trash Bin directly discards the oldest plated item on the tray (with penalty)
    this.trashBinBg.on('pointerdown', () => {
      const oldestItem = this.servingTray.find((item) => item !== null);
      if (oldestItem) {
        this.discardTrayItemWithPenalty(oldestItem);
      } else {
        this.showPopup(
          TRASH_BIN_POS.x - 40,
          TRASH_BIN_POS.y - 40,
          'Drag unwanted plate here (-50% cost)',
          '#cbd5e1'
        );
      }
    });

    const count = this.servingTray.filter((item) => item !== null).length;
    this.trayHeaderText = this.add
      .text(
        GAME_WIDTH / 2,
        counterY + 12,
        `SERVING TRAY (${count}/3 PLATED) • DRAG TO SERVE OR 🗑️`,
        {
          fontFamily: 'monospace',
          fontSize: '10px',
          fontStyle: 'bold',
          color: '#1e293b',
        }
      )
      .setOrigin(0.5);
    this.envContainer.add(this.trayHeaderText);

    env.lineStyle(2, 0xfacc15, 0.6);
    env.strokeRoundedRect(6, 6, GAME_WIDTH - 12, GAME_HEIGHT - 12, 16);
  }

  private drawTier1RoadsideStall(env: Phaser.GameObjects.Graphics): void {
    env.fillGradientStyle(0x1e1b2e, 0x1e1b2e, 0x292524, 0x292524, 1);
    env.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    env.fillStyle(0x1c1917, 1);
    env.fillRect(0, 282, GAME_WIDTH, GAME_HEIGHT - 282);
    env.fillStyle(0x44403c, 1);
    env.fillRect(0, 276, GAME_WIDTH, 8);

    const awningY = 116;
    const stripeCount = 9;
    const stripeW = (GAME_WIDTH - 16) / stripeCount;
    for (let i = 0; i < stripeCount; i++) {
      const isYellow = i % 2 === 0;
      env.fillStyle(isYellow ? 0xfacc15 : 0xd97706, 1);
      env.fillRoundedRect(8 + i * stripeW, awningY, stripeW + 1, 28, {
        tl: 0,
        tr: 0,
        bl: 8,
        br: 8,
      });
    }
    env.lineStyle(2, 0x78350f, 0.9);
    env.strokeRect(8, awningY, GAME_WIDTH - 16, 26);

    env.fillStyle(0xfef08a, 1);
    env.fillRoundedRect(55, awningY + 20, GAME_WIDTH - 110, 20, 6);
    env.lineStyle(2, 0xb45309, 1);
    env.strokeRoundedRect(55, awningY + 20, GAME_WIDTH - 110, 20, 6);

    const banner = this.add
      .text(GAME_WIDTH / 2, awningY + 30, '★ GERAI MAMAK TEPI JALAN ★', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#78350f',
      })
      .setOrigin(0.5);
    this.envContainer.add(banner);

    TIER_1_SEATS.forEach((seat) => {
      this.drawPlasticRedStool(env, seat.x, seat.y + 24);
    });
  }

  private drawTier2KedaiBawahPokok(env: Phaser.GameObjects.Graphics): void {
    env.fillGradientStyle(0x132a13, 0x132a13, 0x1e293b, 0x1e293b, 1);
    env.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    env.fillStyle(0x5c3a21, 1);
    env.fillRect(14, 130, 28, 152);
    env.fillStyle(0x14532d, 0.95);
    env.fillCircle(60, 135, 58);
    env.fillCircle(140, 125, 50);
    env.fillCircle(250, 125, 50);
    env.fillCircle(335, 135, 58);
    env.fillStyle(0x166534, 0.9);
    env.fillCircle(95, 130, 44);
    env.fillCircle(295, 130, 44);

    env.fillStyle(0x27272a, 1);
    env.fillRect(0, 282, GAME_WIDTH, GAME_HEIGHT - 282);
    env.fillStyle(0x22c55e, 0.45);
    env.fillRect(0, 276, GAME_WIDTH, 6);

    const awningY = 116;
    const stripeCount = 9;
    const stripeW = (GAME_WIDTH - 16) / stripeCount;
    for (let i = 0; i < stripeCount; i++) {
      env.fillStyle(i % 2 === 0 ? 0x0284c7 : 0xf8fafc, 1);
      env.fillRoundedRect(8 + i * stripeW, awningY, stripeW + 1, 26, {
        tl: 0,
        tr: 0,
        bl: 8,
        br: 8,
      });
    }

    env.fillStyle(0xdcfce7, 1);
    env.fillRoundedRect(45, awningY + 18, GAME_WIDTH - 90, 20, 6);
    env.lineStyle(2, 0x15803d, 1);
    env.strokeRoundedRect(45, awningY + 18, GAME_WIDTH - 90, 20, 6);

    const banner = this.add
      .text(GAME_WIDTH / 2, awningY + 28, '🌳 KEDAI MAMAK BAWAH POKOK 🌳', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#14532d',
      })
      .setOrigin(0.5);
    this.envContainer.add(banner);

    TIER_2_SEATS.forEach((seat) => {
      this.drawPlasticTableAndStool(env, seat.x, seat.y + 20, 0xfef08a);
    });
  }

  private drawTier3CornerLotMamak(env: Phaser.GameObjects.Graphics): void {
    env.fillGradientStyle(0x1e3a8a, 0x1e3a8a, 0x1e293b, 0x1e293b, 1);
    env.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    env.fillStyle(0xfef9c3, 0.14);
    env.fillRect(10, 128, GAME_WIDTH - 20, 152);
    env.fillStyle(0xfacc15, 0.22);
    env.fillRect(12, 128, 16, 152);
    env.fillRect(GAME_WIDTH - 28, 128, 16, 152);

    const bannerY = 158;
    env.lineStyle(2, 0xfef08a, 0.9);
    env.lineBetween(16, bannerY, GAME_WIDTH - 16, bannerY);
    const flagColors = [0xef4444, 0xfacc15, 0x22c55e, 0x3b82f6, 0xa855f7, 0xf97316];
    for (let i = 0; i < 10; i++) {
      const fx = 24 + i * 35;
      env.fillStyle(flagColors[i % flagColors.length], 1);
      env.fillTriangle(fx, bannerY, fx + 22, bannerY, fx + 11, bannerY + 18);
    }

    env.fillStyle(0x0f172a, 1);
    env.fillRoundedRect(GAME_WIDTH / 2 - 48, 164, 96, 32, 4);
    env.fillStyle(0x16a34a, 1);
    env.fillRect(GAME_WIDTH / 2 - 44, 168, 88, 24);
    env.lineStyle(1, 0xffffff, 0.8);
    env.strokeRect(GAME_WIDTH / 2 - 40, 171, 80, 18);
    env.strokeCircle(GAME_WIDTH / 2, 180, 5);

    const tvLabel = this.add
      .text(GAME_WIDTH / 2, 180, '⚽ LIVE 2-1', {
        fontFamily: 'monospace',
        fontSize: '9px',
        fontStyle: 'bold',
        color: '#ffffff',
      })
      .setOrigin(0.5);
    this.envContainer.add(tvLabel);

    const awningY = 116;
    env.fillStyle(0xdc2626, 1);
    env.fillRoundedRect(10, awningY, GAME_WIDTH - 20, 24, 6);
    env.fillStyle(0xfef08a, 1);
    env.fillRoundedRect(32, awningY + 16, GAME_WIDTH - 64, 22, 6);
    env.lineStyle(2, 0xfacc15, 1);
    env.strokeRoundedRect(32, awningY + 16, GAME_WIDTH - 64, 22, 6);

    const banner = this.add
      .text(GAME_WIDTH / 2, awningY + 27, '🏆 RESTORAN CORNER LOT MAMAK 24 JAM 🏆', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '10.5px',
        fontStyle: 'bold',
        color: '#991b1b',
      })
      .setOrigin(0.5);
    this.envContainer.add(banner);

    env.fillStyle(0x334155, 1);
    env.fillRect(0, 282, GAME_WIDTH, GAME_HEIGHT - 282);
    env.fillStyle(0xfacc15, 0.7);
    env.fillRect(0, 276, GAME_WIDTH, 6);

    TIER_2_SEATS.forEach((seat) => {
      this.drawPlasticTableAndStool(env, seat.x, seat.y + 20, 0x38bdf8);
    });
  }

  private drawPlasticTableAndStool(
    gfx: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    tableColor: number
  ): void {
    this.drawPlasticRedStool(gfx, cx, cy);

    gfx.fillStyle(tableColor, 0.92);
    gfx.fillRoundedRect(cx - 34, cy - 16, 68, 14, 4);
    gfx.lineStyle(1.5, 0x78350f, 0.9);
    gfx.strokeRoundedRect(cx - 34, cy - 16, 68, 14, 4);
  }

  private drawPlasticRedStool(
    gfx: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number
  ): void {
    gfx.fillStyle(0x000000, 0.4);
    gfx.fillEllipse(cx, cy + 24, 54, 12);

    gfx.lineStyle(4, 0x991b1b, 1);
    gfx.lineBetween(cx - 14, cy, cx - 20, cy + 22);
    gfx.lineBetween(cx + 14, cy, cx + 20, cy + 22);
    gfx.lineBetween(cx - 7, cy + 2, cx - 9, cy + 23);
    gfx.lineBetween(cx + 7, cy + 2, cx + 9, cy + 23);

    gfx.lineStyle(2.5, 0xb91c1c, 1);
    gfx.lineBetween(cx - 17, cy + 12, cx + 17, cy + 12);

    gfx.fillStyle(0xdc2626, 1);
    gfx.fillRoundedRect(cx - 22, cy - 7, 44, 13, 5);
    gfx.lineStyle(1.5, 0xfca5a5, 0.8);
    gfx.strokeRoundedRect(cx - 22, cy - 7, 44, 13, 5);

    gfx.fillStyle(0x450a0a, 1);
    gfx.fillEllipse(cx, cy - 1, 8, 3);
  }

  private addItemToServingTray(recipeId: RecipeId): boolean {
    const emptyIdx = this.servingTray.findIndex((item) => item === null);
    if (emptyIdx === -1) {
      return false;
    }

    const pos = SERVING_TRAY_SLOTS[emptyIdx];
    const trayItem = new FoodTrayItem(
      this,
      emptyIdx,
      recipeId,
      pos.x,
      pos.y,
      {
        onServeAttempt: (item, px, py, wasClick) =>
          this.tryFulfillOrDiscardOrder(item, px, py, wasClick),
        onDragHover: (item, px, py, isDragging) =>
          this.updateCustomerDropHighlights(item, px, py, isDragging),
        onPressPreview: (item, active) =>
          this.updatePressPreview(item, active),
      }
    );
    trayItem.setDepth(25);
    this.servingTray[emptyIdx] = trayItem;
    this.updateTrayHeaderCount();
    this.syncMatchHints();
    return true;
  }

  private updateTrayHeaderCount(): void {
    const count = this.servingTray.filter((item) => item !== null).length;
    this.trayHeaderText.setText(
      `SERVING TRAY (${count}/3 PLATED) • DRAG TO SERVE OR 🗑️`
    );
  }

  /**
   * Recomputes which plated tray items match which seated customers:
   * - Customers get colored match dots on their speech bubble rows matching the tray slot color.
   * - Plated tray items with no matching customer get an amber "❓ TAKDE ORDER" tag.
   */
  private syncMatchHints(): void {
    const activeCustomers = this.customers.filter(
      (c): c is Customer =>
        c !== null && (c.customerState === 'waiting' || c.customerState === 'walking_in')
    );

    // 1. Update each tray item's "no order" tag
    for (const item of this.servingTray) {
      if (!item) continue;
      const someoneWantsIt = activeCustomers.some((cust) =>
        cust.remainingItems.includes(item.recipeId)
      );
      item.setNoOrder(!someoneWantsIt);
    }

    // 2. Update each customer's speech bubble match dots
    for (const cust of this.customers) {
      if (!cust) continue;
      const map: Partial<Record<RecipeId, number[]>> = {};
      for (const item of this.servingTray) {
        if (!item) continue;
        if (cust.remainingItems.includes(item.recipeId)) {
          const list = map[item.recipeId] ?? [];
          list.push(item.slotColor);
          map[item.recipeId] = list;
        }
      }
      cust.setMatchColors(map);
    }
  }

  private findTapServeTarget(recipeId: RecipeId): Customer | null {
    let target: Customer | null = null;
    let lowestPatience = Infinity;
    for (const cust of this.customers) {
      if (cust && cust.canAcceptRecipe(recipeId)) {
        const pat = cust.getPatienceRatio();
        if (pat < lowestPatience) {
          lowestPatience = pat;
          target = cust;
        }
      }
    }
    return target;
  }

  private updatePressPreview(item: FoodTrayItem, active: boolean): void {
    this.clearPreviewTarget();
    if (!active) return;
    const target = this.findTapServeTarget(item.recipeId);
    if (target) {
      this.previewTarget = target;
      target.setHighlight(true);
    }
  }

  private clearPreviewTarget(): void {
    if (this.previewTarget) {
      this.previewTarget.setHighlight(false);
      this.previewTarget = null;
    }
  }

  private updateCustomerDropHighlights(
    item: FoodTrayItem,
    pointerX: number,
    pointerY: number,
    isDragging: boolean
  ): void {
    this.customers.forEach((cust) => {
      if (!cust) return;
      if (!isDragging) {
        cust.setHighlight(false);
        return;
      }
      const dist = Phaser.Math.Distance.Between(
        pointerX,
        pointerY,
        cust.x,
        cust.y - 20
      );
      cust.setHighlight(dist < 95 && cust.canAcceptRecipe(item.recipeId));
    });

    // Highlight Trash Bin when dragging near it
    if (this.trashBinBg) {
      if (!isDragging) {
        this.trashBinBg.setFillStyle(0x450a0a, 0.9);
      } else {
        const trashDist = Phaser.Math.Distance.Between(
          pointerX,
          pointerY,
          TRASH_BIN_POS.x,
          TRASH_BIN_POS.y
        );
        this.trashBinBg.setFillStyle(trashDist < 55 ? 0xdc2626 : 0x450a0a, 0.95);
      }
    }
  }

  /**
   * Discards a plated item from the Serving Tray and applies the waste penalty:
   * - Deducts 50% of the item's menu price (min RM 1.00)
   * - Drops reputation by 1 and resets active combo streak
   */
  private discardTrayItemWithPenalty(item: FoodTrayItem): void {
    const def = getRecipeDef(item.recipeId);
    const cashPenalty = gameState.recordDiscardedFood(def.price, 1);
    haptic(HAPTIC.discard, 'discard');

    if (this.servingTray[item.trayIndex] === item) {
      this.servingTray[item.trayIndex] = null;
    }
    item.destroy();
    this.updateTrayHeaderCount();
    this.syncMatchHints();
    this.emitTutorialEvent('discarded');

    this.showPopup(
      TRASH_BIN_POS.x - 45,
      TRASH_BIN_POS.y - 42,
      `🗑️ Discarded ${def.shortName} (-RM ${cashPenalty.toFixed(2)}, Rep -1)`,
      '#f87171'
    );
  }

  private tryFulfillOrDiscardOrder(
    item: FoodTrayItem,
    pointerX: number,
    pointerY: number,
    wasClick: boolean
  ): ServeResult {
    // 1. Check if dragged onto the Trash Bin
    if (!wasClick) {
      const trashDist = Phaser.Math.Distance.Between(
        pointerX,
        pointerY,
        TRASH_BIN_POS.x,
        TRASH_BIN_POS.y
      );
      if (trashDist < 55) {
        this.discardTrayItemWithPenalty(item);
        return 'served';
      }
    }

    // 2. Check customer order fulfillment
    let targetCustomer: Customer | null = null;
    let nearestCustomer: Customer | null = null;
    let nearestDist = Infinity;

    if (!wasClick) {
      for (const cust of this.customers) {
        if (!cust || cust.customerState !== 'waiting') continue;
        const dist = Phaser.Math.Distance.Between(
          pointerX,
          pointerY,
          cust.x,
          cust.y - 20
        );
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestCustomer = cust;
        }
        if (dist < 105 && cust.canAcceptRecipe(item.recipeId)) {
          targetCustomer = cust;
          break;
        }
      }
    } else {
      targetCustomer = this.findTapServeTarget(item.recipeId);
    }

    if (!targetCustomer) {
      const def = getRecipeDef(item.recipeId);
      if (wasClick) {
        // Check if someone is walking in who wants this item vs nobody at all
        const walkingInWants = this.customers.some(
          (c) =>
            c &&
            c.customerState === 'walking_in' &&
            c.remainingItems.includes(item.recipeId)
        );
        haptic(HAPTIC.reject, 'reject');
        this.showPopup(
          item.x,
          item.y - 44,
          walkingInWants
            ? `Wait ah boss, customer still sitting down! 😅`
            : `Nobody ordered ${def.shortName} lah, boss! 🤷`,
          '#fbbf24'
        );
        return 'rejected';
      }

      // Dragged onto a specific customer who ordered something else
      if (nearestCustomer && nearestDist < 105) {
        const wantedNames = nearestCustomer.remainingItems
          .map((id) => getRecipeDef(id).shortName)
          .join(' + ');
        haptic(HAPTIC.reject, 'wrongCustomer');
        this.showPopup(
          nearestCustomer.x,
          nearestCustomer.y - 75,
          `Eh, this customer ordered ${wantedNames} lah! 😅`,
          '#fbbf24'
        );
        return 'rejected';
      }

      return 'cancel';
    }

    if (this.servingTray[item.trayIndex] === item) {
      this.servingTray[item.trayIndex] = null;
    }
    item.destroy();
    this.updateTrayHeaderCount();

    targetCustomer.serveItem(item.recipeId);
    this.syncMatchHints();
    this.emitTutorialEvent('served');
    return 'served';
  }

  /**
   * Spawns a customer with phase-driven Rush Hour recipe weights and Customer Archetypes:
   * - Morning: Breakfast Rush (Teh Tarik & Roti Canai bias)
   * - Evening/Night: Supper & Bola Live Rush (higher Bola Fan & Tapau Rider chance)
   */
  private spawnCustomerInSeat(
    seatIndex: number,
    forcedOrder?: RecipeId[],
    forcedArchetype?: CustomerArchetype
  ): Customer | null {
    const seats = this.getActiveSeats();
    if (seatIndex >= seats.length || this.customers[seatIndex] !== null) return null;

    const seat = seats[seatIndex];
    const state = gameState.getState();
    const unlocked = state.unlockedRecipes;
    if (unlocked.length === 0) return null;

    // Choose Customer Archetype based on time of day (unless forced by tutorial)
    let archetype: CustomerArchetype = forcedArchetype ?? 'regular';
    if (!forcedArchetype) {
      const roll = Math.random();
      if (state.isNight) {
        if (roll < 0.32) archetype = 'bola_fan';
        else if (roll < 0.52) archetype = 'tapau_rider';
      } else {
        if (roll < 0.22) archetype = 'tapau_rider';
        else if (roll < 0.32) archetype = 'bola_fan';
      }
    }

    let requested: RecipeId[];
    if (forcedOrder && forcedOrder.length > 0) {
      requested = [...forcedOrder];
    } else {
      // Bola fans usually order 2 items (drink + food); Tapau riders order 1 quick item
      const orderCount =
        archetype === 'bola_fan'
          ? 2
          : archetype === 'tapau_rider'
          ? 1
          : Math.random() < 0.25
          ? 2
          : 1;

      requested = [];
      for (let i = 0; i < orderCount; i++) {
        requested.push(this.pickPhaseWeightedRecipe(unlocked, state.phase));
      }
    }

    const customer = new Customer(
      this,
      seatIndex,
      seat.spawnX,
      seat.y,
      seat.x,
      seat.y,
      requested,
      {
        onServed: (cust, recipeId, allComplete, patienceRatio) => {
          const def = getRecipeDef(recipeId);

          // Archetype & fast-service tip calculation
          let tip = patienceRatio > 0.6 ? 1.0 : 0;
          if (cust.archetype === 'tapau_rider' && patienceRatio > 0.45) {
            tip += 2.0; // Priority delivery rider bonus
          } else if (cust.archetype === 'bola_fan' && patienceRatio > 0.5) {
            tip += 1.0;
          }

          const totalEarned = gameState.recordSale(def.price, tip, allComplete);

          if (allComplete) {
            const repGain =
              cust.archetype === 'bola_fan'
                ? 5
                : patienceRatio > 0.6
                ? 3
                : 1;
            gameState.adjustReputation(repGain);
          }

          const streak = gameState.getState().comboStreak;
          if (streak >= 3) {
            haptic(HAPTIC.combo, 'combo');
          } else {
            haptic(HAPTIC.serve, 'serve');
          }

          const extraLabel =
            streak >= 3
              ? ` 🔥${streak}x!`
              : tip > 0
              ? ` (Tip!)`
              : '';

          this.showPopup(
            cust.x,
            cust.y - 75,
            `+RM ${totalEarned.toFixed(2)}${extraLabel}`,
            '#4ade80'
          );
          this.syncMatchHints();
        },
        onTimeout: (cust) => {
          haptic(HAPTIC.walkout, 'walkout');
          gameState.recordWalkout();
          this.showPopup(cust.x, cust.y - 75, 'Walked out lah! Rep -5', '#f87171');
          this.syncMatchHints();
        },
        onExited: (cust) => {
          if (this.customers[cust.seatIndex] === cust) {
            this.customers[cust.seatIndex] = null;
          }
          cust.destroy();
          this.syncMatchHints();
        },
      },
      archetype
    );

    customer.setDepth(10);
    if (seats.length >= 4) {
      customer.setScale(0.78);
    }
    this.customers[seatIndex] = customer;
    this.syncMatchHints();
    return customer;
  }

  private pickPhaseWeightedRecipe(
    unlocked: RecipeId[],
    phase: string
  ): RecipeId {
    if (phase === 'Morning' && Math.random() < 0.65) {
      const morningFaves = unlocked.filter(
        (id) => id === 'teh_tarik' || id === 'roti_canai' || id === 'roti_telur'
      );
      if (morningFaves.length > 0) {
        return morningFaves[Math.floor(Math.random() * morningFaves.length)];
      }
    } else if ((phase === 'Evening' || phase === 'Night') && Math.random() < 0.65) {
      const nightFaves = unlocked.filter(
        (id) => id === 'maggi_goreng' || id === 'nasi_kandar' || id === 'milo_ais'
      );
      if (nightFaves.length > 0) {
        return nightFaves[Math.floor(Math.random() * nightFaves.length)];
      }
    }
    return unlocked[Math.floor(Math.random() * unlocked.length)];
  }

  private showPopup(x: number, y: number, message: string, color: string): void {
    const popup = this.add
      .text(x, y, message, {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '11px',
        fontStyle: 'bold',
        color,
        backgroundColor: '#0f172a',
        padding: { x: 6, y: 3 },
      })
      .setOrigin(0.5)
      .setDepth(55);

    this.tweens.add({
      targets: popup,
      y: y - 32,
      alpha: 0,
      duration: 1050,
      ease: 'Cubic.easeOut',
      onComplete: () => popup.destroy(),
    });
  }

  override update(time: number, delta: number): void {
    if (this.isPaused || (this.upgradeModal && this.upgradeModal.visible)) {
      return;
    }

    const tutorialActive = Boolean(this.tutorial && this.tutorial.isActive);
    if (!tutorialActive) {
      this.topHud.updateEntity(time, delta);
    }
    this.prepDock.updateEntity(time, delta);

    const state = gameState.getState();
    const maxCust = state.maxCustomers;
    for (let i = 0; i < maxCust; i++) {
      this.customers[i]?.updateEntity(time, delta);
    }

    if (tutorialActive) {
      return;
    }

    let emptySeatIndex = -1;
    for (let i = 0; i < maxCust; i++) {
      if (this.customers[i] === null) {
        emptySeatIndex = i;
        break;
      }
    }

    if (emptySeatIndex !== -1) {
      this.spawnCooldownMs -= delta;
      if (this.spawnCooldownMs <= 0) {
        this.spawnCustomerInSeat(emptySeatIndex);
        // Faster customer arrivals during Evening/Night supper rush
        const rushMultiplier = state.isNight ? 0.72 : 1.0;
        const baseDelay = maxCust >= 4 ? 1600 : 2100;
        this.spawnCooldownMs = baseDelay * rushMultiplier;
      }
    }
  }
}
