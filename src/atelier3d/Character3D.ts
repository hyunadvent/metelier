import * as THREE from 'three';

export type Pose3D = 'idle' | 'walk' | 'sit';

/** 엉덩이 높이 (모델 단위). 앉을 때 이 높이가 의자 위에 온다. */
const HIP = 0.4;
const SCALE = 0.72;

/**
 * 임시 3D 캐릭터 (토끼). 기본 도형으로만 만들었으며, 실제 모델(GLB)이 준비되면 이 클래스만 바꾸면 된다.
 * group 의 원점은 발 가운데이고 +z 를 바라본다.
 */
export class Character3D {
  readonly group = new THREE.Group();
  private readonly upper = new THREE.Group();
  private readonly legs: THREE.Group[] = [];
  private readonly arms: THREE.Group[] = [];
  private readonly disposables: { dispose(): void }[] = [];
  private pose: Pose3D = 'idle';
  private time = 0;

  constructor() {
    const mat = (color: number) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
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
    const dark = mat(0x5b4636);
    const pink = mat(0xf48fb1);

    const model = new THREE.Group();
    model.scale.setScalar(SCALE);
    this.group.add(model);

    // 다리: 엉덩이를 축으로 앞뒤로 흔든다
    for (const x of [-0.12, 0.12]) {
      const hip = new THREE.Group();
      hip.position.set(x, HIP, 0);
      mesh(new THREE.CapsuleGeometry(0.085, 0.2, 6, 12), fur, hip).position.y = -0.2;
      model.add(hip);
      this.legs.push(hip);
    }

    model.add(this.upper);
    mesh(new THREE.CapsuleGeometry(0.27, 0.26, 8, 20), dress, this.upper).position.y = 0.7;
    mesh(new THREE.SphereGeometry(0.1, 14, 10), fur, this.upper).position.set(0, 0.52, -0.27); // 꼬리
    for (const x of [-0.31, 0.31]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(x, 0.86, 0);
      mesh(new THREE.CapsuleGeometry(0.065, 0.2, 6, 12), fur, shoulder).position.y = -0.16;
      shoulder.rotation.z = x > 0 ? 0.25 : -0.25;
      this.upper.add(shoulder);
      this.arms.push(shoulder);
    }

    const head = new THREE.Group();
    head.position.y = 1.22;
    this.upper.add(head);
    mesh(new THREE.SphereGeometry(0.32, 28, 20), fur, head);
    for (const x of [-0.14, 0.14]) {
      const ear = mesh(new THREE.CapsuleGeometry(0.07, 0.3, 6, 12), fur, head);
      ear.position.set(x, 0.44, -0.02);
      ear.rotation.z = x > 0 ? -0.12 : 0.12;
      const inner = mesh(new THREE.CapsuleGeometry(0.035, 0.22, 4, 8), pink, head);
      inner.position.set(x, 0.44, 0.045);
      inner.rotation.z = ear.rotation.z;
      mesh(new THREE.SphereGeometry(0.036, 12, 10), dark, head).position.set(x * 0.85, 0.03, 0.295);
      const blush = mesh(new THREE.SphereGeometry(0.055, 12, 10), pink, head);
      blush.position.set(x * 1.45, -0.07, 0.26);
      blush.scale.set(1, 0.6, 0.4);
    }
    mesh(new THREE.SphereGeometry(0.03, 10, 8), pink, head).position.set(0, -0.04, 0.315); // 코
  }

  setPose(pose: Pose3D): void {
    this.pose = pose;
    const sitting = pose === 'sit';
    // 앉으면 다리를 앞으로 뻗는다.
    this.legs.forEach((leg) => (leg.rotation.x = sitting ? -Math.PI / 2 : 0));
    this.arms.forEach((arm) => (arm.rotation.x = 0));
    this.upper.position.y = 0;
  }

  /** 자세가 달라졌을 때만 바꾼다 (매 프레임 불러도 된다). */
  setPoseIfChanged(pose: Pose3D): void {
    if (this.pose !== pose) this.setPose(pose);
  }

  /** 앉았을 때 엉덩이가 놓이는 높이만큼 group 을 내려야 하는 값 */
  static readonly hipHeight = HIP * SCALE;

  update(dt: number): void {
    this.time += dt;
    if (this.pose === 'walk') {
      const swing = Math.sin(this.time * 10);
      this.legs[0].rotation.x = swing * 0.7;
      this.legs[1].rotation.x = -swing * 0.7;
      this.arms[0].rotation.x = -swing * 0.5;
      this.arms[1].rotation.x = swing * 0.5;
      this.upper.position.y = Math.abs(swing) * 0.03;
    } else {
      // 가만히 있을 때는 숨 쉬듯 살짝 움직인다.
      this.upper.position.y = Math.sin(this.time * 2.2) * 0.008;
    }
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
