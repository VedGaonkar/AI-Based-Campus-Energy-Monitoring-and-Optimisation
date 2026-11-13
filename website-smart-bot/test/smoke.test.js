import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { scriptedGemini, startAssistant, startWebsite } from './harness.js';

let site, bot, admin, viewer;
const fake = scriptedGemini();

before(async () => {
  site = await startWebsite();
  bot = await startAssistant({ website: site, fake });
  [admin, viewer] = await Promise.all([site.login('admin'), site.login('viewer')]);
});
after(async () => {
  await bot?.close();
  await site?.close();
});

test('assistant signs people in through the real website session and answers from live data', async () => {
  const a = await bot.request(admin, 'GET', '/api/session');
  assert.equal(a.status, 200);
  assert.equal(a.body.mode, 'admin');
  const v = await bot.request(viewer, 'GET', '/api/session');
  assert.equal(v.body.mode, 'viewer');

  const rooms = await bot.chat(viewer, 'Which rooms can I see?');
  assert.match(rooms.text, /R101/);
  assert.match(rooms.text, /R103/);
  assert.equal(rooms.source, 'database');
  assert.equal(fake.calls.length, 0, 'a plain data question must not call Gemini');
});
