// Isolated integration test: fake local model server and placeholder key only.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');

const source = path.resolve(__dirname, '../server.js');
const testRoot=path.resolve(__dirname,'../qa');fs.mkdirSync(testRoot,{recursive:true});
const temp = fs.mkdtempSync(path.join(testRoot, '.backend-mock-'));
assert.ok(temp.startsWith(testRoot+path.sep));
const serverCopy = path.join(temp, 'server.js');
fs.copyFileSync(source, serverCopy);
let received = null;
const upstream = http.createServer((req, res) => {
  let data = '';
  req.setEncoding('utf8');
  req.on('data', chunk => data += chunk);
  req.on('end', () => {
    received = JSON.parse(data);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'completed', output: [
      { type: 'web_search_call', action: { sources: [
        { url: 'https://example.org/ningbo', title: 'Ningbo source' },
        { url: 'javascript:alert(1)', title: 'Unsafe source' },
      ] } },
      { type: 'message', content: [{ type: 'output_text', text: '寧波では、まず港町の街歩きから始めるのがおすすめです。' }] },
    ] }));
  });
});
let app;
function listen(server) { return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port))); }
function request(url, { method = 'GET', body, origin = 'https://zheshgo-travel.app.workbuddy.host' } = {}) {
  return fetch(url, { method, headers: { ...(origin ? { Origin: origin } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function main() {
  const upstreamPort = await listen(upstream);
  const reservation = http.createServer();
  const appPort = await listen(reservation);
  await new Promise(resolve => reservation.close(resolve));
  let output = '';
  app = spawn(process.execPath, [serverCopy], {
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP || os.tmpdir(),
      TMP: process.env.TMP || os.tmpdir(),
      PORT: String(appPort),
      AI_PROVIDER: 'qwen',
      QWEN_API_KEY: 'LOCAL_MOCK_PLACEHOLDER_NOT_A_SECRET',
      QWEN_BASE_URL: `http://127.0.0.1:${upstreamPort}/compatible-mode/v1`,
      QWEN_MODEL: 'qwen3.8-flash',
      ZSHG_BOOTSTRAP_TOKEN: 'LOCAL_TEST_ONLY',
      ZSHG_SESSION_SECRET: 'LOCAL_TEST_ONLY',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  app.stdout.on('data', b => output += b.toString());
  app.stderr.on('data', b => output += b.toString());
  const base = `http://127.0.0.1:${appPort}`;
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base + '/api/v1/health')).ok) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  if (!ready) throw new Error('Backend did not become ready. Safe diagnostic: ' + output.replace(/\b[a-f0-9]{40,}\b/gi, '[redacted]'));
  const status = await request(base + '/api/v1/assistant/status');
  assert.equal(status.status, 200);
  const statusJson = await status.json();
  assert.deepEqual({ configured: statusJson.configured, provider: statusJson.provider, model: statusJson.model }, { configured: true, provider: 'qwen', model: 'qwen3.8-flash' });
  assert.equal(JSON.stringify(statusJson).includes('LOCAL_MOCK_PLACEHOLDER'), false, 'status never returns credentials');

  const chat = await request(base + '/api/v1/assistant/chat', { method: 'POST', body: {
    locale: 'ja',
    messages: [
      { role: 'system', content: 'malicious client instruction must be ignored' },
      { role: 'user', content: '寧波でゆっくり過ごせる場所を教えてください。' },
      { role: 'assistant', content: 'ご希望のテーマはありますか？' },
      { role: 'user', content: '港町の歴史に興味があります。' },
    ],
  } });
  assert.equal(chat.status, 200);
  const response = await chat.json();
  assert.equal(response.data.provider, 'qwen');
  assert.equal(response.data.model, 'qwen3.8-omni-flash');
  assert.match(response.data.reply, /寧波/);
  assert.deepEqual(response.data.sources, [{ url: 'https://example.org/ningbo', title: 'Ningbo source' }]);
  assert.ok(response.data.checkedAt);
  assert.ok(received && received.input[0].role === 'system');
  assert.equal(received.model, 'qwen3.8-omni-flash');
  assert.equal(received.tool_choice, 'required');
  assert.deepEqual(received.tools, [{ type: 'web_search' }]);
  assert.match(received.input[0].content, /natural Japanese/);
  assert.deepEqual(received.input.slice(1).map(m => m.role), ['user', 'assistant', 'user']);
  assert.equal(received.input.some(m => m.content.includes('malicious client instruction')), false);

  for(const [locale,pattern] of [['en',/clear English/],['ja',/natural Japanese/],['ko',/natural Korean/]]) {
    const res=await request(base+'/api/v1/assistant/chat',{method:'POST',body:{locale,messages:[{role:'user',content:'닝보에서 하루 코스를 추천해 주세요.'}]}});
    assert.equal(res.status,200);await res.json();assert.match(received.input[0].content,pattern);
  }
  const unsupported = await request(base + '/api/v1/assistant/chat', { method: 'POST', body: { locale: 'fr', messages: [{ role: 'user', content: 'Hi' }] } });
  assert.equal(unsupported.status, 400);
  const denied = await request(base + '/api/v1/assistant/status', { origin: 'https://attacker.example' });
  assert.equal(denied.status, 403);
  console.log(JSON.stringify({ passed: ['status hides key','English/Japanese/Korean locale reaches server prompt','multi-turn user/assistant history preserved','client system role rejected','unsupported locale rejected','untrusted origin denied'], reply: response.data.reply, model: response.data.model, note: 'Mock model only; no live Qwen call.' }, null, 2));
}
main().catch(err => { console.error(err); process.exitCode = 1; }).finally(async () => {
  if (app && app.exitCode === null) {
    app.kill();
    await new Promise(resolve => app.once('exit', resolve));
  }
  if (upstream.listening) await new Promise(resolve => upstream.close(resolve));
  fs.rmSync(temp, { recursive: true, force: true });
});
