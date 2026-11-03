import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({resolve:{alias:{'@':fileURLToPath(new URL('.',import.meta.url))}},test:{maxWorkers:2,hookTimeout:30000,environment:'node',include:['tests/**/*.test.ts']}});
