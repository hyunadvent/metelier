import * as THREE from 'three';
import { buildAtelierRoom, type AtelierRoom } from './room';

/** 화면 좌표의 사각형 */
export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const FOV = 40;

/**
 * 색칠 화면의 배경: 3D 화실을 이젤 앞에 앉은 시점으로 그린다 (R9).
 * 화실 화면과 같은 buildAtelierRoom 으로 방을 만들므로 방의 모습이 그대로 보인다.
 * 이젤의 캔버스 판이 화면의 종이 자리에 정확히 겹치도록 카메라를 놓는다.
 * 움직이는 것이 없으므로 배치가 바뀔 때만 그린다.
 */
export class EaselBackdrop {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 80);
  private readonly room: AtelierRoom;

  constructor(host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color(0xf6e7d4);
    this.room = buildAtelierRoom();
    this.scene.add(this.room.group);
    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    host.appendChild(canvas);
  }

  /**
   * @param paper 줌 100% 일 때 종이가 놓이는 화면 위 자리
   */
  place(paper: ScreenRect, screenW: number, screenH: number): void {
    if (screenW < 1 || screenH < 1 || paper.height < 1) return;
    const { room, camera } = this;
    this.renderer.setSize(screenW, screenH);
    camera.aspect = screenW / screenH;
    camera.updateProjectionMatrix();

    room.setBoardAspect(paper.width / paper.height);
    room.group.updateMatrixWorld(true);
    const center = room.board.getWorldPosition(new THREE.Vector3());
    const facing = room.board.getWorldQuaternion(new THREE.Quaternion());
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(facing);

    // 판의 세로가 종이의 세로와 같은 픽셀 수로 보이는 거리
    const boardHeight = room.board.scale.y;
    const unitsPerPixel = boardHeight / paper.height;
    const distance = (screenH * unitsPerPixel) / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
    // 판을 정면으로 바라보고, 종이가 화면 가운데에서 벗어난 만큼 카메라를 옆으로 옮긴다.
    camera.quaternion.copy(facing);
    camera.position.copy(center).addScaledVector(normal, distance + 0.02);
    camera.translateX(-(paper.x + paper.width / 2 - screenW / 2) * unitsPerPixel);
    camera.translateY((paper.y + paper.height / 2 - screenH / 2) * unitsPerPixel);
    this.renderer.render(this.scene, camera);
  }

  destroy(): void {
    this.room.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
