import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 2026-09-24 (round 10): first frontend test runner in this project.
  // jsdom, since every test so far renders React components; imports
  // vitest APIs explicitly rather than enabling globals, so tsconfig needs
  // no extra "types" entry.
  test: { environment: 'jsdom' },
})
