// scripts/testTournamentLoader.mjs
// Validiert lib/tournaments.mjs gegen die Repo-Datei tournaments/dc2026.json
//
// Erwartung:
//   - getTournament('dc2026')              → Config-Objekt mit slug "dc2026"
//   - getTournament('does-not-exist')      → null
//   - listTournaments()                    → enthält dc2026

import { getTournament, listTournaments } from '../lib/tournaments.mjs';

let pass = 0, fail = 0;
function expect(label, ok) {
  if (ok) { console.log('✓ ' + label); pass++; }
  else    { console.log('✗ ' + label); fail++; }
}

const dc = await getTournament('dc2026');
expect('getTournament("dc2026") liefert Objekt',     !!dc);
expect('dc2026.slug === "dc2026"',                    dc?.slug === 'dc2026');
expect('dc2026.name enthält "Deutschland Cup"',       /Deutschland Cup/.test(dc?.name));
expect('dc2026.type === "tournament"',                dc?.type === 'tournament');
expect('dc2026.connector === "kayakers"',             dc?.connector === 'kayakers');
expect('dc2026.dates ist Array mit 3 Einträgen',      Array.isArray(dc?.dates) && dc.dates.length === 3);
expect('dc2026.ourTeams hat 5 VMW-Teams',             Array.isArray(dc?.ourTeams) && dc.ourTeams.length === 5);
expect('dc2026.source.tournamentId ist eine UUID',    /^[a-f0-9-]{36}$/i.test(dc?.source?.tournamentId || ''));

const missing = await getTournament('does-not-exist-2099');
expect('getTournament(unknown) → null',               missing === null);

const all = await listTournaments();
expect('listTournaments() liefert Array',             Array.isArray(all));
expect('listTournaments() enthält dc2026',            all.some(t => t.slug === 'dc2026'));

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} pass, ${fail} fail`);
process.exitCode = fail === 0 ? 0 : 1;
