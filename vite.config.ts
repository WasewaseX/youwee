import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const manualChunkGroups: Record<string, string[]> = {
  'vendor-react': ['react', 'react-dom'],
  'vendor-radix': [
    '@radix-ui/react-alert-dialog',
    '@radix-ui/react-collapsible',
    '@radix-ui/react-dialog',
    '@radix-ui/react-label',
    '@radix-ui/react-popover',
    '@radix-ui/react-progress',
    '@radix-ui/react-scroll-area',
    '@radix-ui/react-select',
    '@radix-ui/react-slider',
    '@radix-ui/react-slot',
    '@radix-ui/react-switch',
    '@radix-ui/react-tabs',
    '@radix-ui/react-tooltip',
  ],
  'vendor-tauri': [
    '@tauri-apps/api',
    '@tauri-apps/plugin-dialog',
    '@tauri-apps/plugin-fs',
    '@tauri-apps/plugin-opener',
    '@tauri-apps/plugin-process',
    '@tauri-apps/plugin-shell',
    '@tauri-apps/plugin-updater',
  ],
  'vendor-icons': ['lucide-react'],
};

function manualChunks(id: string): string | undefined {
  if (!id.includes('/node_modules/')) {
    return undefined;
  }

  for (const [chunkName, dependencies] of Object.entries(manualChunkGroups)) {
    if (dependencies.some((dependency) => id.includes(`/node_modules/${dependency}/`))) {
      return chunkName;
    }
  }

  return undefined;
}

// https://vite.dev/config/
export default defineConfig(() => {
  const isWeb = process.env.VITE_WEB_MODE === 'true';

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },
    define: {
      'import.meta.env.VITE_WEB_MODE': JSON.stringify(isWeb),
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks,
        },
      },
    },
    server: {
      proxy: isWeb
        ? {
            '/api': {
              target: 'http://localhost:10000',
              changeOrigin: true,
            },
          }
        : undefined,
    },
  };
});
