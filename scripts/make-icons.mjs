// Renders build/icon.svg to build/icon.png (1024 px). electron-builder makes the
// .ico and .icns from that PNG. Run with: npm run icons
import { readFile, writeFile } from 'node:fs/promises'
import { Resvg } from '@resvg/resvg-js'

const svg = await readFile(new URL('../build/icon.svg', import.meta.url))
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1024 } }).render().asPng()
await writeFile(new URL('../build/icon.png', import.meta.url), png)
console.log(`build/icon.png ${png.length} bytes`)
