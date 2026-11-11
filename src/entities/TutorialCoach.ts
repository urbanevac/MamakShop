import Phaser from 'phaser';
import { BaseEntity } from './BaseEntity';
import { RecipeId } from '../state/GameState';
import { ScreenRect, StationEvent, StationTarget } from './PrepStationDock';
import { GAME_WIDTH, GAME_HEIGHT } from '../config/constants';
import { haptic, HAPTIC } from '../utils/haptics';

export type TutorialEvent = StationEvent | 'served' | 'discarded';
export type TutorialTarget = StationTarget | 'serve' | 'trash' | 'pause' | 'none';

export interface ScreenPoint {
  x: number;
  y: number;
}

/** What the tutorial needs from the scene that hosts it. */
export interface TutorialHost {
  getTargetRect: (target: StationTarget | 'trash' | 'pause') => ScreenRect;
  /** Drag path from the plated tray item to the customer who wants it. */
  getServePath: () => { from: ScreenPoint; to: ScreenPoint } | null;
  /** Spawns a scripted, patience-frozen customer (no-op if the seat is taken). */
  spawnTutorialCustomer: (seatIndex: number, order: RecipeId) => void;
  /** Called once when the tutorial completes or is skipped. */
  finishTutorial: () => void;
}

type StepId =
  | 'welcome'
  | 'kettle'
  | 'filling'
  | 'cup'
  | 'serveDrink'
  | 'dough'
  | 'cooking'
  | 'flip'
  | 'plate'
  | 'serveFood'
  | 'trash'
  | 'pause'
  | 'done';

interface StepDef {
  target: TutorialTarget;
  text: string;
  /** Event that advances this step. Omit for "tap anywhere to continue" steps. */
  advanceOn?: TutorialEvent;
  next: StepId | 'finish';
  /** Input region: 'focus' (only the spotlight) or 'play' (customers + tray area). */
  allow?: 'focus' | 'play';
  showFinger?: boolean;
  onEnter?: () => void;
}

/** Customers + serving tray band (between HUD and Prep Dock). */
const PLAY_REGION: ScreenRect = { x: 0, y: 156, w: GAME_WIDTH, h: 294 };
const HOLE_PAD = 6;

/**
 * "Hari Pertama" — a skippable, event-driven first-shift tutorial.
 * Each step spotlights a real control and waits for the player to actually use it.
 */
export class TutorialCoach extends BaseEntity {
  private readonly host: TutorialHost;
  private readonly steps: Record<StepId, StepDef>;
  private currentId: StepId = 'welcome';
  private stepShownAt = 0;
  private finished = false;
  private stepTweens: Phaser.Tweens.Tween[] = [];

  constructor(scene: Phaser.Scene, host: TutorialHost) {
    super(scene, 0, 0);
    this.host = host;
    this.setDepth(80);

    this.steps = {
      welcome: {
        target: 'none',
        text:
          'Welcome to your stall, boss! 🙏\nFirst day on the job, let Ane show you the ropes lah. Look — got one customer ordering Teh Tarik already!',
        next: 'kettle',
        onEnter: () => this.host.spawnTutorialCustomer(0, 'teh_tarik'),
      },
      kettle: {
        target: 'kettle',
        text: 'Step 1: Tap the KETTLE to pour hot tea, boss. 🫖',
        advanceOn: 'kettle_tapped',
        next: 'filling',
        showFinger: true,
      },
      filling: {
        target: 'cup',
        text: 'Wait ah, pouring now... steady, steady! ⏳',
        advanceOn: 'drink_filled',
        next: 'cup',
      },
      cup: {
        target: 'cup',
        text: "Cup's full! Tap the CUP to 'tarik' the tea — make it nice and frothy, baru syok! 💪",
        advanceOn: 'drink_plated',
        next: 'serveDrink',
        showFinger: true,
      },
      serveDrink: {
        target: 'serve',
        text:
          'Nice! Teh Tarik is on the tray. DRAG it to the customer — or just TAP it to auto-serve the most impatient one lah!',
        advanceOn: 'served',
        next: 'dough',
        allow: 'play',
        showFinger: true,
      },
      dough: {
        target: 'dough',
        text: 'Steady lah! Next customer wants Roti Canai. Tap DOUGH to toss it onto the griddle. 🫓',
        advanceOn: 'dough_tapped',
        next: 'cooking',
        showFinger: true,
        onEnter: () => this.host.spawnTutorialCustomer(1, 'roti_canai'),
      },
      cooking: {
        target: 'griddle',
        text: 'Cooking now... wait till it turns golden brown ah ✨',
        advanceOn: 'roti_ready_to_flip',
        next: 'flip',
      },
      flip: {
        target: 'griddle',
        text: 'Quick, tap to FLIP now! Too slow and it burns — rugi duit, boss! 🔥',
        advanceOn: 'roti_flipped',
        next: 'plate',
        showFinger: true,
      },
      plate: {
        target: 'griddle',
        text: 'Cantik! Tap the griddle one more time to plate it with Dhal & Sambal. 🍽️',
        advanceOn: 'food_plated',
        next: 'serveFood',
        showFinger: true,
      },
      serveFood: {
        target: 'serve',
        text: 'Now serve that Roti Canai to the customer — drag or tap!',
        advanceOn: 'served',
        next: 'trash',
        allow: 'play',
        showFinger: true,
      },
      trash: {
        target: 'trash',
        text:
          'Made the wrong item? Drag it to the 🗑️ bin here. Costs a 50% penalty + Rep -1 though, so don\'t waste food ah!',
        next: 'pause',
      },
      pause: {
        target: 'pause',
        text: 'Need a quick break or got phone call? Tap ⏸ anytime. Switching apps will auto-pause for you too. 👍',
        next: 'done',
      },
      done: {
        target: 'none',
        text:
          'Kedai open for business! 🎉\nServe fast for extra tips & 🔥 combos — too slow and customers will walk out! Good luck, boss!',
        next: 'finish',
      },
    };

    this.goTo('welcome');
  }

  public get isActive(): boolean {
    return !this.finished;
  }

  /** Feed gameplay milestones in; advances the step when it matches. */
  public handleEvent(event: TutorialEvent): void {
    if (this.finished) return;
    const id = this.currentId;

    // Recovery paths so the player can never get stuck
    if (event === 'roti_burned' && (id === 'cooking' || id === 'flip')) {
      this.goTo('dough', 'Alamak, burnt already! 😱 Never mind — tap DOUGH to make a fresh one, and flip faster ah!');
      return;
    }
    if (event === 'discarded' && id === 'serveDrink') {
      this.goTo('kettle', 'Aiyoh, threw it away ah? 😅 Brew another Teh Tarik — tap the KETTLE.');
      return;
    }
    if (event === 'discarded' && id === 'serveFood') {
      this.goTo('dough', 'Aiyoh, threw it away ah? 😅 Cook another Roti Canai — tap DOUGH.');
      return;
    }

    const step = this.steps[id];
    if (step.advanceOn === event) {
      this.advance();
    }
  }

  private advance(): void {
    const next = this.steps[this.currentId].next;
    if (next === 'finish') {
      this.finish();
    } else {
      this.goTo(next);
    }
  }

  public skip(): void {
    this.finish();
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.clearStep();
    this.host.finishTutorial();
    this.destroy();
  }

  private clearStep(): void {
    this.stepTweens.forEach((t) => t.remove());
    this.stepTweens = [];
    this.removeAll(true);
  }

  private goTo(id: StepId, textOverride?: string): void {
    this.currentId = id;
    const step = this.steps[id];
    step.onEnter?.();
    this.render(step, textOverride ?? step.text);
    this.stepShownAt = this.scene.time.now;
  }

  // ===========================================================================
  // Rendering
  // ===========================================================================

  private resolveFocus(step: StepDef): {
    focus: ScreenRect | null;
    serve: { from: ScreenPoint; to: ScreenPoint } | null;
  } {
    if (step.target === 'none') return { focus: null, serve: null };
    if (step.target === 'serve') {
      const path = this.host.getServePath();
      if (!path) return { focus: PLAY_REGION, serve: null };
      const minX = Math.min(path.from.x, path.to.x) - 52;
      const maxX = Math.max(path.from.x, path.to.x) + 52;
      const minY = Math.min(path.from.y, path.to.y) - 130;
      const maxY = Math.max(path.from.y, path.to.y) + 34;
      return {
        focus: {
          x: Math.max(8, minX),
          y: Math.max(PLAY_REGION.y, minY),
          w: Math.min(GAME_WIDTH - 8, maxX) - Math.max(8, minX),
          h: maxY - Math.max(PLAY_REGION.y, minY),
        },
        serve: path,
      };
    }
    const r = this.host.getTargetRect(step.target);
    return {
      focus: { x: r.x - HOLE_PAD, y: r.y - HOLE_PAD, w: r.w + HOLE_PAD * 2, h: r.h + HOLE_PAD * 2 },
      serve: null,
    };
  }

  private render(step: StepDef, text: string): void {
    this.clearStep();
    const { focus, serve } = this.resolveFocus(step);
    const tapToContinue = step.advanceOn === undefined;

    // 1. Dim scrim with a rectangular spotlight hole around the focus
    const dim = this.scene.add.graphics();
    dim.fillStyle(0x020617, tapToContinue ? 0.62 : 0.5);
    if (focus) {
      this.fillAround(dim, focus);
    } else {
      dim.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    }
    this.add(dim);

    // 2. Input handling
    if (tapToContinue) {
      const catcher = this.scene.add
        .zone(0, 0, GAME_WIDTH, GAME_HEIGHT)
        .setOrigin(0)
        .setInteractive();
      catcher.on('pointerdown', () => {
        if (this.scene.time.now - this.stepShownAt < 350) return;
        haptic(HAPTIC.tap, 'tap');
        this.advance();
      });
      this.add(catcher);
    } else {
      const allow = step.allow === 'play' ? PLAY_REGION : focus ?? PLAY_REGION;
      this.addBlockersAround(allow);
    }

    // 3. Pulsing spotlight outline
    if (focus) {
      const ring = this.scene.add.graphics();
      ring.lineStyle(3, 0xfacc15, 1);
      ring.strokeRoundedRect(focus.x, focus.y, focus.w, focus.h, 12);
      this.add(ring);
      this.stepTweens.push(
        this.scene.tweens.add({
          targets: ring,
          alpha: 0.35,
          duration: 520,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        })
      );
    }

    // 4. Pointing finger (or a drag demo for serve steps)
    if (step.showFinger && focus) {
      this.addFinger(focus, serve);
    }

    // 5. Coach speech bubble (with Skip)
    this.addBubble(text, focus, tapToContinue);
  }

  private fillAround(gfx: Phaser.GameObjects.Graphics, hole: ScreenRect): void {
    const right = hole.x + hole.w;
    const bottom = hole.y + hole.h;
    gfx.fillRect(0, 0, GAME_WIDTH, Math.max(0, hole.y));
    gfx.fillRect(0, bottom, GAME_WIDTH, Math.max(0, GAME_HEIGHT - bottom));
    gfx.fillRect(0, hole.y, Math.max(0, hole.x), hole.h);
    gfx.fillRect(right, hole.y, Math.max(0, GAME_WIDTH - right), hole.h);
  }

  /** Invisible input blockers covering everything except the allowed region. */
  private addBlockersAround(allow: ScreenRect): void {
    const right = allow.x + allow.w;
    const bottom = allow.y + allow.h;
    const rects: ScreenRect[] = [
      { x: 0, y: 0, w: GAME_WIDTH, h: allow.y },
      { x: 0, y: bottom, w: GAME_WIDTH, h: GAME_HEIGHT - bottom },
      { x: 0, y: allow.y, w: allow.x, h: allow.h },
      { x: right, y: allow.y, w: GAME_WIDTH - right, h: allow.h },
    ];
    rects.forEach((r) => {
      if (r.w <= 0 || r.h <= 0) return;
      const z = this.scene.add.zone(r.x, r.y, r.w, r.h).setOrigin(0).setInteractive();
      this.add(z);
    });
  }

  private addFinger(
    focus: ScreenRect,
    serve: { from: ScreenPoint; to: ScreenPoint } | null
  ): void {
    const finger = this.scene.add
      .text(0, 0, '👆', { fontSize: '30px' })
      .setOrigin(0.3, 0);
    this.add(finger);

    if (serve) {
      // Drag demo: finger glides from the tray item up to the customer, then repeats
      finger.setPosition(serve.from.x, serve.from.y + 4);
      this.stepTweens.push(
        this.scene.tweens.add({
          targets: finger,
          x: serve.to.x,
          y: serve.to.y - 10,
          duration: 1100,
          ease: 'Sine.easeInOut',
          repeat: -1,
          repeatDelay: 450,
          hold: 250,
        })
      );
      return;
    }

    const fx = focus.x + focus.w * 0.62;
    const fy = focus.y + focus.h * 0.55;
    finger.setPosition(fx, fy);
    this.stepTweens.push(
      this.scene.tweens.add({
        targets: finger,
        y: fy + 9,
        duration: 420,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      })
    );
  }

  private addBubble(text: string, focus: ScreenRect | null, tapToContinue: boolean): void {
    const bubbleW = 330;
    const bubbleX = (GAME_WIDTH - bubbleW) / 2;
    const padX = 16;

    const header = this.scene.add.text(bubbleX + padX, 0, '☕ ANE SAYS:', {
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '10px',
      fontStyle: 'bold',
      color: '#b45309',
    });

    const body = this.scene.add.text(bubbleX + padX, 0, text, {
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '13.5px',
      fontStyle: 'bold',
      color: '#1c1917',
      wordWrap: { width: bubbleW - padX * 2 },
      lineSpacing: 3,
    });

    const footer = tapToContinue
      ? this.scene.add
          .text(bubbleX + bubbleW - padX, 0, 'Tap anywhere to continue ▶', {
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: '10px',
            fontStyle: 'bold',
            color: '#92400e',
          })
          .setOrigin(1, 0)
      : null;

    const bubbleH = 14 + header.height + 6 + body.height + (footer ? 10 + footer.height : 0) + 14;

    // Place the bubble above the focus if the focus sits in the lower half, else below it
    let bubbleY: number;
    if (!focus) {
      bubbleY = GAME_HEIGHT / 2 - bubbleH / 2;
    } else if (focus.y + focus.h / 2 > GAME_HEIGHT / 2) {
      bubbleY = focus.y - 16 - bubbleH;
    } else {
      bubbleY = focus.y + focus.h + 16;
    }
    bubbleY = Phaser.Math.Clamp(bubbleY, 12, GAME_HEIGHT - bubbleH - 12);

    const bg = this.scene.add.graphics();
    bg.fillStyle(0x000000, 0.4);
    bg.fillRoundedRect(bubbleX + 3, bubbleY + 4, bubbleW, bubbleH, 14);
    bg.fillStyle(0xfffbeb, 1);
    bg.fillRoundedRect(bubbleX, bubbleY, bubbleW, bubbleH, 14);
    bg.lineStyle(2.5, 0xf59e0b, 1);
    bg.strokeRoundedRect(bubbleX, bubbleY, bubbleW, bubbleH, 14);
    this.add(bg);

    header.setY(bubbleY + 14);
    body.setY(header.y + header.height + 6);
    this.add([header, body]);
    if (footer) {
      footer.setY(body.y + body.height + 10);
      this.add(footer);
    }

    // Skip pill (always on top of the blockers)
    const skip = this.scene.add
      .text(bubbleX + bubbleW - 10, bubbleY + 9, 'Skip ⏭', {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#fffbeb',
        backgroundColor: '#78350f',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true });
    skip.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event?.stopPropagation?.();
      haptic(HAPTIC.tap, 'tap');
      this.skip();
    });
    this.add(skip);

    // Gentle pop-in
    this.setAlpha(0);
    this.stepTweens.push(this.scene.tweens.add({ targets: this, alpha: 1, duration: 160 }));
  }

  public updateEntity(_time: number, _delta: number): void {
    // Event driven
  }
}
