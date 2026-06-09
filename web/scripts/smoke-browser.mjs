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

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${baseUrl}/chat/?email=thingy%40thingelstad.com&prompt=What%20about%20RSS%3F&from=https%3A%2F%2Fweekly.thingelstad.com%2Farchive%2F123%2F&corpus=blog`);
    await page.waitForURL(/\/signin\/\?return=%2Fchat%2F$/);
    assert.equal(new URL(page.url()).searchParams.get('return'), '/chat/');
    assert.doesNotMatch(page.url(), /thingy%40thingelstad|What%20about|weekly\.thingelstad|corpus=blog/);
    await context.close();

    const authedContext = await browser.newContext();
    await seedSession(authedContext);
    const authedPage = await authedContext.newPage();
    await routeMockApi(authedPage);

    await authedPage.goto(`${baseUrl}/dispatch/`);
    await authedPage.waitForSelector('#dispatch-input:disabled');
    assert.equal(await authedPage.locator('#dispatch-input').getAttribute('placeholder'), 'Start a new Dispatch to shape another request...');

    await authedPage.setViewportSize({ width: 390, height: 844 });
    await authedPage.goto(`${baseUrl}/chat/`);
    await authedPage.waitForSelector('.mobile-chatbar');
    assert.equal(await authedPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await authedPage.locator('#mobile-conversations-toggle').click();
    await authedPage.waitForSelector('.thingy-app-shell.is-mobile-rail-open');
    assert.equal((await authedPage.locator('.rail-surface-switch a.is-active').textContent()).trim(), 'Chat');
    assert.equal(await authedPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);

    await authedContext.close();
  } finally {
    await browser.close();
  }
  console.log('Thingy browser smoke passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
