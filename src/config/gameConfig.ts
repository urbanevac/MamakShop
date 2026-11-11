import Phaser from 'phaser';
import { BootScene } from '../scenes/BootScene';
import { MainScene } from '../scenes/MainScene';
import { GAME_WIDTH, GAME_HEIGHT } from './constants';

export { GAME_WIDTH, GAME_HEIGHT };

// Boost Phaser Text default resolution on Retina / high-DPI mobile screens
const dpr = typeof window !== 'undefined' ? Math.min(3, Math.max(2, window.devicePixelRatio || 2)) : 2;
const origTextFactory = Phaser.GameObjects.GameObjectFactory.prototype.text;
Phaser.GameObjects.GameObjectFactory.prototype.text = function (
  x: number,
  y: number,
  text: string | string[],
  style?: Phaser.Types.GameObjects.Text.TextStyle
) {
  const mergedStyle: Phaser.Types.GameObjects.Text.TextStyle = {
    ...style,
    resolution: dpr,
  };
  return origTextFactory.call(this, x, y, text, mergedStyle);
};

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#120e0c',
  roundPixels: true,
  render: {
    antialias: true,
    pixelArt: false,
    roundPixels: true,
    powerPreference: 'high-performance',
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
  },
  input: {
    activePointers: 2,
    touch: {
      capture: true,
    },
  },
  scene: [BootScene, MainScene],
};
