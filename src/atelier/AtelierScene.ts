import { Assets, Container, Sprite, type Texture } from 'pixi.js';
import type { AtelierLayout } from './scene';

/**
 * 화실 장면을 그리는 컨테이너를 만든다. 장면 좌표 그대로이며, 어디에 얼마나 크게 놓을지는 쓰는 쪽이 정한다.
 * 화실 화면(방 전체 시점)과 색칠 화면 배경(이젤 앞 시점)이 같은 함수를 쓰므로,
 * 여기에 그려지는 것(M6 의 꾸미기 소품 포함)은 두 화면에 똑같이 보인다.
 */
export async function createAtelierScene(layout: AtelierLayout): Promise<Container> {
  const scene = new Container();
  const texture = await Assets.load<Texture>(layout.background);
  const background = new Sprite(texture);
  background.width = layout.width;
  background.height = layout.height;
  scene.addChild(background);
  return scene;
}
