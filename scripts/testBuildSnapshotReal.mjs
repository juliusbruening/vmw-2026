// scripts/testBuildSnapshotReal.mjs
//
// End-to-End-Validierung gegen das echte DC2026-Live-HTML aus tests/fixtures.
// Mock-Fetcher liefert die echte Spielplan-HTML für alle 3 Tage und ein
// Team-Detail-HTML für jede Team-Abfrage.
//
// Erwartung: Snapshot baut sich auf, ourTeam wird per TID korrekt gesetzt,
// referee-Feld ist gefüllt, Bracket-Bug-Schutz greift (keine Falschmeldungen).

import fs from 'node:fs/promises';
import { buildSnapshot } from '../scraper/index.mjs';
import { getTournament } from '../lib/tournaments.mjs';

const FIXTURES = new URL('../tests/fixtures/', import.meta.url);
const spielplanHtml = await fs.readFile(new URL('dc2026-spielplan.html', FIXTURES), 'utf8');
const teamHtml      = await fs.readFile(new URL('dc2026-team-men2.html',  FIXTURES), 'utf8');

async function mockFetcher(url) {
  if (url.includes('/MatchList/')) return spielplanHtml;
  if (url.includes('/Team?id='))   return teamHtml;
  return '';
}

let pass = 0, fail = 0;
function expect(label, ok) {
  if (ok) { console.log('✓ ' + label); pass++; }
  else    { console.log('✗ ' + label); fail++; }
}

const dc = await getTournament('dc2026');
const snapshot = await buildSnapshot(dc, { fetcher: mockFetcher });

expect('Snapshot hat matches[]',                       Array.isArray(snapshot.matches));
expect('Snapshot.matches.length > 100',                snapshot.matches.length > 100);
expect('Snapshot.lastUpdated ist ISO-Datum',           !!Date.parse(snapshot.lastUpdated));

const done = snapshot.matches.filter(m => m.status === 'done');
const next = snapshot.matches.filter(m => m.status === 'next');
expect('Status-Verteilung enthält done + next',        done.length > 0 && next.length > 0);

// VMW-Spiele: einzelne erwartet, alle mit echter TID
const vmwGames = snapshot.matches.filter(m => m.ourTeam !== null);
expect('Mindestens 1 VMW-Spiel gefunden',              vmwGames.length > 0);
expect('Alle VMW-Spiele haben gültige TID',
  vmwGames.every(m => /^[a-f0-9-]{36}$/i.test(m.teamA.tid) || /^[a-f0-9-]{36}$/i.test(m.teamB.tid)));

// VMW-Schiri-Einsätze: VMW Berlin als Schiri-Team
const vmwReferee = snapshot.matches.filter(m => m.ourReferee !== null);
expect('Mindestens 1 VMW-Schiri-Einsatz',              vmwReferee.length > 0);

// Field-Rename: jury → referee
const sample = snapshot.matches[0];
expect('match.referee (nicht jury) vorhanden',         sample.referee !== undefined);
expect('match.jury existiert NICHT mehr',              sample.jury === undefined);
expect('match.ourReferee statt juryVmw',               sample.ourReferee !== undefined);
expect('match.juryVmw existiert NICHT mehr',           sample.juryVmw === undefined);

// Teams-Array: 5 VMW-Teams mit Roster
expect('Snapshot hat 5 Teams (alle VMW)',              snapshot.teams.length === 5);
expect('Mindestens ein Team hat einen Roster',         snapshot.teams.some(t => Array.isArray(t.roster) && t.roster.length > 0));

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} pass, ${fail} fail`);
process.exitCode = fail === 0 ? 0 : 1;
