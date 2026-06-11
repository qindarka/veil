/**
 * scripts/test-browser.mjs
 * Two-tab end-to-end browser test: player A creates a campaign, player B joins
 * via the room code, and both must see each other (party list), exchange chat,
 * and run without console/page errors.
 *
 * Prerequisites:
 *   - npm run dev          (vite + wrangler dev running)
 *   - npm i --no-save puppeteer   (browser driver; intentionally NOT a
 *     package.json dependency — it downloads a full Chrome build)
 *
 * Usage: node scripts/test-browser.mjs [clientUrl]
 *   clientUrl defaults to http://127.0.0.1:5173 — pass the actual port if
 *   Vite picked a different one (it auto-bumps when 5173 is busy).
 */
import puppeteer from 'puppeteer';

const CLIENT = process.argv[2] ?? 'http://127.0.0.1:5173/';
const errors = [];

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  defaultViewport: { width: 1440, height: 810 },
});

async function newPlayer(name, archIndex) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(`${name} PAGEERROR: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const url = (m.location() && m.location().url) || '';
    // Optional-asset probes (GLB/audio swap points) and favicons 404 by design.
    if (url.includes('favicon') || url.includes('/models/') || url.includes('/audio/')) return;
    errors.push(`${name} CONSOLE: ${m.text()} [${url}]`);
  });
  await page.goto(CLIENT, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('.arch-card', { timeout: 20000 });
  const input = await page.waitForSelector('input[placeholder^="What the dream"]');
  // Both tabs share one browser profile; clear any remembered name.
  await input.evaluate((el) => {
    el.value = '';
  });
  await input.type(name);
  const cards = await page.$$('.arch-card');
  await cards[archIndex].click();
  return page;
}

async function submit(page) {
  const [btn] = await page.$$('xpath/.//button[contains(., "Enter the Veil")]');
  await btn.click();
  await page.waitForFunction(() => document.body.innerText.includes('The Skyharbor'), {
    timeout: 60000,
  });
}

try {
  // Player A creates the campaign; scrape the generated room code off the menu.
  const a = await newPlayer('WalkerA', 0);
  const code = await a.evaluate(() => {
    const m = document.body.innerText.match(/\b[A-HJ-NP-Z2-9]{6}\b/);
    return m ? m[0] : null;
  });
  if (!code) throw new Error('could not scrape room code from the create tab');
  console.log('OK room code scraped:', code);
  await submit(a);
  console.log('OK WalkerA in-game (created campaign)');

  // Player B joins with the code.
  const b = await newPlayer('WalkerB', 3);
  const [joinTab] = await b.$$('xpath/.//button[contains(., "Join Campaign")]');
  await joinTab.click();
  const joinInput = await b.waitForSelector('input[placeholder="······"]');
  await joinInput.type(code);
  await submit(b);
  console.log('OK WalkerB in-game (joined via code)');

  // Mutual presence. window.__veil is the dev-only GameContext handle; assert
  // on mirrored state + real party-list DOM rows (innerText is unreliable on
  // backgrounded headless tabs). Event delivery to a throttled background tab
  // can lag, so poll briefly.
  const partyCheck = (page) =>
    page.evaluate(() => ({
      names: [...window.__veil.state.players.values()]
        .filter((p) => p.online)
        .map((p) => p.name)
        .sort(),
      rows: document.querySelectorAll('.party-row').length,
    }));
  const partyOk = async (page) => {
    for (let i = 0; i < 10; i++) {
      const p = await partyCheck(page);
      if (p.names.join() === 'WalkerA,WalkerB' && p.rows === 2) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  };
  const aSeesB = await partyOk(a);
  const bSeesA = await partyOk(b);
  console.log(aSeesB ? 'PASS A sees B in party list' : 'FAIL A does not see B');
  console.log(bSeesA ? 'PASS B sees A in party list' : 'FAIL B does not see A');

  // A walks (B receives position broadcasts), then chats; B must render it.
  await a.keyboard.down('KeyW');
  await new Promise((r) => setTimeout(r, 2000));
  await a.keyboard.up('KeyW');
  await a.keyboard.press('Enter');
  await a.keyboard.type('hello from A');
  await a.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 1500));
  const bGotChat = await b.evaluate(() => document.body.textContent.includes('hello from A'));
  console.log(bGotChat ? 'PASS chat round-trip A -> B' : 'FAIL chat did not reach B');

  await b.screenshot({ path: '/tmp/veil-two-b.png' });
  console.log('OK screenshot /tmp/veil-two-b.png');

  if (!aSeesB || !bSeesA || !bGotChat) process.exitCode = 1;
  if (errors.length) {
    console.log('RUNTIME ERRORS:');
    for (const e of errors.slice(0, 15)) console.log('  ' + e);
    process.exitCode = 1;
  } else {
    console.log('PASS no runtime errors in either tab');
  }
} finally {
  await browser.close();
}
