'use client';

import { useEffect, useRef } from 'react';

/**
 * When the user app is served from docker-compose `frontend` (baked `next build`),
 * remind developers in the console that UI changes require an image rebuild — not `npm run dev`.
 */
export function DockerUserAppHint() {
  const logged = useRef(false);

  useEffect(() => {
    if (logged.current) return;
    if (process.env.NEXT_PUBLIC_DOCKER_USER_APP !== '1') return;
    logged.current = true;
    console.warn(
      [
        '[exchange-frontend] This UI is a baked production bundle (Docker).',
        'Source edits are NOT reflected until you rebuild the image:',
        '  docker compose build --no-cache frontend && docker compose up -d frontend',
        'For hot reload against local src, run: cd apps/frontend && npm run dev',
        '(or from repo root: npm run dev:frontend)',
      ].join('\n')
    );
  }, []);

  return null;
}
