import Phaser from 'phaser';

export abstract class BaseEntity extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y);
    scene.add.existing(this);
  }

  public abstract updateEntity(time: number, delta: number): void;
}
