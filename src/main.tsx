import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ColoringScreen } from './coloring/ColoringScreen';
import './index.css';

// 화실(M5)이 생기기 전까지는 색칠 화면으로 바로 들어간다.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ColoringScreen paintingId="hill-house" />
  </StrictMode>,
);
