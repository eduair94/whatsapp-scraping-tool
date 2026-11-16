// Empties a build folder before compiling, so files of deleted sources never ship.
//   node scripts/clean.mjs main
import { rm } from 'node:fs/promises'

const target = process.argv[2]
if (!['main', 'renderer'].includes(target)) {
  console.error('usage: node scripts/clean.mjs <main|renderer>')
  process.exit(1)
}
await rm(new URL(`../dist/${target}/`, import.meta.url), { recursive: true, force: true })
