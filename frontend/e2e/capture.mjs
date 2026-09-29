// Screenshots of the one-screen pages at 1440×900, for PR descriptions:
//   node e2e/capture.mjs <out-dir> [label]
// Needs the dev server on :4173 (npx vite --port 4173).
import { chromium } from '@playwright/test'
import { signIn } from './mockApi.js'

const [out = '.', label = 'after'] = process.argv.slice(2)
const PAGES = {
  'dt-dashboard': '/reports/drive-test',
  'monthly-plan': '/monthly-plan',
  'hc-pool': '/health-check',
  'hc-in-progress': '/health-check?tab=running',
  'dt-assignment': '/drive-test',
}

const browser = await chromium.launch()
for (const [name, path] of Object.entries(PAGES)) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await signIn(page)
  await page.goto(`http://localhost:4173${path}`)
  await page.waitForTimeout(2500)
  const m = await page.evaluate(() => [document.scrollingElement.scrollHeight, document.scrollingElement.scrollWidth])
  await page.screenshot({ path: `${out}/${name}-${label}.png` })
  console.log(name, 'page scrollHeight/Width', m.join(' / '))
  await page.close()
}
await browser.close()
