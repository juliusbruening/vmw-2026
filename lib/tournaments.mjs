// lib/tournaments.mjs
//
// Tournament-Config-Loader. Zweistufig:
//
//   1. Phase 1: aus Repo-Datei laden (tournaments/<slug>.json)
//   2. Phase 2+: aus Netlify Blob "tournaments/<slug>/config.json" laden
//
// Die Reihenfolge ist absichtlich Blob-zuerst — Phase 2 schreibt die Config
// in den Blob-Store (vom Master via UI), Phase 1 hat noch keine UI und nutzt
// die Repo-Dateien als Bootstrap. Sobald in Phase 2 die UI live ist und der
// Master eine Config angelegt hat, gewinnt sie.

import fs from 'node:fs/promises';
import { getStore } from '@netlify/blobs';

const REPO_DIR  = new URL('../tournaments/', import.meta.url);
const BLOB_STORE = 'tournaments';

/**
 * Lädt eine einzelne Tournament-Config.
 * @param {string} slug
 * @returns {Promise<import('./types.mjs').TournamentConfig | null>}
 */
export async function getTournament(slug) {
  // 1. Blob-Store (production)
  try {
    const store = getStore(BLOB_STORE);
    const cfg = await store.get(`${slug}/config.json`, { type: 'json', consistency: 'strong' });
    // Tombstone-Marker: wenn der Master via UI gelöscht hat, überschattet er die Repo-Datei
    if (cfg && cfg._deleted === true) return null;
    if (cfg) return cfg;
  } catch {
    // Blob-Store nicht erreichbar (z.B. lokales Setup ohne Netlify CLI) → Repo-Fallback
  }

  // 2. Repo-Datei (Bootstrap / vorkonfigurierte Tournaments)
  try {
    const raw = await fs.readFile(new URL(`${slug}.json`, REPO_DIR), 'utf8');
    const cfg = JSON.parse(raw);
    cfg._source = 'repo';   // UI kann das nutzen um es als read-only zu markieren wenn gewünscht
    return cfg;
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

/**
 * Liefert alle bekannten Tournaments (Repo + Blob deduppliziert).
 * Blob-Einträge gewinnen bei gleichem Slug.
 * @returns {Promise<import('./types.mjs').TournamentConfig[]>}
 */
export async function listTournaments() {
  const found = new Map();
  const tombstones = new Set();

  // 1. Blob-Index — kann Tombstones enthalten die Repo-Files überschatten
  try {
    const store = getStore(BLOB_STORE);
    const index = await store.get('index.json', { type: 'json', consistency: 'strong' });
    if (index?.tournaments) {
      for (const entry of index.tournaments) {
        const cfg = await store.get(`${entry.slug}/config.json`, { type: 'json', consistency: 'strong' });
        if (cfg?._deleted === true) { tombstones.add(entry.slug); continue; }
        if (cfg) found.set(cfg.slug, cfg);
      }
    }
  } catch { /* ignore */ }

  // 2. Repo-Dateien (Bootstrap)
  try {
    const entries = await fs.readdir(REPO_DIR);
    const slugs = entries.filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));
    for (const slug of slugs) {
      if (found.has(slug) || tombstones.has(slug)) continue; // Blob bzw. Tombstone gewinnen
      try {
        const raw = await fs.readFile(new URL(`${slug}.json`, REPO_DIR), 'utf8');
        const cfg = JSON.parse(raw);
        cfg._source = 'repo';
        found.set(slug, cfg);
      } catch { /* skip broken file */ }
    }
  } catch { /* dir missing → leer */ }

  return [...found.values()];
}

/**
 * Speichert eine Tournament-Config in den Blob-Store und aktualisiert den Index.
 * @param {import('./types.mjs').TournamentConfig} config
 */
export async function saveTournament(config) {
  const store = getStore(BLOB_STORE);
  await store.setJSON(`${config.slug}/config.json`, config);

  const index = (await store.get('index.json', { type: 'json', consistency: 'strong' })) ?? { tournaments: [] };
  const existing = index.tournaments.findIndex(t => t.slug === config.slug);
  const entry = {
    slug: config.slug,
    name: config.name,
    type: config.type ?? 'tournament',
    status: config.status,
    dates: config.dates,
  };
  if (existing >= 0) index.tournaments[existing] = entry;
  else index.tournaments.push(entry);
  index.updatedAt = new Date().toISOString();
  await store.setJSON('index.json', index);
}

/**
 * Partial-Update einer Tournament-Config (merge mit Bestand).
 */
export async function updateTournament(slug, patch) {
  const existing = await getTournament(slug);
  if (!existing) return null;
  const merged = { ...existing, ...patch, slug };
  merged.updatedAt = patch.updatedAt || new Date().toISOString();
  await saveTournament(merged);
  return merged;
}
