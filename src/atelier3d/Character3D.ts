import * as THREE from 'three';
import { lathe, smoothProfile } from './shapes';

/** 자세: 서 있기, 걷기, 앉기, 앉아서 차 마시기, 앉아서 책 읽기 */
export type Pose3D = 'idle' | 'walk' | 'sit' | 'tea' | 'read';

/** 팔을 벌린 각도 (어깨의 z 축 회전) */
const ARM_SPREAD = 0.32;

/** 엉덩이 높이 (모델 단위). 앉을 때 이 높이가 의자 위에 온다. */
const HIP = 0.4;
const SCALE = 0.72;

/**
 * 임시 3D 캐릭터 (토끼). 곡면과 도형을 조합해 코드로 만들었으며, 뼈대가 없어 팔다리를 축으로 흔드는 동작만 한다.
 * 실제 모델(GLB)이 준비되면 이 클래스만 바꾸면 된다.
 * group 의 원점은 발 가운데이고 +z 를 바라본다.
 */
export class Character3D {
  readonly group = new THREE.Group();
  private readonly upper = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly legs: THREE.Group[] = [];
  private readonly arms: THREE.Group[] = [];
  private readonly ears: THREE.Group[] = [];
  private readonly lids: THREE.Mesh[] = [];
  /** 차를 마실 때 오른손에 드는 찻잔 */
  private readonly cup = new THREE.Group();
  /** 책을 읽을 때 두 손으로 드는 책 */
  private readonly book = new THREE.Group();
  private readonly disposables: { dispose(): void }[] = [];
  private pose: Pose3D = 'idle';
  private wasAirborne = false;
  private time = 0;

  constructor() {
    const mat = (color: number, roughness = 0.8) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness });
      this.disposables.push(m);
      return m;
    };
    const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D) => {
      this.disposables.push(geometry);
      const m = new THREE.Mesh(geometry, material);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    const fur = mat(0xfff6ea);
    const dress = mat(0xf7b6c8);
    const apron = mat(0xfffaf2);
    const dark = mat(0x5b4636, 0.4);
    const pink = mat(0xf48fb1);
    const white = mat(0xffffff, 0.3);

    const model = new THREE.Group();
    model.scale.setScalar(SCALE);
    this.group.add(model);

    // 다리와 발: 엉덩이를 축으로 앞뒤로 흔든다
    for (const x of [-0.12, 0.12]) {
      const hip = new THREE.Group();
      hip.position.set(x, HIP, 0);
      mesh(new THREE.CapsuleGeometry(0.085, 0.18, 6, 12), fur, hip).position.y = -0.19;
      const foot = mesh(new THREE.SphereGeometry(0.1, 14, 10), fur, hip);
      foot.position.set(0, -0.35, 0.045);
      foot.scale.set(1, 0.6, 1.35);
      model.add(hip);
      this.legs.push(hip);
    }

    model.add(this.upper);
    // 몸통: 아래가 넓은 원피스
    const body = mesh(lathe(smoothProfile([[0, 0.36], [0.2, 0.37], [0.31, 0.45], [0.3, 0.62], [0.22, 0.86], [0.15, 0.98], [0, 1.0]])), dress, this.upper);
    body.receiveShadow = true;
    // 치맛단과 앞치마, 주머니
    const hem = mesh(new THREE.TorusGeometry(0.295, 0.028, 8, 28), apron, this.upper);
    hem.rotation.x = Math.PI / 2;
    hem.position.y = 0.44;
    const bib = mesh(new THREE.SphereGeometry(0.2, 18, 12), apron, this.upper);
    bib.position.set(0, 0.66, 0.13);
    bib.scale.set(0.95, 1.05, 0.62);
    const pocket = mesh(new THREE.SphereGeometry(0.07, 12, 8), pink, this.upper);
    pocket.position.set(0, 0.6, 0.255);
    pocket.scale.set(1.2, 0.85, 0.3);
    mesh(new THREE.SphereGeometry(0.11, 14, 10), fur, this.upper).position.set(0, 0.52, -0.29); // 꼬리
    // 목의 리본
    for (const side of [-1, 1]) {
      const bow = mesh(new THREE.SphereGeometry(0.07, 12, 8), pink, this.upper);
      bow.position.set(side * 0.075, 0.97, 0.19);
      bow.scale.set(1.15, 0.8, 0.45);
    }
    mesh(new THREE.SphereGeometry(0.035, 10, 8), mat(0xe5709a), this.upper).position.set(0, 0.97, 0.21);

    // 팔과 손: 어깨를 축으로 흔든다
    for (const x of [-0.27, 0.27]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(x, 0.88, 0);
      mesh(new THREE.CapsuleGeometry(0.062, 0.2, 6, 12), fur, shoulder).position.y = -0.15;
      mesh(new THREE.SphereGeometry(0.075, 12, 10), fur, shoulder).position.y = -0.31;
      mesh(new THREE.SphereGeometry(0.085, 12, 8), dress, shoulder).scale.set(1, 0.8, 1); // 소매
      shoulder.rotation.z = x > 0 ? ARM_SPREAD : -ARM_SPREAD;
      this.upper.add(shoulder);
      this.arms.push(shoulder);
    }

    // 찻잔: 오른손 끝에 달려 팔과 함께 움직인다. 팔을 앞으로 들었을 때 바로 서도록 미리 기울여 둔다.
    this.cup.position.set(0, -0.37, 0.05);
    this.cup.rotation.x = 1.1;
    mesh(lathe([[0, 0], [0.045, 0], [0.066, 0.05], [0.072, 0.1], [0.064, 0.1], [0.058, 0.05], [0, 0.025]]), white, this.cup);
    const teaSurface = mesh(new THREE.CircleGeometry(0.06, 16), mat(0xc98f5a, 0.3), this.cup);
    teaSurface.rotation.x = -Math.PI / 2;
    teaSurface.position.y = 0.085;
    teaSurface.castShadow = false;
    const cupHandle = mesh(new THREE.TorusGeometry(0.03, 0.008, 6, 12, Math.PI), white, this.cup);
    cupHandle.position.set(0.068, 0.055, 0);
    cupHandle.rotation.z = -Math.PI / 2;
    this.cup.visible = false;
    this.arms[1].add(this.cup);

    // 책: 펼친 채 가슴 앞에 든다
    this.book.position.set(0, 0.66, 0.36);
    this.book.rotation.x = -0.95;
    for (const side of [-1, 1]) {
      const cover = mesh(new THREE.BoxGeometry(0.19, 0.012, 0.27), mat(0x6fb7e9), this.book);
      cover.position.set(side * 0.092, 0, 0);
      cover.rotation.z = side * 0.22;
      const page = mesh(new THREE.BoxGeometry(0.175, 0.014, 0.25), white, this.book);
      page.position.set(side * 0.09, 0.012, 0);
      page.rotation.z = side * 0.22;
      // 글줄
      for (let k = 0; k < 5; k++) {
        const line = mesh(new THREE.BoxGeometry(0.12, 0.002, 0.008), dark, this.book);
        line.position.set(side * 0.09, 0.021, -0.08 + k * 0.04);
        line.rotation.z = side * 0.22;
        line.castShadow = false;
      }
    }
    this.book.visible = false;
    this.upper.add(this.book);

    // 머리
    this.head.position.y = 1.24;
    this.upper.add(this.head);
    // 얼굴은 동그란 공 하나로 단순하게 둔다.
    mesh(new THREE.SphereGeometry(0.33, 32, 24), fur, this.head);
    const nose = mesh(new THREE.SphereGeometry(0.03, 10, 8), pink, this.head);
    nose.position.set(0, -0.045, 0.325);
    nose.scale.set(1.2, 0.8, 0.6);
    // 웃는 입
    for (const side of [-1, 1]) {
      const smile = mesh(new THREE.TorusGeometry(0.028, 0.005, 6, 12, Math.PI), dark, this.head);
      smile.position.set(side * 0.028, -0.085, 0.317);
      smile.rotation.z = Math.PI;
    }
    for (const x of [-0.125, 0.125]) {
      // 눈과 눈 속의 반짝임, 깜빡일 때 덮는 눈꺼풀
      const eye = mesh(new THREE.SphereGeometry(0.043, 14, 12), dark, this.head);
      eye.position.set(x, 0.035, 0.298);
      eye.scale.set(0.9, 1.15, 0.5);
      mesh(new THREE.SphereGeometry(0.014, 8, 6), white, this.head).position.set(x + 0.014, 0.055, 0.32);
      const lid = mesh(new THREE.SphereGeometry(0.05, 12, 10), fur, this.head);
      lid.position.set(x, 0.04, 0.299);
      lid.scale.set(1.0, 1.2, 0.66);
      lid.visible = false;
      lid.castShadow = false;
      this.lids.push(lid);
      const blush = mesh(new THREE.SphereGeometry(0.06, 12, 10), pink, this.head);
      blush.position.set(x * 1.75, -0.07, 0.232);
      blush.scale.set(1, 0.6, 0.3);
      // 귀: 뿌리를 축으로 살짝 흔들린다
      const ear = new THREE.Group();
      ear.position.set(x * 1.05, 0.27, -0.02);
      ear.rotation.z = x > 0 ? -0.14 : 0.14;
      mesh(new THREE.CapsuleGeometry(0.075, 0.34, 8, 14), fur, ear).position.y = 0.24;
      const inner = mesh(new THREE.CapsuleGeometry(0.038, 0.26, 6, 10), pink, ear);
      inner.position.set(0, 0.24, 0.05);
      this.head.add(ear);
      this.ears.push(ear);
    }
  }

  setPose(pose: Pose3D): void {
    this.pose = pose;
    const sitting = pose === 'sit' || pose === 'tea' || pose === 'read';
    // 앉으면 다리를 앞으로 뻗고 손을 무릎 쪽에 둔다.
    this.legs.forEach((leg) => (leg.rotation.x = sitting ? -Math.PI / 2 : 0));
    this.arms.forEach((arm, k) => {
      arm.rotation.x = sitting ? -0.5 : 0;
      // 책을 읽을 때는 두 팔을 몸 앞으로 모은다
      arm.rotation.z = (k === 1 ? 1 : -1) * (pose === 'read' ? -0.12 : ARM_SPREAD);
    });
    this.cup.visible = pose === 'tea';
    this.book.visible = pose === 'read';
    this.upper.position.y = 0;
    this.upper.rotation.z = 0;
    this.head.rotation.set(0, 0, 0);
  }

  /** 머리 가운데의 월드 좌표 */
  headPosition(target: THREE.Vector3): THREE.Vector3 {
    return this.head.getWorldPosition(target);
  }

  /** 팔다리를 크게 움직이는 중인가 (걷기, 점프). 그림자를 매 프레임 다시 그려야 한다. */
  get animating(): boolean {
    return this.pose === 'walk' || this.wasAirborne;
  }

  /** 자세가 달라졌을 때만 바꾼다 (매 프레임 불러도 된다). */
  setPoseIfChanged(pose: Pose3D): void {
    if (this.pose !== pose) this.setPose(pose);
  }

  /** 앉았을 때 엉덩이가 놓이는 높이만큼 group 을 내려야 하는 값 */
  static readonly hipHeight = HIP * SCALE;

  /**
   * @param airborne 점프해서 공중에 떠 있는가
   */
  update(dt: number, airborne = false): void {
    this.time += dt;
    // 땅에 내려서면 공중에서 벌렸던 팔다리를 원래 자세로 되돌린다.
    if (this.wasAirborne && !airborne) this.setPose(this.pose);
    this.wasAirborne = airborne;
    const t = this.time;
    if (this.pose === 'walk') {
      const swing = Math.sin(t * 10);
      this.legs[0].rotation.x = swing * 0.7;
      this.legs[1].rotation.x = -swing * 0.7;
      this.arms[0].rotation.x = -swing * 0.55;
      this.arms[1].rotation.x = swing * 0.55;
      this.upper.position.y = Math.abs(swing) * 0.035;
      this.upper.rotation.z = swing * 0.035;
      this.head.rotation.z = -swing * 0.03;
      // 걸을 때 귀가 한 박자 늦게 따라온다
      this.ears.forEach((ear) => (ear.rotation.x = -0.12 + Math.sin(t * 10 - 0.9) * 0.14));
    } else if (this.pose === 'tea') {
      // 5초마다 한 번 찻잔을 입으로 가져가 한 모금 마신다
      const cycle = t % 5;
      const sip = cycle < 1.8 ? Math.sin((cycle / 1.8) * Math.PI) ** 2 : 0;
      this.arms[1].rotation.x = -1.1 - sip * 0.85;
      this.arms[1].rotation.z = ARM_SPREAD - sip * 0.3;
      this.head.rotation.x = -sip * 0.16;
      this.head.rotation.z = (1 - sip) * Math.sin(t * 0.5) * 0.04;
      this.upper.position.y = Math.sin(t * 2.2) * 0.006;
      this.ears.forEach((ear, k) => (ear.rotation.x = Math.sin(t * 1.1 + k) * 0.05));
    } else if (this.pose === 'read') {
      // 고개를 숙여 책을 보고, 6초마다 책장을 넘긴다
      const cycle = t % 6;
      const turn = cycle < 0.9 ? Math.sin((cycle / 0.9) * Math.PI) : 0;
      this.arms[0].rotation.x = -1.05;
      this.arms[1].rotation.x = -1.05 - turn * 0.3;
      this.arms[1].rotation.z = -0.12 - turn * 0.25;
      this.head.rotation.x = 0.3 + Math.sin(t * 0.6) * 0.03;
      this.head.rotation.y = Math.sin(t * 0.35) * 0.12;
      this.upper.position.y = Math.sin(t * 2.2) * 0.006;
      this.ears.forEach((ear, k) => (ear.rotation.x = Math.sin(t * 0.9 + k) * 0.04));
    } else {
      // 가만히 있을 때는 숨 쉬듯 움직이고, 가끔 고개를 갸웃한다.
      this.upper.position.y = Math.sin(t * 2.2) * 0.008;
      this.head.rotation.z = Math.sin(t * 0.7) * 0.05;
      this.ears.forEach((ear, k) => (ear.rotation.x = Math.sin(t * 1.3 + k) * 0.05));
    }
    if (airborne) {
      // 공중에서는 두 팔을 번쩍 들고 다리를 벌리며, 귀가 뒤로 젖혀진다
      this.legs[0].rotation.x = 0.55;
      this.legs[1].rotation.x = -0.4;
      this.arms.forEach((arm) => (arm.rotation.x = -2.5));
      this.ears.forEach((ear) => (ear.rotation.x = -0.4));
      this.upper.position.y = 0;
      this.upper.rotation.z = 0;
    }
    // 몇 초마다 눈을 깜빡인다
    const blinking = t % 3.6 < 0.13;
    this.lids.forEach((lid) => {
      lid.visible = blinking;
      lid.scale.y = 1.2;
    });
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
