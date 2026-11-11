export type RecipeId =
  | 'teh_tarik'
  | 'milo_ais'
  | 'roti_canai'
  | 'maggi_goreng'
  | 'roti_telur'
  | 'nasi_kandar'
  | string;

export type StationSlotState = 'idle' | 'cooking' | 'ready';

export interface StationSlot {
  slotId: string;
  recipeId: RecipeId | null;
  status: StationSlotState;
  progress: number;
  durationMs: number;
  elapsedMs: number;
}

export interface TierInfo {
  level: number;
  name: string;
}

export type TimeOfDayPhase = 'Morning' | 'Afternoon' | 'Evening' | 'Night';

export interface ShiftSummary {
  day: number;
  servedCount: number;
  walkoutsCount: number;
  revenueEarned: number;
  tipsEarned: number;
  wasteCount: number;
  wastePenalty: number;
}

export interface GameStateSnapshot {
  cash: number;
  reputation: number;
  day: number;
  dayElapsedSeconds: number;
  dayDurationSeconds: number;
  isNight: boolean;
  phase: TimeOfDayPhase;
  tier: TierInfo;
  maxCustomers: number;
  griddleCapacity: number;
  hasAneHelper: boolean;
  unlockedRecipes: RecipeId[];
  stationStatus: Record<string, StationSlot>;
  comboStreak: number;
  shiftStats: ShiftSummary;
  lastCompletedShift: ShiftSummary | null;
}

export interface GameStateEvents {
  change: (state: Readonly<GameStateSnapshot>) => void;
  cashChanged: (cash: number, delta: number) => void;
  reputationChanged: (reputation: number, delta: number) => void;
  dayChanged: (day: number) => void;
  shiftEnded: (completedDay: number, nextDay: number, summary: ShiftSummary) => void;
  dayTick: (elapsedSeconds: number, phase: TimeOfDayPhase, isNight: boolean) => void;
  tierChanged: (tier: TierInfo) => void;
  recipeUnlocked: (recipeId: RecipeId, unlockedRecipes: RecipeId[]) => void;
  stationUpdated: (slot: StationSlot, allStations: Record<string, StationSlot>) => void;
  comboChanged: (streak: number) => void;
}

type AnyListener = (...args: any[]) => void;

const STORAGE_KEY = 'mamak_shop_save_v1';

export class GameStateStore {
  public static readonly DAY_DURATION_SECONDS = 90;

  private listeners: Map<keyof GameStateEvents, Set<AnyListener>> = new Map();
  private state: GameStateSnapshot;

  constructor() {
    this.state = this.createDefaultState();
    this.loadFromStorage();
  }

  private createDefaultState(): GameStateSnapshot {
    return {
      cash: 50.0,
      reputation: 70,
      day: 1,
      dayElapsedSeconds: 0,
      dayDurationSeconds: GameStateStore.DAY_DURATION_SECONDS,
      isNight: false,
      phase: 'Morning',
      tier: {
        level: 1,
        name: 'Gerai Tepi Jalan',
      },
      maxCustomers: 2,
      griddleCapacity: 1,
      hasAneHelper: false,
      unlockedRecipes: ['teh_tarik', 'roti_canai'],
      stationStatus: {
        teh_station_1: {
          slotId: 'teh_station_1',
          recipeId: 'teh_tarik',
          status: 'idle',
          progress: 0,
          durationMs: 1500,
          elapsedMs: 0,
        },
        roti_station_1: {
          slotId: 'roti_station_1',
          recipeId: 'roti_canai',
          status: 'idle',
          progress: 0,
          durationMs: 3000,
          elapsedMs: 0,
        },
      },
      comboStreak: 0,
      shiftStats: {
        day: 1,
        servedCount: 0,
        walkoutsCount: 0,
        revenueEarned: 0,
        tipsEarned: 0,
        wasteCount: 0,
        wastePenalty: 0,
      },
      lastCompletedShift: null,
    };
  }

  // --- Persistence (localStorage) ---

  private saveToStorage(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const payload = {
        cash: this.state.cash,
        reputation: this.state.reputation,
        day: this.state.day,
        tier: this.state.tier,
        maxCustomers: this.state.maxCustomers,
        griddleCapacity: this.state.griddleCapacity,
        hasAneHelper: this.state.hasAneHelper,
        unlockedRecipes: this.state.unlockedRecipes,
        shiftStats: this.state.shiftStats,
        lastCompletedShift: this.state.lastCompletedShift,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage quota or private mode errors
    }
  }

  private loadFromStorage(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (typeof parsed.cash === 'number') this.state.cash = parsed.cash;
      if (typeof parsed.reputation === 'number') this.state.reputation = parsed.reputation;
      if (typeof parsed.day === 'number') this.state.day = parsed.day;
      if (parsed.tier && typeof parsed.tier.level === 'number') {
        this.state.tier = parsed.tier;
      }
      if (typeof parsed.maxCustomers === 'number') {
        this.state.maxCustomers = parsed.maxCustomers;
      }
      if (typeof parsed.griddleCapacity === 'number') {
        this.state.griddleCapacity = parsed.griddleCapacity;
      }
      if (typeof parsed.hasAneHelper === 'boolean') {
        this.state.hasAneHelper = parsed.hasAneHelper;
      }
      if (Array.isArray(parsed.unlockedRecipes)) {
        this.state.unlockedRecipes = parsed.unlockedRecipes;
      }
      if (parsed.shiftStats) {
        this.state.shiftStats = {
          ...this.state.shiftStats,
          ...parsed.shiftStats,
          day: this.state.day,
        };
      }
      if (parsed.lastCompletedShift) {
        this.state.lastCompletedShift = parsed.lastCompletedShift;
      }
    } catch {
      // Ignore malformed storage
    }
  }

  public resetGame(): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Ignore
    }
    this.state = this.createDefaultState();
    this.emit('cashChanged', this.state.cash, 0);
    this.emit('reputationChanged', this.state.reputation, 0);
    this.emit('dayChanged', this.state.day);
    this.emit('tierChanged', { ...this.state.tier });
    this.emit('comboChanged', 0);
    this.notifyChange();
  }

  // --- Event Emitter Methods ---

  public on<K extends keyof GameStateEvents>(
    event: K,
    listener: GameStateEvents[K]
  ): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as AnyListener);
    return () => this.off(event, listener);
  }

  public off<K extends keyof GameStateEvents>(
    event: K,
    listener: GameStateEvents[K]
  ): void {
    this.listeners.get(event)?.delete(listener as AnyListener);
  }

  private emit<K extends keyof GameStateEvents>(
    event: K,
    ...args: Parameters<GameStateEvents[K]>
  ): void {
    const set = this.listeners.get(event);
    if (set) {
      set.forEach((fn) => {
        fn(...args);
      });
    }
  }

  private notifyChange(): void {
    this.saveToStorage();
    this.emit('change', this.getState());
  }

  // --- State Getters ---

  public getState(): Readonly<GameStateSnapshot> {
    return {
      ...this.state,
      tier: { ...this.state.tier },
      unlockedRecipes: [...this.state.unlockedRecipes],
      shiftStats: { ...this.state.shiftStats },
      lastCompletedShift: this.state.lastCompletedShift
        ? { ...this.state.lastCompletedShift }
        : null,
      stationStatus: Object.fromEntries(
        Object.entries(this.state.stationStatus).map(([k, v]) => [k, { ...v }])
      ),
    };
  }

  // --- Helper Methods ---

  public addCash(amount: number): number {
    if (amount <= 0) return this.state.cash;
    const roundedDelta = Math.round(amount * 100) / 100;
    this.state.cash = Math.round((this.state.cash + roundedDelta) * 100) / 100;
    this.emit('cashChanged', this.state.cash, roundedDelta);
    this.notifyChange();
    return this.state.cash;
  }

  public deductCash(amount: number): boolean {
    if (amount <= 0) return true;
    const roundedAmount = Math.round(amount * 100) / 100;
    if (this.state.cash < roundedAmount) {
      return false;
    }
    this.state.cash = Math.round((this.state.cash - roundedAmount) * 100) / 100;
    this.emit('cashChanged', this.state.cash, -roundedAmount);
    this.notifyChange();
    return true;
  }

  /**
   * Applies a mandatory cash penalty (clamped at RM 0.00) and emits negative cashChanged delta.
   */
  public applyCashPenalty(amount: number): number {
    if (amount <= 0) return 0;
    const rounded = Math.round(amount * 100) / 100;
    const actualDeducted = Math.min(this.state.cash, rounded);
    this.state.cash = Math.max(0, Math.round((this.state.cash - rounded) * 100) / 100);
    this.emit('cashChanged', this.state.cash, -rounded);
    this.notifyChange();
    return actualDeducted;
  }

  public adjustReputation(delta: number): number {
    const prev = this.state.reputation;
    const clamped = Math.max(0, Math.min(100, Math.round(prev + delta)));
    const actualDelta = clamped - prev;
    this.state.reputation = clamped;
    this.emit('reputationChanged', this.state.reputation, actualDelta);
    this.notifyChange();
    return this.state.reputation;
  }

  public unlockItem(id: RecipeId): boolean {
    if (this.state.unlockedRecipes.includes(id)) {
      return false;
    }
    this.state.unlockedRecipes.push(id);
    this.emit('recipeUnlocked', id, [...this.state.unlockedRecipes]);
    this.notifyChange();
    return true;
  }

  // --- Gameplay Metrics: Sales, Combos, Walkouts & Food Waste Penalty ---

  public recordSale(basePrice: number, tipAmount: number, orderComplete: boolean): number {
    let comboBonus = 0;
    if (orderComplete) {
      this.state.comboStreak += 1;
      if (this.state.comboStreak >= 3) {
        comboBonus = Math.min(2.5, (this.state.comboStreak - 2) * 0.5);
      }
      this.emit('comboChanged', this.state.comboStreak);
    }

    const totalTip = Math.round((tipAmount + comboBonus) * 100) / 100;
    const totalEarned = Math.round((basePrice + totalTip) * 100) / 100;

    this.state.shiftStats.revenueEarned =
      Math.round((this.state.shiftStats.revenueEarned + basePrice) * 100) / 100;
    this.state.shiftStats.tipsEarned =
      Math.round((this.state.shiftStats.tipsEarned + totalTip) * 100) / 100;
    if (orderComplete) {
      this.state.shiftStats.servedCount += 1;
    }

    this.addCash(totalEarned);
    return totalEarned;
  }

  public recordWalkout(): void {
    this.state.shiftStats.walkoutsCount += 1;
    if (this.state.comboStreak > 0) {
      this.state.comboStreak = 0;
      this.emit('comboChanged', 0);
    }
    this.adjustReputation(-5);
  }

  /**
   * Discarding/burning food or drinks incurs a waste cost penalty (50% of menu price),
   * drops reputation by 1, and resets the active combo streak.
   */
  public recordDiscardedFood(menuPrice: number, repPenalty = 1): number {
    const cashPenalty = Math.max(1.0, Math.round(menuPrice * 0.5 * 100) / 100);
    this.state.shiftStats.wasteCount += 1;
    this.state.shiftStats.wastePenalty =
      Math.round((this.state.shiftStats.wastePenalty + cashPenalty) * 100) / 100;

    if (this.state.comboStreak > 0) {
      this.state.comboStreak = 0;
      this.emit('comboChanged', 0);
    }

    this.applyCashPenalty(cashPenalty);
    if (repPenalty > 0) {
      this.adjustReputation(-repPenalty);
    }
    return cashPenalty;
  }

  // --- Kedai Upgrades ---

  public upgradeToTier2(): boolean {
    if (this.state.tier.level >= 2) return false;
    if (!this.deductCash(300)) return false;

    this.state.tier = {
      level: 2,
      name: 'Kedai Bawah Pokok',
    };
    this.state.maxCustomers = 4;
    this.state.griddleCapacity = 2;

    this.unlockItem('milo_ais');
    this.unlockItem('maggi_goreng');

    this.emit('tierChanged', { ...this.state.tier });
    this.notifyChange();
    return true;
  }

  public upgradeToTier3(): boolean {
    if (this.state.tier.level >= 3) return false;
    if (!this.deductCash(1200)) return false;

    this.state.maxCustomers = 4;
    this.state.griddleCapacity = 2;
    this.unlockItem('milo_ais');
    this.unlockItem('maggi_goreng');

    this.state.tier = {
      level: 3,
      name: 'Corner Lot Mamak',
    };
    this.state.hasAneHelper = true;

    this.unlockItem('roti_telur');
    this.unlockItem('nasi_kandar');

    this.emit('tierChanged', { ...this.state.tier });
    this.notifyChange();
    return true;
  }

  // --- Day / Night Cycle (90s per day) ---

  public advanceTime(deltaSeconds: number): void {
    if (deltaSeconds <= 0) return;

    this.state.dayElapsedSeconds += deltaSeconds;

    if (this.state.dayElapsedSeconds >= this.state.dayDurationSeconds) {
      const completedDay = this.state.day;
      const summary: ShiftSummary = { ...this.state.shiftStats, day: completedDay };
      this.state.lastCompletedShift = summary;

      this.state.dayElapsedSeconds %= this.state.dayDurationSeconds;
      this.state.day += 1;
      this.state.shiftStats = {
        day: this.state.day,
        servedCount: 0,
        walkoutsCount: 0,
        revenueEarned: 0,
        tipsEarned: 0,
        wasteCount: 0,
        wastePenalty: 0,
      };

      this.emit('dayChanged', this.state.day);
      this.emit('shiftEnded', completedDay, this.state.day, summary);
    }

    const progress = this.state.dayElapsedSeconds / this.state.dayDurationSeconds;
    const phase = this.computePhase(progress);
    const isNight = phase === 'Evening' || phase === 'Night';

    this.state.phase = phase;
    this.state.isNight = isNight;

    this.emit('dayTick', this.state.dayElapsedSeconds, phase, isNight);
    this.emit('change', this.getState());
  }

  private computePhase(progress: number): TimeOfDayPhase {
    if (progress < 0.25) return 'Morning';
    if (progress < 0.5) return 'Afternoon';
    if (progress < 0.75) return 'Evening';
    return 'Night';
  }

  // --- Station Status Management ---

  public startStation(slotId: string, recipeId?: RecipeId, durationMs?: number): boolean {
    const slot = this.state.stationStatus[slotId];
    if (!slot || slot.status !== 'idle') return false;

    const targetRecipe = recipeId ?? slot.recipeId;
    if (!targetRecipe || !this.state.unlockedRecipes.includes(targetRecipe)) {
      return false;
    }

    slot.recipeId = targetRecipe;
    if (durationMs !== undefined && durationMs > 0) {
      slot.durationMs = durationMs;
    }
    slot.status = 'cooking';
    slot.elapsedMs = 0;
    slot.progress = 0;

    this.emit('stationUpdated', { ...slot }, this.getState().stationStatus);
    this.notifyChange();
    return true;
  }

  public updateStations(deltaMs: number): void {
    let anyChanged = false;
    for (const key of Object.keys(this.state.stationStatus)) {
      const slot = this.state.stationStatus[key];
      if (slot.status === 'cooking') {
        slot.elapsedMs = Math.min(slot.durationMs, slot.elapsedMs + deltaMs);
        slot.progress = slot.durationMs > 0 ? slot.elapsedMs / slot.durationMs : 1;
        if (slot.elapsedMs >= slot.durationMs) {
          slot.status = 'ready';
          slot.progress = 1;
        }
        this.emit('stationUpdated', { ...slot }, this.getState().stationStatus);
        anyChanged = true;
      }
    }
    if (anyChanged) {
      this.notifyChange();
    }
  }

  public collectStation(slotId: string): RecipeId | null {
    const slot = this.state.stationStatus[slotId];
    if (!slot || slot.status !== 'ready') return null;

    const completedRecipe = slot.recipeId;
    slot.status = 'idle';
    slot.progress = 0;
    slot.elapsedMs = 0;

    this.emit('stationUpdated', { ...slot }, this.getState().stationStatus);
    this.notifyChange();
    return completedRecipe;
  }
}

export const gameState = new GameStateStore();
