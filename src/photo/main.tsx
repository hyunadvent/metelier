import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PhotoLab } from './PhotoLab';
import '../index.css';
import '../editor/editor.css';
import './photoLab.css';

// 사진 → 색칠 그림 변환을 시험하는 화면. 개발 서버에서만 쓰며 배포 빌드에는 포함되지 않는다.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PhotoLab />
  </StrictMode>,
);
