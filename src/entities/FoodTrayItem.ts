import Phaser from 'phaser';
import { BaseEntity } from './BaseEntity';
import { Customer } from './Customer';
import { RecipeId } from '../state/GameState';
import { getRecipeDef } from '../config/recipes';

/** Distinct marker colours per tray slot — mirrored as dots on matching customers' speech bubbles. */
export const TRAY_SLOT_COLORS: readonly number[] = [0x22d3ee, 0xf472b6, 0xa3e635];

export type ServeResult = 'served' | 'rejected' | 'cancel';

export interface TrayItemCallbacks {
  /** Called on release. Returns whether the item was served, rejected (wrong target) or cancelled. */
  onServeAttempt: (
    item: FoodTrayItem,
    pointerX: number,
    pointerY: number,
    wasClick: boolean
  ) => ServeResult;
  /** Called while dragging (after the finger moves past the tap threshold) and on release. */
  onDragHover: (
    item: FoodTrayItem,
    pointerX: number,
    pointerY: number,
    isDragging: boolean
  ) => void;
  /** Called on press (active=true) so the scene can preview the tap-to-serve target. */
  onPressPreview: (item: FoodTrayItem, active: boolean) => void;
}

export class FoodTrayItem extends BaseEntity {
  public readonly trayIndex: number;
  public readonly recipeId: RecipeId;
  public readonly isPadu: boolean;
  private readonly homeX: number;
  private readonly homeY: number;
  private readonly callbacks: TrayItemCallbacks;

  private statusTag!: Phaser.GameObjects.Text;
  private hasNoOrder = false;

  private dragStartX = 0;
  private dragStartY = 0;
  private isDragging = false;
  private releaseHandled = true;

  constructor(
    scene: Phaser.Scene,
    trayIndex: number,
    recipeId: RecipeId,
    x: number,
    y: number,
    callbacks: TrayItemCallbacks,
    isPadu = false
  ) {
    super(scene, x, y);
    this.trayIndex = trayIndex;
    this.recipeId = recipeId;
    this.isPadu = isPadu;
    this.homeX = x;
    this.homeY = y;
    this.callbacks = callbacks;

    this.buildVisuals();
    this.setupDragAndClick();
  }

  public get slotColor(): number {
    return TRAY_SLOT_COLORS[this.trayIndex % TRAY_SLOT_COLORS.length];
  }

  private buildVisuals(): void {
    const def = getRecipeDef(this.recipeId);
    const gfx = this.scene.add.graphics();

    // Compact stainless steel serving plate base (3 slots + Trash bin on the 390px counter)
    gfx.fillStyle(this.isPadu ? 0xfef08a : 0x94a3b8, 1);
    gfx.fillRoundedRect(-41, -28, 82, 56, 10);
    gfx.fillStyle(this.isPadu ? 0xfffbeb : 0xe2e8f0, 1);
    gfx.fillRoundedRect(-37, -24, 74, 48, 8);
    gfx.lineStyle(this.isPadu ? 2.5 : 2, this.isPadu ? 0xf59e0b : 0xfacc15, 0.98);
    gfx.strokeRoundedRect(-41, -28, 82, 56, 10);

    Customer.drawFoodIcon(gfx, this.recipeId, 0, -5, 1.0);

    // Slot colour marker (top-left) — same colour appears on matching customers' bubbles
    gfx.fillStyle(0x0f172a, 1);
    gfx.fillCircle(-31, -18, 7.5);
    gfx.fillStyle(this.slotColor, 1);
    gfx.fillCircle(-31, -18, 6);
    this.add(gfx);

    if (this.isPadu) {
      const paduBadge = this.scene.add
        .text(28, -18, '✨', {
          fontSize: '11px',
        })
        .setOrigin(0.5);
      this.add(paduBadge);
    }

    const slotNum = this.scene.add
      .text(-31, -18, `${this.trayIndex + 1}`, {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '8px',
        fontStyle: 'bold',
        color: '#0f172a',
      })
      .setOrigin(0.5);
    this.add(slotNum);

    const priceDisplay = this.isPadu ? def.price + 1.0 : def.price;
    const label = this.scene.add
      .text(0, 16, `${def.shortName} (RM${priceDisplay.toFixed(2)})`, {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '8px',
        fontStyle: 'bold',
        color: this.isPadu ? '#b45309' : '#0f172a',
      })
      .setOrigin(0.5);
    this.add(label);

    this.statusTag = this.scene.add
      .text(0, -34, this.isPadu ? '✨ PADU! (+RM1)' : 'SERVE ✓ / DRAG', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '7.5px',
        fontStyle: 'bold',
        color: this.isPadu ? '#1c1917' : '#fef08a',
        backgroundColor: this.isPadu ? '#facc15' : '#15803d',
        padding: { x: 4, y: 1.5 },
      })
      .setOrigin(0.5);
    this.add(this.statusTag);
  }

  /** Shows an amber "No order" tag when no seated customer wants this item. */
  public setNoOrder(noOrder: boolean): void {
    if (this.hasNoOrder === noOrder) return;
    this.hasNoOrder = noOrder;
    if (noOrder) {
      this.statusTag
        .setText('❓ NO ORDER')
        .setBackgroundColor('#b45309')
        .setColor('#fffbeb');
    } else if (this.isPadu) {
      this.statusTag
        .setText('✨ PADU! (+RM1)')
        .setBackgroundColor('#facc15')
        .setColor('#1c1917');
    } else {
      this.statusTag
        .setText('SERVE ✓ / DRAG')
        .setBackgroundColor('#15803d')
        .setColor('#fef08a');
    }
  }

  public get isMoving(): boolean {
    return this.isDragging;
  }

  private setupDragAndClick(): void {
    // Do NOT call this.setSize() here: in Phaser 3, Container.displayOriginX/Y = width*0.5 / height*0.5,
    // which shifts hitArea coordinates by (+width/2, +height/2) and clips the bottom/right half!
    // Leaving width=0, height=0 keeps (0,0) at the true center of the tray item.
    this.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(-47, -42, 94, 76),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true,
    });
    this.scene.input.setDraggable(this);

    this.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.dragStartX = pointer.x;
      this.dragStartY = pointer.y;
      this.isDragging = false;
      this.releaseHandled = false;
      this.scene.tweens.killTweensOf(this);
      this.setDepth(60);
      this.setScale(1.1);
      this.callbacks.onPressPreview(this, true);
    });

    this.on('drag', (pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
      const dist = Phaser.Math.Distance.Between(
        this.dragStartX,
        this.dragStartY,
        pointer.x,
        pointer.y
      );
      if (dist > 12 && !this.isDragging) {
        this.isDragging = true;
        this.callbacks.onPressPreview(this, false);
      }
      if (!this.isDragging) return;
      this.setPosition(dragX, dragY);
      this.callbacks.onDragHover(this, pointer.x, pointer.y, true);
    });

    // Handle release from either event: 'pointerup' may not reach this item if another
    // interactive object (e.g. a tutorial overlay) is on top at the release point.
    const onRelease = (pointer: Phaser.Input.Pointer) => {
      if (this.releaseHandled || !this.scene) return;
      this.releaseHandled = true;
      this.callbacks.onPressPreview(this, false);
      this.callbacks.onDragHover(this, pointer.x, pointer.y, false);
      const distFromHome = Phaser.Math.Distance.Between(
        this.homeX,
        this.homeY,
        pointer.x,
        pointer.y
      );
      const wasClick = !this.isDragging || distFromHome < 36;
      const result = this.callbacks.onServeAttempt(this, pointer.x, pointer.y, wasClick);
      if (!this.scene) return; // served & destroyed
      if (result === 'rejected') {
        this.rejectBounce();
      } else if (result === 'cancel') {
        this.snapBackHome();
      }
    };
    this.on('pointerup', onRelease);
    this.on('dragend', onRelease);
  }

  public snapBackHome(onDone?: () => void): void {
    this.setScale(1);
    this.setDepth(25);
    this.scene.tweens.add({
      targets: this,
      x: this.homeX,
      y: this.homeY,
      duration: 180,
      ease: 'Back.easeOut',
      onComplete: () => onDone?.(),
    });
  }

  /** Snap home, then shake side-to-side to signal "nobody wants this here". */
  public rejectBounce(): void {
    this.snapBackHome(() => {
      if (!this.scene) return;
      this.scene.tweens.add({
        targets: this,
        x: this.homeX + 6,
        duration: 45,
        yoyo: true,
        repeat: 3,
        ease: 'Sine.easeInOut',
        onComplete: () => this.setX(this.homeX),
      });
    });
  }

  public updateEntity(_time: number, _delta: number): void {
    // Static when resting on tray
  }
}
