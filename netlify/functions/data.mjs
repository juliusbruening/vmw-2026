// netlify/functions/data.mjs (Phase 3+)
//
// GET /api/data?slug=<slug>
//
// Liefert:
//   - config         (UI-Subset, abgeleitet aus tournaments/<slug>/config.json)
//   - snapshot       (matches/teams/standings)
//   - assignments    (Phase 3+ rollenbasiert) ODER legacy refereeAssignments
//   - referees       (Public-View aller aktiven Schiris — für den Picker im Frontend)
//
// Strong-Consistency-Reads für assignments + referees, damit gerade-gespeicherte
// Einträge sofort sichtbar sind.

import { getStore } from '@netlify/blobs';
import { getTournament } from '../../lib/tournaments.mjs';
import { listReferees } from '../../lib/referees.mjs';

export default async (req) => {
  try {
    const url = new URL(req.url);
    const slug = (url.searchParams.get('slug') || 'dc2026').trim();

    const store = getStore('tournaments');
    const [snapshot, assignments, legacyRefs, config, referees] = await Promise.all([
      store.get(`${slug}/snapshot.json`, { type: 'json' }),
      store.get(`${slug}/assignments.json`, { type: 'json', consistency: 'strong' }),
      store.get(`${slug}/refereeAssignments.json`, { type: 'json', consistency: 'strong' }),
      getTournament(slug),
      // Public-View — KEIN Vollname, kein loginCode
      listReferees({ activeOnly: true, includeSecret: false }).catch(() => []),
    ]);

    if (!config) {
      return new Response(JSON.stringify({ error: `Tournament "${slug}" nicht gefunden` }),
        { status: 404, headers: { 'content-type': 'application/json' } });
    }

    // External Tournaments haben keinen eigenen Snapshot — Hinweis statt leere Daten
    if (config.type === 'external') {
      return new Response(JSON.stringify({
        slug, external: true,
        config: {
          slug: config.slug, name: config.name, type: 'external',
          status: config.status, externalUrl: config.externalUrl || null,
        },
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'public, max-age=300',
        },
      });
    }

    const uiConfig = {
      slug: config.slug,
      name: config.name,
      type: config.type ?? 'tournament',
      status: config.status,
      showStandings: !!config.showStandings,
      showHausliga: !!config.showHausliga,
      dates: config.dates ?? [],
      expectedDates: config.expectedDates ?? null,
      ourTeams: config.ourTeams ?? [],
      pendingTeamSelection: !!config.pendingTeamSelection,
      source: config.source ?? null,
    };

    const payload = {
      slug,
      config: uiConfig,
      snapshot: snapshot ?? null,
      assignments: assignments ?? null,                       // Phase 3 rollenbasiert
      refereeAssignments: legacyRefs ?? {},                   // Phase 1 legacy
      referees,                                                // Public-Schiri-Index für Picker
      server: new Date().toISOString(),
    };

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=5',
        'netlify-cdn-cache-control': 'public, s-maxage=5, stale-while-revalidate=60',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
