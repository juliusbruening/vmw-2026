# VMW Live-App — Turnier 2.0

Multi-Turnier-Plattform für VMW Berlin. Nachfolger der DC2026-Einzel-App, jetzt mit pluggable Connectoren, Multi-Turnier-Verwaltung und persistentem Schiedsrichter-Tracking.

**Phasen 1-6 sind umgesetzt** (alles außer Phase 7 — DKV-PDF-Export). Konzepte siehe `KONZEPT_MULTI_TURNIER.md` und `KONZEPT_SCHIRI_TRACKING.md` im übergeordneten Projektordner.

## Was alles drin ist

### Phase 1 — Multi-Turnier-Refactor
- Tournament-Config aus Daten (`tournaments/<slug>.json` oder Blob-Store `tournaments/<slug>/config.json`)
- SPA-Routing `/t/<slug>`, `/admin`, `/me/<code>`
- TID-basiertes Team-Matching (Bracket-Bug-Fix — kein Namens-Matching mehr)
- Field-Rename: `jury → referee`, `juryVmw → ourReferee`, `vmwTeam → ourTeam`

### Phase 2 — Connector-Abstraktion + Master-Admin-Wizard
- `scraper/connectors/index.mjs` als Registry, `kayakers.mjs` mit Drei-Pfad-Discovery (Vollständig / Reduziert / Manuell)
- `bundesligaKanupolio.mjs` als Skelett (Parser müssen aus `vmw-kanupolo-live` migriert werden)
- Master-Admin im Frontend: Turnier-Liste, Status-Toggle, "Neues Turnier"-Wizard mit URL-Discovery
- Connector erkennt automatisch `/View/<slug>`, `/Tournament/<slug>`, `/MatchList/<slug>` plus `vid`-Param für Liga-Phasen
- Zwei Passwort-Rollen: `MASTER_PASSWORD` (Julius — alles) und `ADMIN_PASSWORD` (Trainer — nur Schiri-Einteilungen)

### Phase 3 — Schiri-Stammdaten + Rollen-Einteilung
- Vereins-Pool unter `club/referees/<id>.json` mit Index `club/referees/index.json`
- 5 Schiri-Klassen (PLZ / C / B / A / ICF) + 5 Kategorien (U14 / U16 / U21 / Damen / Herren)
- 7 Rollen pro Spiel (1.SR, 2.SR, Protokoll, Zeit, Shotclock, 1.Linie, 2.Linie), alle optional
- PLZ-Klasse darf nicht 1./2. Schiri sein — Validierung im Frontend (ausgegraut) + Backend (HTTP 400)
- Schiri-Picker als Bottom-Sheet mit Filter nach Kategorie + Klasse + Suche
- Public-Profil-Sheet beim Klick auf einen Schiri-Namen (kein Vollname, nur Stats)
- Master-Admin: Schiri-CRUD (Anlegen, Editieren, Soft-Delete, Vornamen-Kollisions-Warnung)

### Phase 4 — Lifecycle + Landing-Page
- Status-Automatik: `awaiting-schedule → active → completed` via Cron
- Adaptive Re-Discovery-Frequenz für `awaiting-schedule`: >30 Tage = 1×/Woche, 7-30 Tage = 1×/Tag, <7 Tage = 2×/Tag
- Sobald Spielplan erscheint: Auto-Transition zu `active`, Master sieht `pendingTeamSelection`-Banner
- Auto-Transition zu `completed` einen Tag nach letztem Spieltag
- Landing-Page auf `/` mit Status-Sektionen (Läuft / Geplant / Beendet), Master sieht zusätzlich Drafts

### Phase 5 — Jahres-Reports + CSV
- `/api/admin/reports/referees?year=YYYY` aggregiert alle `assignments.json` + manuelle Einträge des Jahres
- Master-Admin-Tab "Reports" zeigt Tabelle mit Total + Aufschlüsselung pro Rolle, sortierbar
- CSV-Export via `/api/admin/reports/referees.csv?year=YYYY` (UTF-8 BOM, Excel-freundlich)
- Klick auf Report-Zeile öffnet das Public-Profil-Sheet

### Phase 6 — Schiri-Login + Self-Service
- Login-Modal mit drei Tabs: Trainer / Master / Schiri
- Schiri-Login-Code Format `VMW-XXXX` (Vereins-Präfix + 4 Zufallszeichen ohne 0/O/1/I)
- Rate-Limit: 5 Fehlversuche pro IP / 5 Min
- Self-Service-Dashboard `/me/<code>` ODER per App-Login zugänglich: Stammdaten editieren + Einsatz-Historie + manuell Einsatz ergänzen
- Self pflegt: Adresse, Telefon, Lizenz-Nr, Verband, Verein. Master pflegt: Klasse, Kategorien, active-Flag, Notizen
- Manuelle Einträge (`club/manualEntries/<refId>/<id>.json`) für externe Turniere — fließen in Jahres-Report

## Projekt-Struktur

```
Turnier 2.0/
├── lib/
│   ├── auth.mjs                     # Rolle-Detection (master/trainer/self)
│   ├── refereeLevels.mjs            # ROLES, REFEREE_LEVELS, CATEGORIES, canAssignRole
│   ├── referees.mjs                 # CRUD für Schiri-Stammdaten
│   ├── reports.mjs                  # aggregateReferees, refereesToCsv, listManualEntries
│   ├── tournaments.mjs              # getTournament, listTournaments, saveTournament, updateTournament
│   └── types.mjs                    # JSDoc-Typen
│
├── scraper/
│   ├── connectors/
│   │   ├── index.mjs                # getConnector, detectConnector
│   │   ├── kayakers.mjs             # Drei-Pfad-Discovery + Scrape
│   │   └── bundesligaKanupolio.mjs  # Skelett, TODO: Parser aus vmw-kanupolo-live
│   ├── index.mjs                    # Dispatcher → Connector
│   ├── parseMatchList.mjs           # Field-Rename jury → referee
│   ├── parseTeam.mjs
│   └── fetch.mjs
│
├── netlify/functions/
│   ├── data.mjs                     # GET /api/data?slug=… (snapshot + assignments + referees + config)
│   ├── admin.mjs                    # /api/admin/*  (Tournaments + Refs + Reports + Rollen)
│   ├── auth-login.mjs               # POST /api/auth/referee-login
│   ├── me.mjs                       # /api/me/*  (Self-Service)
│   ├── public-referee-stats.mjs     # GET /api/club/referees/<id>/stats
│   ├── tournaments-list.mjs         # GET /api/tournaments  (Landing-Page)
│   ├── scrape.mjs                   # Cron alle 15 Min — adaptive Re-Discovery + auto-completion
│   └── force-scrape.mjs             # POST manueller Scrape
│
├── tournaments/
│   └── dc2026.json                  # DC2026-Config
│
├── public/
│   ├── index.html
│   ├── app.js                       # Phase-1-Frontend (slug-aware)
│   ├── phase3.js                    # Login-Modal, Picker, Profil, Master-Admin, Landing, /me
│   ├── style.css
│   ├── phase3.css
│   └── manifest.webmanifest
│
├── scripts/
│   ├── testParseMatchList.mjs
│   ├── testTournamentLoader.mjs
│   ├── testTidBasedMatching.mjs
│   ├── testBuildSnapshotReal.mjs
│   ├── migrateBlobsPhase1.mjs
│   ├── scrapeOnce.mjs
│   └── serveLocal.mjs
│
├── tests/fixtures/
│   ├── dc2026-spielplan.html
│   └── dc2026-team-men2.html
│
├── netlify.toml                     # SPA + API-Redirects
├── package.json
└── README.md
```

## URL-Schema

| Pfad | Inhalt | Auth |
|---|---|---|
| `/` | Landing-Page mit Tournament-Übersicht | public |
| `/t/<slug>` | Tournament-Live-Ansicht | public |
| `/t/<slug>?beamer=1` | Beamer-Modus | public |
| `/admin` | Admin-Modal (Login → Trainer/Master) | passwortgeschützt |
| `/me/<code>` | Schiri-Self-Service (alternativ via App-Login) | personal-token |

## Endpoint-Übersicht

### Public
- `GET /api/data?slug=…` — Snapshot + Assignments + Referees + Config
- `GET /api/tournaments` — Tournament-Index für die Landing-Page
- `GET /api/club/referees/<id>/stats?year=YYYY` — Public-Profil-Stats

### Auth
- `POST /api/auth/referee-login` — Schiri-Login mit Code, Rate-Limited

### Schiri-Self-Service (`x-personal-token`)
- `GET  /api/me/profile`
- `PUT  /api/me/profile`
- `GET  /api/me/entries?year=YYYY`
- `POST /api/me/manual-entry`
- `PUT  /api/me/manual-entry/<id>`
- `DELETE /api/me/manual-entry/<id>`

### Trainer + Master (`x-admin-password`)
- `POST /api/admin/login`
- `GET/POST /api/admin/refs?slug=…` — Legacy Phase-1
- `POST /api/admin/t/<slug>/assignments/<matchNr>` — Phase-3 rollenbasiert

### Master only
- `GET  /api/admin/tournaments`
- `POST /api/admin/tournaments/discover`
- `POST /api/admin/tournaments`
- `PUT  /api/admin/tournaments/<slug>`
- `POST /api/admin/tournaments/<slug>/status`
- `POST /api/admin/tournaments/<slug>/scrape`
- `GET  /api/admin/discover/list?country=DE`
- `GET/POST/PUT/DELETE /api/admin/referees(/…)`
- `POST/DELETE /api/admin/referees/<id>/login-code`
- `GET  /api/admin/reports/referees?year=YYYY`
- `GET  /api/admin/reports/referees.csv?year=YYYY`

## Setup

```bash
npm install
npm test            # alle Tests grün
npm run preview     # http://localhost:5173 (mit Mock-Daten)
```

Auf Netlify deployen — Env-Variablen setzen:
- `ADMIN_PASSWORD` — für Trainer (oder Master, wenn `MASTER_PASSWORD` nicht gesetzt)
- `MASTER_PASSWORD` — optional, für separate Master-Rolle

Nach erstem Deploy:
```bash
netlify dev   # Terminal 1
node scripts/migrateBlobsPhase1.mjs   # Terminal 2 — verschiebt DC2026-Daten in neuen Store
```

## Nicht umgesetzt (Stretch / Phase 7)

- **DKV-Einsatzbogen-PDF-Export** — wartet auf konkrete Layout-Tests gegen die echte Vorlage.
- **`bundesligaKanupolio`-Connector ist ein Skelett** — die Parser aus `vmw-kanupolo-live` müssen 1:1 übernommen werden. Vorbereitet ist alles, Migration ist mechanisch.
- **Migrations-Wizard für DC2026-Schiri-Einträge auf Rollen-Format** — der alte players[]-Eintrag wird heute parallel gelesen; ein UI-Wizard für die Namen→Rolle-Zuordnung fehlt.

## Known Limitations / nächste Verbesserungen

- Login-Code wird als Klartext im Index gespeichert. Für höhere Sicherheit könnte man ihn hashen — Master müsste ihn dann beim Generieren einmalig sichern.
- `phase3.js` ist eine Single-File-Erweiterung statt Module — pragmatisch für den ersten Wurf, langfristig könnte man auf Vite + ES-Modules wechseln.
- Live-Beamer-Modus hat noch keinen Liga-Tabellen-View für `type: 'league'`.
- Kein Audit-Log für Schiri-Profil-Edits durch Self-Service.

## Lessons learned aus dem Live-Betrieb DC2026

Alle Fixes aus dem Wochenende sind übernommen:
- Multilingual Status-Detection (Beendet/Finished/Nicht gespielt/Cancelled)
- Score-Extraktion aus Team-Zelle
- TID-basiertes Team-Matching (Bracket-Bug-Schutz)
- Strong-Consistency-Read + Verify-Loop für Race-Schutz
- Frontend-Merge schützt frisch gespeicherte Einträge vor stale CDN-Antworten
- Zeitbasierte Live-Erkennung (Anpfiff erreicht + kein Score → live)
- "Gerade beendet" desc-Sortierung
