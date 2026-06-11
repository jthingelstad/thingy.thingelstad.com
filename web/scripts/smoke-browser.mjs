#!/usr/bin/env node
import assert from 'node:assert/strict';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (error) {
  console.error('Thingy browser smoke requires Playwright. Install it locally with: npm install --save-dev playwright');
  process.exit(1);
}

const baseUrl = (process.env.THINGY_SMOKE_URL || 'http://localhost:8080').replace(/\/$/, '');
const apiHost = 'https://k0yklt9vg3.execute-api.us-east-1.amazonaws.com';
const streamHost = 'https://jcvud66qqpq53frvno5stoqntm0zqntw.lambda-url.us-east-1.on.aws';

function fakeToken() {
  const payload = Buffer.from(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 20,
    email: 'thingy@thingelstad.com'
  })).toString('base64url');
  return `${payload}.smoke`;
}

async function seedSession(context) {
  await context.addInitScript((token) => {
    window.localStorage.setItem('weeklyThingLibrarianToken', token);
    window.localStorage.setItem('thingyUserEmail', 'thingy@thingelstad.com');
    window.localStorage.setItem('thingyUserProfile', JSON.stringify({
      preferred_name: 'Smoke',
      status: 'premium',
      supporting_member: true,
      entitlements: ['supporting_member'],
      modes: [{ id: 'thingy', label: 'Thingy' }]
    }));
  }, fakeToken());
}

async function routeMockApi(page) {
  await page.route(`${apiHost}/dispatch`, async (route) => {
    const body = route.request().postDataJSON?.() || {};
    if (body.action === 'list') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          supporting_member: true,
          entitlements: ['supporting_member'],
          dispatches: [{
            id: 'smoke-sent',
            status: 'sent',
            title: 'Smoke Sent Dispatch',
            prompt: 'Smoke prompt',
            updated_at: new Date().toISOString()
          }]
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
    await route.fulfill({
      contentType: 'text/event-stream; charset=utf-8',
      body: 'event: answer_delta\ndata: {"delta":"Hi. I am Thingy."}\n\nevent: done\ndata: {"request_id":"smoke"}\n\n'
    });
  });
}

async function checkSignInRedirect(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${baseUrl}/chat/?email=thingy%40thingelstad.com&prompt=What%20about%20RSS%3F&from=https%3A%2F%2Fweekly.thingelstad.com%2Farchive%2F123%2F&corpus=blog`);
  await page.waitForURL(/\/signin\/\?return=%2Fchat%2F$/);
  assert.equal(new URL(page.url()).searchParams.get('return'), '/chat/');
  assert.doesNotMatch(page.url(), /thingy%40thingelstad|What%20about|weekly\.thingelstad|corpus=blog/);
  await context.close();
}

async function checkChatIslands(browser) {
  const context = await browser.newContext();
  await seedSession(context);
  const page = await context.newPage();
  await routeMockApi(page);
  await page.goto(`${baseUrl}/chat/`);

  // The AuthPanel mount should be hidden when signed in; the chat panel visible.
  await page.waitForSelector('#librarian-chat:not([hidden])');
  assert.equal(await page.locator('#librarian-auth').isHidden(), true, 'auth panel hidden when signed in');

  // RailRecents island should render the empty-state copy from the
  // component, not from static HTML (we removed the static <p>).
  await page.waitForSelector('#rail-recents-mount .rail-empty');
  const emptyText = (await page.locator('#rail-recents-mount .rail-empty').textContent()).trim();
  assert.match(emptyText, /Your conversations sync with Thingy/);

  // ComposerCount island should be present at rest, then visible/reactive
  // after the compact composer expands.
  await page.waitForSelector('#librarian-question-count .composer-count', { state: 'attached' });
  const countLocator = page.locator('#librarian-question-count .composer-count');
  assert.equal((await countLocator.textContent()).trim(), '0 / 1200', 'count starts at 0');
  assert.equal(await countLocator.isVisible(), false, 'count is hidden while composer is compact');
  await page.locator('#librarian-question').fill('Hello Thingy');
  await countLocator.waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const el = document.querySelector('#librarian-question-count .composer-count');
    return el && /^12 \/ 1200/.test(el.textContent || '');
  });

  // ComposerSubmit island: send button is present and not in stop mode at rest.
  const sendButton = page.locator('button.composer-send').first();
  assert.equal((await sendButton.getAttribute('aria-label')) || '', 'Ask Thingy', 'send button at rest');
  assert.equal(await sendButton.evaluate((el) => el.classList.contains('is-stop')), false, 'send button not in stop mode at rest');

  // AccountMenu: opening it shows the build stamp injected at build time.
  await page.locator('.rail-account-btn').click();
  await page.waitForSelector('.rail-menu-build');
  assert.match((await page.locator('.rail-menu-build').textContent()).trim(), /^Build .+/);
  await page.keyboard.press('Escape');

  // Notice toast: showNotice via the store should reveal the .thingy-notice node.
  await page.evaluate(async () => {
    const mod = await import('/src/shared/stores/ui-store.js');
    mod.showNotice('Smoke notice');
  });
  await page.waitForSelector('.thingy-notice.is-visible');
  assert.equal((await page.locator('.thingy-notice').textContent()).trim(), 'Smoke notice');

  await context.close();
}

async function checkDispatchIslands(browser) {
  const context = await browser.newContext();
  await seedSession(context);
  const page = await context.newPage();
  await routeMockApi(page);
  await page.goto(`${baseUrl}/dispatch/`);

  // DispatchRecents mount should render the loaded smoke draft from the
  // mocked /dispatch list response.
  await page.waitForSelector('#dispatch-recents-mount .rail-recent');
  const row = page.locator('#dispatch-recents-mount .rail-recent').first();
  assert.match((await row.locator('.rail-recent-title').textContent()).trim(), /Smoke Sent Dispatch/);

  // DispatchStatus mount renders an aria-live region from the component
  // (empty when no status, but the element is in the DOM).
  await page.waitForSelector('#dispatch-status-mount .dispatch-status', { state: 'attached' });
  assert.equal(await page.locator('#dispatch-status-mount .dispatch-status').getAttribute('aria-live'), 'polite');

  // The sent draft is non-editable; the input should be disabled with the
  // dispatched placeholder copy.
  await page.waitForSelector('#dispatch-input:disabled');
  assert.equal(
    await page.locator('#dispatch-input').getAttribute('placeholder'),
    'Start a new Dispatch to shape another request...'
  );

  await context.close();
}

async function checkMobileChat(browser) {
  const context = await browser.newContext();
  await seedSession(context);
  const page = await context.newPage();
  await routeMockApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/chat/`);
  await page.waitForSelector('.mobile-chatbar');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await page.locator('#mobile-conversations-toggle').click();
  await page.waitForSelector('.thingy-app-shell.is-mobile-rail-open');
  assert.equal((await page.locator('.rail-surface-switch a.is-active').textContent()).trim(), 'Chat');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await context.close();
}

async function main() {
  const browser = await chromium.launch();
  try {
    await checkSignInRedirect(browser);
    await checkChatIslands(browser);
    await checkDispatchIslands(browser);
    await checkMobileChat(browser);
  } finally {
    await browser.close();
  }
  console.log('Thingy browser smoke passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
