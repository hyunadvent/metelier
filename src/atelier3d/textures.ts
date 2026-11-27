// 코드로 그리는 텍스처. 이미지 파일 없이 2D 캔버스에 그려서 만든다.
import * as THREE from 'three';

/** 매번 같은 무늬가 나오도록 씨앗을 주는 난수 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return [canvas, canvas.getContext('2d')!];
}

function toTexture(canvas: HTMLCanvasElement, repeat?: [number, number]): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  if (repeat) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat[0], repeat[1]);
  }
  return texture;
}

/** 나무 마루: 세로로 긴 널빤지 8장이 한 타일. 이어 붙여도 끊기지 않는다. */
export function woodFloorTexture(repeatX: number, repeatY: number): THREE.CanvasTexture {
  const size = 1024;
  const planks = 8;
  const plankW = size / planks;
  const [canvas, ctx] = makeCanvas(size, size);
  const random = seededRandom(7);
  // 널빤지마다 색이 아주 조금씩만 다르다
  const tones = ['#e6b685', '#e3b180', '#e9bb8b', '#e1ae7d', '#e7b888'];
  for (let p = 0; p < planks; p++) {
    const x = p * plankW;
    // 널빤지마다 이음매 위치가 어긋난다
    const joints = [Math.round(random() * 1000)];
    // 이음매는 널빤지마다 한 곳: 그 위아래가 서로 다른 널빤지다 (타일 경계를 넘어 이어진다)
    ctx.fillStyle = tones[Math.floor(random() * tones.length)];
    ctx.fillRect(x, 0, plankW, size);
    ctx.fillStyle = tones[Math.floor(random() * tones.length)];
    ctx.fillRect(x, joints[0], plankW, size - joints[0]);
    // 나뭇결: 타일 경계에서 이어지도록 주기를 타일 크기에 맞춘다
    for (let g = 0; g < 26; g++) {
      const gx = x + 4 + random() * (plankW - 8);
      const wave = 1 + Math.floor(random() * 3);
      const amp = 1 + random() * 3;
      const phase = random() * Math.PI * 2;
      ctx.strokeStyle = `rgba(${110 + random() * 40}, ${62 + random() * 25}, 28, ${0.05 + random() * 0.1})`;
      ctx.lineWidth = 0.6 + random() * 1.4;
      ctx.beginPath();
      for (let y = 0; y <= size; y += 16) {
        const px = gx + Math.sin((y / size) * Math.PI * 2 * wave + phase) * amp;
        if (y === 0) ctx.moveTo(px, y);
        else ctx.lineTo(px, y);
      }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(105, 62, 28, 0.3)';
    for (const y of joints) ctx.fillRect(x, y, plankW, 2);
    ctx.fillRect(x, 0, 2, size);
    ctx.fillStyle = 'rgba(255, 240, 215, 0.16)';
    ctx.fillRect(x + 2, 0, 1.5, size);
  }
  return toTexture(canvas, [repeatX, repeatY]);
}

/** 벽: 크림색 바탕에 은은한 얼룩 */
export function plasterTexture(repeatX: number, repeatY: number): THREE.CanvasTexture {
  const size = 512;
  const [canvas, ctx] = makeCanvas(size, size);
  const random = seededRandom(21);
  ctx.fillStyle = '#fdf1df';
  ctx.fillRect(0, 0, size, size);
  for (let k = 0; k < 90; k++) {
    const x = random() * size;
    const y = random() * size;
    const r = 30 + random() * 90;
    const warm = random() < 0.5;
    // 타일 경계에 걸친 얼룩은 반대편에도 그려 이음매를 없앤다
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        const gradient = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        gradient.addColorStop(0, warm ? 'rgba(226, 190, 150, 0.07)' : 'rgba(255, 255, 255, 0.09)');
        gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      }
    }
  }
  return toTexture(canvas, [repeatX, repeatY]);
}

/** 깔개: 분홍 테두리와 꽃무늬 */
export function rugTexture(): THREE.CanvasTexture {
  const w = 1024;
  const h = 716;
  const [canvas, ctx] = makeCanvas(w, h);
  const random = seededRandom(5);
  ctx.fillStyle = '#f3dde6';
  ctx.fillRect(0, 0, w, h);
  const band = (inset: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(inset, inset, w - inset * 2, h - inset * 2);
  };
  band(26, '#fbf2ee');
  band(58, '#e9c7d6');
  band(74, '#fdf6f1');
  band(150, '#f1dfea');
  band(162, '#fef8f3');
  const rosette = (x: number, y: number, r: number, petal: string, center: string) => {
    ctx.fillStyle = petal;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.5, r * 0.3, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = center;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.24, 0, Math.PI * 2);
    ctx.fill();
  };
  // 테두리를 따라 도는 작은 꽃
  for (let k = 0; k < 13; k++) {
    const x = 112 + (k / 12) * (w - 224);
    rosette(x, 112, 17, k % 2 ? '#d7c5ec' : '#f4bdd0', '#fff4c9');
    rosette(x, h - 112, 17, k % 2 ? '#f4bdd0' : '#d7c5ec', '#fff4c9');
  }
  for (let k = 1; k < 8; k++) {
    const y = 112 + (k / 8) * (h - 224);
    rosette(112, y, 17, k % 2 ? '#c9e0f3' : '#f4bdd0', '#fff4c9');
    rosette(w - 112, y, 17, k % 2 ? '#f4bdd0' : '#c9e0f3', '#fff4c9');
  }
  // 가운데 큰 꽃과 네 귀퉁이 꽃
  rosette(w / 2, h / 2, 96, '#f6cbd9', '#fff1c4');
  rosette(w / 2, h / 2, 50, '#fde4ec', '#f9d99a');
  for (const [x, y] of [[250, 240], [w - 250, 240], [250, h - 240], [w - 250, h - 240]]) rosette(x, y, 44, '#dcccf0', '#fff4c9');
  // 실로 짠 느낌의 잔무늬
  for (let k = 0; k < 9000; k++) {
    ctx.fillStyle = random() < 0.5 ? 'rgba(255, 255, 255, 0.10)' : 'rgba(150, 110, 120, 0.05)';
    ctx.fillRect(random() * w, random() * h, 2, 1);
  }
  return toTexture(canvas);
}

/** 천: 가로세로로 짠 올. 색을 곱해 쓰는 흰 바탕 텍스처다. */
export function linenTexture(repeat: number): THREE.CanvasTexture {
  const size = 128;
  const [canvas, ctx] = makeCanvas(size, size);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  for (let k = 0; k < size; k += 4) {
    ctx.fillStyle = 'rgba(120, 100, 90, 0.07)';
    ctx.fillRect(k, 0, 1, size);
    ctx.fillRect(0, k, size, 1);
  }
  return toTexture(canvas, [repeat, repeat]);
}

/** 책등: 위아래 띠와 제목 딱지. 색을 곱해 쓴다. */
export function bookSpineTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(64, 128);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 64, 128);
  ctx.fillStyle = 'rgba(60, 40, 30, 0.22)';
  ctx.fillRect(0, 12, 64, 5);
  ctx.fillRect(0, 108, 64, 5);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fillRect(14, 34, 36, 26);
  ctx.fillStyle = 'rgba(60, 40, 30, 0.25)';
  ctx.fillRect(20, 42, 24, 3);
  ctx.fillRect(20, 50, 16, 3);
  return toTexture(canvas);
}

/** 하늘: 위는 파랗고 지평선 쪽은 밝다 */
export function skyTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(16, 512);
  const gradient = ctx.createLinearGradient(0, 0, 0, 512);
  gradient.addColorStop(0, '#5fa9ea');
  gradient.addColorStop(0.45, '#8fcaf4');
  gradient.addColorStop(0.75, '#c4e5fa');
  gradient.addColorStop(1, '#eef8fd');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 16, 512);
  return toTexture(canvas);
}

/** 가운데가 진하고 가장자리로 사라지는 둥근 얼룩. 빛 번짐과 바닥 그림자에 쓴다. */
export function radialTexture(inner: string, outer: string): THREE.CanvasTexture {
  const size = 128;
  const [canvas, ctx] = makeCanvas(size, size);
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(1, outer);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return toTexture(canvas);
}

/** 한쪽 끝이 어둡고 반대쪽으로 사라지는 띠. 벽과 바닥이 만나는 구석의 음영에 쓴다. */
export function edgeShadeTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(8, 64);
  const gradient = ctx.createLinearGradient(0, 0, 0, 64);
  gradient.addColorStop(0, 'rgba(120, 78, 40, 0.34)');
  gradient.addColorStop(0.35, 'rgba(120, 78, 40, 0.12)');
  gradient.addColorStop(1, 'rgba(120, 78, 40, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 8, 64);
  return toTexture(canvas);
}

/** 벚꽃잎 한 장 */
export function petalTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(64, 64);
  ctx.translate(32, 32);
  ctx.rotate(0.5);
  ctx.fillStyle = '#ffd3e2';
  ctx.beginPath();
  ctx.moveTo(0, 24);
  ctx.bezierCurveTo(-22, 8, -18, -22, -4, -22);
  ctx.lineTo(0, -15);
  ctx.lineTo(4, -22);
  ctx.bezierCurveTo(18, -22, 22, 8, 0, 24);
  ctx.fill();
  ctx.fillStyle = 'rgba(240, 150, 180, 0.5)';
  ctx.beginPath();
  ctx.ellipse(0, 12, 4, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  return toTexture(canvas);
}

/** 액자에 넣을 풍경화: 하늘, 구름, 언덕, 작은 집, 꽃밭 */
export function landscapePainting(seed: number, withHouse = true): THREE.CanvasTexture {
  const w = 620;
  const h = 400;
  const [canvas, ctx] = makeCanvas(w, h);
  const random = seededRandom(seed);
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.6);
  sky.addColorStop(0, '#8fc9f2');
  sky.addColorStop(1, '#e3f3fb');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  // 구름
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  for (let c = 0; c < 4; c++) {
    const cx = random() * w;
    const cy = 30 + random() * 90;
    for (let k = 0; k < 5; k++) {
      ctx.beginPath();
      ctx.ellipse(cx + (k - 2) * 26, cy + Math.sin(k * 2) * 7, 34, 20, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // 겹겹의 언덕
  const hill = (base: number, amp: number, color: string, phase: number) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 10) ctx.lineTo(x, base + Math.sin(x / 110 + phase) * amp + Math.sin(x / 47 + phase * 2) * amp * 0.3);
    ctx.lineTo(w, h);
    ctx.fill();
  };
  hill(h * 0.5, 22, '#a9d3a0', random() * 6);
  hill(h * 0.58, 18, '#bfe0a4', random() * 6);
  // 나무
  for (let t = 0; t < 5; t++) {
    const tx = 30 + random() * (w - 60);
    const ty = h * 0.56 + random() * 16;
    ctx.fillStyle = '#8b6748';
    ctx.fillRect(tx - 3, ty - 4, 6, 26);
    ctx.fillStyle = t % 2 ? '#7fb574' : '#94c47f';
    ctx.beginPath();
    ctx.arc(tx, ty - 14, 22, 0, Math.PI * 2);
    ctx.fill();
  }
  if (withHouse) {
    const hx = w * 0.56;
    const hy = h * 0.55;
    ctx.fillStyle = '#fff6e6';
    ctx.fillRect(hx, hy, 86, 54);
    ctx.fillStyle = '#e58f6a';
    ctx.beginPath();
    ctx.moveTo(hx - 10, hy);
    ctx.lineTo(hx + 43, hy - 36);
    ctx.lineTo(hx + 96, hy);
    ctx.fill();
    ctx.fillStyle = '#9b6b4a';
    ctx.fillRect(hx + 36, hy + 24, 16, 30);
    ctx.fillStyle = '#9fd0ee';
    ctx.fillRect(hx + 10, hy + 14, 16, 14);
    ctx.fillRect(hx + 60, hy + 14, 16, 14);
  }
  hill(h * 0.76, 10, '#cfe8a6', random() * 6);
  // 앞쪽 꽃밭
  for (let k = 0; k < 420; k++) {
    const y = h * 0.74 + random() * h * 0.26;
    const size = 1.5 + ((y - h * 0.74) / (h * 0.26)) * 4.5;
    ctx.fillStyle = ['#fbd3e1', '#ffffff', '#f7a8c3', '#fff0b8', '#d9c8ee'][Math.floor(random() * 5)];
    ctx.beginPath();
    ctx.arc(random() * w, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(canvas);
}

/** 액자에 넣을 꽃 그림 */
export function flowerPainting(petalColor: string, seed: number): THREE.CanvasTexture {
  const w = 300;
  const h = 400;
  const [canvas, ctx] = makeCanvas(w, h);
  const random = seededRandom(seed);
  ctx.fillStyle = '#fdf7ee';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(207, 230, 168, 0.35)';
  ctx.beginPath();
  ctx.ellipse(w / 2, h * 0.82, w * 0.5, 60, 0, 0, Math.PI * 2);
  ctx.fill();
  const blooms: [number, number, number][] = [];
  for (let k = 0; k < 6; k++) blooms.push([w / 2 + (random() - 0.5) * 150, 90 + random() * 130, 26 + random() * 16]);
  ctx.strokeStyle = '#7fae6a';
  ctx.lineWidth = 5;
  for (const [x, y] of blooms) {
    ctx.beginPath();
    ctx.moveTo(w / 2 + (x - w / 2) * 0.15, h * 0.86);
    ctx.quadraticCurveTo(w / 2, (y + h) / 2, x, y);
    ctx.stroke();
  }
  ctx.fillStyle = '#8fc47c';
  for (let k = 0; k < 7; k++) {
    ctx.beginPath();
    ctx.ellipse(w / 2 + (random() - 0.5) * 120, 250 + random() * 70, 26, 11, random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const [x, y, r] of blooms) {
    ctx.fillStyle = petalColor;
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.5, r * 0.5, r * 0.33, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#fff1b8';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.26, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(canvas);
}
