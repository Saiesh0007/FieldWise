import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    // Web Serial / geolocation need a secure context; for LAN demo access
    // over HTTPS use `vite --host` with a trusted cert. Localhost is fine
    // for USB Web Serial during recording.
    host: true,
    // Vite 5+ rejects requests whose Host header doesn't match a known
    // hostname ("Blocked request" 403) as a DNS-rebinding protection —
    // this is what breaks access through a forwarded VS Code dev tunnel
    // (*.devtunnels.ms), since the tunnel's public hostname isn't
    // localhost/the LAN IP Vite expects by default. Allow-listing the
    // devtunnels.ms suffix (leading dot = that domain + all subdomains)
    // permits exactly that one remote-access path without disabling the
    // protection entirely (`allowedHosts: true` would allow *any* host).
    allowedHosts: ['.devtunnels.ms'],
  },
  optimizeDeps: {
    // maplibre-gl spins up its tile-processing work in a Worker created
    // from a relative URL inside the package. Vite's esbuild dependency
    // pre-bundling flattens/rewrites that path and breaks it (the worker
    // 404s and every layer — raster tiles included — silently fails to
    // render, with no thrown error). Excluding it from pre-bundling keeps
    // the package's own file layout intact.
    exclude: ['maplibre-gl'],
  },
})
