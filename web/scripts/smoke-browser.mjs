#!/usr/bin/env node
import assert from 'node:assert/strict';

let chromium;
let webkit;
let AxeBuilder;
try {
  ({ chromium, webkit } = await import('playwright'));
  ({ default: AxeBuilder } = await import('@axe-core/playwright'));
} catch (error) {
  console.error('Thingy browser smoke requires Playwright. Install it locally with: npm install --save-dev playwright');
  process.exit(1);
}

const baseUrl = (process.env.THINGY_SMOKE_URL || 'http://localhost:8080').replace(/\/$/, '');
// Same-origin '/api' builds resolve against the page under test so the
// route mocks still match.
const withBase = (value) => (value.startsWith('http') ? value : `${baseUrl}${value}`);
const apiHost = withBase(
  (process.env.LIBRARIAN_API_URL || 'https://k0yklt9vg3.execute-api.us-east-1.amazonaws.com').replace(/\/$/, '')
);
const streamHost = withBase(
  (process.env.LIBRARIAN_STREAM_URL || 'https://librarian.thingelstad.com').replace(/\/$/, '')
);

function fakeToken() {
  const payload = Buffer.from(
    JSON.stringify({
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 20,
      email: 'thingy@thingelstad.com'
    })
  ).toString('base64url');
  return `${payload}.smoke`;
}

async function seedSession(context) {
  await context.addInitScript((token) => {
    window.localStorage.setItem('weeklyThingLibrarianToken', token);
    window.localStorage.setItem('thingyUserEmail', 'thingy@thingelstad.com');
    window.localStorage.setItem(
      'thingyUserProfile',
      JSON.stringify({
        preferred_name: 'Smoke',
        status: 'premium',
        supporting_member: true,
        entitlements: ['supporting_member'],
        modes: [{ id: 'thingy', label: 'Thingy' }]
      })
    );
  }, fakeToken());
}

async function routeMockApi(page, { holdWelcome = false } = {}) {
  let releaseWelcome = () => {};
  const welcomeGate = new Promise((resolve) => {
    releaseWelcome = resolve;
  });
  if (!holdWelcome) releaseWelcome();
  await page.route(`${apiHost}/auth`, async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        token: fakeToken(),
        email: 'thingy@thingelstad.com',
        status: 'premium',
        supporting_member: true,
        entitlements: ['supporting_member'],
        profile: {
          preferred_name: 'Smoke',
          supporting_member: true,
          entitlements: ['supporting_member'],
          modes: [{ id: 'thingy', label: 'Thingy' }]
        }
      })
    });
  });

  // WebMCP registration probe: answer with an empty tool list so the smoke
  // stays hermetic (registration paths are unit-tested in
  // tests/thingy-webmcp.test.mjs).
  await page.route(`${apiHost}/tools`, async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ tools: [], server_version: 'smoke' })
    });
  });

  await page.route(`${apiHost}/conversations`, async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        conversations: [],
        modes: [{ id: 'thingy', label: 'Thingy' }],
        entitlements: ['supporting_member']
      })
    });
  });

  await page.route(`${streamHost}/welcome`, async (route) => {
    await welcomeGate;
    const personalizedWelcome =
      'Hi. I am Thingy. Your recent threads have explored reader control, durable archives, and the independent web. ' +
      'There are several useful directions to continue from here, including how those ideas changed over time and where they connect across sources. ' +
      'You can also start somewhere completely different. Ask something specific, compare two ideas, or invite Thingy to find a surprising thread.';
    await route.fulfill({
      contentType: 'text/event-stream; charset=utf-8',
      body: `event: answer_delta\ndata: ${JSON.stringify({ delta: personalizedWelcome })}\n\nevent: done\ndata: {"request_id":"smoke"}\n\n`
    });
  });

  return { releaseWelcome };
}

function collectUiFailures(page) {
  const failures = [];
  page.on('pageerror', (error) => failures.push(`page: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  return failures;
}

function assertNoUiFailures(failures, surface) {
  assert.deepEqual(failures, [], `${surface} emitted browser errors`);
}

async function assertAccessible(page, surface) {
  const results = await new AxeBuilder({ page }).analyze();
  assert.deepEqual(
    results.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((node) => node.target) })),
    [],
    `${surface} has automated accessibility violations`
  );
}

async function checkSignInRedirect(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const failures = collectUiFailures(page);
  await page.goto(
    `${baseUrl}/chat/?email=thingy%40thingelstad.com&prompt=What%20about%20RSS%3F&from=https%3A%2F%2Fweekly.thingelstad.com%2Farchive%2F123%2F&corpus=blog`
  );
  await page.waitForURL(/\/signin\/\?return=%2Fchat%2F$/);
  assert.equal(new URL(page.url()).searchParams.get('return'), '/chat/');
  assert.doesNotMatch(page.url(), /thingy%40thingelstad|What%20about|weekly\.thingelstad|corpus=blog/);
  await page.waitForSelector('.thingy-signin-form');
  await assertAccessible(page, 'sign-in');
  assertNoUiFailures(failures, 'sign-in redirect');
  await context.close();
}

async function checkGuestPreview(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const failures = collectUiFailures(page);
  await page.goto(`${baseUrl}/chat/`);
  await page.waitForSelector('.thingy-guest-banner');
  await page.waitForSelector('.librarian-chat:not([hidden])');
  assert.match(await page.locator('.thingy-guest-banner').textContent(), /Guest preview/);
  assert.ok(await page.locator('#librarian-question').isVisible(), 'guest composer is available');
  assert.equal(await page.locator('.rail').isVisible(), false, 'guest view hides the conversation rail');
  await assertAccessible(page, 'guest chat');
  assertNoUiFailures(failures, 'guest chat');
  await context.close();
}

async function checkReactChatGuest(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const failures = collectUiFailures(page);
  await page.goto(`${baseUrl}/chat/`);
  await page.waitForSelector('.thingy-guest-banner');
  await page.waitForSelector('.thingy-aui-input');
  assert.match(await page.locator('.thingy-guest-banner').textContent(), /Guest preview/);
  assert.ok(
    (await page.locator('.librarian-message-assistant').first().textContent()).includes("I'm Thingy"),
    'react chat guest welcome renders'
  );
  await assertAccessible(page, 'react chat guest');
  assertNoUiFailures(failures, 'react chat guest');
  await context.close();
}

async function checkChat(browser) {
  const context = await browser.newContext();
  await seedSession(context);
  const page = await context.newPage();
  const failures = collectUiFailures(page);
  const mocks = await routeMockApi(page, { holdWelcome: true });
  await page.goto(`${baseUrl}/chat/`);

  // Signed-in shell: rail with New chat, thread root, composer.
  await page.waitForSelector('.librarian-chat');
  await page.waitForSelector('.thingy-aui-rail');
  await page.waitForSelector('.thingy-aui-newchat');

  // The static welcome renders immediately; personalization is async and
  // must not lock the composer.
  await page.waitForSelector('.librarian-message-assistant');
  assert.match(await page.locator('.librarian-message-assistant').first().textContent(), /Hi\. I'm Thingy/);

  // The counter stays hidden until the reader nears the 1200 cap.
  await page.waitForSelector('#librarian-question-count .composer-count', { state: 'hidden' });
  await page.locator('#librarian-question').fill('x'.repeat(1050));
  await page.waitForSelector('#librarian-question-count .composer-count', { state: 'visible' });
  await page.locator('#librarian-question').fill('Hello Thingy');
  await page.waitForSelector('#librarian-question-count .composer-count', { state: 'hidden' });
  const sendButton = page.locator('button.composer-send').first();
  assert.equal(await sendButton.isEnabled(), true, 'welcome personalization does not disable the composer');
  mocks.releaseWelcome();
  await page.waitForFunction(() =>
    document.querySelector('.librarian-message-assistant')?.textContent?.includes('Hi. I am Thingy.')
  );

  // Message editing affordances come from assistant-ui now; the empty
  // thread has none, but the account menu must expose the build stamp.
  await page.locator('.rail-account-btn').click();
  await page.waitForSelector('.rail-menu-build');
  assert.match((await page.locator('.rail-menu-build').textContent()).trim(), /^Build .+/);
  await page.keyboard.press('Escape');

  await assertAccessible(page, 'chat');
  assertNoUiFailures(failures, 'chat');
  await context.close();
}

async function checkMobileChat(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await seedSession(context);
  const page = await context.newPage();
  const failures = collectUiFailures(page);
  await routeMockApi(page);
  await page.goto(`${baseUrl}/chat/`);

  await page.waitForSelector('.mobile-chatbar');
  await page.waitForSelector('.librarian-chat');
  // The rail is a drawer on phones: hidden until toggled, dismissed by the
  // scrim.
  assert.equal(await page.locator('.thingy-aui-rail').isVisible(), false, 'rail starts closed on phones');
  await page.locator('.mobile-chatbar-circle').click();
  await page.waitForSelector('.thingy-aui-rail', { state: 'visible' });
  assert.equal(
    await page.locator('.thingy-aui-newchat').first().isVisible(),
    true,
    'open mobile rail shows the new-chat action'
  );
  await page.locator('.rail-scrim').click({ position: { x: 380, y: 400 } });
  await page.waitForSelector('.thingy-aui-rail', { state: 'hidden' });

  await assertAccessible(page, 'mobile chat');
  assertNoUiFailures(failures, 'mobile chat');
  await context.close();
}

async function main() {
  for (const [name, browserType] of [
    ['Chromium', chromium],
    ['WebKit', webkit]
  ]) {
    const browser = await browserType.launch();
    try {
      await checkSignInRedirect(browser);
      await checkGuestPreview(browser);
      await checkReactChatGuest(browser);
      await checkChat(browser);
      await checkMobileChat(browser);
    } finally {
      await browser.close();
    }
    console.log(`Thingy browser smoke passed in ${name}.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
