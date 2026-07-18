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
const apiHost = (process.env.LIBRARIAN_API_URL || 'https://k0yklt9vg3.execute-api.us-east-1.amazonaws.com').replace(
  /\/$/,
  ''
);
const streamHost = (process.env.LIBRARIAN_STREAM_URL || 'https://stream.thingy.thingelstad.com').replace(/\/$/, '');

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

  await page.route(`${apiHost}/dispatch`, async (route) => {
    const body = route.request().postDataJSON?.() || {};
    if (body.action === 'list') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          supporting_member: true,
          entitlements: ['supporting_member'],
          dispatches: [
            {
              id: 'smoke-sent',
              status: 'sent',
              title: 'Smoke Sent Dispatch',
              prompt: 'Smoke prompt',
              updated_at: new Date().toISOString()
            }
          ]
        })
      });
      return;
    }
    await route.fulfill({ contentType: 'application/json', body: '{}' });
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

async function checkDiscordSignedOut(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const failures = collectUiFailures(page);
  await page.goto(`${baseUrl}/discord/?state=smoke-state`);
  await page.waitForSelector('.thingy-discord-signin:not([hidden])');
  const signInUrl = new URL(await page.locator('.thingy-discord-signin a').getAttribute('href'), baseUrl);
  assert.equal(signInUrl.pathname, '/signin/');
  assert.equal(signInUrl.searchParams.get('return'), '/discord/?state=smoke-state');
  await assertAccessible(page, 'Discord connection');
  assertNoUiFailures(failures, 'Discord connection');
  await context.close();
}

async function checkChat(browser) {
  const context = await browser.newContext();
  await seedSession(context);
  const page = await context.newPage();
  const failures = collectUiFailures(page);
  const mocks = await routeMockApi(page, { holdWelcome: true });
  await page.goto(`${baseUrl}/chat/`);

  // The route-level root owns the entire authenticated shell.
  await page.waitForSelector('.librarian-chat:not([hidden])');
  assert.equal(await page.locator('.librarian-auth').isHidden(), true, 'auth panel hidden when signed in');

  await page.waitForSelector('.rail-body .rail-empty');
  const emptyText = (await page.locator('.rail-body .rail-empty').textContent()).trim();
  assert.match(emptyText, /Your conversations sync with Thingy/);

  // A deterministic welcome renders immediately, but personalization remains
  // asynchronous and must not lock the composer.
  await page.waitForSelector('.librarian-message-assistant');
  assert.match(await page.locator('.librarian-message-assistant').first().textContent(), /Hi\. I'm Thingy/);

  // Controlled composer state should update while the welcome request is held.
  await page.waitForSelector('#librarian-question-count .composer-count');
  const countLocator = page.locator('#librarian-question-count .composer-count');
  assert.equal((await countLocator.textContent()).trim(), '0 / 1200', 'count starts at 0');
  await page.locator('#librarian-question').fill('Hello Thingy');
  await page.waitForFunction(() => {
    const el = document.querySelector('#librarian-question-count .composer-count');
    return el && /^12 \/ 1200/.test(el.textContent || '');
  });
  await page.waitForSelector('button.composer-send[aria-label="Ask Thingy"]');
  const sendButton = page.locator('button.composer-send').first();
  assert.equal(await sendButton.isEnabled(), true, 'welcome personalization does not disable the composer');
  mocks.releaseWelcome();
  await page
    .waitForFunction(() =>
      document.querySelector('.librarian-message-assistant')?.textContent?.includes('Hi. I am Thingy.')
    )
    .catch(async (error) => {
      const text = await page.locator('.librarian-message-assistant').textContent();
      throw new Error(`Personalized welcome did not render. Current message: ${text}. Failures: ${failures.join('; ')}`, {
        cause: error
      });
    });
  assert.equal((await sendButton.getAttribute('aria-label')) || '', 'Ask Thingy', 'send button at rest');
  assert.equal(
    await sendButton.evaluate((el) => el.classList.contains('is-stop')),
    false,
    'send button not in stop mode at rest'
  );

  // Account menu stays inside the root and exposes the injected build stamp.
  await page.locator('.rail-account-btn').click();
  await page.waitForSelector('.rail-menu-build');
  assert.match((await page.locator('.rail-menu-build').textContent()).trim(), /^Build .+/);
  await page.keyboard.press('Escape');

  // The source picker uses one native checkbox focus target per source.
  await page.locator('.srcpick-btn').click();
  await page.waitForSelector('#srcpick-pop:not([hidden])');
  assert.equal(await page.locator('.srcpick-row[tabindex]').count(), 0, 'source labels are not duplicate tab stops');
  assert.equal(await page.locator('.srcpick-row input[type="checkbox"]').count(), 3);
  await page.locator('.thingy-chat-scroll').click({ position: { x: 10, y: 10 } });
  assert.equal(await page.locator('#srcpick-pop').isHidden(), true, 'outside click closes the source picker');

  // Authenticated routes must not execute Tinylytics or any other third-party script.
  assert.equal(await page.locator('script[src*="tinylytics"]').count(), 0);
  assert.equal(
    await page.evaluate(() =>
      performance.getEntriesByType('resource').some((entry) => entry.name.includes('tinylytics.app'))
    ),
    false
  );

  await assertAccessible(page, 'chat');

  assertNoUiFailures(failures, 'chat');

  await context.close();
}

async function checkDispatch(browser) {
  const context = await browser.newContext();
  await seedSession(context);
  const page = await context.newPage();
  const failures = collectUiFailures(page);
  await routeMockApi(page);
  await page.goto(`${baseUrl}/dispatch/`);

  await page.waitForSelector('.dispatch-rail-item');
  const row = page.locator('.dispatch-rail-item').first();
  assert.match((await row.locator('.rail-recent-title').textContent()).trim(), /Smoke Sent Dispatch/);

  await page.waitForSelector('.dispatch-status', { state: 'attached' });
  assert.equal(await page.locator('.dispatch-status').getAttribute('aria-live'), 'polite');

  // The sent draft is non-editable; the input should be disabled with the
  // dispatched placeholder copy.
  await page.waitForSelector('#dispatch-input:disabled');
  assert.equal(
    await page.locator('#dispatch-input').getAttribute('placeholder'),
    'Start a new Dispatch to shape another request...'
  );

  assert.equal(await page.locator('script[src*="tinylytics"]').count(), 0);
  await assertAccessible(page, 'dispatch');

  assertNoUiFailures(failures, 'dispatch');

  // Dispatch uses AccountMenu's built-in logout path rather than injecting
  // the Chat route's custom store cleanup callback.
  await page.locator('.rail-account-btn').click();
  await page.getByRole('menuitem', { name: 'Logout' }).click();
  await page.waitForURL(/\/signin\/\?return=%2Fdispatch%2F/);

  await context.close();
}

async function checkMobileChat(browser) {
  const context = await browser.newContext();
  await seedSession(context);
  const page = await context.newPage();
  const failures = collectUiFailures(page);
  await routeMockApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/chat/`);
  await page.waitForSelector('.mobile-chatbar');
  await page.waitForSelector('.librarian-chat:not([hidden])');
  await page.waitForSelector('.thingy-input');
  await page.waitForSelector('.session-welcome-toggle');
  assert.equal(await page.locator('.rail-scrim').count(), 0, 'closed mobile rail has no hidden focusable scrim');
  assert.equal(
    await page.locator('.session-welcome-toggle').getAttribute('aria-expanded'),
    'false',
    'long personalized welcome starts compact'
  );
  assert.equal(
    await page.locator('.thingy-composer-zone').isVisible(),
    true,
    'mobile composer zone is visible at rest'
  );
  assert.equal(await page.locator('.thingy-input').isVisible(), true, 'mobile composer is visible at rest');
  assert.equal(
    await page.locator('.thingy-input').evaluate((element) => window.getComputedStyle(element).position),
    'static',
    'mobile composer stays in page flow'
  );
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await page.locator('.mobile-chatbar-circle').click();
  await page.waitForSelector('.thingy-app-shell.is-mobile-rail-open');
  assert.equal(await page.locator('.rail-scrim').count(), 1, 'open mobile rail renders one close scrim');
  assert.equal((await page.locator('.rail-surface-switch a.is-active').textContent()).trim(), 'Chat');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await page.locator('.rail-scrim').click({ position: { x: 380, y: 400 } });
  await page.waitForSelector('.thingy-app-shell:not(.is-mobile-rail-open)');
  assert.equal(await page.locator('.rail-scrim').count(), 0, 'closing mobile rail removes the scrim from focus order');
  await page.locator('.session-welcome-toggle').click();
  assert.equal(
    await page.locator('.session-welcome-toggle').getAttribute('aria-expanded'),
    'true',
    'personalized welcome can be expanded'
  );
  await assertAccessible(page, 'mobile chat');
  assertNoUiFailures(failures, 'mobile chat');
  await context.close();
}

async function checkMobileDispatch(browser) {
  const context = await browser.newContext();
  await seedSession(context);
  const page = await context.newPage();
  const failures = collectUiFailures(page);
  await routeMockApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/dispatch/`);
  await page.waitForSelector('.dispatch-chat:not([hidden])');
  assert.equal(
    await page.locator('.rail-scrim').count(),
    0,
    'closed mobile Dispatch rail has no hidden focusable scrim'
  );
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await page.locator('.mobile-chatbar-circle').click();
  await page.waitForSelector('.thingy-app-shell.is-mobile-rail-open');
  assert.equal(await page.locator('.rail-scrim').count(), 1, 'open mobile Dispatch rail renders one close scrim');
  assert.equal((await page.locator('.rail-surface-switch a.is-active').textContent()).trim(), 'Dispatch');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await page.locator('.rail-scrim').click({ position: { x: 380, y: 400 } });
  await page.waitForSelector('.thingy-app-shell:not(.is-mobile-rail-open)');
  assert.equal(await page.locator('.rail-scrim').count(), 0, 'closing mobile Dispatch rail removes the scrim');
  await assertAccessible(page, 'mobile Dispatch');
  assertNoUiFailures(failures, 'mobile Dispatch');
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
      await checkDiscordSignedOut(browser);
      await checkChat(browser);
      await checkDispatch(browser);
      await checkMobileChat(browser);
      await checkMobileDispatch(browser);
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
