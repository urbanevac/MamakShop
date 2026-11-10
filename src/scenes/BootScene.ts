import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    // Preload initial assets here
  }

  create(): void {
    this.scene.start('MainScene');
  }
}
