import { defineConfig } from 'vitest/config';

// GitHub Pages serves the site from /<repo-name>/, so production builds need that base path.
const REPO_NAME = 'open-concept-designs';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? `/${REPO_NAME}/` : '/',
  test: {
    environment: 'node',
  },
}));
