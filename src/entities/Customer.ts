import Phaser from 'phaser';
import { BaseEntity } from './BaseEntity';
import { RecipeId } from '../state/GameState';
import { getRecipeDef } from '../config/recipes';

export type CustomerState = 'walking_in' | 'waiting' | 'leaving_happy' | 'leaving_angry';
export type CustomerArchetype = 'regular' | 'tapau_rider' | 'bola_fan' | 'vip_vlogger';

export interface CustomerEvents {
  onServed: (
    customer: Customer,
    recipeId: RecipeId,
    allComplete: boolean,
    patienceRatio: number
  ) => void;
  onTimeout: (customer: Customer) => void;
  onExited: (customer: Customer) => void;
}

const SHIRT_COLORS = [0x2563eb, 0x059669, 0x7c3aed, 0xd97706, 0x0891b2, 0xbe185d];
const SKIN_TONES = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524];

export class Customer extends BaseEntity {
  public readonly seatIndex: number;
  public readonly archetype: CustomerArchetype;
  public readonly requestedItems: RecipeId[];
  public readonly remainingItems: RecipeId[];
  public customerState: CustomerState = 'walking_in';

  private readonly maxPatienceMs: number;
  private remainingPatienceMs: number;

  private readonly targetX: number;
  private readonly targetY: number;
  private readonly callbacks: CustomerEvents;

  private bodyGraphics!: Phaser.GameObjects.Graphics;
  private faceGraphics!: Phaser.GameObjects.Graphics;
  private archetypeTag!: Phaser.GameObjects.Text;
  private bubbleContainer!: Phaser.GameObjects.Container;
  private bubbleBg!: Phaser.GameObjects.Graphics;
  private bubbleItemsContainer!: Phaser.GameObjects.Container;
  private patienceBarBg!: Phaser.GameObjects.Graphics;
  private patienceBarFill!: Phaser.GameObjects.Graphics;
  private highlightRing!: Phaser.GameObjects.Graphics;

  private readonly shirtColor: number;
  private readonly skinColor: number;

  /** When true (e.g. during the tutorial), patience does not drain. */
  public patienceFrozen = false;
  /** Tray slot colours currently holding each requested recipe (drawn as dots on the bubble). */
  private matchColors: Partial<Record<RecipeId, number[]>> = {};
  private matchKey = '';

  constructor(
    scene: Phaser.Scene,
    seatIndex: number,
    spawnX: number,
    spawnY: number,
    targetX: number,
    targetY: number,
    requestedItems: RecipeId[],
    callbacks: CustomerEvents,
    archetype: CustomerArchetype = 'regular',
    patienceModifier = 1.0
  ) {
    super(scene, spawnX, spawnY);
    this.seatIndex = seatIndex;
    this.targetX = targetX;
    this.targetY = targetY;
    this.archetype = archetype;
    this.requestedItems = [...requestedItems];
    this.remainingItems = [...requestedItems];
    this.callbacks = callbacks;

    let basePatienceMs = 15000;
    if (archetype === 'tapau_rider') {
      basePatienceMs = 11000;
      this.shirtColor = 0x16a34a;
    } else if (archetype === 'bola_fan') {
      basePatienceMs = 19000;
      this.shirtColor = 0xdc2626;
    } else if (archetype === 'vip_vlogger') {
      basePatienceMs = 16000;
      this.shirtColor = 0x9333ea;
    } else {
      basePatienceMs = 15000;
      this.shirtColor = SHIRT_COLORS[Math.floor(Math.random() * SHIRT_COLORS.length)];
    }
    this.maxPatienceMs = Math.round(basePatienceMs * patienceModifier);
    this.remainingPatienceMs = this.maxPatienceMs;
    this.skinColor = SKIN_TONES[Math.floor(Math.random() * SKIN_TONES.length)];

    this.buildVisuals();
    this.setupInteractivity();
    this.walkToCounter();
  }

  private buildVisuals(): void {
    // Glowing drop-target ring when dragging food near customer
    this.highlightRing = this.scene.add.graphics();
    this.highlightRing.fillStyle(0xfacc15, 0.16);
    this.highlightRing.fillCircle(0, -10, 48);
    this.highlightRing.lineStyle(3, 0xfacc15, 0.95);
    this.highlightRing.strokeCircle(0, -10, 48);
    this.highlightRing.setVisible(false);
    this.add(this.highlightRing);

    this.bodyGraphics = this.scene.add.graphics();

    // Soft ground shadow
    this.bodyGraphics.fillStyle(0x000000, 0.35);
    this.bodyGraphics.fillEllipse(0, 35, 56, 15);

    // Torso / Shoulders with 3D shading
    this.bodyGraphics.fillStyle(this.shirtColor, 1);
    this.bodyGraphics.fillRoundedRect(-24, -4, 48, 39, 13);
    // Subtle dark bottom shade on shirt
    this.bodyGraphics.fillStyle(0x000000, 0.18);
    this.bodyGraphics.fillRoundedRect(-22, 18, 44, 15, 8);
    // Top shoulder rim highlight
    this.bodyGraphics.lineStyle(2, 0xffffff, 0.22);
    this.bodyGraphics.lineBetween(-16, -2, 16, -2);
    // Crisp dark outline
    this.bodyGraphics.lineStyle(2, 0x0f172a, 0.9);
    this.bodyGraphics.strokeRoundedRect(-24, -4, 48, 39, 13);

    if (this.archetype === 'bola_fan') {
      // Harimau Malaya / Football stripes
      this.bodyGraphics.fillStyle(0xfacc15, 0.92);
      this.bodyGraphics.fillRect(-11, -2, 6, 35);
      this.bodyGraphics.fillRect(5, -2, 6, 35);
    } else if (this.archetype === 'tapau_rider') {
      // High-vis neon reflective harness
      this.bodyGraphics.fillStyle(0xbef264, 0.95);
      this.bodyGraphics.fillRect(-21, 9, 42, 6);
      this.bodyGraphics.fillRect(-12, -3, 5, 14);
      this.bodyGraphics.fillRect(7, -3, 5, 14);
    } else if (this.archetype === 'vip_vlogger') {
      // Gold chain & Vlogger lapel mic
      this.bodyGraphics.lineStyle(2.5, 0xfacc15, 0.95);
      this.bodyGraphics.strokeCircle(0, 3, 8);
      this.bodyGraphics.fillStyle(0xfef08a, 1);
      this.bodyGraphics.fillCircle(0, 11, 3);
    } else {
      // Polo collar V-neck
      this.bodyGraphics.fillStyle(0xffffff, 0.3);
      this.bodyGraphics.fillTriangle(-8, -4, 8, -4, 0, 8);
    }

    // Neck
    this.bodyGraphics.fillStyle(this.skinColor, 1);
    this.bodyGraphics.fillRoundedRect(-6, -10, 12, 10, 3);

    // Ears
    this.bodyGraphics.fillStyle(this.skinColor, 1);
    this.bodyGraphics.fillCircle(-19, -21, 4.5);
    this.bodyGraphics.fillCircle(19, -21, 4.5);
    this.bodyGraphics.lineStyle(1.5, 0x0f172a, 0.8);
    this.bodyGraphics.strokeCircle(-19, -21, 4.5);
    this.bodyGraphics.strokeCircle(19, -21, 4.5);

    // Head
    this.bodyGraphics.fillStyle(this.skinColor, 1);
    this.bodyGraphics.fillCircle(0, -22, 19);
    this.bodyGraphics.lineStyle(2, 0x0f172a, 0.9);
    this.bodyGraphics.strokeCircle(0, -22, 19);

    // Hair / Helmet
    if (this.archetype === 'tapau_rider') {
      this.bodyGraphics.fillStyle(0x15803d, 1);
      this.bodyGraphics.slice(
        0,
        -23,
        21.5,
        Phaser.Math.DegToRad(175),
        Phaser.Math.DegToRad(365),
        false
      );
      this.bodyGraphics.fillPath();
      // Helmet visor strip
      this.bodyGraphics.lineStyle(2.5, 0xbef264, 1);
      this.bodyGraphics.lineBetween(-16, -28, 16, -28);
    } else {
      this.bodyGraphics.fillStyle(0x1c1917, 1);
      this.bodyGraphics.slice(
        0,
        -24,
        19.5,
        Phaser.Math.DegToRad(185),
        Phaser.Math.DegToRad(355),
        false
      );
      this.bodyGraphics.fillPath();
      // Hair sheen highlight
      this.bodyGraphics.lineStyle(2, 0x57534e, 0.65);
      this.bodyGraphics.beginPath();
      this.bodyGraphics.arc(0, -24, 15, Phaser.Math.DegToRad(215), Phaser.Math.DegToRad(295), false);
      this.bodyGraphics.strokePath();
    }

    this.add(this.bodyGraphics);

    this.faceGraphics = this.scene.add.graphics();
    this.add(this.faceGraphics);
    this.drawFace('neutral');

    // Archetype badge pill on torso if special customer
    if (this.archetype !== 'regular') {
      const tagText =
        this.archetype === 'tapau_rider'
          ? '🛵 TAPAU'
          : this.archetype === 'bola_fan'
          ? '⚽ BOLA'
          : '👑 VLOGGER';
      const tagBg =
        this.archetype === 'tapau_rider'
          ? '#14532d'
          : this.archetype === 'bola_fan'
          ? '#7f1d1d'
          : '#581c87';
      this.archetypeTag = this.scene.add
        .text(0, 22, tagText, {
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: '8.5px',
          fontStyle: 'bold',
          color: '#fef08a',
          backgroundColor: tagBg,
          padding: { x: 4, y: 1.5 },
        })
        .setOrigin(0.5);
      this.add(this.archetypeTag);
    }

    // Patience Bar above head (width 62px, sits at y = -52)
    this.patienceBarBg = this.scene.add.graphics();
    this.patienceBarBg.fillStyle(0x090d16, 0.95);
    this.patienceBarBg.fillRoundedRect(-31, -54, 62, 9, 4.5);
    this.patienceBarBg.lineStyle(1.2, 0xfef08a, 0.7);
    this.patienceBarBg.strokeRoundedRect(-31, -54, 62, 9, 4.5);
    this.patienceBarBg.setVisible(false);
    this.add(this.patienceBarBg);

    this.patienceBarFill = this.scene.add.graphics();
    this.patienceBarFill.setVisible(false);
    this.add(this.patienceBarFill);

    // Stagger speech bubble height slightly on alternating seats so 4-seat mode never collides
    const bubbleY = this.seatIndex % 2 === 0 ? -102 : -112;
    this.bubbleContainer = this.scene.add.container(0, bubbleY);
    this.bubbleContainer.setVisible(false);

    this.bubbleBg = this.scene.add.graphics();
    this.bubbleContainer.add(this.bubbleBg);

    this.bubbleItemsContainer = this.scene.add.container(0, 0);
    this.bubbleContainer.add(this.bubbleItemsContainer);

    this.add(this.bubbleContainer);
    this.refreshSpeechBubble();
  }

  private drawFace(mood: 'neutral' | 'happy' | 'impatient' | 'angry'): void {
    this.faceGraphics.clear();

    // Rosy cheeks
    this.faceGraphics.fillStyle(0xf87171, mood === 'happy' ? 0.35 : 0.18);
    this.faceGraphics.fillCircle(-10, -19, 3.2);
    this.faceGraphics.fillCircle(10, -19, 3.2);

    // Eyes + white specular catchlight
    this.faceGraphics.fillStyle(0x18181b, 1);
    this.faceGraphics.fillCircle(-6.5, -23.5, 2.5);
    this.faceGraphics.fillCircle(6.5, -23.5, 2.5);
    this.faceGraphics.fillStyle(0xffffff, 0.9);
    this.faceGraphics.fillCircle(-7.2, -24.3, 0.9);
    this.faceGraphics.fillCircle(5.8, -24.3, 0.9);

    this.faceGraphics.lineStyle(2, 0x18181b, 1);
    if (mood === 'happy') {
      this.faceGraphics.beginPath();
      this.faceGraphics.arc(0, -18, 5, Phaser.Math.DegToRad(15), Phaser.Math.DegToRad(165), false);
      this.faceGraphics.strokePath();
    } else if (mood === 'neutral') {
      this.faceGraphics.beginPath();
      this.faceGraphics.arc(0, -17, 4, Phaser.Math.DegToRad(25), Phaser.Math.DegToRad(155), false);
      this.faceGraphics.strokePath();
    } else if (mood === 'impatient') {
      this.faceGraphics.lineBetween(-5, -15, 5, -15);
      this.faceGraphics.lineBetween(-9, -28, -3, -27);
      this.faceGraphics.lineBetween(9, -28, 3, -27);
    } else if (mood === 'angry') {
      this.faceGraphics.beginPath();
      this.faceGraphics.arc(0, -12, 5, Phaser.Math.DegToRad(200), Phaser.Math.DegToRad(340), false);
      this.faceGraphics.strokePath();
      this.faceGraphics.lineStyle(2.2, 0xdc2626, 1);
      this.faceGraphics.lineBetween(-9, -29, -3, -26);
      this.faceGraphics.lineBetween(9, -29, 3, -26);
    }
  }

  /**
   * Compact vertical/stacked Speech Bubble layout so 4 seated customers never overlap horizontally!
   * Max bubble width is 84px (single item) or 88px (stacked 2-item order).
   */
  private refreshSpeechBubble(): void {
    this.bubbleItemsContainer.removeAll(true);
    this.bubbleBg.clear();

    const count = this.remainingItems.length;
    if (count === 0) {
      this.bubbleContainer.setVisible(false);
      return;
    }

    const isSamePair =
      count === 2 && this.remainingItems[0] === this.remainingItems[1];
    const rows = count === 1 || isSamePair ? 1 : 2;
    const bubbleW = 86;
    const bubbleH = rows === 1 ? 40 : 58;

    const borderColor =
      this.archetype === 'tapau_rider'
        ? 0x22c55e
        : this.archetype === 'bola_fan'
        ? 0xef4444
        : this.archetype === 'vip_vlogger'
        ? 0xa855f7
        : 0xf59e0b;

    // Subtle drop shadow under speech bubble
    this.bubbleBg.fillStyle(0x000000, 0.35);
    this.bubbleBg.fillRoundedRect(
      -bubbleW / 2 + 2,
      -bubbleH / 2 + 3,
      bubbleW,
      bubbleH,
      10
    );

    // Crisp cream speech bubble card
    this.bubbleBg.fillStyle(0xfffbeb, 0.99);
    this.bubbleBg.fillRoundedRect(-bubbleW / 2, -bubbleH / 2, bubbleW, bubbleH, 10);
    this.bubbleBg.lineStyle(2.2, borderColor, 1);
    this.bubbleBg.strokeRoundedRect(-bubbleW / 2, -bubbleH / 2, bubbleW, bubbleH, 10);

    // Speech bubble pointer tail
    this.bubbleBg.fillStyle(0xfffbeb, 0.99);
    this.bubbleBg.fillTriangle(-5, bubbleH / 2 - 1, 5, bubbleH / 2 - 1, 0, bubbleH / 2 + 7);
    this.bubbleBg.lineStyle(2.2, borderColor, 1);
    this.bubbleBg.lineBetween(-5, bubbleH / 2, 0, bubbleH / 2 + 7);
    this.bubbleBg.lineBetween(5, bubbleH / 2, 0, bubbleH / 2 + 7);

    if (rows === 1) {
      const recipeId = this.remainingItems[0];
      const def = getRecipeDef(recipeId);
      const iconGfx = this.scene.add.graphics();
      Customer.drawFoodIcon(iconGfx, recipeId, -22, 0, 0.78);
      this.bubbleItemsContainer.add(iconGfx);

      const qtySuffix = isSamePair ? ' ×2' : '';
      const label = this.scene.add
        .text(-4, 0, `${def.shortName.replace(' ', '\n')}${qtySuffix}`, {
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: '10px',
          fontStyle: 'bold',
          color: '#0f172a',
          align: 'left',
          lineSpacing: -1,
        })
        .setOrigin(0, 0.5);
      this.bubbleItemsContainer.add(label);
    } else {
      // Stacked 2-row compact order list (zero horizontal spillover!)
      this.remainingItems.forEach((recipeId, idx) => {
        const def = getRecipeDef(recipeId);
        const rowY = idx === 0 ? -13 : 13;

        if (idx === 1) {
          const divider = this.scene.add.graphics();
          divider.lineStyle(1, 0xfde68a, 0.9);
          divider.lineBetween(-34, 0, 34, 0);
          this.bubbleItemsContainer.add(divider);
        }

        const iconGfx = this.scene.add.graphics();
        Customer.drawFoodIcon(iconGfx, recipeId, -24, rowY, 0.62);
        this.bubbleItemsContainer.add(iconGfx);

        const label = this.scene.add
          .text(-8, rowY, def.shortName, {
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: '9.5px',
            fontStyle: 'bold',
            color: '#0f172a',
          })
          .setOrigin(0, 0.5);
        this.bubbleItemsContainer.add(label);
      });
    }

    this.drawMatchDots(rows, bubbleW, isSamePair);
  }

  /**
   * Draws coloured dots on the right edge of each bubble row, one per tray slot that
   * currently holds that recipe, so players can see "Tray 2 → this customer" at a glance.
   */
  private drawMatchDots(rows: number, bubbleW: number, isSamePair: boolean): void {
    const rowRecipes: RecipeId[] =
      rows === 1 || isSamePair ? [this.remainingItems[0]] : [...this.remainingItems];

    rowRecipes.forEach((recipeId, idx) => {
      const colors = this.matchColors[recipeId] ?? [];
      if (colors.length === 0) return;
      const rowY = rows === 1 ? 0 : idx === 0 ? -13 : 13;
      const dots = this.scene.add.graphics();
      colors.slice(0, 3).forEach((color, i) => {
        const dy = rowY + (i - (Math.min(colors.length, 3) - 1) / 2) * 9;
        dots.fillStyle(0x0f172a, 1);
        dots.fillCircle(bubbleW / 2, dy, 5.5);
        dots.fillStyle(color, 1);
        dots.fillCircle(bubbleW / 2, dy, 4);
      });
      this.bubbleItemsContainer.add(dots);
    });
  }

  /** Updates which tray slot colours match this customer's remaining items (redraws only on change). */
  public setMatchColors(colors: Partial<Record<RecipeId, number[]>>): void {
    const key = Object.keys(colors)
      .sort()
      .map((k) => `${k}:${(colors[k] ?? []).join(',')}`)
      .join('|');
    if (key === this.matchKey) return;
    this.matchKey = key;
    this.matchColors = colors;
    if (this.customerState === 'waiting' || this.customerState === 'walking_in') {
      this.refreshSpeechBubble();
    }
  }

  /**
   * Upgraded 2D procedural food illustrations with shadows, highlights, and authentic details
   */
  public static drawFoodIcon(
    gfx: Phaser.GameObjects.Graphics,
    recipeId: RecipeId,
    cx: number,
    cy: number,
    scale = 1
  ): void {
    if (recipeId === 'teh_tarik') {
      // Saucer shadow
      gfx.fillStyle(0x000000, 0.22);
      gfx.fillEllipse(cx, cy + 11 * scale, 22 * scale, 6 * scale);
      // Glass handle
      gfx.lineStyle(2.5 * scale, 0xe2e8f0, 1);
      gfx.strokeCircle(cx + 9 * scale, cy + 1 * scale, 4.8 * scale);
      // Warm pulled tea body
      gfx.fillStyle(0xc27838, 1);
      gfx.fillRoundedRect(cx - 9.5 * scale, cy - 10 * scale, 18 * scale, 21 * scale, 3 * scale);
      // Darker tea depth at bottom
      gfx.fillStyle(0x9a5b25, 0.6);
      gfx.fillRoundedRect(cx - 8.5 * scale, cy + 2 * scale, 16 * scale, 8 * scale, 2 * scale);
      // Vertical glass highlight
      gfx.fillStyle(0xffffff, 0.3);
      gfx.fillRect(cx - 6.5 * scale, cy - 6 * scale, 2.5 * scale, 14 * scale);
      // Glass rim outline
      gfx.lineStyle(1.4 * scale, 0xf8fafc, 0.9);
      gfx.strokeRoundedRect(cx - 9.5 * scale, cy - 10 * scale, 18 * scale, 21 * scale, 3 * scale);
      // Frothy pulled foam crown (3 bubbles)
      gfx.fillStyle(0xfef3c7, 1);
      gfx.fillRoundedRect(cx - 10.5 * scale, cy - 13 * scale, 20 * scale, 6 * scale, 3 * scale);
      gfx.fillCircle(cx - 5 * scale, cy - 12 * scale, 3.2 * scale);
      gfx.fillCircle(cx, cy - 13 * scale, 3.6 * scale);
      gfx.fillCircle(cx + 5 * scale, cy - 12 * scale, 3.2 * scale);
    } else if (recipeId === 'milo_ais') {
      // Tall iced Milo glass
      gfx.fillStyle(0x000000, 0.22);
      gfx.fillEllipse(cx, cy + 12 * scale, 20 * scale, 5 * scale);
      gfx.fillStyle(0x3e2723, 1);
      gfx.fillRoundedRect(cx - 9 * scale, cy - 11 * scale, 18 * scale, 23 * scale, 3 * scale);
      // Chocolate malt gradient highlight
      gfx.fillStyle(0x5d4037, 0.7);
      gfx.fillRect(cx - 6 * scale, cy - 7 * scale, 4 * scale, 16 * scale);
      gfx.lineStyle(1.5 * scale, 0x22c55e, 0.95);
      gfx.strokeRoundedRect(cx - 9 * scale, cy - 11 * scale, 18 * scale, 23 * scale, 3 * scale);
      // Floating ice cubes
      gfx.fillStyle(0xe0f2fe, 0.9);
      gfx.fillRoundedRect(cx - 6 * scale, cy - 8 * scale, 5 * scale, 5 * scale, 1 * scale);
      gfx.fillRoundedRect(cx + 1 * scale, cy - 7 * scale, 5 * scale, 5 * scale, 1 * scale);
      // Milo Dinosaur cocoa powder heap on top
      gfx.fillStyle(0x271914, 1);
      gfx.fillEllipse(cx, cy - 10 * scale, 14 * scale, 4 * scale);
      // Red angled straw
      gfx.lineStyle(2.2 * scale, 0xef4444, 1);
      gfx.lineBetween(cx + 3 * scale, cy - 5 * scale, cx + 8 * scale, cy - 16 * scale);
    } else if (recipeId === 'roti_canai') {
      // Plate shadow + stainless steel plate rim
      gfx.fillStyle(0x000000, 0.25);
      gfx.fillEllipse(cx, cy + 4 * scale, 30 * scale, 19 * scale);
      gfx.fillStyle(0xe2e8f0, 1);
      gfx.fillEllipse(cx, cy + 2 * scale, 29 * scale, 18 * scale);
      gfx.lineStyle(1.5 * scale, 0x64748b, 1);
      gfx.strokeEllipse(cx, cy + 2 * scale, 29 * scale, 18 * scale);
      // Crispy golden flaky flatbread with char rings
      gfx.fillStyle(0xfbbf24, 1);
      gfx.fillEllipse(cx - 3 * scale, cy + 2 * scale, 19 * scale, 12.5 * scale);
      gfx.fillStyle(0xfef08a, 0.7);
      gfx.fillEllipse(cx - 4 * scale, cy + 1 * scale, 12 * scale, 7 * scale);
      gfx.lineStyle(1.1 * scale, 0xb45309, 0.9);
      gfx.strokeEllipse(cx - 3 * scale, cy + 2 * scale, 14 * scale, 8 * scale);
      // Dual stainless steel curry bowls: yellow Dhal + red Sambal
      gfx.fillStyle(0xf59e0b, 1);
      gfx.fillCircle(cx + 7 * scale, cy + 4 * scale, 3.8 * scale);
      gfx.fillStyle(0xdc2626, 1);
      gfx.fillCircle(cx + 8 * scale, cy - 2 * scale, 3.8 * scale);
    } else if (recipeId === 'maggi_goreng') {
      gfx.fillStyle(0x000000, 0.25);
      gfx.fillEllipse(cx, cy + 4 * scale, 30 * scale, 19 * scale);
      gfx.fillStyle(0xf8fafc, 1);
      gfx.fillEllipse(cx, cy + 2 * scale, 29 * scale, 18 * scale);
      gfx.lineStyle(1.2 * scale, 0x94a3b8, 1);
      gfx.strokeEllipse(cx, cy + 2 * scale, 29 * scale, 18 * scale);
      // Spiced dark-soy wok noodles
      gfx.fillStyle(0xb45309, 1);
      gfx.fillEllipse(cx, cy + 2 * scale, 21 * scale, 13 * scale);
      gfx.lineStyle(1.2 * scale, 0xf59e0b, 0.85);
      gfx.strokeEllipse(cx - 2 * scale, cy + 2 * scale, 13 * scale, 7 * scale);
      // Sunny-side-up fried egg (Telur Mata)
      gfx.fillStyle(0xffffff, 1);
      gfx.fillCircle(cx - 2 * scale, cy + 1 * scale, 5.5 * scale);
      gfx.fillStyle(0xf97316, 1);
      gfx.fillCircle(cx - 2 * scale, cy + 1 * scale, 2.8 * scale);
      // Calamansi lime (Limau Kasturi) + bok choy leaf
      gfx.fillStyle(0x16a34a, 1);
      gfx.fillCircle(cx + 7.5 * scale, cy + 3 * scale, 3.2 * scale);
    } else if (recipeId === 'roti_telur') {
      gfx.fillStyle(0x000000, 0.25);
      gfx.fillEllipse(cx, cy + 4 * scale, 30 * scale, 19 * scale);
      gfx.fillStyle(0xe2e8f0, 1);
      gfx.fillEllipse(cx, cy + 2 * scale, 29 * scale, 18 * scale);
      gfx.lineStyle(1.5 * scale, 0x64748b, 1);
      gfx.strokeEllipse(cx, cy + 2 * scale, 29 * scale, 18 * scale);
      // Folded square egg parcel
      gfx.fillStyle(0xfde047, 1);
      gfx.fillRoundedRect(cx - 12 * scale, cy - 4 * scale, 19 * scale, 12 * scale, 2.5 * scale);
      gfx.fillStyle(0xf97316, 0.65);
      gfx.fillRoundedRect(cx - 8 * scale, cy - 1.5 * scale, 11 * scale, 7 * scale, 1.5 * scale);
      gfx.lineStyle(1.4 * scale, 0xb45309, 1);
      gfx.strokeRoundedRect(cx - 12 * scale, cy - 4 * scale, 19 * scale, 12 * scale, 2.5 * scale);
      // Curry ramekin
      gfx.fillStyle(0xdc2626, 1);
      gfx.fillCircle(cx + 9 * scale, cy - 1 * scale, 4 * scale);
    } else if (recipeId === 'nasi_kandar') {
      gfx.fillStyle(0x000000, 0.25);
      gfx.fillEllipse(cx, cy + 4 * scale, 30 * scale, 19 * scale);
      gfx.fillStyle(0xf8fafc, 1);
      gfx.fillEllipse(cx, cy + 2 * scale, 29 * scale, 18 * scale);
      gfx.lineStyle(1.2 * scale, 0x94a3b8, 1);
      gfx.strokeEllipse(cx, cy + 2 * scale, 29 * scale, 18 * scale);
      // Fluffy white rice mound
      gfx.fillStyle(0xffffff, 1);
      gfx.fillCircle(cx - 3 * scale, cy + 1 * scale, 7.5 * scale);
      // Kuah Campur (flooded mixed dark/red curries)
      gfx.fillStyle(0x991b1b, 0.95);
      gfx.fillCircle(cx + 3 * scale, cy + 3 * scale, 6 * scale);
      // Crispy Ayam Goreng Berempah piece + bendi (okra)
      gfx.fillStyle(0xd97706, 1);
      gfx.fillEllipse(cx + 2 * scale, cy - 2 * scale, 11 * scale, 6.5 * scale);
      gfx.lineStyle(2 * scale, 0x16a34a, 1);
      gfx.lineBetween(cx - 9 * scale, cy + 5 * scale, cx - 2 * scale, cy + 7 * scale);
    } else {
      gfx.fillStyle(0xe2e8f0, 1);
      gfx.fillCircle(cx, cy, 12 * scale);
      gfx.fillStyle(0xd97706, 1);
      gfx.fillCircle(cx, cy, 8 * scale);
    }
  }

  private setupInteractivity(): void {
    this.setInteractive(
      new Phaser.Geom.Rectangle(-48, -125, 96, 165),
      Phaser.Geom.Rectangle.Contains
    );
  }

  private walkToCounter(): void {
    this.scene.tweens.add({
      targets: this,
      x: this.targetX,
      y: this.targetY,
      duration: 600,
      ease: 'Power2.easeOut',
      onComplete: () => {
        if (this.customerState !== 'walking_in') return;
        this.customerState = 'waiting';
        this.patienceBarBg.setVisible(true);
        this.patienceBarFill.setVisible(true);
        this.bubbleContainer.setVisible(true);
        this.bubbleContainer.setScale(0.2);
        this.scene.tweens.add({
          targets: this.bubbleContainer,
          scaleX: 1,
          scaleY: 1,
          duration: 220,
          ease: 'Back.easeOut',
        });
        this.updatePatienceBarGraphic();
      },
    });
  }

  public canAcceptRecipe(recipeId: RecipeId): boolean {
    return (
      this.customerState === 'waiting' &&
      this.remainingItems.includes(recipeId)
    );
  }

  public setHighlight(active: boolean): void {
    this.highlightRing.setVisible(active && this.customerState === 'waiting');
  }

  public serveItem(recipeId: RecipeId): boolean {
    if (!this.canAcceptRecipe(recipeId)) return false;

    const index = this.remainingItems.indexOf(recipeId);
    if (index === -1) return false;

    this.remainingItems.splice(index, 1);
    const patienceRatio = this.getPatienceRatio();
    const allComplete = this.remainingItems.length === 0;

    this.callbacks.onServed(this, recipeId, allComplete, patienceRatio);

    if (allComplete) {
      this.leaveHappy();
    } else {
      this.refreshSpeechBubble();
    }
    return true;
  }

  public getPatienceRatio(): number {
    return Math.max(0, Math.min(1, this.remainingPatienceMs / this.maxPatienceMs));
  }

  /** Restores a fraction of max patience (e.g. +0.35 when a live football goal is scored!). */
  public boostPatience(ratioDelta: number): void {
    if (this.customerState !== 'waiting') return;
    this.remainingPatienceMs = Math.min(
      this.maxPatienceMs,
      this.remainingPatienceMs + this.maxPatienceMs * ratioDelta
    );
    this.updatePatienceBarGraphic();
    this.scene.tweens.add({
      targets: this,
      y: this.targetY - 8,
      duration: 130,
      yoyo: true,
      repeat: 1,
      ease: 'Sine.easeOut',
    });
  }

  private updatePatienceBarGraphic(): void {
    const ratio = this.getPatienceRatio();
    const maxW = 58;
    const fillW = Math.max(0, maxW * ratio);

    let color = 0x22c55e;
    if (ratio <= 0.3) {
      color = 0xef4444;
      this.drawFace('angry');
    } else if (ratio <= 0.6) {
      color = 0xfacc15;
      this.drawFace('impatient');
    } else {
      this.drawFace('neutral');
    }

    this.patienceBarFill.clear();
    if (fillW > 0) {
      this.patienceBarFill.fillStyle(color, 1);
      this.patienceBarFill.fillRoundedRect(-29, -52, fillW, 5, 2.5);
    }
  }

  private leaveHappy(): void {
    this.customerState = 'leaving_happy';
    this.highlightRing.setVisible(false);
    this.patienceBarBg.setVisible(false);
    this.patienceBarFill.setVisible(false);
    this.bubbleContainer.setVisible(false);
    this.drawFace('happy');

    const exitX = this.seatIndex <= 1 ? -70 : 460;
    this.scene.tweens.add({
      targets: this,
      x: exitX,
      alpha: 0,
      duration: 500,
      ease: 'Power2.easeIn',
      onComplete: () => {
        this.callbacks.onExited(this);
      },
    });
  }

  private leaveAngry(): void {
    this.customerState = 'leaving_angry';
    this.highlightRing.setVisible(false);
    this.patienceBarBg.setVisible(false);
    this.patienceBarFill.setVisible(false);
    this.drawFace('angry');

    this.bubbleItemsContainer.removeAll(true);
    this.bubbleBg.clear();
    this.bubbleBg.fillStyle(0xfee2e2, 0.98);
    this.bubbleBg.fillRoundedRect(-34, -18, 68, 36, 8);
    this.bubbleBg.lineStyle(2, 0xdc2626, 1);
    this.bubbleBg.strokeRoundedRect(-34, -18, 68, 36, 8);

    const angryLabel = this.scene.add
      .text(0, 0, '😡 LAMBAT!', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '10px',
        fontStyle: 'bold',
        color: '#b91c1c',
      })
      .setOrigin(0.5);
    this.bubbleItemsContainer.add(angryLabel);

    this.callbacks.onTimeout(this);

    const exitX = this.seatIndex <= 1 ? -70 : 460;
    this.scene.tweens.add({
      targets: this,
      x: exitX,
      alpha: 0,
      delay: 350,
      duration: 500,
      ease: 'Power2.easeIn',
      onComplete: () => {
        this.callbacks.onExited(this);
      },
    });
  }

  public updateEntity(_time: number, delta: number): void {
    if (this.customerState !== 'waiting') return;
    if (this.patienceFrozen) return;

    this.remainingPatienceMs = Math.max(0, this.remainingPatienceMs - delta);
    this.updatePatienceBarGraphic();

    if (this.remainingPatienceMs <= 0) {
      this.leaveAngry();
    }
  }
}
