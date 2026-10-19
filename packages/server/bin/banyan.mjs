#!/usr/bin/env node
// Banyan CLI launcher. Uses tsx to run the TypeScript entry directly.
import { register } from 'tsx/esm/api'

register()

await import('../src/index.ts')
