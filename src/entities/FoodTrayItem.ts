import Phaser from 'phaser';
import { BaseEntity } from './BaseEntity';
import { Customer } from './Customer';
import { RecipeId } from '../state/GameState';
import { getRecipeDef } from '../config/recipes';

export class FoodTrayItem extends BaseEntity {
  public readonly trayIndex: number;
  public readonly recipeId: RecipeId;
  private readonly homeX: number;
  private readonly homeY: number;
  private readonly onServeAttempt: (
    item: FoodTrayItem,
    pointerX: number,
    pointerY: number,
    wasClick: boolean
  ) => boolean;
  private readonly onDragHover: (
    item: FoodTrayItem,
    pointerX: number,
    pointerY: number,
    isDragging: boolean
  ) => void;

  private dragStartX = 0;
  private dragStartY = 0;
  private isDragging = false;

  constructor(
    scene: Phaser.Scene,
    trayIndex: number,
    recipeId: RecipeId,
    x: number,
    y: number,
    onServeAttempt: (
      item: FoodTrayItem,
      pointerX: number,
      pointerY: number,
      wasClick: boolean
    ) => boolean,
    onDragHover: (
      item: FoodTrayItem,
      pointerX: number,
      pointerY: number,
      isDragging: boolean
    ) => void
  ) {
    super(scene, x, y);
    this.trayIndex = trayIndex;
    this.recipeId = recipeId;
    this.homeX = x;
    this.homeY = y;
    this.onServeAttempt = onServeAttempt;
    this.onDragHover = onDragHover;

    this.buildVisuals();
    this.setupDragAndClick();
  }

  private buildVisuals(): void {
    const def = getRecipeDef(this.recipeId);
    const gfx = this.scene.add.graphics();

    // Compact stainless steel serving plate base (3 slots + Trash bin on the 390px counter)
    gfx.fillStyle(0x94a3b8, 1);
    gfx.fillRoundedRect(-41, -28, 82, 56, 10);
    gfx.fillStyle(0xe2e8f0, 1);
    gfx.fillRoundedRect(-37, -24, 74, 48, 8);
    gfx.lineStyle(2, 0xfacc15, 0.95);
    gfx.strokeRoundedRect(-41, -28, 82, 56, 10);

    Customer.drawFoodIcon(gfx, this.recipeId, 0, -5, 1.0);
    this.add(gfx);

    const label = this.scene.add
      .text(0, 16, `${def.shortName} (RM${def.price.toFixed(2)})`, {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '8px',
        fontStyle: 'bold',
        color: '#0f172a',
      })
      .setOrigin(0.5);
    this.add(label);

    const badge = this.scene.add
      .text(0, -34, 'SERVE / DRAG 🗑️', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '7px',
        fontStyle: 'bold',
        color: '#fef08a',
        backgroundColor: '#15803d',
        padding: { x: 4, y: 1.5 },
      })
      .setOrigin(0.5);
    this.add(badge);
  }

  private setupDragAndClick(): void {
    this.setSize(84, 62);
    this.setInteractive(
      new Phaser.Geom.Rectangle(-42, -31, 84, 62),
      Phaser.Geom.Rectangle.Contains
    );
    this.scene.input.setDraggable(this);

    this.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.dragStartX = pointer.x;
      this.dragStartY = pointer.y;
      this.isDragging = false;
      this.setDepth(60);
      this.setScale(1.1);
    });

    this.on('drag', (pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
      const dist = Phaser.Math.Distance.Between(
        this.dragStartX,
        this.dragStartY,
        pointer.x,
        pointer.y
      );
      if (dist > 6) {
        this.isDragging = true;
      }
      this.setPosition(dragX, dragY);
      this.onDragHover(this, pointer.x, pointer.y, true);
    });

    this.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      this.onDragHover(this, pointer.x, pointer.y, false);
      const wasClick = !this.isDragging;
      const handled = this.onServeAttempt(this, pointer.x, pointer.y, wasClick);
      if (!handled && this.scene) {
        this.snapBackHome();
      }
    });
  }

  public snapBackHome(): void {
    this.setScale(1);
    this.setDepth(25);
    this.scene.tweens.add({
      targets: this,
      x: this.homeX,
      y: this.homeY,
      duration: 180,
      ease: 'Back.easeOut',
    });
  }

  public updateEntity(_time: number, _delta: number): void {
    // Static when resting on tray
  }
}
