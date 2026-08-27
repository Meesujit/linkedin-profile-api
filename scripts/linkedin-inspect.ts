/// <reference lib="dom" />
/**
 * Dev-only DOM/network inspector. Opens a profile and dumps the rendered HTML
 * to /tmp plus key structural facts (ids, h1, title). Used to reverse-engineer
 * LinkedIn's current DOM so the extractor selectors match reality.
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import { config } from '../src/config.js';

const profileUrl = process.argv[2] ?? 'https://www.linkedin.com/in/example/';
const statePath = path.resolve(process.cwd(), config.linkedinStatePath);
const outFile = '/tmp/linkedin-profile.html';

async function main(): Promise<void> {
  const browser = await chromium.launch({
    headless: config.headless,
    args: ['--disable-dev-shm-usage', '--no-sandbox'],
  });
  const context = await browser.newContext({ storageState: statePath, locale: 'en-US' });
  const page: Page = await context.newPage();

  const requests: string[] = [];
  page.on('response', (r) => {
    const ct = r.headers()['content-type'] ?? '';
    requests.push(`${r.status()} ${r.request().method()} ct=${ct} ${r.url().slice(0, 110)}`);
  });

  console.log(`Opening ${profileUrl}`);
  const resp = await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: config.pageNavigationTimeoutMs });
  console.log(`status=${resp?.status()} finalUrl=${page.url()}`);
  await page.waitForTimeout(6000).catch(() => undefined);

  const html = await page.content();
  writeFileSync(outFile, html);

  const ids = await page.$$eval('[id]', (els) => els.map((e) => e.id).filter((id) => id.length < 40));
  const h1 = await page.$eval('h1', (e) => e.textContent?.replace(/\s+/g, ' ').trim()).catch(() => null);
  const title = await page.title();

  console.log(`TITLE: ${title}`);
  console.log(`H1: ${h1}`);
  console.log(`IDS (${ids.length}): ${ids.slice(0, 80).join(', ')}`);
  console.log(`\nHTML written to ${outFile} (${html.length} bytes)`);

  console.log(`\nDATA REQUESTS (non-static):`);
  requests
    .filter((r) => !/\.(png|jpe?g|gif|svg|css|woff2?|ttf|ico|js)($|\?)/i.test(r))
    .slice(0, 40)
    .forEach((r) => console.log(`  ${r}`));

  await browser.close();
}

main().catch((err) => {
  console.error('Inspection failed:', (err as Error).message);
  process.exit(1);
});
