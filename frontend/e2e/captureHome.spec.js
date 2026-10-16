// Screenshots of UEP Home for each role that has one, at 1440×900, from the
// mocked API (e2e/fixtures.js), for PR descriptions. Skipped in a normal run;
// to take them:
//   HOME_CAPTURE_DIR=<out-dir> npx playwright test e2e/captureHome.spec.js
import { expect, test } from '@playwright/test'
import { HOME_ROLES, serveHome } from './homeRoles.js'
import { signIn } from './mockApi.js'

const out = process.env.HOME_CAPTURE_DIR

test.describe('Home screenshots', () => {
  test.skip(!out, 'set HOME_CAPTURE_DIR to take them')
  test.use({ viewport: { width: 1440, height: 900 } })

  for (const [name, who, summary] of HOME_ROLES) {
    test(name, async ({ page }) => {
      await signIn(page, who)
      await serveHome(page, summary)
      await page.goto('/home')
      await expect(page.getByRole('heading', { name: 'Your work' })).toBeVisible()
      await page.waitForTimeout(1500)
      const scrolls = await page.evaluate(() => document.scrollingElement.scrollHeight > window.innerHeight)
      expect(scrolls).toBe(false)
      await page.screenshot({ path: `${out}/home-${name}.png` })
    })
  }
})
