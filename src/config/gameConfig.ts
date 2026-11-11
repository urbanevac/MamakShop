import Phaser from 'phaser';
import { BootScene } from '../scenes/BootScene';
import { MainScene } from '../scenes/MainScene';
import { GAME_WIDTH, GAME_HEIGHT } from './constants';

export { GAME_WIDTH, GAME_HEIGHT };

/**
 * Supersampling factor (2x–3x) for crisp Retina / High-DPI vector & text rendering
 * while keeping all game coordinates, hitboxes, and pointers in 390x720 logical units.
 */
export const RENDER_DPR =
  typeof window !== 'undefined'
    ? Math.min(3, Math.max(2, Math.round(window.devicePixelRatio || 2)))
    : 2;

const origTextFactory = Phaser.GameObjects.GameObjectFactory.prototype.text;
Phaser.GameObjects.GameObjectFactory.prototype.text = function (
  x: number,
  y: number,
  text: string | string[],
  style?: Phaser.Types.GameObjects.Text.TextStyle
) {
  const mergedStyle: Phaser.Types.GameObjects.Text.TextStyle = {
    ...style,
    resolution: RENDER_DPR,
  };
  return origTextFactory.call(this, x, y, text, mergedStyle);
};

// Supersample the Canvas 2D renderer at RENDER_DPR (e.g. 780x1440 or 1170x2160 physical pixels)
// while keeping ScaleManager & InputManager at logical 390x720 coordinates.
const CanvasRendererProto = Phaser.Renderer.Canvas.CanvasRenderer.prototype as unknown as {
  __retinaPatched?: boolean;
  resize: (width: number, height: number) => void;
  preRender: () => void;
  gameCanvas: HTMLCanvasElement;
  gameContext: CanvasRenderingContext2D;
  width: number;
  height: number;
};

if (CanvasRendererProto && !CanvasRendererProto.__retinaPatched) {
  CanvasRendererProto.__retinaPatched = true;

  const origResize = CanvasRendererProto.resize;
  CanvasRendererProto.resize = function (width: number, height: number) {
    const physW = Math.round(width * RENDER_DPR);
    const physH = Math.round(height * RENDER_DPR);
    if (this.gameCanvas) {
      this.gameCanvas.width = physW;
      this.gameCanvas.height = physH;
    }
    origResize.call(this, physW, physH);
  };

  const origPreRender = CanvasRendererProto.preRender;
  CanvasRendererProto.preRender = function () {
    const targetW = Math.round(GAME_WIDTH * RENDER_DPR);
    const targetH = Math.round(GAME_HEIGHT * RENDER_DPR);
    if (
      this.gameCanvas &&
      (this.gameCanvas.width !== targetW || this.gameCanvas.height !== targetH)
    ) {
      this.gameCanvas.width = targetW;
      this.gameCanvas.height = targetH;
      this.width = targetW;
      this.height = targetH;
    }
    origPreRender.call(this);
  };

  const origSetTransform = CanvasRenderingContext2D.prototype
    .setTransform as unknown as (
    this: CanvasRenderingContext2D,
    a?: number | DOMMatrix2DInit,
    b?: number,
    c?: number,
    d?: number,
    e?: number,
    f?: number
  ) => void;

  (CanvasRenderingContext2D.prototype as unknown as {
    setTransform: typeof origSetTransform;
  }).setTransform = function (
    this: CanvasRenderingContext2D,
    a?: number | DOMMatrix2DInit,
    b?: number,
    c?: number,
    d?: number,
    e?: number,
    f?: number
  ) {
    if (typeof a === 'number') {
      if (this.canvas && this.canvas.parentElement?.id === 'game-container') {
        return origSetTransform.call(
          this,
          a * RENDER_DPR,
          (b ?? 0) * RENDER_DPR,
          (c ?? 0) * RENDER_DPR,
          (d ?? 1) * RENDER_DPR,
          (e ?? 0) * RENDER_DPR,
          (f ?? 0) * RENDER_DPR
        );
      }
      return origSetTransform.call(this, a, b, c, d, e, f);
    }
    return origSetTransform.call(this, a);
  };
}

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.CANVAS,
  parent: 'game-container',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#120e0c',
  roundPixels: false,
  render: {
    antialias: true,
    pixelArt: false,
    roundPixels: false,
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
