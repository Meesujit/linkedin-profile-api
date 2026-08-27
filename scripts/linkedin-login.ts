/**
 * Interactive LinkedIn authentication.
 *
 * Launches a headed Chromium window on LinkedIn's login page. The user logs in
 * manually (including any MFA / verification LinkedIn requests) and the script
 * detects success, then persists the Playwright storage state for the API.
 *
 * Run:  pnpm linkedin:login
 *
 * Security: this script never sees or stores the password. The saved state file
 * (storage/linkedin-state.json) is git-ignored. CAPTCHA / MFA / checkpoints are
 * handled manually by the user — nothing here attempts to bypass them.
 */

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { config } from '../src/config.js';

const statePath = path.resolve(process.cwd(), config.linkedinStatePath);

function isLoggedIn(url: URL): boolean {
  const href = url.href;
  if (/linkedin\.com\/(login|signup|checkpoint|challenge|authwall|uas\/)/i.test(href)) return false;
  return /linkedin\.com\/(feed|home|mynetwork|in\/|messaging|notifications)/i.test(href);
}

async function main(): Promise<void> {
  const browser = await chromium.launch({
    headless: false, // interactive login requires a visible browser
    timeout: config.browserLaunchTimeoutMs,
    args: ['--disable-dev-shm-usage', '--no-sandbox'],
  });

  try {
    const context = await browser.newContext({
      locale: 'en-US',
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    console.log('Opening LinkedIn login page…');
    await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });

    console.log('');
    console.log('  ➜  Log in manually in the browser window.');
    console.log('  ➜  Complete any CAPTCHA / MFA / verification yourself.');
    console.log('  ➜  This script will detect success and save your session.');
    console.log('');

    await page.waitForURL((url) => isLoggedIn(url), { timeout: 0 });

    mkdirSync(path.dirname(statePath), { recursive: true });
    await context.storageState({ path: statePath });

    console.log('');
    console.log('LinkedIn authentication successful.');
    console.log(`Session state saved to ${statePath}`);
    console.log('You can now start the API with `pnpm start`.');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Authentication did not complete:', (err as Error).message);
  process.exit(1);
});
