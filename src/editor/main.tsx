import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from './Editor';
import '../index.css';
import './editor.css';

// 개발 서버에서만 쓰는 그림 제작 도구. 배포 빌드에는 포함되지 않는다.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Editor />
  </StrictMode>,
);
