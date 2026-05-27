// lib/reports.mjs
//
// Aggregations-Logik für Schiri-Einsätze über alle Turniere eines Jahres.
// Quelle: tournaments/<slug>/assignments.json (Phase 3 rollenbasiert)
//         + club/manualEntries/<refereeId>/*.json (Phase 6)

import { getStore } from '@netlify/blobs';
import { listTournaments } from './tournaments.mjs';
import { listReferees } from './referees.mjs';
import { ROLES } from './refereeLevels.mjs';

/**
 * Aggregiert alle Einsätze pro Schiri für ein Jahr.
 * Returnt { byReferee: { [id]: {...} } }.
 *
 * @param {{ year: number }} opts
 */
export async function aggregateReferees({ year }) {
  const [tournaments, referees] = await Promise.all([
    listTournaments(),
    listReferees({ activeOnly: false, includeSecret: true }),
  ]);
  const refsById = new Map(referees.map(r => [r.id, r]));

  // Initialisiere Schiri-Buckets
  const byReferee = {};
  for (const r of referees) {
    byReferee[r.id] = {
      id: r.id,
      displayName: r.displayName || r.firstName,
      fullName: `${r.firstName || ''} ${r.lastName || ''}`.trim(),
      level: r.level,
      active: r.active,
      totalGames: 0,
      byRole: Object.fromEntries(ROLES.map(rl => [rl.code, 0])),
      byTournament: {},
    };
  }

  // 1) Auto-Einsätze aus den Turnier-Assignments
  const store = getStore('tournaments');
  for (const t of tournaments) {
    // Filter: Turnier hat mindestens ein Datum im Zieljahr
    const yearsCovered = new Set((t.dates || []).map(d => Number(d.slice(0, 4))));
    if (!yearsCovered.has(year)) continue;

    const assignments = await store.get(`${t.slug}/assignments.json`, { type: 'json' });
    if (!assignments) continue;

    for (const [matchNr, entry] of Object.entries(assignments)) {
      if (!entry?.roles) continue;
      for (const [roleCode, refId] of Object.entries(entry.roles)) {
        if (!refId) continue;
        if (!byReferee[refId]) continue;
        const bucket = byReferee[refId];
        bucket.totalGames += 1;
        bucket.byRole[roleCode] = (bucket.byRole[roleCode] || 0) + 1;
        const tKey = t.slug;
        if (!bucket.byTournament[tKey]) {
          bucket.byTournament[tKey] = { slug: t.slug, name: t.name, games: 0, byRole: {} };
        }
        bucket.byTournament[tKey].games += 1;
        bucket.byTournament[tKey].byRole[roleCode] = (bucket.byTournament[tKey].byRole[roleCode] || 0) + 1;
      }
    }
  }

  // 2) Manuelle Einsätze (Phase 6) — pro Schiri unter club/manualEntries/<refId>/
  const clubStore = getStore('club');
  for (const refId of Object.keys(byReferee)) {
    try {
      const list = await clubStore.list({ prefix: `manualEntries/${refId}/` });
      const blobs = list?.blobs || [];
      for (const b of blobs) {
        const entry = await clubStore.get(b.key, { type: 'json' });
        if (!entry) continue;
        const entryYear = Number((entry.tournamentDate || '').slice(0, 4));
        if (entryYear !== year) continue;
        const bucket = byReferee[refId];
        bucket.totalGames += 1;
        bucket.byRole[entry.role] = (bucket.byRole[entry.role] || 0) + 1;
        const key = `_manual:${entry.tournamentName || 'Manuell'}`;
        if (!bucket.byTournament[key]) {
          bucket.byTournament[key] = {
            slug: null, name: entry.tournamentName || 'Manueller Eintrag',
            games: 0, byRole: {}, manual: true,
          };
        }
        bucket.byTournament[key].games += 1;
        bucket.byTournament[key].byRole[entry.role] = (bucket.byTournament[key].byRole[entry.role] || 0) + 1;
      }
    } catch { /* kein manualEntries-Dir → skip */ }
  }

  // Tournament-Map zu Array konvertieren für übersichtliche JSON-Antworten
  for (const id of Object.keys(byReferee)) {
    byReferee[id].byTournament = Object.values(byReferee[id].byTournament);
  }

  return { byReferee };
}

/**
 * Konvertiert aggregateReferees-Output in CSV (UTF-8, Excel-freundlich).
 */
export function refereesToCsv(aggregation, year) {
  const rows = Object.values(aggregation.byReferee);
  const header = ['DisplayName', 'FullName', 'Level', 'Total', ...ROLES.map(r => r.short)];
  const lines = [header.join(',')];
  for (const r of rows) {
    const cols = [
      csvField(r.displayName),
      csvField(r.fullName),
      csvField(r.level || ''),
      String(r.totalGames),
      ...ROLES.map(role => String(r.byRole[role.code] || 0)),
    ];
    lines.push(cols.join(','));
  }
  // BOM für Excel-UTF-8-Erkennung
  return '﻿' + lines.join('\n');
}

function csvField(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Manuelle Einträge pro Schiri lesen — für /api/me/entries.
 */
export async function listManualEntries(refereeId, { year } = {}) {
  const store = getStore('club');
  try {
    const list = await store.list({ prefix: `manualEntries/${refereeId}/` });
    const blobs = list?.blobs || [];
    const entries = await Promise.all(blobs.map(b => store.get(b.key, { type: 'json' })));
    let filtered = entries.filter(Boolean);
    if (year) filtered = filtered.filter(e => Number((e.tournamentDate || '').slice(0, 4)) === year);
    return filtered.sort((a, b) => (b.tournamentDate || '').localeCompare(a.tournamentDate || ''));
  } catch {
    return [];
  }
}
