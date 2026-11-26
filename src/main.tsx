import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ColoringScreen } from './coloring/ColoringScreen';
import './index.css';

// 화실(M5)이 생기기 전까지는 색칠 화면으로 바로 들어간다.
// 주소에 ?painting=<id> 를 붙이면 public/paintings/<id>/ 의 그림을 연다.
const requested = new URLSearchParams(location.search).get('painting');
const paintingId = requested && /^[a-z0-9][a-z0-9-]{0,40}$/.test(requested) ? requested : 'hill-house';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ColoringScreen paintingId={paintingId} />
  </StrictMode>,
);
