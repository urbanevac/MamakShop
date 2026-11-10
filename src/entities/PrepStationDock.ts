import Phaser from 'phaser';
import { BaseEntity } from './BaseEntity';
import { GameStateStore, RecipeId } from '../state/GameState';
import { Customer } from './Customer';
import { getRecipeDef } from '../config/recipes';
import { GAME_WIDTH } from '../config/constants';

export type TehTarikStage = 'idle' | 'filling' | 'filled' | 'pulling';
export type RotiCanaiStage = 'idle' | 'cooking' | 'ready_to_flip' | 'cooked' | 'burned';

interface GriddleSlotState {
  stage: RotiCanaiStage;
  timerMs: number;
  recipeId: RecipeId;
}

export interface PrepStationCallbacks {
  canAddToServingTray: () => boolean;
  onPlateItem: (recipeId: RecipeId) => boolean;
  onStationMessage: (x: number, y: number, text: string, color: string) => void;
  getNeededDrinkRecipe: () => RecipeId;
}

export class PrepStationDock extends BaseEntity {
  private readonly store: GameStateStore;
  private readonly callbacks: PrepStationCallbacks;
  private unsubscribers: Array<() => void> = [];

  // --- 1. Drinks Station (Teh Tarik + Milo Ais + Ane Helper) ---
  private selectedDrinkRecipe: RecipeId = 'teh_tarik';
  private tehStage: TehTarikStage = 'idle';
  private tehFillElapsedMs = 0;
  private readonly TEH_FILL_DURATION_MS = 1500;
  private aneAutoCooldownMs = 600;

  private drinkSelectorBtn!: Phaser.GameObjects.Rectangle;
  private drinkSelectorText!: Phaser.GameObjects.Text;
  private aneHelperBadge!: Phaser.GameObjects.Text;
  private kettleContainer!: Phaser.GameObjects.Container;
  private cupContainer!: Phaser.GameObjects.Container;
  private cupVisualGfx!: Phaser.GameObjects.Graphics;
  private tehStreamGfx!: Phaser.GameObjects.Graphics;
  private tehProgressFill!: Phaser.GameObjects.Graphics;
  private tehStatusText!: Phaser.GameObjects.Text;
  private kettleBadge!: Phaser.GameObjects.Text;
  private cupBadge!: Phaser.GameObjects.Text;

  // --- 2. Food / Griddle Station (1 slot in Tier 1, 2 slots in Tier 2+) ---
  private selectedFoodRecipe: RecipeId = 'roti_canai';
  private readonly ROTI_COOK_DURATION_MS = 3000;
  private readonly ROTI_BURN_DURATION_MS = 3000;

  private griddleSlots: [GriddleSlotState, GriddleSlotState] = [
    { stage: 'idle', timerMs: 0, recipeId: 'roti_canai' },
    { stage: 'idle', timerMs: 0, recipeId: 'roti_canai' },
  ];

  private foodSelectorBtn!: Phaser.GameObjects.Rectangle;
  private foodSelectorText!: Phaser.GameObjects.Text;
  private doughContainer!: Phaser.GameObjects.Container;
  private doughBadge!: Phaser.GameObjects.Text;

  private griddleSlotContainers: Phaser.GameObjects.Container[] = [];
  private griddleSlotHitBgs: Phaser.GameObjects.Rectangle[] = [];
  private griddleSlotGfx: Phaser.GameObjects.Graphics[] = [];
  private griddleSlotBadges: Phaser.GameObjects.Text[] = [];
  private griddleSlotBars: Phaser.GameObjects.Graphics[] = [];

  private rotiStatusText!: Phaser.GameObjects.Text;

  private readonly DOCK_X = 12;
  private readonly DOCK_Y = 516;
  private readonly DOCK_W = GAME_WIDTH - 24;
  private readonly DOCK_H = 314;

  constructor(
    scene: Phaser.Scene,
    store: GameStateStore,
    callbacks: PrepStationCallbacks
  ) {
    super(scene, 0, 0);
    this.store = store;
    this.callbacks = callbacks;

    this.buildDockShell();
    this.buildTehTarikStation();
    this.buildRotiCanaiStation();

    this.unsubscribers.push(
      this.store.on('tierChanged', () => {
        this.syncTehVisuals();
        this.syncRotiVisuals();
      }),
      this.store.on('recipeUnlocked', () => {
        this.syncTehVisuals();
        this.syncRotiVisuals();
      })
    );

    this.syncTehVisuals();
    this.syncRotiVisuals();
  }

  private buildDockShell(): void {
    const bg = this.scene.add.graphics();

    bg.fillStyle(0x1e293b, 0.98);
    bg.fillRoundedRect(this.DOCK_X, this.DOCK_Y, this.DOCK_W, this.DOCK_H, 14);
    bg.lineStyle(2.5, 0x94a3b8, 1);
    bg.strokeRoundedRect(this.DOCK_X, this.DOCK_Y, this.DOCK_W, this.DOCK_H, 14);

    bg.fillStyle(0xfacc15, 1);
    bg.fillRoundedRect(this.DOCK_X + 2, this.DOCK_Y + 2, this.DOCK_W - 4, 28, {
      tl: 12,
      tr: 12,
      bl: 0,
      br: 0,
    });

    bg.lineStyle(2, 0x475569, 0.9);
    bg.lineBetween(
      GAME_WIDTH / 2,
      this.DOCK_Y + 30,
      GAME_WIDTH / 2,
      this.DOCK_Y + this.DOCK_H - 6
    );

    this.add(bg);

    const headerTitle = this.scene.add
      .text(GAME_WIDTH / 2, this.DOCK_Y + 16, 'PREP STATION DOCK', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#1c1917',
      })
      .setOrigin(0.5);
    this.add(headerTitle);
  }

  // =========================================================================
  // 1. TEH TARIK / DRINKS STATION (Left Half: x = 20..190)
  // =========================================================================

  private buildTehTarikStation(): void {
    const leftCenterX = 104;
    const topY = this.DOCK_Y + 36;

    // Recipe selector button (cycles Teh Tarik / Milo Ais when unlocked)
    this.drinkSelectorBtn = this.scene.add
      .rectangle(leftCenterX, topY + 12, 154, 22, 0x0f172a, 1)
      .setStrokeStyle(1, 0xfacc15, 0.85)
      .setInteractive({ useHandCursor: true });
    this.add(this.drinkSelectorBtn);

    this.drinkSelectorText = this.scene.add
      .text(leftCenterX, topY + 12, 'DRINK: TEH TARIK', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#fef08a',
      })
      .setOrigin(0.5);
    this.add(this.drinkSelectorText);

    this.drinkSelectorBtn.on('pointerdown', () => {
      const unlockedDrinks = this.store
        .getState()
        .unlockedRecipes.filter((id) => getRecipeDef(id).category === 'drink');
      if (unlockedDrinks.length <= 1) return;
      const idx = unlockedDrinks.indexOf(this.selectedDrinkRecipe);
      this.selectedDrinkRecipe = unlockedDrinks[(idx + 1) % unlockedDrinks.length];
      this.syncTehVisuals();
    });

    // Ane Helper Indicator Badge (Tier 3)
    this.aneHelperBadge = this.scene.add
      .text(leftCenterX, topY + 29, '🤖 ANE HELPER: AUTO-BREWING', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '8.5px',
        fontStyle: 'bold',
        color: '#4ade80',
      })
      .setOrigin(0.5)
      .setVisible(false);
    this.add(this.aneHelperBadge);

    // --- Interactive Element A: Kettle (Logical 104, 616) ---
    this.kettleContainer = this.scene.add.container(leftCenterX, topY + 64);
    const kettleHitBg = this.scene.add
      .rectangle(0, 0, 152, 68, 0x334155, 1)
      .setStrokeStyle(1.5, 0x94a3b8, 0.9)
      .setInteractive({ useHandCursor: true });

    const kettleGfx = this.scene.add.graphics();
    kettleGfx.fillStyle(0xcbd5e1, 1);
    kettleGfx.fillRoundedRect(-38, -20, 42, 40, 6);
    kettleGfx.lineStyle(2, 0x475569, 1);
    kettleGfx.strokeRoundedRect(-38, -20, 42, 40, 6);
    kettleGfx.lineStyle(4, 0xe2e8f0, 1);
    kettleGfx.lineBetween(4, 4, 20, -12);
    kettleGfx.lineStyle(3, 0xfacc15, 1);
    kettleGfx.strokeRoundedRect(-48, -12, 10, 24, 3);
    kettleGfx.fillStyle(0xf59e0b, 1);
    kettleGfx.fillCircle(-17, -23, 4);

    const kettleLabel = this.scene.add
      .text(36, -10, '1. KETTLE', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#f8fafc',
      })
      .setOrigin(0.5);

    this.kettleBadge = this.scene.add
      .text(36, 12, 'TAP TO POUR', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '9px',
        fontStyle: 'bold',
        color: '#1c1917',
        backgroundColor: '#facc15',
        padding: { x: 6, y: 3 },
      })
      .setOrigin(0.5);

    this.kettleContainer.add([kettleHitBg, kettleGfx, kettleLabel, this.kettleBadge]);
    this.add(this.kettleContainer);

    kettleHitBg.on('pointerdown', () => {
      this.handleKettleTap();
    });

    this.tehStreamGfx = this.scene.add.graphics();
    this.add(this.tehStreamGfx);

    // --- Interactive Element B: Tea Cup (Logical 104, 712) ---
    this.cupContainer = this.scene.add.container(leftCenterX, topY + 158);
    const cupHitBg = this.scene.add
      .rectangle(0, 0, 152, 78, 0x334155, 1)
      .setStrokeStyle(1.5, 0x94a3b8, 0.9)
      .setInteractive({ useHandCursor: true });

    this.cupVisualGfx = this.scene.add.graphics();

    const cupLabel = this.scene.add
      .text(34, -14, '2. TEA CUP', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#f8fafc',
      })
      .setOrigin(0.5);

    this.cupBadge = this.scene.add
      .text(34, 12, 'EMPTY', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '9px',
        fontStyle: 'bold',
        color: '#94a3b8',
        backgroundColor: '#0f172a',
        padding: { x: 6, y: 3 },
      })
      .setOrigin(0.5);

    this.cupContainer.add([cupHitBg, this.cupVisualGfx, cupLabel, this.cupBadge]);
    this.add(this.cupContainer);

    cupHitBg.on('pointerdown', () => {
      this.handleCupTap();
    });

    // Progress bar & status footer
    const barTrack = this.scene.add.graphics();
    barTrack.fillStyle(0x0f172a, 1);
    barTrack.fillRoundedRect(28, topY + 214, 152, 12, 6);
    barTrack.lineStyle(1, 0x64748b, 1);
    barTrack.strokeRoundedRect(28, topY + 214, 152, 12, 6);
    this.add(barTrack);

    this.tehProgressFill = this.scene.add.graphics();
    this.add(this.tehProgressFill);

    this.tehStatusText = this.scene.add
      .text(leftCenterX, topY + 244, 'Tap Kettle to fill cup (1.5s)', {
        fontFamily: 'monospace',
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#cbd5e1',
      })
      .setOrigin(0.5);
    this.add(this.tehStatusText);
  }

  private handleKettleTap(): void {
    if (this.tehStage !== 'idle') return;

    this.tehStage = 'filling';
    this.tehFillElapsedMs = 0;

    this.scene.tweens.add({
      targets: this.kettleContainer,
      angle: 10,
      duration: 180,
      yoyo: true,
    });
    this.syncTehVisuals();
  }

  private handleCupTap(): void {
    if (this.tehStage !== 'filled') return;

    if (!this.callbacks.canAddToServingTray()) {
      this.callbacks.onStationMessage(
        this.cupContainer.x,
        this.cupContainer.y - 30,
        'Serving Tray Full (Max 3)!',
        '#f87171'
      );
      return;
    }

    this.tehStage = 'pulling';
    this.syncTehVisuals();

    const drinkToPlate = this.selectedDrinkRecipe;
    const def = getRecipeDef(drinkToPlate);

    this.scene.tweens.add({
      targets: this.cupContainer,
      y: this.cupContainer.y - 12,
      scaleY: 1.08,
      duration: 140,
      yoyo: true,
      onComplete: () => {
        const plated = this.callbacks.onPlateItem(drinkToPlate);
        if (plated) {
          this.callbacks.onStationMessage(
            this.cupContainer.x,
            this.cupContainer.y - 25,
            `${def.shortName} Ready! → Tray`,
            '#4ade80'
          );
          this.tehStage = 'idle';
          this.tehFillElapsedMs = 0;
        } else {
          this.tehStage = 'filled';
        }
        this.syncTehVisuals();
      },
    });
  }

  private syncTehVisuals(): void {
    const topY = this.DOCK_Y + 36;
    const state = this.store.getState();
    const unlockedDrinks = state.unlockedRecipes.filter(
      (id) => getRecipeDef(id).category === 'drink'
    );
    const def = getRecipeDef(this.selectedDrinkRecipe);

    this.drinkSelectorText.setText(
      unlockedDrinks.length > 1
        ? `🔄 DRINK: ${def.name.toUpperCase()}`
        : `DRINK: ${def.name.toUpperCase()}`
    );
    this.aneHelperBadge.setVisible(state.hasAneHelper);

    this.cupVisualGfx.clear();
    this.tehStreamGfx.clear();
    this.tehProgressFill.clear();

    const fillRatio =
      this.tehStage === 'filling'
        ? Math.min(1, this.tehFillElapsedMs / this.TEH_FILL_DURATION_MS)
        : this.tehStage === 'filled' || this.tehStage === 'pulling'
        ? 1
        : 0;

    const cx = -28;
    const cy = 2;
    this.cupVisualGfx.lineStyle(2.5, 0xcbd5e1, 1);
    this.cupVisualGfx.strokeCircle(cx + 14, cy, 7);

    this.cupVisualGfx.fillStyle(0x1e293b, 1);
    this.cupVisualGfx.fillRoundedRect(cx - 14, cy - 18, 28, 36, 4);

    const liquidColor =
      this.selectedDrinkRecipe === 'milo_ais' ? 0x3e2723 : 0xc27838;

    if (fillRatio > 0) {
      const liquidH = Math.max(4, 32 * fillRatio);
      this.cupVisualGfx.fillStyle(liquidColor, 1);
      this.cupVisualGfx.fillRoundedRect(cx - 13, cy + 17 - liquidH, 26, liquidH, 3);
    }

    if (this.tehStage === 'filled' || this.tehStage === 'pulling') {
      this.cupVisualGfx.fillStyle(
        this.selectedDrinkRecipe === 'milo_ais' ? 0x22c55e : 0xfef3c7,
        1
      );
      this.cupVisualGfx.fillRoundedRect(cx - 15, cy - 20, 30, 7, 3);
    }

    this.cupVisualGfx.lineStyle(2, 0xe2e8f0, 1);
    this.cupVisualGfx.strokeRoundedRect(cx - 14, cy - 18, 28, 36, 4);

    if (this.tehStage === 'idle') {
      this.kettleBadge
        .setText('TAP TO POUR')
        .setBackgroundColor('#facc15')
        .setColor('#1c1917');
      this.cupBadge
        .setText('EMPTY')
        .setBackgroundColor('#0f172a')
        .setColor('#94a3b8');
      this.tehStatusText
        .setText(
          state.hasAneHelper
            ? 'Ane Helper auto-brewing...'
            : '1. Tap Kettle to fill (1.5s)'
        )
        .setColor('#cbd5e1');
    } else if (this.tehStage === 'filling') {
      this.kettleBadge
        .setText('POURING...')
        .setBackgroundColor('#0284c7')
        .setColor('#ffffff');
      this.cupBadge
        .setText(`${Math.round(fillRatio * 100)}%`)
        .setBackgroundColor('#0f172a')
        .setColor('#38bdf8');
      this.tehStatusText.setText(`Filling ${def.shortName}...`).setColor('#38bdf8');

      this.tehStreamGfx.lineStyle(4, liquidColor, 0.95);
      this.tehStreamGfx.lineBetween(76, topY + 88, 76, topY + 144);

      this.tehProgressFill.fillStyle(0x38bdf8, 1);
      this.tehProgressFill.fillRoundedRect(
        28,
        topY + 214,
        Math.max(4, 152 * fillRatio),
        12,
        6
      );
    } else if (this.tehStage === 'filled' || this.tehStage === 'pulling') {
      this.kettleBadge
        .setText('CUP FULL')
        .setBackgroundColor('#475569')
        .setColor('#cbd5e1');
      this.cupBadge
        .setText("TAP TO 'TARIK'!")
        .setBackgroundColor('#16a34a')
        .setColor('#fef08a');
      this.tehStatusText
        .setText("2. Tap Cup to 'Tarik' → Tray!")
        .setColor('#4ade80');

      this.tehProgressFill.fillStyle(0x22c55e, 1);
      this.tehProgressFill.fillRoundedRect(28, topY + 214, 152, 12, 6);
    }
  }

  // =========================================================================
  // 2. ROTI CANAI / HOT KITCHEN STATION (Right Half: x = 200..370)
  // =========================================================================

  private buildRotiCanaiStation(): void {
    const rightCenterX = 286;
    const topY = this.DOCK_Y + 36;

    // Recipe selector button (cycles Roti Canai / Maggi Goreng / Roti Telur / Nasi Kandar)
    this.foodSelectorBtn = this.scene.add
      .rectangle(rightCenterX, topY + 12, 154, 22, 0x0f172a, 1)
      .setStrokeStyle(1, 0xfacc15, 0.85)
      .setInteractive({ useHandCursor: true });
    this.add(this.foodSelectorBtn);

    this.foodSelectorText = this.scene.add
      .text(rightCenterX, topY + 12, 'DISH: ROTI CANAI', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#fef08a',
      })
      .setOrigin(0.5);
    this.add(this.foodSelectorText);

    this.foodSelectorBtn.on('pointerdown', () => {
      const unlockedFoods = this.store
        .getState()
        .unlockedRecipes.filter((id) => getRecipeDef(id).category === 'food');
      if (unlockedFoods.length <= 1) return;
      const idx = unlockedFoods.indexOf(this.selectedFoodRecipe);
      this.selectedFoodRecipe = unlockedFoods[(idx + 1) % unlockedFoods.length];
      this.syncRotiVisuals();
    });

    // --- Interactive Element A: Dough / Prep Tray (Logical 286, 616) ---
    this.doughContainer = this.scene.add.container(rightCenterX, topY + 64);
    const doughHitBg = this.scene.add
      .rectangle(0, 0, 152, 68, 0x334155, 1)
      .setStrokeStyle(1.5, 0x94a3b8, 0.9)
      .setInteractive({ useHandCursor: true });

    const doughGfx = this.scene.add.graphics();
    doughGfx.fillStyle(0x94a3b8, 1);
    doughGfx.fillRoundedRect(-64, -18, 54, 36, 6);
    doughGfx.lineStyle(1.5, 0xe2e8f0, 0.9);
    doughGfx.strokeRoundedRect(-64, -18, 54, 36, 6);

    doughGfx.fillStyle(0xfef3c7, 1);
    doughGfx.fillCircle(-46, -5, 8);
    doughGfx.fillCircle(-28, -5, 8);
    doughGfx.fillCircle(-37, 7, 8);

    const doughLabel = this.scene.add
      .text(28, -10, '1. DOUGH / PREP', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#f8fafc',
      })
      .setOrigin(0.5);

    this.doughBadge = this.scene.add
      .text(28, 12, 'TAP DOUGH', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '9px',
        fontStyle: 'bold',
        color: '#1c1917',
        backgroundColor: '#facc15',
        padding: { x: 6, y: 3 },
      })
      .setOrigin(0.5);

    this.doughContainer.add([doughHitBg, doughGfx, doughLabel, this.doughBadge]);
    this.add(this.doughContainer);

    doughHitBg.on('pointerdown', () => {
      this.handleDoughTap();
    });

    // --- Interactive Element B: Griddle Slots (1 in Tier 1, 2 side-by-side in Tier 2+) ---
    for (let i = 0; i < 2; i++) {
      const slotContainer = this.scene.add.container(rightCenterX, topY + 158);
      const hitBg = this.scene.add
        .rectangle(0, 0, 152, 78, 0x334155, 1)
        .setStrokeStyle(1.5, 0x94a3b8, 0.9)
        .setInteractive({ useHandCursor: true });

      const gfx = this.scene.add.graphics();
      const badge = this.scene.add
        .text(0, 22, 'EMPTY', {
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: '8.5px',
          fontStyle: 'bold',
          color: '#94a3b8',
          backgroundColor: '#0f172a',
          padding: { x: 5, y: 2.5 },
        })
        .setOrigin(0.5);

      const barGfx = this.scene.add.graphics();

      slotContainer.add([hitBg, gfx, badge, barGfx]);
      this.add(slotContainer);

      hitBg.on('pointerdown', () => {
        this.handleGriddleSlotTap(i);
      });

      this.griddleSlotContainers.push(slotContainer);
      this.griddleSlotHitBgs.push(hitBg);
      this.griddleSlotGfx.push(gfx);
      this.griddleSlotBadges.push(badge);
      this.griddleSlotBars.push(barGfx);
    }

    this.rotiStatusText = this.scene.add
      .text(rightCenterX, topY + 244, '1. Tap Dough → Griddle', {
        fontFamily: 'monospace',
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#cbd5e1',
      })
      .setOrigin(0.5);
    this.add(this.rotiStatusText);
  }

  private handleDoughTap(): void {
    const cap = this.store.getState().griddleCapacity;

    // Find first idle slot (or burned slot to reset) within griddleCapacity
    let targetSlotIdx = -1;
    for (let i = 0; i < cap; i++) {
      if (this.griddleSlots[i].stage === 'idle') {
        targetSlotIdx = i;
        break;
      }
    }
    if (targetSlotIdx === -1) {
      for (let i = 0; i < cap; i++) {
        if (this.griddleSlots[i].stage === 'burned') {
          targetSlotIdx = i;
          break;
        }
      }
    }

    if (targetSlotIdx === -1) return;

    this.griddleSlots[targetSlotIdx] = {
      stage: 'cooking',
      timerMs: 0,
      recipeId: this.selectedFoodRecipe,
    };

    this.scene.tweens.add({
      targets: this.doughContainer,
      scaleX: 0.95,
      scaleY: 0.95,
      duration: 90,
      yoyo: true,
    });
    this.syncRotiVisuals();
  }

  private handleGriddleSlotTap(slotIdx: number): void {
    const slot = this.griddleSlots[slotIdx];
    const container = this.griddleSlotContainers[slotIdx];

    if (slot.stage === 'ready_to_flip') {
      slot.stage = 'cooked';
      slot.timerMs = 0;
      this.scene.tweens.add({
        targets: container,
        scaleY: 1.08,
        duration: 120,
        yoyo: true,
      });
      this.callbacks.onStationMessage(
        container.x,
        container.y - 26,
        'Flipped! Tap to Plate w/ Dhal',
        '#facc15'
      );
      this.syncRotiVisuals();
      return;
    }

    if (slot.stage === 'cooked') {
      if (!this.callbacks.canAddToServingTray()) {
        this.callbacks.onStationMessage(
          container.x,
          container.y - 30,
          'Serving Tray Full (Max 3)!',
          '#f87171'
        );
        return;
      }

      const def = getRecipeDef(slot.recipeId);
      const plated = this.callbacks.onPlateItem(slot.recipeId);
      if (plated) {
        this.callbacks.onStationMessage(
          container.x,
          container.y - 25,
          `${def.shortName} Plated! → Tray`,
          '#4ade80'
        );
        slot.stage = 'idle';
        slot.timerMs = 0;
        this.syncRotiVisuals();
      }
      return;
    }

    if (slot.stage === 'burned') {
      slot.stage = 'idle';
      slot.timerMs = 0;
      this.callbacks.onStationMessage(
        container.x,
        container.y - 25,
        'Cleared burnt dish',
        '#cbd5e1'
      );
      this.syncRotiVisuals();
    }
  }

  private syncRotiVisuals(): void {
    const topY = this.DOCK_Y + 36;
    const rightCenterX = 286;
    const state = this.store.getState();
    const cap = state.griddleCapacity;

    const unlockedFoods = state.unlockedRecipes.filter(
      (id) => getRecipeDef(id).category === 'food'
    );
    const selectedDef = getRecipeDef(this.selectedFoodRecipe);
    this.foodSelectorText.setText(
      unlockedFoods.length > 1
        ? `🔄 DISH: ${selectedDef.name.toUpperCase()}`
        : `DISH: ${selectedDef.name.toUpperCase()}`
    );

    const hasIdleSlot = this.griddleSlots
      .slice(0, cap)
      .some((s) => s.stage === 'idle' || s.stage === 'burned');
    if (hasIdleSlot) {
      this.doughBadge
        .setText(`TAP (${cap}x GRIDDLE)`)
        .setBackgroundColor('#facc15')
        .setColor('#1c1917');
    } else {
      this.doughBadge
        .setText('GRIDDLE FULL')
        .setBackgroundColor('#475569')
        .setColor('#cbd5e1');
    }

    // Layout 1 single wide griddle card (Tier 1) OR 2 side-by-side griddle slots (Tier 2+)
    for (let i = 0; i < 2; i++) {
      const container = this.griddleSlotContainers[i];
      const hitBg = this.griddleSlotHitBgs[i];
      const gfx = this.griddleSlotGfx[i];
      const badge = this.griddleSlotBadges[i];
      const bar = this.griddleSlotBars[i];
      const slot = this.griddleSlots[i];

      if (i >= cap) {
        container.setVisible(false);
        continue;
      }
      container.setVisible(true);

      const cardW = cap === 1 ? 152 : 72;
      const cardX =
        cap === 1 ? rightCenterX : rightCenterX + (i === 0 ? -40 : 40);
      container.setPosition(cardX, topY + 158);
      hitBg.setSize(cardW, 78);

      gfx.clear();
      bar.clear();

      // Cast-iron pan circle
      const panX = cap === 1 ? -34 : 0;
      const panY = cap === 1 ? 0 : -12;
      const panR = cap === 1 ? 25 : 19;

      gfx.fillStyle(0x0f172a, 1);
      gfx.fillCircle(panX, panY, panR);
      gfx.lineStyle(2, 0x64748b, 1);
      gfx.strokeCircle(panX, panY, panR);

      badge.setPosition(cap === 1 ? 30 : 0, cap === 1 ? 0 : 21);

      // Mini progress bar at bottom of slot card
      const barW = cardW - 14;
      const barX = -barW / 2;
      const barY = 30;
      bar.fillStyle(0x0f172a, 1);
      bar.fillRoundedRect(barX, barY, barW, 6, 3);

      if (slot.stage === 'idle') {
        badge
          .setText(cap === 1 ? '2. GRIDDLE' : `SLOT ${i + 1}`)
          .setBackgroundColor('#0f172a')
          .setColor('#94a3b8');
      } else if (slot.stage === 'cooking') {
        const ratio = Math.min(1, slot.timerMs / this.ROTI_COOK_DURATION_MS);
        gfx.fillStyle(0xfef3c7, 1);
        gfx.fillCircle(panX, panY, panR - 5);
        badge
          .setText(`${Math.round(ratio * 100)}%`)
          .setBackgroundColor('#0284c7')
          .setColor('#ffffff');
        bar.fillStyle(0x38bdf8, 1);
        bar.fillRoundedRect(barX, barY, Math.max(3, barW * ratio), 6, 3);
      } else if (slot.stage === 'ready_to_flip') {
        const burnRem = Math.max(
          0,
          1 - slot.timerMs / this.ROTI_BURN_DURATION_MS
        );
        gfx.fillStyle(0xfacc15, 1);
        gfx.fillCircle(panX, panY, panR - 4);
        badge
          .setText('FLIP!')
          .setBackgroundColor('#ea580c')
          .setColor('#fef08a');
        bar.fillStyle(0xf97316, 1);
        bar.fillRoundedRect(barX, barY, Math.max(3, barW * burnRem), 6, 3);
      } else if (slot.stage === 'cooked') {
        Customer.drawFoodIcon(gfx, slot.recipeId, panX, panY, cap === 1 ? 0.85 : 0.7);
        badge
          .setText('PLATE!')
          .setBackgroundColor('#16a34a')
          .setColor('#fef08a');
        bar.fillStyle(0x22c55e, 1);
        bar.fillRoundedRect(barX, barY, barW, 6, 3);
      } else if (slot.stage === 'burned') {
        gfx.fillStyle(0x1c1917, 1);
        gfx.fillCircle(panX, panY, panR - 4);
        gfx.lineStyle(1.5, 0xef4444, 1);
        gfx.strokeCircle(panX, panY, panR - 4);
        badge
          .setText('BURNED')
          .setBackgroundColor('#dc2626')
          .setColor('#ffffff');
        bar.fillStyle(0xef4444, 1);
        bar.fillRoundedRect(barX, barY, barW, 6, 3);
      }
    }

    // Status summary text at bottom right
    const activeSlots = this.griddleSlots.slice(0, cap);
    const flipping = activeSlots.find((s) => s.stage === 'ready_to_flip');
    const cooked = activeSlots.find((s) => s.stage === 'cooked');
    const cooking = activeSlots.find((s) => s.stage === 'cooking');

    if (flipping) {
      const sec = Math.max(
        0,
        (this.ROTI_BURN_DURATION_MS - flipping.timerMs) / 1000
      ).toFixed(1);
      this.rotiStatusText
        .setText(`⚠️ FLIP NOW! Burns in ${sec}s`)
        .setColor('#fb923c');
    } else if (cooked) {
      this.rotiStatusText
        .setText('Tap Griddle → Plate to Tray!')
        .setColor('#4ade80');
    } else if (cooking) {
      this.rotiStatusText
        .setText(`Cooking (${cap}x griddle)...`)
        .setColor('#38bdf8');
    } else {
      this.rotiStatusText
        .setText(`Tap Dough → Griddle (${cap} slot${cap > 1 ? 's' : ''})`)
        .setColor('#cbd5e1');
    }
  }

  public updateEntity(_time: number, delta: number): void {
    const state = this.store.getState();

    // --- Ane Helper (Tier 3 Auto-Brews Drinks onto Serving Tray) ---
    if (state.hasAneHelper) {
      if (this.tehStage === 'idle' && this.callbacks.canAddToServingTray()) {
        this.aneAutoCooldownMs -= delta;
        if (this.aneAutoCooldownMs <= 0) {
          this.selectedDrinkRecipe = this.callbacks.getNeededDrinkRecipe();
          this.handleKettleTap();
          this.aneAutoCooldownMs = 500;
        }
      } else if (
        this.tehStage === 'filled' &&
        this.callbacks.canAddToServingTray()
      ) {
        this.handleCupTap();
      }
    }

    // 1. Update Teh Tarik / Drink fill timer (1.5s)
    if (this.tehStage === 'filling') {
      this.tehFillElapsedMs += delta;
      if (this.tehFillElapsedMs >= this.TEH_FILL_DURATION_MS) {
        this.tehFillElapsedMs = this.TEH_FILL_DURATION_MS;
        this.tehStage = 'filled';
      }
      this.syncTehVisuals();
    }

    // 2. Update Griddle Slots (1 or 2 slots depending on Tier)
    const cap = state.griddleCapacity;
    let rotiChanged = false;
    for (let i = 0; i < cap; i++) {
      const slot = this.griddleSlots[i];
      if (slot.stage === 'cooking') {
        slot.timerMs += delta;
        if (slot.timerMs >= this.ROTI_COOK_DURATION_MS) {
          slot.stage = 'ready_to_flip';
          slot.timerMs = 0;
        }
        rotiChanged = true;
      } else if (slot.stage === 'ready_to_flip') {
        slot.timerMs += delta;
        if (slot.timerMs >= this.ROTI_BURN_DURATION_MS) {
          slot.stage = 'burned';
          slot.timerMs = 0;
          this.callbacks.onStationMessage(
            this.griddleSlotContainers[i].x,
            this.griddleSlotContainers[i].y - 25,
            '🔥 Dish Burned!',
            '#f87171'
          );
        }
        rotiChanged = true;
      }
    }
    if (rotiChanged) {
      this.syncRotiVisuals();
    }
  }

  public override destroy(fromScene?: boolean): void {
    this.unsubscribers.forEach((u) => u());
    this.unsubscribers = [];
    super.destroy(fromScene);
  }
}
