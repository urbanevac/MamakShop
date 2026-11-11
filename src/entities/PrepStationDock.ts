import Phaser from 'phaser';
import { BaseEntity } from './BaseEntity';
import { GameStateStore, RecipeId } from '../state/GameState';
import { Customer } from './Customer';
import { getRecipeDef } from '../config/recipes';
import { GAME_WIDTH } from '../config/constants';
import { haptic, HAPTIC } from '../utils/haptics';

export type TehTarikStage = 'idle' | 'filling' | 'filled' | 'pulling';
export type RotiCanaiStage = 'idle' | 'cooking' | 'ready_to_flip' | 'cooked' | 'burned';

interface GriddleSlotState {
  stage: RotiCanaiStage;
  timerMs: number;
  recipeId: RecipeId;
  isPadu: boolean;
}

export interface PrepStationCallbacks {
  canAddToServingTray: () => boolean;
  canAneAutoBrewDrink: () => boolean;
  onPlateItem: (recipeId: RecipeId, isPadu?: boolean) => boolean;
  onStationMessage: (x: number, y: number, text: string, color: string) => void;
  getNeededDrinkRecipe: () => RecipeId;
  /** Gameplay milestones consumed by the first-shift tutorial. */
  onStationEvent?: (event: StationEvent) => void;
}

export type StationEvent =
  | 'kettle_tapped'
  | 'drink_filled'
  | 'drink_plated'
  | 'dough_tapped'
  | 'roti_ready_to_flip'
  | 'roti_flipped'
  | 'roti_burned'
  | 'food_plated';

export type StationTarget = 'kettle' | 'cup' | 'dough' | 'griddle';

export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class PrepStationDock extends BaseEntity {
  private readonly store: GameStateStore;
  private readonly callbacks: PrepStationCallbacks;
  private unsubscribers: Array<() => void> = [];

  // --- 1. Drinks Station (Teh Tarik + Milo Ais + Ane Helper) ---
  private selectedDrinkRecipe: RecipeId = 'teh_tarik';
  private demandCounts: Partial<Record<RecipeId, number>> = {};
  private demandKey = '';
  private tehStage: TehTarikStage = 'idle';
  private tehFillElapsedMs = 0;
  private readonly TEH_FILL_DURATION_MS = 1500;
  private aneAutoCooldownMs = 600;

  private drinkPillsContainer!: Phaser.GameObjects.Container;
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
  /** Tutorial mode doubles the flip window so new players aren't punished while learning. */
  private burnMultiplier = 1;
  /** Suspends the Ane Helper auto-brewer (used during the tutorial). */
  private aneSuspended = false;
  /** Tracks which griddle slots already fired the "about to burn" haptic. */
  private burnWarned: [boolean, boolean] = [false, false];

  private griddleSlots: [GriddleSlotState, GriddleSlotState] = [
    { stage: 'idle', timerMs: 0, recipeId: 'roti_canai', isPadu: false },
    { stage: 'idle', timerMs: 0, recipeId: 'roti_canai', isPadu: false },
  ];

  private foodPillsContainer!: Phaser.GameObjects.Container;
  private doughContainer!: Phaser.GameObjects.Container;
  private doughBadge!: Phaser.GameObjects.Text;

  private griddleSlotContainers: Phaser.GameObjects.Container[] = [];
  private griddleSlotHitBgs: Phaser.GameObjects.Rectangle[] = [];
  private griddleSlotGfx: Phaser.GameObjects.Graphics[] = [];
  private griddleSlotBadges: Phaser.GameObjects.Text[] = [];
  private griddleSlotBars: Phaser.GameObjects.Graphics[] = [];

  private rotiStatusText!: Phaser.GameObjects.Text;

  private readonly DOCK_X = 12;
  private readonly DOCK_Y = 454;
  private readonly DOCK_W = GAME_WIDTH - 24;
  private readonly DOCK_H = 256;

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
        this.rebuildRecipePills();
        this.syncTehVisuals();
        this.syncRotiVisuals();
      }),
      this.store.on('recipeUnlocked', () => {
        this.rebuildRecipePills();
        this.syncTehVisuals();
        this.syncRotiVisuals();
      })
    );

    this.rebuildRecipePills();
    this.syncTehVisuals();
    this.syncRotiVisuals();
  }

  // =========================================================================
  // Tutorial / UX helpers
  // =========================================================================

  private getDrinkFillDurationMs(recipeId = this.selectedDrinkRecipe): number {
    const baseMs = getRecipeDef(recipeId).prepTimeMs || this.TEH_FILL_DURATION_MS;
    const mult = this.store.getState().hasTermosAir ? 0.7 : 1.0;
    return Math.round(baseMs * mult);
  }

  private getFoodCookDurationMs(recipeId: RecipeId): number {
    const baseMs = getRecipeDef(recipeId).prepTimeMs || this.ROTI_COOK_DURATION_MS;
    const mult = this.store.getState().hasTurboKuali ? 0.75 : 1.0;
    return Math.round(baseMs * mult);
  }

  private getFoodBurnDurationMs(recipeId: RecipeId): number {
    const baseBurn = getRecipeDef(recipeId).burnWindowMs ?? this.ROTI_BURN_DURATION_MS;
    return Math.round(baseBurn * this.burnMultiplier);
  }

  private emitStationEvent(event: StationEvent): void {
    this.callbacks.onStationEvent?.(event);
  }

  /** Enables the forgiving tutorial mode: slower burn, Ane Helper off, default recipes selected. */
  public setTutorialMode(active: boolean): void {
    this.burnMultiplier = active ? 2 : 1;
    this.aneSuspended = active;
    if (active) {
      this.selectedDrinkRecipe = 'teh_tarik';
      this.selectedFoodRecipe = 'roti_canai';
      this.rebuildRecipePills();
    }
    this.syncTehVisuals();
    this.syncRotiVisuals();
  }

  /** World-space rectangle of an interactive station card (for tutorial spotlights). */
  public getTargetRect(target: StationTarget): ScreenRect {
    switch (target) {
      case 'kettle':
        return { x: 26, y: 525, w: 156, h: 58 };
      case 'cup':
        return { x: 26, y: 592, w: 156, h: 68 };
      case 'dough':
        return { x: 208, y: 525, w: 156, h: 58 };
      case 'griddle':
        return { x: 208, y: 592, w: 156, h: 68 };
    }
  }

  private buildDockShell(): void {
    const bg = this.scene.add.graphics();

    // Outer drop shadow + brushed dark slate stainless steel dock
    bg.fillStyle(0x090d16, 0.7);
    bg.fillRoundedRect(this.DOCK_X, this.DOCK_Y + 4, this.DOCK_W, this.DOCK_H, 14);

    bg.fillStyle(0x1e293b, 0.99);
    bg.fillRoundedRect(this.DOCK_X, this.DOCK_Y, this.DOCK_W, this.DOCK_H, 14);
    bg.lineStyle(2.5, 0x94a3b8, 1);
    bg.strokeRoundedRect(this.DOCK_X, this.DOCK_Y, this.DOCK_W, this.DOCK_H, 14);

    // Golden Mamak header bar
    bg.fillStyle(0xfacc15, 1);
    bg.fillRoundedRect(this.DOCK_X + 2, this.DOCK_Y + 2, this.DOCK_W - 4, 26, {
      tl: 12,
      tr: 12,
      bl: 0,
      br: 0,
    });

    // Center divider between Drink Station and Food Station
    bg.lineStyle(2, 0x334155, 1);
    bg.lineBetween(
      GAME_WIDTH / 2,
      this.DOCK_Y + 28,
      GAME_WIDTH / 2,
      this.DOCK_Y + this.DOCK_H - 6
    );

    this.add(bg);

    const headerTitle = this.scene.add
      .text(GAME_WIDTH / 2, this.DOCK_Y + 15, 'PREP STATION DOCK', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '11.5px',
        fontStyle: 'bold',
        color: '#1c1917',
      })
      .setOrigin(0.5);
    this.add(headerTitle);

    // Ane Helper badge mounted cleanly inside the top-left of the yellow dock header bar
    this.aneHelperBadge = this.scene.add
      .text(22, this.DOCK_Y + 15, '🤖 ANE AUTO', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '8.5px',
        fontStyle: 'bold',
        color: '#fef08a',
        backgroundColor: '#15803d',
        padding: { x: 5, y: 2 },
      })
      .setOrigin(0, 0.5)
      .setVisible(false);
    this.add(this.aneHelperBadge);
  }

  /**
   * Updates live order demand counts (e.g. { teh_tarik: 1, maggi_goreng: 2 })
   * and refreshes the recipe selector pills when demand changes.
   */
  public setDemandCounts(counts: Partial<Record<RecipeId, number>>): void {
    const key = Object.entries(counts)
      .filter(([, c]) => (c ?? 0) > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, c]) => `${k}:${c}`)
      .join('|');
    if (key === this.demandKey) return;
    this.demandKey = key;
    this.demandCounts = { ...counts };
    this.rebuildRecipePills();
  }

  /**
   * Auto-selects the first needed drink and/or food recipe from a customer's order
   * and pulses the recipe selector pills for instant visual confirmation.
   */
  public selectRecipesForOrder(recipes: RecipeId[]): RecipeId[] {
    const unlocked = this.store.getState().unlockedRecipes;
    const selected: RecipeId[] = [];
    let drinkChanged = false;
    let foodChanged = false;

    for (const id of recipes) {
      if (!unlocked.includes(id)) continue;
      const def = getRecipeDef(id);
      if (def.category === 'drink' && !drinkChanged) {
        this.selectedDrinkRecipe = id;
        drinkChanged = true;
        selected.push(id);
      } else if (def.category === 'food' && !foodChanged) {
        this.selectedFoodRecipe = id;
        foodChanged = true;
        selected.push(id);
      }
    }

    if (selected.length > 0) {
      this.rebuildRecipePills();
      if (drinkChanged) this.syncTehVisuals();
      if (foodChanged) this.syncRotiVisuals();
    }
    return selected;
  }

  /**
   * Builds thumb-friendly 1-tap Recipe Pills in a dedicated 40px zone (y = 480..518)
   * with live order demand badges (×1, ×2) and zero overlap against Kettle or Dough cards!
   */
  private rebuildRecipePills(): void {
    const unlocked = this.store.getState().unlockedRecipes;

    // 1. Drink Pills (left column center = 104, y = 496)
    this.drinkPillsContainer.removeAll(true);
    const drinks = unlocked.filter((id) => getRecipeDef(id).category === 'drink');
    const drinkPillW = drinks.length === 1 ? 156 : 75;

    drinks.forEach((id, idx) => {
      const def = getRecipeDef(id);
      const isSelected = this.selectedDrinkRecipe === id;
      const demand = this.demandCounts[id] ?? 0;
      const px = drinks.length === 1 ? 104 : 104 + (idx === 0 ? -40 : 40);
      const py = this.DOCK_Y + 42; // 496

      const fillColor = isSelected ? 0xd97706 : demand > 0 ? 0x112a22 : 0x0f172a;
      const strokeColor = isSelected ? 0xfef08a : demand > 0 ? 0x22c55e : 0x475569;

      const btn = this.scene.add
        .rectangle(px, py, drinkPillW, 24, fillColor, 1)
        .setStrokeStyle(1.5, strokeColor, 1)
        .setInteractive({ useHandCursor: true });

      const textShiftX = demand > 0 ? (drinkPillW > 100 ? -10 : -8) : 0;
      const txt = this.scene.add
        .text(px + textShiftX, py, def.shortName, {
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: demand > 0 && drinkPillW < 100 ? '9px' : '10px',
          fontStyle: 'bold',
          color: isSelected ? '#ffffff' : demand > 0 ? '#ecfdf5' : '#94a3b8',
        })
        .setOrigin(0.5);

      btn.on('pointerdown', () => {
        this.selectedDrinkRecipe = id;
        this.rebuildRecipePills();
        this.syncTehVisuals();
      });

      this.drinkPillsContainer.add([btn, txt]);

      if (demand > 0) {
        const badgeX = px + drinkPillW / 2 - (drinkPillW > 100 ? 18 : 11);
        const badge = this.scene.add
          .text(badgeX, py, `×${demand}`, {
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: drinkPillW > 100 ? '9px' : '8px',
            fontStyle: 'bold',
            color: '#fef08a',
            backgroundColor: '#15803d',
            padding: { x: drinkPillW > 100 ? 4 : 2.5, y: 1 },
          })
          .setOrigin(0.5);
        this.drinkPillsContainer.add(badge);
      }
    });

    // 2. Food Pills (right column center = 286, y = 488..507)
    this.foodPillsContainer.removeAll(true);
    const foods = unlocked.filter((id) => getRecipeDef(id).category === 'food');

    foods.forEach((id, idx) => {
      const def = getRecipeDef(id);
      const isSelected = this.selectedFoodRecipe === id;
      const demand = this.demandCounts[id] ?? 0;

      let px = 286;
      let py = this.DOCK_Y + 42; // 496
      let pillW = 156;
      let pillH = 24;

      if (foods.length === 2) {
        pillW = 75;
        px = 286 + (idx === 0 ? -40 : 40);
      } else if (foods.length > 2) {
        pillW = 75;
        pillH = 18;
        const col = idx % 2;
        const row = Math.floor(idx / 2);
        px = 286 + (col === 0 ? -40 : 40);
        py = this.DOCK_Y + 34 + row * 19; // Row 0 = 488, Row 1 = 507 (bottom = 516, well above y=525!)
      }

      const fillColor = isSelected ? 0xd97706 : demand > 0 ? 0x112a22 : 0x0f172a;
      const strokeColor = isSelected ? 0xfef08a : demand > 0 ? 0x22c55e : 0x475569;

      const btn = this.scene.add
        .rectangle(px, py, pillW, pillH, fillColor, 1)
        .setStrokeStyle(1.4, strokeColor, 1)
        .setInteractive({ useHandCursor: true });

      const textShiftX = demand > 0 ? (pillW > 100 ? -10 : -8.5) : 0;
      const fontSize =
        foods.length > 2
          ? demand > 0
            ? '8px'
            : '9px'
          : demand > 0 && pillW < 100
          ? '9px'
          : '10px';

      const txt = this.scene.add
        .text(px + textShiftX, py, def.shortName, {
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize,
          fontStyle: 'bold',
          color: isSelected ? '#ffffff' : demand > 0 ? '#ecfdf5' : '#94a3b8',
        })
        .setOrigin(0.5);

      btn.on('pointerdown', () => {
        this.selectedFoodRecipe = id;
        this.rebuildRecipePills();
        this.syncRotiVisuals();
      });

      this.foodPillsContainer.add([btn, txt]);

      if (demand > 0) {
        const badgeX = px + pillW / 2 - (pillW > 100 ? 18 : 10.5);
        const badge = this.scene.add
          .text(badgeX, py, `×${demand}`, {
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: pillW > 100 ? '9px' : '7.5px',
            fontStyle: 'bold',
            color: '#fef08a',
            backgroundColor: '#15803d',
            padding: { x: pillW > 100 ? 4 : 2, y: 0.5 },
          })
          .setOrigin(0.5);
        this.foodPillsContainer.add(badge);
      }
    });
  }

  // =========================================================================
  // 1. TEH TARIK / DRINKS STATION (Left Half: x = 20..190)
  // =========================================================================

  private buildTehTarikStation(): void {
    const leftCenterX = 104;

    this.drinkPillsContainer = this.scene.add.container(0, 0);
    this.add(this.drinkPillsContainer);

    // --- Interactive Element A: Kettle Card (Logical center 104, 554 — covers y=525..583) ---
    this.kettleContainer = this.scene.add.container(leftCenterX, 554);
    const kettleHitBg = this.scene.add
      .rectangle(0, 0, 156, 58, 0x293548, 1)
      .setStrokeStyle(1.5, 0x94a3b8, 0.95)
      .setInteractive({ useHandCursor: true });

    const kettleGfx = this.scene.add.graphics();
    // 3D button top highlight bevel
    kettleGfx.lineStyle(1.5, 0xe2e8f0, 0.35);
    kettleGfx.lineBetween(-74, -27, 74, -27);
    // Dedicated left icon well (-70..-12) so spout never touches text on the right!
    kettleGfx.fillStyle(0x0f172a, 0.65);
    kettleGfx.fillRoundedRect(-70, -22, 58, 44, 8);
    // Stainless steel tall Mamak tea kettle pot centered at x = -43
    kettleGfx.fillStyle(0xcbd5e1, 1);
    kettleGfx.fillRoundedRect(-57, -14, 30, 30, 5);
    kettleGfx.fillStyle(0xf8fafc, 0.45);
    kettleGfx.fillRect(-53, -11, 5, 24);
    kettleGfx.lineStyle(1.8, 0x475569, 1);
    kettleGfx.strokeRoundedRect(-57, -14, 30, 30, 5);
    // Kettle spout pointing right inside the icon well (stops at x = -16)
    kettleGfx.lineStyle(3.5, 0xe2e8f0, 1);
    kettleGfx.lineBetween(-27, 4, -17, -9);
    // Kettle handle on left
    kettleGfx.lineStyle(2.5, 0xfacc15, 1);
    kettleGfx.strokeRoundedRect(-64, -9, 7, 18, 2);
    // Brass lid knob
    kettleGfx.fillStyle(0xf59e0b, 1);
    kettleGfx.fillCircle(-42, -17, 3.2);

    const kettleLabel = this.scene.add
      .text(32, -10, '1. KETTLE', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#f8fafc',
      })
      .setOrigin(0.5);

    this.kettleBadge = this.scene.add
      .text(32, 10, 'TAP TO POUR', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '9px',
        fontStyle: 'bold',
        color: '#1c1917',
        backgroundColor: '#facc15',
        padding: { x: 6, y: 2.5 },
      })
      .setOrigin(0.5);

    this.kettleContainer.add([kettleHitBg, kettleGfx, kettleLabel, this.kettleBadge]);
    this.add(this.kettleContainer);

    kettleHitBg.on('pointerdown', () => {
      this.handleKettleTap();
    });

    this.tehStreamGfx = this.scene.add.graphics();
    this.add(this.tehStreamGfx);

    // --- Interactive Element B: Tea Cup Card (Logical center 104, 626 — covers y=592..660) ---
    this.cupContainer = this.scene.add.container(leftCenterX, 626);
    const cupHitBg = this.scene.add
      .rectangle(0, 0, 156, 68, 0x293548, 1)
      .setStrokeStyle(1.5, 0x94a3b8, 0.95)
      .setInteractive({ useHandCursor: true });

    this.cupVisualGfx = this.scene.add.graphics();

    const cupLabel = this.scene.add
      .text(32, -12, '2. TEA CUP', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#f8fafc',
      })
      .setOrigin(0.5);

    this.cupBadge = this.scene.add
      .text(32, 11, 'EMPTY', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '9px',
        fontStyle: 'bold',
        color: '#94a3b8',
        backgroundColor: '#0f172a',
        padding: { x: 6, y: 2.5 },
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
    barTrack.fillRoundedRect(26, 668, 156, 10, 5);
    barTrack.lineStyle(1, 0x64748b, 1);
    barTrack.strokeRoundedRect(26, 668, 156, 10, 5);
    this.add(barTrack);

    this.tehProgressFill = this.scene.add.graphics();
    this.add(this.tehProgressFill);

    this.tehStatusText = this.scene.add
      .text(leftCenterX, 692, '1. Tap Kettle to fill (1.5s)', {
        fontFamily: 'monospace',
        fontSize: '9.5px',
        fontStyle: 'bold',
        color: '#cbd5e1',
      })
      .setOrigin(0.5);
    this.add(this.tehStatusText);
  }

  private handleKettleTap(fromAne = false): void {
    if (this.tehStage !== 'idle') return;

    this.tehStage = 'filling';
    this.tehFillElapsedMs = 0;
    if (!fromAne) {
      haptic(HAPTIC.tap, 'tap');
      this.emitStationEvent('kettle_tapped');
    }

    this.scene.tweens.add({
      targets: this.kettleContainer,
      angle: 8,
      duration: 160,
      yoyo: true,
    });
    this.syncTehVisuals();
  }

  private handleCupTap(fromAne = false): void {
    if (this.tehStage !== 'filled') return;

    if (!this.callbacks.canAddToServingTray()) {
      if (!fromAne) haptic(HAPTIC.reject, 'trayFull');
      this.callbacks.onStationMessage(
        this.cupContainer.x,
        this.cupContainer.y - 30,
        'Tray full lah, boss! (Max 3)',
        '#f87171'
      );
      return;
    }

    if (!fromAne) haptic(HAPTIC.tap, 'tap');
    this.tehStage = 'pulling';
    this.syncTehVisuals();

    const drinkToPlate = this.selectedDrinkRecipe;
    const def = getRecipeDef(drinkToPlate);

    this.scene.tweens.add({
      targets: this.cupContainer,
      y: 616,
      scaleY: 1.07,
      duration: 140,
      yoyo: true,
      onComplete: () => {
        this.cupContainer.setPosition(104, 626);
        this.cupContainer.setScale(1);
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
          if (!fromAne) this.emitStationEvent('drink_plated');
        } else {
          this.tehStage = 'filled';
        }
        this.syncTehVisuals();
      },
    });
  }

  private syncTehVisuals(): void {
    const state = this.store.getState();
    const def = getRecipeDef(this.selectedDrinkRecipe);

    this.aneHelperBadge.setVisible(state.hasAneHelper);

    this.cupVisualGfx.clear();
    this.tehStreamGfx.clear();
    this.tehProgressFill.clear();

    const fillDurMs = this.getDrinkFillDurationMs();
    const fillRatio =
      this.tehStage === 'filling'
        ? Math.min(1, this.tehFillElapsedMs / fillDurMs)
        : this.tehStage === 'filled' || this.tehStage === 'pulling'
        ? 1
        : 0;

    // 3D top bevel highlight + left icon well inside Tea Cup card
    this.cupVisualGfx.lineStyle(1.5, 0xe2e8f0, 0.35);
    this.cupVisualGfx.lineBetween(-74, -32, 74, -32);
    this.cupVisualGfx.fillStyle(0x0f172a, 0.65);
    this.cupVisualGfx.fillRoundedRect(-70, -26, 58, 52, 8);

    const cx = -42;
    const cy = 2;
    this.cupVisualGfx.lineStyle(2.5, 0xcbd5e1, 1);
    this.cupVisualGfx.strokeCircle(cx + 12, cy, 5.5);

    this.cupVisualGfx.fillStyle(0x1e293b, 1);
    this.cupVisualGfx.fillRoundedRect(cx - 13, cy - 15, 26, 30, 4);

    const liquidColor =
      this.selectedDrinkRecipe === 'milo_ais' ? 0x3e2723 : 0xc27838;

    if (fillRatio > 0) {
      const liquidH = Math.max(4, 26 * fillRatio);
      this.cupVisualGfx.fillStyle(liquidColor, 1);
      this.cupVisualGfx.fillRoundedRect(cx - 12, cy + 14 - liquidH, 24, liquidH, 3);
    }

    if (this.tehStage === 'filled' || this.tehStage === 'pulling') {
      this.cupVisualGfx.fillStyle(
        this.selectedDrinkRecipe === 'milo_ais' ? 0x22c55e : 0xfef3c7,
        1
      );
      this.cupVisualGfx.fillRoundedRect(cx - 14, cy - 17, 28, 5, 3);
      // Warm rising steam lines above full cup
      this.cupVisualGfx.lineStyle(1.5, 0xf8fafc, 0.55);
      this.cupVisualGfx.lineBetween(cx - 5, cy - 19, cx - 3, cy - 23);
      this.cupVisualGfx.lineBetween(cx + 4, cy - 19, cx + 6, cy - 23);
    }

    this.cupVisualGfx.lineStyle(2, 0xe2e8f0, 1);
    this.cupVisualGfx.strokeRoundedRect(cx - 13, cy - 15, 26, 30, 4);

    if (this.tehStage === 'idle') {
      this.kettleBadge
        .setText('TAP TO POUR')
        .setBackgroundColor('#facc15')
        .setColor('#1c1917');
      this.cupBadge
        .setText('EMPTY')
        .setBackgroundColor('#0f172a')
        .setColor('#94a3b8');
      const pourSec = (fillDurMs / 1000).toFixed(1);
      this.tehStatusText
        .setText(
          state.hasAneHelper
            ? '🤖 Ane Helper Smart-Brew ON'
            : state.hasTermosAir
            ? `🫖 Termos ON • Tap Kettle (${pourSec}s)`
            : `1. Tap Kettle to fill (${pourSec}s)`
        )
        .setColor(
          state.hasAneHelper || state.hasTermosAir ? '#4ade80' : '#cbd5e1'
        );
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

      // Pouring stream connecting kettle spout to cup
      this.tehStreamGfx.lineStyle(4, liquidColor, 0.95);
      this.tehStreamGfx.lineBetween(62, 578, 62, 612);

      this.tehProgressFill.fillStyle(0x38bdf8, 1);
      this.tehProgressFill.fillRoundedRect(
        26,
        668,
        Math.max(4, 156 * fillRatio),
        10,
        5
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
      this.tehProgressFill.fillRoundedRect(26, 668, 156, 10, 5);
    }
  }

  // =========================================================================
  // 2. ROTI CANAI / HOT KITCHEN STATION (Right Half: x = 200..370)
  // =========================================================================

  private buildRotiCanaiStation(): void {
    const rightCenterX = 286;

    this.foodPillsContainer = this.scene.add.container(0, 0);
    this.add(this.foodPillsContainer);

    // --- Interactive Element A: Dough / Prep Tray (Logical center 286, 554 — covers y=525..583) ---
    this.doughContainer = this.scene.add.container(rightCenterX, 554);
    const doughHitBg = this.scene.add
      .rectangle(0, 0, 156, 58, 0x293548, 1)
      .setStrokeStyle(1.5, 0x94a3b8, 0.95)
      .setInteractive({ useHandCursor: true });

    const doughGfx = this.scene.add.graphics();
    // 3D top bevel highlight
    doughGfx.lineStyle(1.5, 0xe2e8f0, 0.35);
    doughGfx.lineBetween(-74, -27, 74, -27);
    // Dedicated left icon well (-70..-12) so dough tray never touches "1. DOUGH / PREP" text!
    doughGfx.fillStyle(0x0f172a, 0.65);
    doughGfx.fillRoundedRect(-70, -22, 58, 44, 8);
    // Stainless steel dough tray inside left well (-65..-17)
    doughGfx.fillStyle(0x94a3b8, 1);
    doughGfx.fillRoundedRect(-65, -15, 48, 30, 5);
    doughGfx.lineStyle(1.4, 0xe2e8f0, 0.9);
    doughGfx.strokeRoundedRect(-65, -15, 48, 30, 5);

    // 3 glossy oiled dough balls inside tray
    doughGfx.fillStyle(0xfef3c7, 1);
    doughGfx.fillCircle(-49, -4, 6.5);
    doughGfx.fillCircle(-33, -4, 6.5);
    doughGfx.fillCircle(-41, 6, 6.5);
    doughGfx.lineStyle(1, 0xd97706, 0.85);
    doughGfx.strokeCircle(-49, -4, 6.5);
    doughGfx.strokeCircle(-33, -4, 6.5);
    doughGfx.strokeCircle(-41, 6, 6.5);

    const doughLabel = this.scene.add
      .text(32, -10, '1. DOUGH / PREP', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#f8fafc',
      })
      .setOrigin(0.5);

    this.doughBadge = this.scene.add
      .text(32, 10, 'TAP DOUGH', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '9px',
        fontStyle: 'bold',
        color: '#1c1917',
        backgroundColor: '#facc15',
        padding: { x: 6, y: 2.5 },
      })
      .setOrigin(0.5);

    this.doughContainer.add([doughHitBg, doughGfx, doughLabel, this.doughBadge]);
    this.add(this.doughContainer);

    doughHitBg.on('pointerdown', () => {
      this.handleDoughTap();
    });

    // --- Interactive Element B: Griddle Slots (Logical center y = 626) ---
    for (let i = 0; i < 2; i++) {
      const slotContainer = this.scene.add.container(rightCenterX, 626);
      const hitBg = this.scene.add
        .rectangle(0, 0, 156, 68, 0x293548, 1)
        .setStrokeStyle(1.5, 0x94a3b8, 0.95)
        .setInteractive({ useHandCursor: true });

      const gfx = this.scene.add.graphics();
      const badge = this.scene.add
        .text(0, 19, 'EMPTY', {
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
      .text(rightCenterX, 692, '1. Tap Dough → Griddle', {
        fontFamily: 'monospace',
        fontSize: '9.5px',
        fontStyle: 'bold',
        color: '#cbd5e1',
      })
      .setOrigin(0.5);
    this.add(this.rotiStatusText);
  }

  private handleDoughTap(): void {
    const cap = this.store.getState().griddleCapacity;

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
          const burnedDef = getRecipeDef(this.griddleSlots[i].recipeId);
          const penalty = this.store.recordDiscardedFood(burnedDef.price, 1);
          this.callbacks.onStationMessage(
            this.griddleSlotContainers[i].x,
            this.griddleSlotContainers[i].y - 25,
            `🗑️ Burnt Waste -RM ${penalty.toFixed(2)}`,
            '#f87171'
          );
          targetSlotIdx = i;
          break;
        }
      }
    }

    if (targetSlotIdx === -1) {
      haptic(HAPTIC.reject, 'griddleFull');
      return;
    }

    haptic(HAPTIC.tap, 'tap');
    this.griddleSlots[targetSlotIdx] = {
      stage: 'cooking',
      timerMs: 0,
      recipeId: this.selectedFoodRecipe,
      isPadu: false,
    };
    this.emitStationEvent('dough_tapped');

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
      const burnDur = this.getFoodBurnDurationMs(slot.recipeId);
      const isPaduFlip = slot.timerMs <= burnDur * 0.45;
      slot.stage = 'cooked';
      slot.timerMs = 0;
      slot.isPadu = isPaduFlip;
      haptic(isPaduFlip ? HAPTIC.serve : HAPTIC.tap, 'tap');
      this.scene.tweens.add({
        targets: container,
        scaleY: 1.08,
        duration: 120,
        yoyo: true,
      });
      this.callbacks.onStationMessage(
        container.x,
        container.y - 26,
        isPaduFlip
          ? '✨ PADU FLIP! (+RM 1.00) • Tap to plate!'
          : 'Nice flip! Tap again to plate',
        isPaduFlip ? '#fde047' : '#facc15'
      );
      this.syncRotiVisuals();
      this.emitStationEvent('roti_flipped');
      return;
    }

    if (slot.stage === 'cooked') {
      if (!this.callbacks.canAddToServingTray()) {
        haptic(HAPTIC.reject, 'trayFull');
        this.callbacks.onStationMessage(
          container.x,
          container.y - 30,
          'Tray full lah, boss! (Max 3)',
          '#f87171'
        );
        return;
      }

      const def = getRecipeDef(slot.recipeId);
      const plated = this.callbacks.onPlateItem(slot.recipeId, slot.isPadu);
      if (plated) {
        haptic(HAPTIC.tap, 'tap');
        this.callbacks.onStationMessage(
          container.x,
          container.y - 25,
          slot.isPadu
            ? `✨ Padu ${def.shortName} → Tray (+RM1)!`
            : `${def.shortName} Plated! → Tray`,
          slot.isPadu ? '#fde047' : '#4ade80'
        );
        slot.stage = 'idle';
        slot.timerMs = 0;
        slot.isPadu = false;
        this.syncRotiVisuals();
        this.emitStationEvent('food_plated');
      }
      return;
    }

    if (slot.stage === 'burned') {
      const def = getRecipeDef(slot.recipeId);
      const penalty = this.store.recordDiscardedFood(def.price, 1);
      slot.stage = 'idle';
      slot.timerMs = 0;
      this.callbacks.onStationMessage(
        container.x,
        container.y - 25,
        `🗑️ Burnt Waste -RM ${penalty.toFixed(2)}`,
        '#f87171'
      );
      this.syncRotiVisuals();
    }
  }

  private syncRotiVisuals(): void {
    const rightCenterX = 286;
    const state = this.store.getState();
    const cap = state.griddleCapacity;

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

      const cardW = cap === 1 ? 156 : 75;
      const cardX =
        cap === 1 ? rightCenterX : rightCenterX + (i === 0 ? -40 : 40);
      container.setPosition(cardX, 626);
      hitBg.setSize(cardW, 68);

      gfx.clear();
      bar.clear();

      // 3D top bevel highlight
      gfx.lineStyle(1.5, 0xe2e8f0, 0.35);
      gfx.lineBetween(-cardW / 2 + 4, -32, cardW / 2 - 4, -32);

      const panX = cap === 1 ? -40 : 0;
      const panY = cap === 1 ? -1 : -11;
      const panR = cap === 1 ? 22 : 17;

      gfx.fillStyle(0x090d16, 1);
      gfx.fillCircle(panX, panY, panR);
      gfx.lineStyle(2, 0x64748b, 1);
      gfx.strokeCircle(panX, panY, panR);

      badge.setPosition(cap === 1 ? 30 : 0, cap === 1 ? -1 : 15);

      const barW = cardW - 14;
      const barX = -barW / 2;
      const barY = 25;
      bar.fillStyle(0x0f172a, 1);
      bar.fillRoundedRect(barX, barY, barW, 6, 3);

      if (slot.stage === 'idle') {
        badge
          .setText(cap === 1 ? '2. GRIDDLE' : `SLOT ${i + 1}`)
          .setBackgroundColor('#0f172a')
          .setColor('#94a3b8');
      } else if (slot.stage === 'cooking') {
        const cookDur = this.getFoodCookDurationMs(slot.recipeId);
        const ratio = Math.min(1, slot.timerMs / cookDur);
        gfx.fillStyle(0xfef3c7, 1);
        gfx.fillCircle(panX, panY, panR - 5);
        // Sizzling oil droplets around dough
        gfx.fillStyle(0xfacc15, 0.85);
        gfx.fillCircle(panX - 10, panY - 8, 1.8);
        gfx.fillCircle(panX + 11, panY + 7, 1.8);
        badge
          .setText(`${Math.round(ratio * 100)}%`)
          .setBackgroundColor('#0284c7')
          .setColor('#ffffff');
        bar.fillStyle(0x38bdf8, 1);
        bar.fillRoundedRect(barX, barY, Math.max(3, barW * ratio), 6, 3);
      } else if (slot.stage === 'ready_to_flip') {
        const burnDur = this.getFoodBurnDurationMs(slot.recipeId);
        const burnRem = Math.max(0, 1 - slot.timerMs / burnDur);
        const inPaduZone = slot.timerMs <= burnDur * 0.45;
        gfx.fillStyle(inPaduZone ? 0xfef08a : 0xfacc15, 1);
        gfx.fillCircle(panX, panY, panR - 4);
        gfx.lineStyle(1.5, inPaduZone ? 0xf59e0b : 0xd97706, 1);
        gfx.strokeCircle(panX, panY, panR - 8);
        badge
          .setText(inPaduZone ? (cap === 1 ? '⚡ PADU FLIP!' : '⚡ PADU!') : 'FLIP!')
          .setBackgroundColor(inPaduZone ? '#facc15' : '#ea580c')
          .setColor(inPaduZone ? '#1c1917' : '#fef08a');
        bar.fillStyle(inPaduZone ? 0xfacc15 : 0xf97316, 1);
        bar.fillRoundedRect(barX, barY, Math.max(3, barW * burnRem), 6, 3);
      } else if (slot.stage === 'cooked') {
        Customer.drawFoodIcon(gfx, slot.recipeId, panX, panY, cap === 1 ? 0.82 : 0.68);
        badge
          .setText(slot.isPadu ? (cap === 1 ? '✨ PLATE PADU!' : '✨ PADU!') : 'PLATE!')
          .setBackgroundColor(slot.isPadu ? '#f59e0b' : '#16a34a')
          .setColor(slot.isPadu ? '#1c1917' : '#fef08a');
        bar.fillStyle(slot.isPadu ? 0xfacc15 : 0x22c55e, 1);
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

    const activeSlots = this.griddleSlots.slice(0, cap);
    const flipping = activeSlots.find((s) => s.stage === 'ready_to_flip');
    const cooked = activeSlots.find((s) => s.stage === 'cooked');
    const cooking = activeSlots.find((s) => s.stage === 'cooking');

    if (flipping) {
      const burnDur = this.getFoodBurnDurationMs(flipping.recipeId);
      const sec = Math.max(0, (burnDur - flipping.timerMs) / 1000).toFixed(1);
      const inPadu = flipping.timerMs <= burnDur * 0.45;
      this.rotiStatusText
        .setText(
          inPadu
            ? `⚡ FLIP NOW FOR PADU (+RM1)! (${sec}s)`
            : `⚠️ FLIP NOW! Burns in ${sec}s`
        )
        .setColor(inPadu ? '#fde047' : '#fb923c');
    } else if (cooked) {
      this.rotiStatusText
        .setText(
          cooked.isPadu
            ? '✨ Padu! Tap Griddle → Plate (+RM1)'
            : 'Tap Griddle → Plate to Tray!'
        )
        .setColor(cooked.isPadu ? '#fde047' : '#4ade80');
    } else if (cooking) {
      this.rotiStatusText
        .setText(
          state.hasTurboKuali
            ? `🔥 Turbo Cooking (${cap}x griddle)...`
            : `Cooking (${cap}x griddle)...`
        )
        .setColor('#38bdf8');
    } else {
      this.rotiStatusText
        .setText(
          state.hasTurboKuali
            ? `🔥 Turbo Kuali ON (${cap} slot${cap > 1 ? 's' : ''})`
            : `Tap Dough → Griddle (${cap} slot${cap > 1 ? 's' : ''})`
        )
        .setColor(state.hasTurboKuali ? '#4ade80' : '#cbd5e1');
    }
  }

  public updateEntity(_time: number, delta: number): void {
    const state = this.store.getState();

    // --- Smart Ane Helper ---
    if (state.hasAneHelper && !this.aneSuspended) {
      if (this.tehStage === 'idle' && this.callbacks.canAneAutoBrewDrink()) {
        this.aneAutoCooldownMs -= delta;
        if (this.aneAutoCooldownMs <= 0) {
          this.selectedDrinkRecipe = this.callbacks.getNeededDrinkRecipe();
          this.rebuildRecipePills();
          this.handleKettleTap(true);
          this.aneAutoCooldownMs = 500;
        }
      } else if (
        this.tehStage === 'filled' &&
        this.callbacks.canAneAutoBrewDrink()
      ) {
        this.handleCupTap(true);
      }
    }

    if (this.tehStage === 'filling') {
      const fillDur = this.getDrinkFillDurationMs();
      this.tehFillElapsedMs += delta;
      if (this.tehFillElapsedMs >= fillDur) {
        this.tehFillElapsedMs = fillDur;
        this.tehStage = 'filled';
        this.emitStationEvent('drink_filled');
      }
      this.syncTehVisuals();
    }

    const cap = state.griddleCapacity;
    let rotiChanged = false;
    for (let i = 0; i < cap; i++) {
      const slot = this.griddleSlots[i];
      if (slot.stage === 'cooking') {
        const cookDur = this.getFoodCookDurationMs(slot.recipeId);
        slot.timerMs += delta;
        if (slot.timerMs >= cookDur) {
          slot.stage = 'ready_to_flip';
          slot.timerMs = 0;
          this.burnWarned[i] = false;
          this.emitStationEvent('roti_ready_to_flip');
        }
        rotiChanged = true;
      } else if (slot.stage === 'ready_to_flip') {
        const burnDur = this.getFoodBurnDurationMs(slot.recipeId);
        slot.timerMs += delta;
        // Buzz once when the last second of the flip window begins
        if (!this.burnWarned[i] && burnDur - slot.timerMs <= 1000) {
          this.burnWarned[i] = true;
          haptic(HAPTIC.burnWarning, 'burnWarning');
        }
        if (slot.timerMs >= burnDur) {
          slot.stage = 'burned';
          slot.timerMs = 0;
          slot.isPadu = false;
          haptic(HAPTIC.burned, 'burned');
          this.callbacks.onStationMessage(
            this.griddleSlotContainers[i].x,
            this.griddleSlotContainers[i].y - 25,
            '🔥 Alamak, burnt already!',
            '#f87171'
          );
          this.emitStationEvent('roti_burned');
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
