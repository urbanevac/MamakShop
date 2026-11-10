import Phaser from 'phaser';
import { BaseEntity } from './BaseEntity';
import { RecipeId } from '../state/GameState';
import { getRecipeDef } from '../config/recipes';

export type CustomerState = 'walking_in' | 'waiting' | 'leaving_happy' | 'leaving_angry';

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
  public readonly requestedItems: RecipeId[];
  public readonly remainingItems: RecipeId[];
  public customerState: CustomerState = 'walking_in';

  private readonly maxPatienceMs = 15000; // 15 seconds decay
  private remainingPatienceMs = 15000;

  private readonly targetX: number;
  private readonly targetY: number;
  private readonly callbacks: CustomerEvents;

  private bodyGraphics!: Phaser.GameObjects.Graphics;
  private faceGraphics!: Phaser.GameObjects.Graphics;
  private bubbleContainer!: Phaser.GameObjects.Container;
  private bubbleBg!: Phaser.GameObjects.Graphics;
  private bubbleItemsContainer!: Phaser.GameObjects.Container;
  private patienceBarBg!: Phaser.GameObjects.Graphics;
  private patienceBarFill!: Phaser.GameObjects.Graphics;
  private highlightRing!: Phaser.GameObjects.Graphics;

  private readonly shirtColor: number;
  private readonly skinColor: number;

  constructor(
    scene: Phaser.Scene,
    seatIndex: number,
    spawnX: number,
    spawnY: number,
    targetX: number,
    targetY: number,
    requestedItems: RecipeId[],
    callbacks: CustomerEvents
  ) {
    super(scene, spawnX, spawnY);
    this.seatIndex = seatIndex;
    this.targetX = targetX;
    this.targetY = targetY;
    this.requestedItems = [...requestedItems];
    this.remainingItems = [...requestedItems];
    this.callbacks = callbacks;

    this.shirtColor = SHIRT_COLORS[Math.floor(Math.random() * SHIRT_COLORS.length)];
    this.skinColor = SKIN_TONES[Math.floor(Math.random() * SKIN_TONES.length)];

    this.buildVisuals();
    this.setupInteractivity();
    this.walkToCounter();
  }

  private buildVisuals(): void {
    // Drop target highlight ring when dragging food near customer
    this.highlightRing = this.scene.add.graphics();
    this.highlightRing.lineStyle(3, 0xfacc15, 0.95);
    this.highlightRing.strokeCircle(0, -10, 48);
    this.highlightRing.setVisible(false);
    this.add(this.highlightRing);

    // Character torso & head (2D styled canvas shapes)
    this.bodyGraphics = this.scene.add.graphics();
    // Shadow
    this.bodyGraphics.fillStyle(0x000000, 0.3);
    this.bodyGraphics.fillEllipse(0, 34, 54, 16);

    // Shoulders / Shirt
    this.bodyGraphics.fillStyle(this.shirtColor, 1);
    this.bodyGraphics.fillRoundedRect(-24, -4, 48, 38, 12);
    this.bodyGraphics.lineStyle(2, 0x1e293b, 0.8);
    this.bodyGraphics.strokeRoundedRect(-24, -4, 48, 38, 12);

    // Collar detail
    this.bodyGraphics.fillStyle(0xffffff, 0.25);
    this.bodyGraphics.fillTriangle(-8, -4, 8, -4, 0, 8);

    // Head
    this.bodyGraphics.fillStyle(this.skinColor, 1);
    this.bodyGraphics.fillCircle(0, -22, 19);
    this.bodyGraphics.lineStyle(2, 0x1e293b, 0.8);
    this.bodyGraphics.strokeCircle(0, -22, 19);

    // Hair / Cap
    this.bodyGraphics.fillStyle(0x1c1917, 1);
    this.bodyGraphics.slice(0, -24, 19, Phaser.Math.DegToRad(190), Phaser.Math.DegToRad(350), false);
    this.bodyGraphics.fillPath();

    this.add(this.bodyGraphics);

    // Facial expression graphics (updated dynamically with patience)
    this.faceGraphics = this.scene.add.graphics();
    this.add(this.faceGraphics);
    this.drawFace('neutral');

    // Patience Bar above head (width 64px, sits at y = -54)
    this.patienceBarBg = this.scene.add.graphics();
    this.patienceBarBg.fillStyle(0x18181b, 0.95);
    this.patienceBarBg.fillRoundedRect(-32, -56, 64, 9, 4);
    this.patienceBarBg.lineStyle(1, 0xfef08a, 0.6);
    this.patienceBarBg.strokeRoundedRect(-32, -56, 64, 9, 4);
    this.patienceBarBg.setVisible(false);
    this.add(this.patienceBarBg);

    this.patienceBarFill = this.scene.add.graphics();
    this.patienceBarFill.setVisible(false);
    this.add(this.patienceBarFill);

    // Speech Bubble container above patience bar (y = -108)
    this.bubbleContainer = this.scene.add.container(0, -108);
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
    // Eyes
    this.faceGraphics.fillStyle(0x18181b, 1);
    this.faceGraphics.fillCircle(-6, -24, 2.2);
    this.faceGraphics.fillCircle(6, -24, 2.2);

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
      // Flat mouth + furrowed brows
      this.faceGraphics.lineBetween(-5, -15, 5, -15);
      this.faceGraphics.lineBetween(-9, -28, -3, -27);
      this.faceGraphics.lineBetween(9, -28, 3, -27);
    } else if (mood === 'angry') {
      // Frown + angry brows
      this.faceGraphics.beginPath();
      this.faceGraphics.arc(0, -12, 5, Phaser.Math.DegToRad(200), Phaser.Math.DegToRad(340), false);
      this.faceGraphics.strokePath();
      this.faceGraphics.lineStyle(2.2, 0xdc2626, 1);
      this.faceGraphics.lineBetween(-9, -29, -3, -26);
      this.faceGraphics.lineBetween(9, -29, 3, -26);
    }
  }

  private refreshSpeechBubble(): void {
    this.bubbleItemsContainer.removeAll(true);
    this.bubbleBg.clear();

    const count = this.remainingItems.length;
    if (count === 0) {
      this.bubbleContainer.setVisible(false);
      return;
    }

    const bubbleW = count === 1 ? 86 : 132;
    const bubbleH = 44;

    // White speech bubble with Mamak yellow border & tail
    this.bubbleBg.fillStyle(0xfffbeb, 0.98);
    this.bubbleBg.fillRoundedRect(-bubbleW / 2, -bubbleH / 2, bubbleW, bubbleH, 10);
    this.bubbleBg.lineStyle(2.5, 0xf59e0b, 1);
    this.bubbleBg.strokeRoundedRect(-bubbleW / 2, -bubbleH / 2, bubbleW, bubbleH, 10);

    // Speech bubble pointer triangle
    this.bubbleBg.fillStyle(0xfffbeb, 0.98);
    this.bubbleBg.fillTriangle(-6, bubbleH / 2 - 1, 6, bubbleH / 2 - 1, 0, bubbleH / 2 + 8);
    this.bubbleBg.lineStyle(2.5, 0xf59e0b, 1);
    this.bubbleBg.lineBetween(-6, bubbleH / 2, 0, bubbleH / 2 + 8);
    this.bubbleBg.lineBetween(6, bubbleH / 2, 0, bubbleH / 2 + 8);

    const spacing = 60;
    const startX = -((count - 1) * spacing) / 2;

    this.remainingItems.forEach((recipeId, idx) => {
      const def = getRecipeDef(recipeId);
      const itemX = startX + idx * spacing;

      const iconGfx = this.scene.add.graphics();
      Customer.drawFoodIcon(iconGfx, recipeId, itemX - 18, 0, 0.78);
      this.bubbleItemsContainer.add(iconGfx);

      const label = this.scene.add
        .text(itemX + 2, 0, def.shortName.replace(' ', '\n'), {
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: '10px',
          fontStyle: 'bold',
          color: '#1c1917',
          align: 'left',
          lineSpacing: -1,
        })
        .setOrigin(0, 0.5);
      this.bubbleItemsContainer.add(label);
    });
  }

  /**
   * Reusable 2D procedural canvas food icon renderer
   */
  public static drawFoodIcon(
    gfx: Phaser.GameObjects.Graphics,
    recipeId: RecipeId,
    cx: number,
    cy: number,
    scale = 1
  ): void {
    if (recipeId === 'teh_tarik') {
      gfx.lineStyle(2.5 * scale, 0xcbd5e1, 1);
      gfx.strokeCircle(cx + 9 * scale, cy, 5 * scale);
      gfx.fillStyle(0xc27838, 1);
      gfx.fillRoundedRect(cx - 10 * scale, cy - 11 * scale, 19 * scale, 22 * scale, 3 * scale);
      gfx.lineStyle(1.5 * scale, 0xe2e8f0, 0.9);
      gfx.strokeRoundedRect(cx - 10 * scale, cy - 11 * scale, 19 * scale, 22 * scale, 3 * scale);
      gfx.fillStyle(0xfef3c7, 1);
      gfx.fillRoundedRect(cx - 11 * scale, cy - 13 * scale, 21 * scale, 6 * scale, 3 * scale);
    } else if (recipeId === 'milo_ais') {
      // Iced Milo glass with green rim & red straw
      gfx.fillStyle(0x3e2723, 1);
      gfx.fillRoundedRect(cx - 9 * scale, cy - 11 * scale, 18 * scale, 23 * scale, 3 * scale);
      gfx.lineStyle(1.5 * scale, 0x22c55e, 0.95);
      gfx.strokeRoundedRect(cx - 9 * scale, cy - 11 * scale, 18 * scale, 23 * scale, 3 * scale);
      // Ice cubes & Milo powder top
      gfx.fillStyle(0xe0f2fe, 0.85);
      gfx.fillRect(cx - 6 * scale, cy - 8 * scale, 5 * scale, 5 * scale);
      gfx.fillRect(cx + 1 * scale, cy - 7 * scale, 5 * scale, 5 * scale);
      // Red straw
      gfx.lineStyle(2 * scale, 0xef4444, 1);
      gfx.lineBetween(cx + 3 * scale, cy - 5 * scale, cx + 8 * scale, cy - 16 * scale);
    } else if (recipeId === 'roti_canai') {
      gfx.fillStyle(0xcbd5e1, 1);
      gfx.fillEllipse(cx, cy + 2 * scale, 28 * scale, 18 * scale);
      gfx.lineStyle(1.5 * scale, 0x64748b, 1);
      gfx.strokeEllipse(cx, cy + 2 * scale, 28 * scale, 18 * scale);
      gfx.fillStyle(0xfbbf24, 1);
      gfx.fillEllipse(cx - 2 * scale, cy + 2 * scale, 18 * scale, 12 * scale);
      gfx.lineStyle(1 * scale, 0xb45309, 0.9);
      gfx.strokeEllipse(cx - 2 * scale, cy + 2 * scale, 12 * scale, 7 * scale);
      gfx.fillStyle(0xdc2626, 1);
      gfx.fillCircle(cx + 8 * scale, cy - 1 * scale, 4 * scale);
    } else if (recipeId === 'maggi_goreng') {
      // Plate with curly spiced noodles, fried egg & lime
      gfx.fillStyle(0xe2e8f0, 1);
      gfx.fillEllipse(cx, cy + 2 * scale, 28 * scale, 18 * scale);
      gfx.fillStyle(0xb45309, 1);
      gfx.fillEllipse(cx, cy + 2 * scale, 20 * scale, 13 * scale);
      // Sunny side egg on top
      gfx.fillStyle(0xffffff, 1);
      gfx.fillCircle(cx - 2 * scale, cy + 1 * scale, 5 * scale);
      gfx.fillStyle(0xf97316, 1);
      gfx.fillCircle(cx - 2 * scale, cy + 1 * scale, 2.5 * scale);
      // Green calamansi lime
      gfx.fillStyle(0x22c55e, 1);
      gfx.fillCircle(cx + 7 * scale, cy + 3 * scale, 3 * scale);
    } else if (recipeId === 'roti_telur') {
      // Rectangular folded egg roti with yellow egg center & curry
      gfx.fillStyle(0xcbd5e1, 1);
      gfx.fillEllipse(cx, cy + 2 * scale, 28 * scale, 18 * scale);
      gfx.fillStyle(0xfde047, 1);
      gfx.fillRoundedRect(cx - 11 * scale, cy - 4 * scale, 18 * scale, 12 * scale, 2 * scale);
      gfx.lineStyle(1.5 * scale, 0xd97706, 1);
      gfx.strokeRoundedRect(cx - 11 * scale, cy - 4 * scale, 18 * scale, 12 * scale, 2 * scale);
      gfx.fillStyle(0xdc2626, 1);
      gfx.fillCircle(cx + 9 * scale, cy - 1 * scale, 4 * scale);
    } else if (recipeId === 'nasi_kandar') {
      // Steamed rice mound with flood of mixed curries (Kuah Campur) & fried chicken
      gfx.fillStyle(0xe2e8f0, 1);
      gfx.fillEllipse(cx, cy + 2 * scale, 28 * scale, 18 * scale);
      gfx.fillStyle(0xffffff, 1);
      gfx.fillCircle(cx - 3 * scale, cy + 1 * scale, 7 * scale);
      gfx.fillStyle(0x991b1b, 1);
      gfx.fillCircle(cx + 4 * scale, cy + 2 * scale, 6 * scale);
      gfx.fillStyle(0xd97706, 1);
      gfx.fillCircle(cx, cy - 2 * scale, 4 * scale);
    } else {
      gfx.fillStyle(0xe2e8f0, 1);
      gfx.fillCircle(cx, cy, 12 * scale);
      gfx.fillStyle(0xd97706, 1);
      gfx.fillCircle(cx, cy, 8 * scale);
    }
  }

  private setupInteractivity(): void {
    this.setSize(100, 160);
    this.setInteractive(
      new Phaser.Geom.Rectangle(-50, -125, 100, 165),
      Phaser.Geom.Rectangle.Contains
    );
  }

  private walkToCounter(): void {
    // Bobbing walk animation toward target stool/counter position
    this.scene.tweens.add({
      targets: this,
      x: this.targetX,
      y: this.targetY,
      duration: 650,
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

  private updatePatienceBarGraphic(): void {
    const ratio = this.getPatienceRatio();
    const maxW = 60;
    const fillW = Math.max(0, maxW * ratio);

    let color = 0x22c55e; // Green (> 60%)
    if (ratio <= 0.3) {
      color = 0xef4444; // Red (<= 30%)
      this.drawFace('angry');
    } else if (ratio <= 0.6) {
      color = 0xfacc15; // Yellow (30% - 60%)
      this.drawFace('impatient');
    } else {
      this.drawFace('neutral');
    }

    this.patienceBarFill.clear();
    if (fillW > 0) {
      this.patienceBarFill.fillStyle(color, 1);
      this.patienceBarFill.fillRoundedRect(-30, -54, fillW, 5, 2.5);
    }
  }

  private leaveHappy(): void {
    this.customerState = 'leaving_happy';
    this.highlightRing.setVisible(false);
    this.patienceBarBg.setVisible(false);
    this.patienceBarFill.setVisible(false);
    this.bubbleContainer.setVisible(false);
    this.drawFace('happy');

    const exitX = this.seatIndex === 0 ? -70 : 460;
    this.scene.tweens.add({
      targets: this,
      x: exitX,
      alpha: 0,
      duration: 550,
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

    // Replace speech bubble content with angry storm symbol
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

    const exitX = this.seatIndex === 0 ? -70 : 460;
    this.scene.tweens.add({
      targets: this,
      x: exitX,
      alpha: 0,
      delay: 350,
      duration: 550,
      ease: 'Power2.easeIn',
      onComplete: () => {
        this.callbacks.onExited(this);
      },
    });
  }

  public updateEntity(_time: number, delta: number): void {
    if (this.customerState !== 'waiting') return;

    this.remainingPatienceMs = Math.max(0, this.remainingPatienceMs - delta);
    this.updatePatienceBarGraphic();

    if (this.remainingPatienceMs <= 0) {
      this.leaveAngry();
    }
  }
}
