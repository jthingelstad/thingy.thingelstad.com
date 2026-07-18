#!/usr/bin/env node
import { chromium } from 'playwright';

const args = new Set(process.argv.slice(2));
const baseUrl = valueArg('--base-url') || process.env.THINGY_QA_URL || 'http://localhost:8080';
const email = process.env.THINGY_QA_EMAIL || 'thingy@thingelstad.com';
const apiUrl = String(process.env.LIBRARIAN_API_URL || '').replace(/\/$/, '');
const jmapToken =
  process.env.FASTMAIL_JMAP_TOKEN || process.env.THINGY_FASTMAIL_JMAP_TOKEN || process.env.THINGY_JMAP_TOKEN;
const suppliedSessionToken = process.env.THINGY_SESSION_TOKEN || '';
const cleanupOnly = args.has('--cleanup-only');
const dispatchOnly = args.has('--dispatch-only');
const qaPrefix = process.env.THINGY_QA_PREFIX || 'QA real-api';

if (!apiUrl) fail('LIBRARIAN_API_URL is required.');
if (!suppliedSessionToken && !jmapToken) {
  fail(
    'Set THINGY_SESSION_TOKEN or a Fastmail JMAP token: FASTMAIL_JMAP_TOKEN, THINGY_FASTMAIL_JMAP_TOKEN, or THINGY_JMAP_TOKEN.'
  );
}

function valueArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function fail(message) {
  console.error(`Thingy real API QA failed: ${message}`);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function apiPost(path, payload, token = '') {
  const response = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${path} HTTP ${response.status}: ${data.error || data.message || 'error'}`);
  }
  return data;
}

async function jmapFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      authorization: `Bearer ${jmapToken}`,
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {})
    }
  });
  if (!response.ok) throw new Error(`JMAP HTTP ${response.status}`);
  return await response.json();
}

async function latestMagicLinkSince(since) {
  const session = await jmapFetch('https://api.fastmail.com/jmap/session');
  const mail = 'urn:ietf:params:jmap:mail';
  const core = 'urn:ietf:params:jmap:core';
  const accountId = session.primaryAccounts?.[mail];
  const response = await jmapFetch(session.apiUrl, {
    method: 'POST',
    body: JSON.stringify({
      using: [core, mail],
      methodCalls: [
        [
          'Email/query',
          {
            accountId,
            filter: { text: 'Thingy' },
            sort: [{ property: 'receivedAt', isAscending: false }],
            limit: 12
          },
          'q'
        ],
        [
          'Email/get',
          {
            accountId,
            '#ids': { resultOf: 'q', name: 'Email/query', path: '/ids' },
            properties: ['subject', 'receivedAt', 'bodyValues'],
            fetchTextBodyValues: true,
            fetchHTMLBodyValues: true,
            maxBodyValueBytes: 200000
          },
          'g'
        ]
      ]
    })
  });
  const emails = response.methodResponses?.find((item) => item[2] === 'g')?.[1]?.list || [];
  for (const item of emails) {
    if (new Date(item.receivedAt || 0) < since) continue;
    const body = Object.values(item.bodyValues || {})
      .map((value) => value?.value || '')
      .join('\n');
    const url = body.match(/https?:\/\/[^\s"'<>]+(?:login_token|magic_token)=[^\s"'<>]+/)?.[0];
    if (url) return { url, receivedAt: item.receivedAt };
  }
  return null;
}

async function latestDispatchEmailSince(since) {
  if (!jmapToken) return null;
  const jmapSession = await jmapFetch('https://api.fastmail.com/jmap/session');
  const mail = 'urn:ietf:params:jmap:mail';
  const core = 'urn:ietf:params:jmap:core';
  const accountId = jmapSession.primaryAccounts?.[mail];
  const response = await jmapFetch(jmapSession.apiUrl, {
    method: 'POST',
    body: JSON.stringify({
      using: [core, mail],
      methodCalls: [
        [
          'Email/query',
          {
            accountId,
            filter: { after: since.toISOString() },
            sort: [{ property: 'receivedAt', isAscending: false }],
            limit: 10
          },
          'q'
        ],
        [
          'Email/get',
          {
            accountId,
            '#ids': { resultOf: 'q', name: 'Email/query', path: '/ids' },
            properties: ['subject', 'receivedAt', 'bodyValues'],
            fetchTextBodyValues: true,
            fetchHTMLBodyValues: true,
            maxBodyValueBytes: 200000
          },
          'g'
        ]
      ]
    })
  });
  const emails = response.methodResponses?.find((item) => item[2] === 'g')?.[1]?.list || [];
  return (
    emails.find((item) => {
      if (new Date(item.receivedAt || 0) < since) return false;
      const content = [item.subject, ...Object.values(item.bodyValues || {}).map((value) => value?.value || '')].join(
        '\n'
      );
      return (
        !/(sign in|private sign-in link)/i.test(content) &&
        (content.includes(qaPrefix) || /(dispatch|prepared by thingy|template test)/i.test(content))
      );
    }) || null
  );
}

async function authData() {
  if (suppliedSessionToken) {
    const refreshed = await apiPost('/auth', { action: 'refresh_session' }, suppliedSessionToken);
    return { ...refreshed, token: refreshed.token || suppliedSessionToken, auth_status: 'session_token' };
  }

  const requestedAt = new Date(Date.now() - 5000);
  const request = await apiPost('/auth', {
    action: 'check',
    email,
    source: 'thingy',
    return_path: '/chat/'
  });
  if (request.token) return { ...request, auth_status: 'token_returned' };
  if (request.status !== 'magic_link_sent') throw new Error(`Unexpected auth status: ${request.status || 'none'}`);

  let link = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    link = await latestMagicLinkSince(requestedAt);
    if (link) break;
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  if (!link) throw new Error('No fresh Thingy magic link found.');

  const url = new URL(link.url);
  const loginToken = url.searchParams.get('login_token') || url.searchParams.get('magic_token');
  const complete = await apiPost('/auth', {
    action: 'complete_magic_link',
    login_token: loginToken,
    source: 'thingy'
  });
  if (!complete.token) throw new Error('Magic-link redemption did not return a session token.');
  return { ...complete, auth_status: request.status, email_received_at: link.receivedAt };
}

function storedProfilePayload(data) {
  const incoming = data.profile || {};
  const entitlements = data.entitlements || incoming.entitlements || [];
  return {
    ...incoming,
    status: data.status || incoming.status || '',
    supporting_member: Boolean(
      data.status === 'premium' || incoming.supporting_member || entitlements.includes('supporting_member')
    ),
    entitlements,
    modes: data.modes || incoming.modes || []
  };
}

async function seedSession(context, data) {
  await context.addInitScript(
    (auth) => {
      window.localStorage.setItem('weeklyThingLibrarianToken', auth.token);
      window.localStorage.setItem('thingyUserEmail', auth.email);
      window.localStorage.setItem('thingyUserProfile', JSON.stringify(auth.profile));
    },
    {
      token: data.token,
      email: data.email || email,
      profile: storedProfilePayload(data)
    }
  );
}

function collectFailures(page) {
  const failures = [];
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console: ${message.text().slice(0, 180)}`);
  });
  page.on('requestfailed', (request) => {
    const url = request.url();
    const error = request.failure()?.errorText || '';
    if (/fonts\.gstatic\.com/.test(url) && /aborted/i.test(error)) return;
    if (/ERR_ABORTED|aborted/i.test(error)) return;
    failures.push(`request: ${request.method()} ${url.slice(0, 140)} ${error}`);
  });
  return failures;
}

async function cleanupConversations(token) {
  const listed = await apiPost('/conversations', { action: 'list', limit: 50 }, token);
  const matches = (listed.conversations || []).filter((item) => {
    const title = String(item.title || item.preview || '').trim();
    return title.startsWith(qaPrefix);
  });
  for (const item of matches) {
    const conversationId = item.id || item.conversation_id;
    if (conversationId) await apiPost('/conversations', { action: 'delete', conversation_id: conversationId }, token);
  }
  return matches.length;
}

async function cleanupDispatches(token) {
  const listed = await apiPost('/dispatch', { action: 'list', limit: 50 }, token);
  const matches = (listed.dispatches || []).filter((item) => {
    const title = String(item.topic || item.title || item.prompt || '').trim();
    return title.startsWith(qaPrefix);
  });
  for (const item of matches) {
    const dispatchId = item.id || item.dispatch_id;
    if (dispatchId) await apiPost('/dispatch', { action: 'delete', dispatch_id: dispatchId }, token);
  }
  return matches.length;
}

async function currentIds(token, path, key) {
  const listed = await apiPost(path, { action: 'list', limit: 50 }, token);
  return new Set(
    (listed[key] || []).map((item) => item.id || item.conversation_id || item.dispatch_id).filter(Boolean)
  );
}

async function cleanupIdsCreatedAfter(token, path, key, baseline) {
  const current = await currentIds(token, path, key);
  const created = [...current].filter((id) => !baseline.has(id));
  for (const id of created) {
    const payload =
      path === '/conversations' ? { action: 'delete', conversation_id: id } : { action: 'delete', dispatch_id: id };
    await apiPost(path, payload, token);
  }
  return created.length;
}

async function checkDesktopChat(browser, data, result) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  await seedSession(context, data);
  const page = await context.newPage();
  const failures = collectFailures(page);
  await page.goto(`${baseUrl.replace(/\/$/, '')}/chat/`);
  await page.waitForSelector('.librarian-chat:not([hidden])', { timeout: 20000 });
  await page.waitForSelector(`text=${data.email || email}`, { timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector('#librarian-question')?.disabled, null, { timeout: 30000 });
  assert(
    (await page.locator('text=Supporting Member').count()) > 0 || data.status !== 'premium',
    'chat account status did not render'
  );
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    'desktop chat has horizontal overflow'
  );

  const prompt = `${qaPrefix}: one sentence smoke check ${Date.now()}`;
  await page.locator('#librarian-question').fill(prompt);
  await page.getByRole('button', { name: 'Ask Thingy' }).click();
  await page.waitForSelector('button[aria-label="Copy answer"]', { timeout: 90000 });
  result.prompt = prompt;
  result.failures = failures;
  await context.close();
}

async function checkDesktopDispatch(browser, data, result) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  await seedSession(context, data);
  const page = await context.newPage();
  const failures = collectFailures(page);
  await page.goto(`${baseUrl.replace(/\/$/, '')}/dispatch/?dispatch_test=template`);
  await page.waitForSelector('.dispatch-chat:not([hidden])', { timeout: 20000 });
  await page.waitForSelector(`text=${data.email || email}`, { timeout: 20000 });
  assert((await page.locator('.rail-body').count()) === 1, 'dispatch recents region missing');
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    'desktop dispatch has horizontal overflow'
  );

  await page.locator('.rail-newchat.dispatch-new').click();
  const prompt = `${qaPrefix}: Create a concise Dispatch about RSS and open-web themes in Jamie's archive, using two or three sources and a practical synthesis. No clarification is needed; this direction is approved. ${Date.now()}`;
  await page.locator('#dispatch-input').fill(prompt);
  await page.getByRole('button', { name: 'Send to Thingy' }).click();
  await page.waitForFunction(() => document.querySelector('#dispatch-input')?.disabled, null, { timeout: 10000 });
  await page.waitForFunction(() => !document.querySelector('#dispatch-input')?.disabled, null, { timeout: 190000 });
  const sendButton = page.getByRole('button', { name: 'Send Template Test' });
  for (let turn = 0; turn < 2 && (await sendButton.count()) === 0; turn += 1) {
    if ((await page.locator('.dispatch-status[data-kind="error"]').count()) > 0) break;
    await page
      .locator('#dispatch-input')
      .fill(
        'Proceed with that approved direction. Use your strongest archive sources and make the final editorial choices.'
      );
    await page.getByRole('button', { name: 'Send to Thingy' }).click();
    await page.waitForFunction(() => document.querySelector('#dispatch-input')?.disabled, null, { timeout: 10000 });
    await page.waitForFunction(() => !document.querySelector('#dispatch-input')?.disabled, null, { timeout: 190000 });
  }
  if ((await sendButton.count()) !== 1) {
    const transcript = (await page.locator('.dispatch-messages').innerText()).replace(/\s+/g, ' ').slice(-3000);
    const status = (await page.locator('.dispatch-status').innerText()).replace(/\s+/g, ' ').trim();
    throw new Error(
      `dispatch planner did not reach the template-send action. Status: ${status || 'none'}. Transcript: ${transcript}. Browser errors: ${failures.join(' | ') || 'none'}`
    );
  }
  const requestedAt = new Date(Date.now() - 5000);
  await sendButton.click();
  await page.getByText('Dispatch sent. Check your email.').waitFor({ timeout: 120000 });
  if (jmapToken) {
    let delivered = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      delivered = await latestDispatchEmailSince(requestedAt);
      if (delivered) break;
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    assert(delivered, 'template Dispatch completed but no matching email arrived through JMAP');
    result.email_received_at = delivered.receivedAt;
    result.email_subject = delivered.subject;
  }
  result.prompt = prompt;
  result.failures = failures;
  await context.close();
}

async function checkMobile(browser, data, path, toggleSelector, resultName) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  await seedSession(context, data);
  const page = await context.newPage();
  const failures = collectFailures(page);
  await page.goto(`${baseUrl.replace(/\/$/, '')}${path}`);
  await page.waitForSelector('.mobile-chatbar', { timeout: 20000 });
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    `${resultName} has overflow at rest`
  );
  await page.locator(toggleSelector).click();
  await page.waitForSelector('.thingy-app-shell.is-mobile-rail-open', { timeout: 10000 });
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    `${resultName} has overflow with rail open`
  );
  await context.close();
  return failures;
}

const data = await authData();
const cleanupBefore = {
  conversations: await cleanupConversations(data.token),
  dispatches: await cleanupDispatches(data.token)
};
const baseline = {
  conversations: await currentIds(data.token, '/conversations', 'conversations'),
  dispatches: await currentIds(data.token, '/dispatch', 'dispatches')
};

if (cleanupOnly) {
  console.log(JSON.stringify({ ok: true, cleanup: cleanupBefore }, null, 2));
  process.exit(0);
}

const browser = await chromium.launch();
const results = {
  ok: true,
  auth_status: data.auth_status,
  email_received_at: data.email_received_at || '',
  checks: []
};

try {
  if (!dispatchOnly) {
    const chatResult = {};
    await checkDesktopChat(browser, data, chatResult);
    results.checks.push({ name: 'desktop chat real stream', ok: true, failures: chatResult.failures });
  }

  const dispatchResult = {};
  await checkDesktopDispatch(browser, data, dispatchResult);
  results.checks.push({
    name: 'desktop dispatch real clarify and template email',
    ok: true,
    email_received_at: dispatchResult.email_received_at || '',
    email_subject: dispatchResult.email_subject || '',
    failures: dispatchResult.failures
  });

  if (!dispatchOnly) {
    const mobileChatFailures = await checkMobile(browser, data, '/chat/', '.mobile-chatbar-circle', 'mobile chat');
    results.checks.push({ name: 'mobile chat rail', ok: true, failures: mobileChatFailures });

    const mobileDispatchFailures = await checkMobile(
      browser,
      data,
      '/dispatch/',
      '.mobile-chatbar-circle',
      'mobile dispatch'
    );
    results.checks.push({ name: 'mobile dispatch rail', ok: true, failures: mobileDispatchFailures });
  }
} finally {
  await browser.close();
  results.cleanup = {
    before: cleanupBefore,
    after: {
      conversations: await cleanupIdsCreatedAfter(
        data.token,
        '/conversations',
        'conversations',
        baseline.conversations
      ),
      dispatches: await cleanupIdsCreatedAfter(data.token, '/dispatch', 'dispatches', baseline.dispatches)
    }
  };
}

const failures = results.checks.flatMap((check) => check.failures || []);
if (failures.length) results.ok = false;
console.log(JSON.stringify(results, null, 2));
if (!results.ok) process.exit(1);
