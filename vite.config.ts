import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const PAINTING_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;
const PACKAGE_FILES = new Set(['regions.png', 'lines.png', 'reference.png', 'meta.json']);
const PNG_PREFIX = 'data:image/png;base64,';

/**
 * 그림 제작 도구(/editor.html)가 만든 그림 패키지를 public/paintings/<id>/ 에 저장한다.
 * 개발 서버에서만 동작하며 배포 빌드에는 포함되지 않는다.
 */
function paintingEditorSave(): Plugin {
  return {
    name: 'painting-editor-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__editor/save', (req, res) => {
        const fail = (status: number, text: string) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(text);
        };
        if (req.method !== 'POST') return fail(405, 'POST 만 받습니다.');

        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', async () => {
          try {
            const { id, files } = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              id: string;
              files: Record<string, string>;
            };
            if (typeof id !== 'string' || !PAINTING_ID.test(id)) return fail(400, '그림 ID 가 올바르지 않습니다.');
            const names = Object.keys(files ?? {});
            if (names.length !== PACKAGE_FILES.size || !names.every((n) => PACKAGE_FILES.has(n))) {
              return fail(400, '그림 패키지 파일 구성이 올바르지 않습니다.');
            }
            const dir = join(server.config.root, 'public', 'paintings', id);
            await mkdir(dir, { recursive: true });
            for (const name of names) {
              const value = files[name];
              if (name.endsWith('.png')) {
                if (!value.startsWith(PNG_PREFIX)) return fail(400, `${name} 은 PNG 여야 합니다.`);
                await writeFile(join(dir, name), Buffer.from(value.slice(PNG_PREFIX.length), 'base64'));
              } else {
                await writeFile(join(dir, name), value, 'utf8');
              }
            }
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            fail(500, e instanceof Error ? e.message : String(e));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), paintingEditorSave()],
  // three 와 그 부가 모듈이 개발 서버에서 따로 묶여 three 가 두 번 불러와지는 것을 막는다.
  resolve: { dedupe: ['three'] },
  optimizeDeps: { include: ['three', 'three/addons/geometries/RoundedBoxGeometry.js', 'three/addons/effects/OutlineEffect.js'] },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
