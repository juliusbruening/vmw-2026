// scripts/testCacheHeaders.mjs
//
// Validiert, dass die Cache-Header korrekt gesetzt werden:
//   - Anonyme User: public, max-age=… → CDN-Caching aktiv
//   - Authed (Master/Trainer/Schiri): private, max-age=5 → kein CDN, kurzer Browser-Cache
//
// Methode: Function-Handler direkt importieren und mit Mock-Request aufrufen.
// Funktioniert ohne Netlify-Runtime — wir mocken nur Header + URL.

let pass = 0, fail = 0;
function expect(label, ok, details = '') {
  if (ok) { console.log('✓ ' + label); pass++; }
  else    { console.log('✗ ' + label + (details ? ': ' + details : '')); fail++; }
}

function makeRequest(url, headers = {}) {
  return new Request(url, { method: 'GET', headers });
}

// ── /api/tournaments ──────────────────────────────────────────────────────
const tournamentsHandler = (await import('../netlify/functions/tournaments-list.mjs')).default;

// Anonymous → CDN-Header gesetzt
process.env.ADMIN_PASSWORD = 'dummy';   // damit lib/auth.mjs nicht crasht
const anonRes = await tournamentsHandler(makeRequest('https://x/api/tournaments'));
const anonCC  = anonRes.headers.get('cache-control') || '';
expect('Anon /api/tournaments: public max-age', anonCC.includes('public') && anonCC.includes('max-age'),
  `actual: "${anonCC}"`);

// Authed (master password) → private no-cdn
const authRes = await tournamentsHandler(makeRequest('https://x/api/tournaments', {
  'x-admin-password': 'dummy',
}));
const authCC = authRes.headers.get('cache-control') || '';
expect('Authed /api/tournaments: private', authCC.includes('private'),
  `actual: "${authCC}"`);
expect('Authed: KEIN CDN-Cache-Header',
  !authRes.headers.get('netlify-cdn-cache-control'),
  `cdn-header: "${authRes.headers.get('netlify-cdn-cache-control') || ''}"`);

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} pass, ${fail} fail`);
process.exitCode = fail === 0 ? 0 : 1;
