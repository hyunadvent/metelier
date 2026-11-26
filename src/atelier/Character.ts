import { Container, Graphics } from 'pixi.js';

export type Pose = 'idle' | 'walk' | 'sit';

const OUTLINE = 0x5b4636;

/**
 * 임시 캐릭터 (토끼). 도형으로만 그렸으며, 실제 스프라이트가 준비되면 이 클래스만 바꾸면 된다.
 * view 의 원점은 발 가운데다.
 */
export class Character {
  readonly view = new Container();
  private readonly inner = new Container();
  private readonly upper = new Container();
  private readonly legLeft = new Graphics();
  private readonly legRight = new Graphics();
  private readonly shadow = new Graphics();
  private pose: Pose = 'idle';
  private time = 0;

  constructor() {
    this.shadow.ellipse(0, 0, 62, 14).fill({ color: OUTLINE, alpha: 0.18 });

    for (const [leg, x] of [
      [this.legLeft, -34],
      [this.legRight, 8],
    ] as const) {
      leg.roundRect(0, -52, 26, 52, 11).fill(0xfff6ea).stroke({ width: 4, color: OUTLINE });
      leg.position.set(x, 0);
    }

    const ears = new Graphics();
    for (const x of [-30, 30]) {
      ears.ellipse(x, -268, 17, 44).fill(0xfff6ea).stroke({ width: 4, color: OUTLINE });
      ears.ellipse(x, -264, 7, 26).fill(0xf9c5d1);
    }
    const body = new Graphics().roundRect(-54, -156, 108, 118, 38).fill(0xf7b6c8).stroke({ width: 4, color: OUTLINE });
    body.roundRect(-24, -112, 48, 34, 10).fill(0xfff6ea).stroke({ width: 3, color: OUTLINE }); // 앞치마 주머니
    const head = new Graphics().circle(0, -196, 64).fill(0xfff6ea).stroke({ width: 4, color: OUTLINE });
    head.circle(-23, -198, 6.5).fill(OUTLINE).circle(23, -198, 6.5).fill(OUTLINE);
    head.ellipse(-40, -180, 11, 7).fill({ color: 0xf48fb1, alpha: 0.7 });
    head.ellipse(40, -180, 11, 7).fill({ color: 0xf48fb1, alpha: 0.7 });
    head.ellipse(0, -184, 5, 3.5).fill(0xe58aa0); // 코
    this.upper.addChild(ears, body, head);

    this.inner.addChild(this.legLeft, this.legRight, this.upper);
    this.view.addChild(this.shadow, this.inner);
  }

  setPose(pose: Pose): void {
    this.pose = pose;
    const sitting = pose === 'sit';
    this.legLeft.visible = !sitting;
    this.legRight.visible = !sitting;
    this.shadow.visible = !sitting;
    this.legLeft.scale.y = 1;
    this.legRight.scale.y = 1;
    // 앉으면 다리만큼 내려앉는다.
    this.upper.position.set(0, sitting ? 38 : 0);
    this.inner.rotation = 0;
  }

  /** 바라보는 방향: -1 왼쪽, 1 오른쪽 */
  face(direction: -1 | 1): void {
    this.inner.scale.x = direction;
  }

  update(dt: number): void {
    this.time += dt;
    if (this.pose === 'walk') {
      const swing = Math.sin(this.time * 11);
      this.upper.y = -Math.abs(swing) * 9;
      this.legLeft.scale.y = 1 - Math.max(0, swing) * 0.3;
      this.legRight.scale.y = 1 - Math.max(0, -swing) * 0.3;
      this.inner.rotation = swing * 0.04;
    } else {
      // 가만히 있을 때는 숨 쉬듯 살짝 움직인다.
      this.upper.y = (this.pose === 'sit' ? 38 : 0) + Math.sin(this.time * 2.2) * 2.5;
    }
  }
}
