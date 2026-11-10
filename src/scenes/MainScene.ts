import Phaser from 'phaser';
import { gameState, RecipeId } from '../state/GameState';
import { TopHud } from '../entities/TopHud';
import { Customer } from '../entities/Customer';
import { FoodTrayItem } from '../entities/FoodTrayItem';
import { PrepStationDock } from '../entities/PrepStationDock';
import { UpgradeKedaiModal } from '../entities/UpgradeKedaiModal';
import { getRecipeDef } from '../config/recipes';
import { GAME_WIDTH, GAME_HEIGHT } from '../config/constants';

interface SeatPosition {
  seatIndex: number;
  x: number;
  y: number;
  spawnX: number;
}

const TIER_1_SEATS: SeatPosition[] = [
  { seatIndex: 0, x: 112, y: 344, spawnX: -60 },
  { seatIndex: 1, x: 278, y: 344, spawnX: GAME_WIDTH + 60 },
];

const TIER_2_SEATS: SeatPosition[] = [
  { seatIndex: 0, x: 52, y: 348, spawnX: -60 },
  { seatIndex: 1, x: 147, y: 348, spawnX: -60 },
  { seatIndex: 2, x: 243, y: 348, spawnX: GAME_WIDTH + 60 },
  { seatIndex: 3, x: 338, y: 348, spawnX: GAME_WIDTH + 60 },
];

const SERVING_TRAY_SLOTS: Array<{ x: number; y: number }> = [
  { x: 76, y: 458 },
  { x: 195, y: 458 },
  { x: 314, y: 458 },
];

export class MainScene extends Phaser.Scene {
  private envContainer!: Phaser.GameObjects.Container;
  private topHud!: TopHud;
  private prepDock!: PrepStationDock;
  private upgradeModal!: UpgradeKedaiModal;

  private customers: Array<Customer | null> = [null, null, null, null];
  private servingTray: Array<FoodTrayItem | null> = [null, null, null];
  private trayHeaderText!: Phaser.GameObjects.Text;
  private spawnCooldownMs = 600;

  constructor() {
    super({ key: 'MainScene' });
  }

  create(): void {
    this.envContainer = this.add.container(0, 0);
    this.drawEnvironmentForTier(gameState.getState().tier.level);

    // Top HUD with "🏪 UPGRADE" Shop button
    this.topHud = new TopHud(this, gameState, () => {
      this.upgradeModal.open();
    });
    this.topHud.setDepth(30);

    // Bottom Interactive Prep Station Dock
    this.prepDock = new PrepStationDock(this, gameState, {
      canAddToServingTray: () => this.servingTray.some((slot) => slot === null),
      onPlateItem: (recipeId) => this.addItemToServingTray(recipeId),
      onStationMessage: (x, y, text, color) => this.showPopup(x, y, text, color),
      getNeededDrinkRecipe: () => this.findNeededDrinkRecipe(),
    });
    this.prepDock.setDepth(20);

    // "Upgrade Kedai" Modal Overlay (opens via Shop button or at end of each 90s shift)
    this.upgradeModal = new UpgradeKedaiModal(this, gameState);

    // React to Tier Upgrades (update background visuals & seat layout)
    gameState.on('tierChanged', (tier) => {
      this.drawEnvironmentForTier(tier.level);
      this.repositionExistingCustomers();
      this.showPopup(
        GAME_WIDTH / 2,
        240,
        `🎉 Upgraded to ${tier.name}!`,
        '#facc15'
      );
    });

    // Automatically open "Upgrade Kedai" modal at the end of each shift
    gameState.on('shiftEnded', (completedDay, nextDay) => {
      this.upgradeModal.open(
        `🌙 Day ${completedDay} Shift Complete! Ready for Day ${nextDay}`
      );
    });

    // Spawn first customer immediately
    this.spawnCustomerInSeat(0);
  }

  private getActiveSeats(): SeatPosition[] {
    const maxCust = gameState.getState().maxCustomers;
    return maxCust >= 4 ? TIER_2_SEATS : TIER_1_SEATS;
  }

  private repositionExistingCustomers(): void {
    const seats = this.getActiveSeats();
    this.customers.forEach((cust, idx) => {
      if (cust && seats[idx]) {
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

  /**
   * Renders the stall background visuals dynamically for Tier 1, Tier 2, or Tier 3:
   * - Tier 1: "Gerai Tepi Jalan" (Roadside stall with 2 red plastic stools)
   * - Tier 2: "Kedai Bawah Pokok" (Canopy stall under a shady tree with 4 plastic tables)
   * - Tier 3: "Corner Lot Mamak" (Bright shophouse corner lot with football banners & Ane Helper)
   */
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

    // Stainless Steel Silver Serving Tray Counter (Max capacity: 3 plated items)
    const counterY = 396;
    const counterH = 110;

    env.fillStyle(0x090d16, 0.55);
    env.fillRect(10, counterY + 6, GAME_WIDTH - 20, counterH);

    env.fillStyle(0x94a3b8, 1);
    env.fillRoundedRect(10, counterY, GAME_WIDTH - 20, counterH, 8);

    env.fillStyle(0xcbd5e1, 1);
    env.fillRoundedRect(10, counterY, GAME_WIDTH - 20, 28, {
      tl: 8,
      tr: 8,
      bl: 0,
      br: 0,
    });

    env.lineStyle(2, 0xf8fafc, 0.85);
    env.lineBetween(14, counterY + 4, GAME_WIDTH - 14, counterY + 4);
    env.lineStyle(2, 0x475569, 1);
    env.strokeRoundedRect(10, counterY, GAME_WIDTH - 20, counterH, 8);
    env.lineBetween(10, counterY + 28, GAME_WIDTH - 10, counterY + 28);

    SERVING_TRAY_SLOTS.forEach((pos, idx) => {
      env.fillStyle(0x64748b, 0.65);
      env.fillRoundedRect(pos.x - 46, pos.y - 30, 92, 60, 10);
      env.lineStyle(1.5, 0xe2e8f0, 0.75);
      env.strokeRoundedRect(pos.x - 46, pos.y - 30, 92, 60, 10);

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

    const count = this.servingTray.filter((item) => item !== null).length;
    this.trayHeaderText = this.add
      .text(
        GAME_WIDTH / 2,
        counterY + 14,
        `SERVING TRAY (${count}/3 PLATED) • DRAG TO CUSTOMER`,
        {
          fontFamily: 'monospace',
          fontSize: '10px',
          fontStyle: 'bold',
          color: '#1e293b',
        }
      )
      .setOrigin(0.5);
    this.envContainer.add(this.trayHeaderText);

    // Outer viewport border
    env.lineStyle(2, 0xfacc15, 0.6);
    env.strokeRoundedRect(6, 6, GAME_WIDTH - 12, GAME_HEIGHT - 12, 16);
  }

  private drawTier1RoadsideStall(env: Phaser.GameObjects.Graphics): void {
    env.fillGradientStyle(0x1e1b2e, 0x1e1b2e, 0x292524, 0x292524, 1);
    env.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    env.fillStyle(0x1c1917, 1);
    env.fillRect(0, 320, GAME_WIDTH, GAME_HEIGHT - 320);
    env.fillStyle(0x44403c, 1);
    env.fillRect(0, 314, GAME_WIDTH, 8);

    const awningY = 132;
    const stripeCount = 9;
    const stripeW = (GAME_WIDTH - 16) / stripeCount;
    for (let i = 0; i < stripeCount; i++) {
      const isYellow = i % 2 === 0;
      env.fillStyle(isYellow ? 0xfacc15 : 0xd97706, 1);
      env.fillRoundedRect(8 + i * stripeW, awningY, stripeW + 1, 30, {
        tl: 0,
        tr: 0,
        bl: 8,
        br: 8,
      });
    }
    env.lineStyle(2, 0x78350f, 0.9);
    env.strokeRect(8, awningY, GAME_WIDTH - 16, 28);

    env.fillStyle(0xfef08a, 1);
    env.fillRoundedRect(55, awningY + 22, GAME_WIDTH - 110, 22, 6);
    env.lineStyle(2, 0xb45309, 1);
    env.strokeRoundedRect(55, awningY + 22, GAME_WIDTH - 110, 22, 6);

    const banner = this.add
      .text(GAME_WIDTH / 2, awningY + 33, '★ GERAI MAMAK TEPI JALAN ★', {
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
    // Lush shady evening/day park backdrop under a large tropical Angsana tree
    env.fillGradientStyle(0x132a13, 0x132a13, 0x1e293b, 0x1e293b, 1);
    env.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // Big shady tree trunk on the left/right edges & lush green leafy canopy overhead
    env.fillStyle(0x5c3a21, 1);
    env.fillRect(14, 150, 28, 175);
    env.fillStyle(0x14532d, 0.95);
    env.fillCircle(60, 155, 58);
    env.fillCircle(140, 145, 50);
    env.fillCircle(250, 145, 50);
    env.fillCircle(335, 155, 58);
    env.fillStyle(0x166534, 0.9);
    env.fillCircle(95, 150, 44);
    env.fillCircle(295, 150, 44);

    // Paved outdoor patio floor
    env.fillStyle(0x27272a, 1);
    env.fillRect(0, 320, GAME_WIDTH, GAME_HEIGHT - 320);
    env.fillStyle(0x22c55e, 0.45);
    env.fillRect(0, 314, GAME_WIDTH, 6);

    // Blue & White Pasar Malam / Canopy Tent Roof
    const awningY = 132;
    const stripeCount = 9;
    const stripeW = (GAME_WIDTH - 16) / stripeCount;
    for (let i = 0; i < stripeCount; i++) {
      env.fillStyle(i % 2 === 0 ? 0x0284c7 : 0xf8fafc, 1);
      env.fillRoundedRect(8 + i * stripeW, awningY, stripeW + 1, 28, {
        tl: 0,
        tr: 0,
        bl: 8,
        br: 8,
      });
    }

    env.fillStyle(0xDCFCE7, 1);
    env.fillRoundedRect(45, awningY + 20, GAME_WIDTH - 90, 22, 6);
    env.lineStyle(2, 0x15803d, 1);
    env.strokeRoundedRect(45, awningY + 20, GAME_WIDTH - 90, 22, 6);

    const banner = this.add
      .text(GAME_WIDTH / 2, awningY + 31, '🌳 KEDAI MAMAK BAWAH POKOK 🌳', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#14532d',
      })
      .setOrigin(0.5);
    this.envContainer.add(banner);

    // 4 Plastic Tables + Red Stools for up to 4 waiting customers
    TIER_2_SEATS.forEach((seat) => {
      this.drawPlasticTableAndStool(env, seat.x, seat.y + 20, 0xfef08a);
    });
  }

  private drawTier3CornerLotMamak(env: Phaser.GameObjects.Graphics): void {
    // Bright illuminated Corner Lot Shophouse interior/patio
    env.fillGradientStyle(0x1e3a8a, 0x1e3a8a, 0x1e293b, 0x1e293b, 1);
    env.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // Bright cream shophouse tiled wall & pillars
    env.fillStyle(0xfef9c3, 0.14);
    env.fillRect(10, 145, GAME_WIDTH - 20, 172);
    env.fillStyle(0xfacc15, 0.22);
    env.fillRect(12, 145, 16, 172);
    env.fillRect(GAME_WIDTH - 28, 145, 16, 172);

    // Hanging Football Triangular Pennant Banners ("BOLA LIVE!") across shophouse ceiling
    const bannerY = 178;
    env.lineStyle(2, 0xfef08a, 0.9);
    env.lineBetween(16, bannerY, GAME_WIDTH - 16, bannerY);
    const flagColors = [0xef4444, 0xfacc15, 0x22c55e, 0x3b82f6, 0xa855f7, 0xf97316];
    for (let i = 0; i < 10; i++) {
      const fx = 24 + i * 35;
      env.fillStyle(flagColors[i % flagColors.length], 1);
      env.fillTriangle(fx, bannerY, fx + 22, bannerY, fx + 11, bannerY + 20);
    }

    // Big screen TV in corner lot showing live football match
    env.fillStyle(0x0f172a, 1);
    env.fillRoundedRect(GAME_WIDTH / 2 - 48, 186, 96, 36, 4);
    env.fillStyle(0x16a34a, 1);
    env.fillRect(GAME_WIDTH / 2 - 44, 190, 88, 28);
    env.lineStyle(1, 0xffffff, 0.8);
    env.strokeRect(GAME_WIDTH / 2 - 40, 193, 80, 22);
    env.strokeCircle(GAME_WIDTH / 2, 204, 6);

    const tvLabel = this.add
      .text(GAME_WIDTH / 2, 204, '⚽ LIVE 2-1', {
        fontFamily: 'monospace',
        fontSize: '9px',
        fontStyle: 'bold',
        color: '#ffffff',
      })
      .setOrigin(0.5);
    this.envContainer.add(tvLabel);

    // Shophouse Signboard
    const awningY = 132;
    env.fillStyle(0xdc2626, 1);
    env.fillRoundedRect(10, awningY, GAME_WIDTH - 20, 26, 6);
    env.fillStyle(0xfef08a, 1);
    env.fillRoundedRect(32, awningY + 18, GAME_WIDTH - 64, 24, 6);
    env.lineStyle(2, 0xfacc15, 1);
    env.strokeRoundedRect(32, awningY + 18, GAME_WIDTH - 64, 24, 6);

    const banner = this.add
      .text(GAME_WIDTH / 2, awningY + 30, '🏆 RESTORAN CORNER LOT MAMAK 24 JAM 🏆', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '10.5px',
        fontStyle: 'bold',
        color: '#991b1b',
      })
      .setOrigin(0.5);
    this.envContainer.add(banner);

    // Checkered shophouse tile floor
    env.fillStyle(0x334155, 1);
    env.fillRect(0, 320, GAME_WIDTH, GAME_HEIGHT - 320);
    env.fillStyle(0xfacc15, 0.7);
    env.fillRect(0, 314, GAME_WIDTH, 6);

    // 4 Shophouse Tables + Stools
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
    // Red plastic stool behind table
    this.drawPlasticRedStool(gfx, cx, cy);

    // Square plastic table surface in front of customer
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
      (item, px, py, wasClick) => this.tryFulfillCustomerOrder(item, px, py, wasClick),
      (item, px, py, isDragging) =>
        this.updateCustomerDropHighlights(item, px, py, isDragging)
    );
    trayItem.setDepth(25);
    this.servingTray[emptyIdx] = trayItem;
    this.updateTrayHeaderCount();
    return true;
  }

  private updateTrayHeaderCount(): void {
    const count = this.servingTray.filter((item) => item !== null).length;
    this.trayHeaderText.setText(
      `SERVING TRAY (${count}/3 PLATED) • DRAG TO CUSTOMER`
    );
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
  }

  private tryFulfillCustomerOrder(
    item: FoodTrayItem,
    pointerX: number,
    pointerY: number,
    wasClick: boolean
  ): boolean {
    let targetCustomer: Customer | null = null;

    if (!wasClick) {
      for (const cust of this.customers) {
        if (!cust || !cust.canAcceptRecipe(item.recipeId)) continue;
        const dist = Phaser.Math.Distance.Between(
          pointerX,
          pointerY,
          cust.x,
          cust.y - 20
        );
        if (dist < 105) {
          targetCustomer = cust;
          break;
        }
      }
    } else {
      let lowestPatience = Infinity;
      for (const cust of this.customers) {
        if (cust && cust.canAcceptRecipe(item.recipeId)) {
          const pat = cust.getPatienceRatio();
          if (pat < lowestPatience) {
            lowestPatience = pat;
            targetCustomer = cust;
          }
        }
      }
    }

    if (!targetCustomer) {
      return false;
    }

    if (this.servingTray[item.trayIndex] === item) {
      this.servingTray[item.trayIndex] = null;
    }
    item.destroy();
    this.updateTrayHeaderCount();

    targetCustomer.serveItem(item.recipeId);
    return true;
  }

  private spawnCustomerInSeat(seatIndex: number): void {
    const seats = this.getActiveSeats();
    if (seatIndex >= seats.length || this.customers[seatIndex] !== null) return;

    const seat = seats[seatIndex];
    const unlocked = gameState.getState().unlockedRecipes;
    if (unlocked.length === 0) return;

    const orderCount = Math.random() < 0.2 ? 2 : 1;
    const requested: RecipeId[] = [];
    for (let i = 0; i < orderCount; i++) {
      const pick = unlocked[Math.floor(Math.random() * unlocked.length)];
      requested.push(pick);
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
          const tip = patienceRatio > 0.6 ? 1.0 : 0;
          const totalEarned = def.price + tip;
          gameState.addCash(totalEarned);

          if (allComplete) {
            gameState.adjustReputation(patienceRatio > 0.6 ? 3 : 1);
          }

          this.showPopup(
            cust.x,
            cust.y - 75,
            tip > 0
              ? `+RM ${totalEarned.toFixed(2)} (Tip +RM ${tip.toFixed(2)}!)`
              : `+RM ${totalEarned.toFixed(2)}`,
            '#4ade80'
          );
        },
        onTimeout: (cust) => {
          gameState.adjustReputation(-5);
          this.showPopup(cust.x, cust.y - 75, 'Walked Out! Rep -5', '#f87171');
        },
        onExited: (cust) => {
          if (this.customers[cust.seatIndex] === cust) {
            this.customers[cust.seatIndex] = null;
          }
          cust.destroy();
        },
      }
    );

    customer.setDepth(10);
    // Slightly scale down customer width when 4 seats are active so all 4 speech bubbles fit cleanly
    if (seats.length >= 4) {
      customer.setScale(0.78);
    }
    this.customers[seatIndex] = customer;
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
    // Pause gameplay timers while the Upgrade Kedai modal is open
    if (this.upgradeModal && this.upgradeModal.visible) {
      return;
    }

    this.topHud.updateEntity(time, delta);
    this.prepDock.updateEntity(time, delta);

    const maxCust = gameState.getState().maxCustomers;
    for (let i = 0; i < maxCust; i++) {
      this.customers[i]?.updateEntity(time, delta);
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
        this.spawnCooldownMs = maxCust >= 4 ? 1600 : 2200;
      }
    }
  }
}
