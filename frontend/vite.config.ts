import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const offlinePrecachePlugin = () => ({
  name: 'schoolbridge-offline-precache',
  apply: 'build' as const,
  async closeBundle() {
    const outputDirectory = resolve(process.cwd(), 'dist')
    const manifest = JSON.parse(await readFile(resolve(outputDirectory, '.vite/manifest.json'), 'utf8'))
    const assets = [...new Set(Object.values(manifest).flatMap((entry: any) => [
      entry.file,
      ...(entry.css ?? []),
      ...(entry.assets ?? []),
    ]).filter((file): file is string => typeof file === 'string' && file.length > 0))]
      .map(file => `/${file}`)
    const workerPath = resolve(outputDirectory, 'service-worker.js')
    const worker = await readFile(workerPath, 'utf8')
    const marker = 'const PRECACHE_ASSETS = []'
    if (!worker.includes(marker)) throw new Error('Service worker precache marker is missing.')
    await writeFile(workerPath, worker.replace(marker, `const PRECACHE_ASSETS = ${JSON.stringify(assets)}`))
  },
})

export default defineConfig({
  plugins: [react(), offlinePrecachePlugin()],
  build: { manifest: true },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
    },
  },
})
