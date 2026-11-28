import * as THREE from 'three';

/** 별가루 알갱이 수 */
const COUNT = 36;
/** 머리 위 어디서 생겨 어디까지 떨어지는가 (머리 가운데 기준, 미터) */
const TOP = 0.78;
const BOTTOM = 0.12;
/** 퍼지는 반지름 */
const SPREAD = 0.3;

/**
 * 색칠 버프가 걸려 있는 동안 캐릭터 머리 위로 떨어지는 작은 별가루.
 * 버프가 끝나면 서서히 사라진다.
 */
export class Stardust {
  readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly speed = new Float32Array(COUNT);
  private readonly phase = new Float32Array(COUNT);
  private readonly material: THREE.PointsMaterial;
  private readonly texture: THREE.Texture;
  /** 0~1: 보이는 정도 (켜지고 꺼질 때 부드럽게) */
  private strength = 0;
  private time = 0;

  constructor() {
    this.positions = new Float32Array(COUNT * 3);
    this.colors = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) this.respawn(i, Math.random());
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.texture = sparkleTexture();
    this.material = new THREE.PointsMaterial({
      size: 0.08,
      map: this.texture,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    // 외곽선 효과가 알갱이에 테두리를 그리지 않게 한다
    this.material.userData.outlineParameters = { visible: false };
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  /**
   * @param active 버프가 걸려 있는가
   * @param head 캐릭터 머리 가운데 (월드 좌표)
   */
  update(dt: number, active: boolean, head: THREE.Vector3): void {
    this.strength = Math.min(1, Math.max(0, this.strength + (active ? dt * 3 : -dt * 1.5)));
    this.points.visible = this.strength > 0;
    if (!this.points.visible) return;
    this.time += dt;
    this.points.position.copy(head);
    for (let i = 0; i < COUNT; i++) {
      const k = i * 3;
      this.positions[k + 1] -= this.speed[i] * dt;
      if (this.positions[k + 1] < BOTTOM) this.respawn(i, 0);
      // 아래로 갈수록 흐려지고, 반짝인다
      const y = this.positions[k + 1];
      const fade = Math.min(1, (y - BOTTOM) / 0.18) * Math.min(1, (TOP - y) / 0.12 + 0.2);
      const twinkle = 0.65 + 0.35 * Math.sin(this.time * 9 + this.phase[i]);
      const a = Math.max(0, fade) * twinkle * this.strength;
      this.colors[k] = 1 * a;
      this.colors[k + 1] = 0.78 * a;
      this.colors[k + 2] = 0.3 * a;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }

  /** 알갱이 하나를 위에서 다시 떨어뜨린다. along: 0 이면 맨 위, 1 이면 맨 아래 쪽에서 */
  private respawn(i: number, along: number): void {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * SPREAD;
    const k = i * 3;
    this.positions[k] = Math.cos(angle) * r;
    this.positions[k + 1] = TOP - along * (TOP - BOTTOM);
    this.positions[k + 2] = Math.sin(angle) * r;
    this.speed[i] = 0.18 + Math.random() * 0.2;
    this.phase[i] = Math.random() * Math.PI * 2;
  }
}

/** 가운데가 밝은 작은 별 모양 */
function sparkleTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const c = size / 2;
    const glow = ctx.createRadialGradient(c, c, 0, c, c, c);
    glow.addColorStop(0, 'rgba(255,255,255,1)');
    glow.addColorStop(0.25, 'rgba(255,255,255,0.7)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
    // 네 갈래 반짝임
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.moveTo(c, 2);
    ctx.quadraticCurveTo(c + 4, c - 4, size - 2, c);
    ctx.quadraticCurveTo(c + 4, c + 4, c, size - 2);
    ctx.quadraticCurveTo(c - 4, c + 4, 2, c);
    ctx.quadraticCurveTo(c - 4, c - 4, c, 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
