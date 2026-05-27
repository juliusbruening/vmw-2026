/* =========================================================
   Phase 2-6 Frontend-Supplement
   Erweitert app.js um:
   - Rollen-Picker für Schiri-Einteilung (Phase 3)
   - Public-Profil-Sheet beim Klick auf Schiri-Namen (Phase 3+5)
   - Login-Modal mit Master/Trainer/Schiri-Tabs (Phase 3+6)
   - Master-Admin-Tabs: Turniere/Stammdaten/Reports (Phase 2-5)
   - Schiri-Self-Service-Dashboard (Phase 6)
   - Landing-Page bei pathname '/' (Phase 4)
   - Liga-Tabelle-Tab wenn config.showStandings (Phase 2)
   ========================================================= */

(function(){
  'use strict';

  // ─── Konstanten (mirror von lib/refereeLevels.mjs) ────────────────────
  const ROLES = [
    { code: 'ref1',      label: '1. Schiedsrichter', short: '1.SR',  requiresRefMatch: true  },
    { code: 'ref2',      label: '2. Schiedsrichter', short: '2.SR',  requiresRefMatch: true  },
    { code: 'scorer',    label: 'Protokoll',         short: 'Prot',  requiresRefMatch: false },
    { code: 'timer',     label: 'Zeitnehmer',        short: 'Zeit',  requiresRefMatch: false },
    { code: 'shotclock', label: 'Shotclock',         short: 'Shot',  requiresRefMatch: false },
    { code: 'line1',     label: '1. Linienrichter',  short: 'Lin1',  requiresRefMatch: false },
    { code: 'line2',     label: '2. Linienrichter',  short: 'Lin2',  requiresRefMatch: false },
  ];
  const REFEREE_LEVELS = ['PLZ', 'C', 'B', 'A', 'ICF'];
  const PLZ_CAN_DO = (roleCode) => !ROLES.find(r => r.code === roleCode)?.requiresRefMatch;
  const CATEGORIES = ['U14', 'U16', 'U21', 'Damen', 'Herren'];

  // Globalen State erweitern (vorausgesetzt window.state ist von app.js)
  window.state = window.state || {};
  Object.assign(window.state, {
    role:           window.state.role || localStorage.getItem('vmw.role') || null,            // 'trainer'|'master'|null
    refereeAuth:    window.state.refereeAuth || localStorage.getItem('refereeAuth') || null,  // Schiri-Login-Code
    referees:       [],
    assignments:    null,
  });

  // ─── Helpers ────────────────────────────────────────────────────────
  const $ = (sel, root=document) => root.querySelector(sel);
  const h = (tag, attrs = {}, ...children) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k === 'onclick') el.onclick = v;
      else if (k.startsWith('data-')) el.setAttribute(k, v);
      else el[k] = v;
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

  // ─── Modal-Manager ───────────────────────────────────────────────────
  function openModal(content, opts={}) {
    closeModal();
    const backdrop = h('div', { class: 'p3-backdrop', onclick: (e) => { if (e.target === backdrop) closeModal(); }});
    const modal = h('div', { class: 'p3-modal' });
    if (opts.wide) modal.classList.add('wide');
    modal.appendChild(content);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    document.body.style.overflow = 'hidden';
    return modal;
  }
  function closeModal() {
    document.querySelectorAll('.p3-backdrop').forEach(b => b.remove());
    document.body.style.overflow = '';
  }
  window.closeP3Modal = closeModal;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  // ─── Toast ──────────────────────────────────────────────────────────
  function toast(msg, kind='info') {
    const el = h('div', { class: `p3-toast ${kind}` }, msg);
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  // ─── API-Helpers ────────────────────────────────────────────────────
  async function api(path, opts={}) {
    const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
    if (window.state.adminPassword) headers['x-admin-password'] = window.state.adminPassword;
    if (window.state.refereeAuth)   headers['x-personal-token'] = window.state.refereeAuth;
    const res = await fetch(path, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data?.error || data?.message || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // ═══════════════════════════════════════════════════════════════════
  // LOGIN-MODAL mit 3 Tabs (Trainer / Master / Schiri)
  // ═══════════════════════════════════════════════════════════════════
  window.openLogin = function() {
    let activeTab = 'trainer';
    const tabBar = h('div', { class: 'p3-tabbar' });
    const body = h('div', { class: 'p3-body' });

    function render() {
      tabBar.innerHTML = '';
      ['trainer', 'master', 'schiri'].forEach(t => {
        const btn = h('button', {
          class: 'p3-tab ' + (activeTab === t ? 'active' : ''),
          onclick: () => { activeTab = t; render(); },
        }, t === 'trainer' ? 'Trainer' : t === 'master' ? 'Master' : 'Schiri');
        tabBar.appendChild(btn);
      });

      body.innerHTML = '';
      if (activeTab === 'trainer' || activeTab === 'master') {
        const input = h('input', { type: 'password', placeholder: '••••••••', class: 'p3-input' });
        const btn = h('button', {
          class: 'p3-btn primary',
          onclick: async () => {
            try {
              window.state.adminPassword = input.value;
              await api(`/api/admin/login?slug=${encodeURIComponent(CURRENT_SLUG)}`, { method: 'POST', body: '{}' });
              window.state.role = activeTab;
              localStorage.setItem('vmw.adminPwd', input.value);
              localStorage.setItem('vmw.role', activeTab);
              toast(`Eingeloggt als ${activeTab}`, 'success');
              closeModal();
              // Nach Login: zum richtigen Bereich.
              //   Master → Master-Admin (Turniere/Schiris/Reports)
              //   Trainer → wenn auf /t/<slug>, dort weiter; sonst zurück zur Landing
              if (activeTab === 'master') {
                window.openMasterAdmin();
              } else if (window.CURRENT_SLUG && typeof window.renderActiveTab === 'function') {
                window.renderActiveTab();
              } else {
                window.renderLanding();
              }
            } catch (e) {
              window.state.adminPassword = null;
              toast('Login fehlgeschlagen', 'error');
            }
          },
        }, 'Login');
        body.appendChild(h('label', {}, 'Passwort'));
        body.appendChild(input);
        body.appendChild(btn);
      } else {
        const input = h('input', { type: 'text', placeholder: 'VMW-XXXX', class: 'p3-input', style: 'text-transform:uppercase' });
        const btn = h('button', {
          class: 'p3-btn primary',
          onclick: async () => {
            try {
              const result = await fetch('/api/auth/referee-login', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ code: input.value.trim() }),
              }).then(r => r.json());
              if (!result.ok) { toast(result.error === 'rate_limited' ? 'Zu viele Versuche — bitte später' : 'Code ungültig', 'error'); return; }
              window.state.refereeAuth = input.value.trim();
              localStorage.setItem('refereeAuth', input.value.trim());
              toast(`Willkommen ${result.referee.displayName}`, 'success');
              closeModal();
              window.openMyProfile();
            } catch (e) {
              toast('Login fehlgeschlagen', 'error');
            }
          },
        }, 'Einloggen');
        body.appendChild(h('label', {}, 'Schiri-Login-Code'));
        body.appendChild(input);
        body.appendChild(h('div', { class: 'p3-hint' }, 'Code vom Schiri-Verantwortlichen.'));
        body.appendChild(btn);
      }
    }

    const modal = h('div', { class: 'p3-modal-content' },
      h('div', { class: 'p3-modal-h' },
        h('h3', {}, 'Login'),
        h('button', { class: 'p3-close', onclick: closeModal }, '×')
      ),
      tabBar,
      body
    );
    openModal(modal);
    render();
  };

  window.logout = function() {
    if (window.state.refereeAuth) {
      window.state.refereeAuth = null;
      localStorage.removeItem('refereeAuth');
    }
    if (window.state.role) {
      window.state.role = null;
      window.state.adminPassword = null;
      localStorage.removeItem('vmw.role');
      localStorage.removeItem('vmw.adminPwd');
    }
    toast('Ausgeloggt', 'info');
    if (typeof window.renderActiveTab === 'function') window.renderActiveTab();
  };

  // ═══════════════════════════════════════════════════════════════════
  // ROLLEN-PICKER (Schiri für ein Match in eine Rolle eintragen)
  // ═══════════════════════════════════════════════════════════════════
  window.openRolePicker = function(matchNr, roleCode) {
    const role = ROLES.find(r => r.code === roleCode);
    if (!role) return;
    const match = window.state.snapshot?.matches?.find(m => m.nr === matchNr);
    if (!match) return;
    const refs = window.state.referees || [];
    const currentAssignment = (window.state.assignments?.[matchNr]?.roles) || {};

    let filterCategory = 'all';
    let filterLevel = 'all';
    let search = '';

    const listEl = h('div', { class: 'p3-picker-list' });
    function render() {
      listEl.innerHTML = '';
      const matchDivKey = match.divisionCode || ''; // U14|U16|U21|Women|Men1|Men2
      const defaultCat = matchDivKey === 'Women' ? 'Damen' : (matchDivKey.startsWith('Men') ? 'Herren' : matchDivKey);
      const cat = filterCategory === 'auto' ? defaultCat : (filterCategory === 'all' ? null : filterCategory);

      let visible = refs.filter(r => r.active !== false);
      if (cat) visible = visible.filter(r => (r.categories || []).includes(cat));
      if (filterLevel !== 'all') visible = visible.filter(r => r.level === filterLevel);
      if (search) visible = visible.filter(r => (r.displayName || '').toLowerCase().includes(search.toLowerCase()));

      // "Keine Auswahl"-Option oben
      listEl.appendChild(h('div', {
        class: 'p3-picker-item empty',
        onclick: () => savePick(null),
      }, h('em', {}, '— Keine Auswahl —')));

      visible.forEach(r => {
        const disabled = role.requiresRefMatch && r.level === 'PLZ';
        const alreadyAssigned = Object.entries(currentAssignment).find(([rc, id]) => rc !== roleCode && id === r.id);
        const item = h('div', {
          class: 'p3-picker-item' + (disabled || alreadyAssigned ? ' disabled' : ''),
          onclick: disabled || alreadyAssigned ? null : () => savePick(r.id),
        },
          h('div', {},
            h('div', { class: 'p3-pname' }, r.displayName || ''),
            h('div', { class: 'p3-pmeta' }, `${r.level || '—'} · ${(r.categories || []).join(', ')}`)
          ),
          disabled ? h('div', { class: 'p3-pdis' }, 'PLZ darf nicht 1./2. Schiri')
          : alreadyAssigned ? h('div', { class: 'p3-pdis' }, 'bereits eingeteilt')
          : null
        );
        listEl.appendChild(item);
      });
    }

    async function savePick(refId) {
      const newRoles = { ...currentAssignment, [roleCode]: refId };
      try {
        const slug = window.CURRENT_SLUG || 'dc2026';
        const result = await api(`/api/admin/t/${slug}/assignments/${matchNr}`, {
          method: 'POST',
          body: JSON.stringify({ roles: newRoles }),
        });
        window.state.assignments = result.assignments;
        toast('Gespeichert', 'success');
        closeModal();
        if (typeof window.renderActiveTab === 'function') window.renderActiveTab();
      } catch (e) {
        toast('Fehler: ' + (e.message || 'unbekannt'), 'error');
      }
    }

    const filters = h('div', { class: 'p3-picker-filters' },
      h('div', { class: 'p3-filter-row' },
        h('span', { class: 'p3-flabel' }, 'Kategorie:'),
        ['all', ...CATEGORIES].map(c => h('button', {
          class: 'p3-pillchoice ' + (filterCategory === c ? 'active' : ''),
          onclick: () => { filterCategory = c; render(); },
        }, c === 'all' ? 'Alle' : c))
      ),
      h('div', { class: 'p3-filter-row' },
        h('span', { class: 'p3-flabel' }, 'Klasse:'),
        ['all', ...REFEREE_LEVELS].map(l => h('button', {
          class: 'p3-pillchoice ' + (filterLevel === l ? 'active' : ''),
          onclick: () => { filterLevel = l; render(); },
        }, l === 'all' ? 'Alle' : l))
      ),
    );
    const searchEl = h('input', {
      type: 'text', placeholder: '🔍 Suchen…', class: 'p3-input',
      oninput: (e) => { search = e.target.value; render(); },
    });

    const teamLabel = `${match.teamA?.name || ''} vs ${match.teamB?.name || ''}`;
    const modal = h('div', { class: 'p3-modal-content' },
      h('div', { class: 'p3-modal-h' },
        h('div', {},
          h('h3', {}, `${role.label} · Spiel #${matchNr}`),
          h('div', { class: 'p3-subtitle' }, teamLabel)
        ),
        h('button', { class: 'p3-close', onclick: closeModal }, '×'),
      ),
      h('div', { class: 'p3-picker-search' }, searchEl),
      filters,
      listEl,
    );
    openModal(modal);
    render();
  };

  // ═══════════════════════════════════════════════════════════════════
  // PROFIL-SHEET (Public, Klick auf Schiri-Pillen-Namen)
  // ═══════════════════════════════════════════════════════════════════
  window.openProfile = async function(refereeId) {
    const year = new Date().getFullYear();
    try {
      const data = await fetch(`/api/club/referees/${refereeId}/stats?year=${year}`).then(r => r.json());
      if (data.error) { toast('Profil nicht gefunden', 'error'); return; }
      const modal = h('div', { class: 'p3-modal-content' },
        h('div', { class: 'p3-modal-h' },
          h('div', {},
            h('h3', {}, data.displayName),
            h('div', { class: 'p3-subtitle' }, `Klasse ${data.level || '—'}`)
          ),
          h('button', { class: 'p3-close', onclick: closeModal }, '×'),
        ),
        h('div', { class: 'p3-body' },
          h('div', { class: 'p3-stat-grid' },
            h('div', { class: 'p3-stat' },
              h('div', { class: 'p3-stat-label' }, `Einsätze ${year}`),
              h('div', { class: 'p3-stat-value' }, String(data.totalGames || 0))),
            h('div', { class: 'p3-stat' },
              h('div', { class: 'p3-stat-label' }, 'Turniere'),
              h('div', { class: 'p3-stat-value' }, String((data.byTournament || []).length))),
          ),
          h('div', { class: 'p3-section-title' }, 'Pro Rolle'),
          h('div', { class: 'p3-list' },
            ...ROLES.map(r => {
              const cnt = (data.byRole?.[r.code] || 0);
              if (!cnt) return null;
              return h('div', { class: 'p3-list-item' },
                h('span', {}, r.label),
                h('strong', {}, String(cnt))
              );
            }).filter(Boolean)
          ),
          h('div', { class: 'p3-section-title' }, 'Pro Turnier'),
          h('div', { class: 'p3-list' },
            ...(data.byTournament || []).map(t =>
              h('div', { class: 'p3-list-item' },
                h('span', {}, t.name),
                h('strong', {}, String(t.games))
              )
            )
          ),
        ),
      );
      openModal(modal);
    } catch (e) {
      toast('Profil konnte nicht geladen werden', 'error');
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // SELF-SERVICE: Mein Profil + Meine Einsätze
  // ═══════════════════════════════════════════════════════════════════
  window.openMyProfile = async function() {
    try {
      const [profile, entries] = await Promise.all([
        api('/api/me/profile'),
        api(`/api/me/entries?year=${new Date().getFullYear()}`),
      ]);
      const ref = profile.referee;

      const incomplete = !ref.street || !ref.city || !ref.licenseNr;

      const content = h('div', { class: 'p3-modal-content' },
        h('div', { class: 'p3-modal-h' },
          h('div', {},
            h('h3', {}, `👋 ${ref.displayName}`),
            h('div', { class: 'p3-subtitle' }, `${ref.level || '—'} · ${(ref.categories || []).join(', ')}`)
          ),
          h('button', { class: 'p3-close', onclick: closeModal }, '×'),
        ),
        h('div', { class: 'p3-body' },
          incomplete ? h('div', { class: 'p3-banner warning' }, '⚠ Bitte ergänze deine Adresse für den jährlichen Einsatzbogen.') : null,
          h('div', { class: 'p3-stat-grid' },
            h('div', { class: 'p3-stat' },
              h('div', { class: 'p3-stat-label' }, `Einsätze ${entries.year}`),
              h('div', { class: 'p3-stat-value' }, String(entries.stats?.totalGames || 0))),
            h('div', { class: 'p3-stat' },
              h('div', { class: 'p3-stat-label' }, 'manuell ergänzt'),
              h('div', { class: 'p3-stat-value' }, String((entries.manualEntries || []).length))),
          ),
          h('div', { class: 'p3-section-title' }, 'Stammdaten'),
          ...renderProfileForm(ref),
          h('div', { class: 'p3-section-title' }, 'Manuelle Einsätze'),
          ...renderManualEntries(entries.manualEntries || []),
          h('button', {
            class: 'p3-btn primary',
            style: 'width:100%; margin-top:12px',
            onclick: () => window.openManualEntryForm(),
          }, '+ Manuellen Einsatz ergänzen'),
          h('div', { style: 'margin-top:16px; text-align:right' },
            h('button', { class: 'p3-btn', onclick: window.logout }, 'Logout')
          ),
        ),
      );
      openModal(content, { wide: true });
    } catch (e) {
      toast('Profil konnte nicht geladen werden: ' + e.message, 'error');
    }
  };

  function renderProfileForm(ref) {
    const fields = [
      ['firstName', 'Vorname'], ['lastName', 'Nachname'], ['displayName', 'Anzeigename'],
      ['street', 'Straße *'], ['city', 'PLZ + Ort *'], ['phone', 'Telefon'],
      ['licenseNr', 'Ausweis-Nr. *'], ['federation', 'Verband'], ['club', 'Verein'],
    ];
    const inputs = {};
    const form = h('div', { class: 'p3-form' },
      ...fields.map(([key, label]) => {
        const input = h('input', { type: 'text', class: 'p3-input', value: ref[key] || '' });
        inputs[key] = input;
        return h('div', { class: 'p3-field' },
          h('label', {}, label),
          input,
        );
      }),
      h('button', {
        class: 'p3-btn primary',
        onclick: async () => {
          const patch = {};
          for (const [key] of fields) patch[key] = inputs[key].value;
          try {
            await api('/api/me/profile', { method: 'PUT', body: JSON.stringify(patch) });
            toast('Stammdaten gespeichert', 'success');
          } catch (e) {
            toast('Fehler: ' + e.message, 'error');
          }
        },
      }, 'Stammdaten speichern'),
    );
    return [form];
  }

  function renderManualEntries(entries) {
    if (!entries.length) return [h('div', { class: 'p3-hint' }, 'Noch keine manuellen Einträge.')];
    return entries.map(e => h('div', { class: 'p3-entry' },
      h('div', {},
        h('div', { class: 'p3-entry-title' }, `${e.tournamentDate} · ${e.tournamentName}`),
        h('div', { class: 'p3-entry-meta' }, `${e.matchLabel || ''} · ${ROLES.find(r=>r.code===e.role)?.label || e.role}`),
      ),
      h('button', {
        class: 'p3-btn small danger',
        onclick: async () => {
          if (!confirm('Eintrag löschen?')) return;
          try {
            await api(`/api/me/manual-entry/${e.id}`, { method: 'DELETE' });
            closeModal();
            window.openMyProfile();
          } catch (err) { toast('Fehler: ' + err.message, 'error'); }
        },
      }, '×'),
    ));
  }

  window.openManualEntryForm = function() {
    const inputs = {};
    function input(name, label, opts = {}) {
      const el = h('input', { type: opts.type || 'text', class: 'p3-input', placeholder: opts.placeholder || '' });
      inputs[name] = el;
      return h('div', { class: 'p3-field' }, h('label', {}, label), el);
    }
    function select(name, label, options) {
      const el = h('select', { class: 'p3-input' }, ...options.map(o => h('option', { value: o.value }, o.label)));
      inputs[name] = el;
      return h('div', { class: 'p3-field' }, h('label', {}, label), el);
    }
    const content = h('div', { class: 'p3-modal-content' },
      h('div', { class: 'p3-modal-h' },
        h('h3', {}, 'Manuellen Einsatz ergänzen'),
        h('button', { class: 'p3-close', onclick: closeModal }, '×')),
      h('div', { class: 'p3-body' },
        input('tournamentName', 'Turniername *'),
        input('tournamentDate', 'Datum *', { type: 'date' }),
        input('matchLabel', 'Spiel (Free-Text)', { placeholder: 'z.B. Cottbus U21 vs. Berlin U21' }),
        select('role', 'Rolle *', ROLES.map(r => ({ value: r.code, label: r.label }))),
        input('notes', 'Notizen (optional)'),
        h('button', {
          class: 'p3-btn primary',
          onclick: async () => {
            try {
              const body = {};
              for (const k of Object.keys(inputs)) body[k] = inputs[k].value;
              await api('/api/me/manual-entry', { method: 'POST', body: JSON.stringify(body) });
              toast('Eintrag gespeichert', 'success');
              closeModal();
              window.openMyProfile();
            } catch (e) {
              toast('Fehler: ' + e.message, 'error');
            }
          },
        }, 'Speichern'),
      ),
    );
    openModal(content);
  };

  // ═══════════════════════════════════════════════════════════════════
  // MASTER-ADMIN: Stammdaten verwalten
  // ═══════════════════════════════════════════════════════════════════
  window.openMasterAdmin = async function() {
    if (window.state.role !== 'master') { openLogin(); return; }
    let activeTab = 'tournaments';

    const tabBar = h('div', { class: 'p3-tabbar' });
    const body = h('div', { class: 'p3-body' });

    async function render() {
      tabBar.innerHTML = '';
      for (const t of [['tournaments','Turniere'], ['referees','Schiris'], ['reports','Reports']]) {
        const btn = h('button', {
          class: 'p3-tab ' + (activeTab === t[0] ? 'active' : ''),
          onclick: () => { activeTab = t[0]; render(); },
        }, t[1]);
        tabBar.appendChild(btn);
      }
      body.innerHTML = '';

      if (activeTab === 'tournaments') {
        const result = await api('/api/admin/tournaments');
        body.appendChild(h('button', {
          class: 'p3-btn primary', style: 'margin-bottom:12px',
          onclick: () => openTournamentWizard(),
        }, '+ Neues Turnier'));
        result.tournaments.forEach(t => {
          body.appendChild(h('div', { class: 'p3-admin-row' },
            h('div', {},
              h('strong', {}, t.name),
              h('div', { class: 'p3-hint' }, `${t.status} · ${t.connector} · ${(t.dates || []).length} Tage`)
            ),
            h('div', { class: 'p3-row-actions' },
              h('button', { class: 'p3-btn small', onclick: () => quickScrape(t.slug) }, '🔄 Scrape'),
              h('select', {
                class: 'p3-input small',
                onchange: async (e) => {
                  await api(`/api/admin/tournaments/${t.slug}/status`, { method: 'POST', body: JSON.stringify({ status: e.target.value }) });
                  toast('Status aktualisiert', 'success'); render();
                },
              },
                ...['draft','awaiting-schedule','active','completed','archived'].map(s =>
                  h('option', { value: s, selected: s === t.status }, s))
              ),
            ),
          ));
        });
      }

      if (activeTab === 'referees') {
        const result = await api('/api/admin/referees');
        body.appendChild(h('button', {
          class: 'p3-btn primary', style: 'margin-bottom:12px',
          onclick: () => openRefereeForm(),
        }, '+ Neuer Schiri'));
        result.referees.forEach(r => {
          body.appendChild(h('div', { class: 'p3-admin-row' },
            h('div', {},
              h('strong', {}, `${r.firstName} ${r.lastName}`),
              h('span', { class: 'p3-hint' }, ` · "${r.displayName}" · ${r.level || '—'} · ${(r.categories || []).join(', ')}`),
              r.loginCode ? h('div', { class: 'p3-code' }, `Login-Code: ${r.loginCode}`) : null,
              r.active === false ? h('span', { class: 'p3-badge muted' }, 'inaktiv') : null,
            ),
            h('div', { class: 'p3-row-actions' },
              h('button', { class: 'p3-btn small', onclick: () => openRefereeForm(r) }, 'Edit'),
              h('button', { class: 'p3-btn small', onclick: () => generateCode(r.id) }, '🔑 Code'),
              r.active !== false
                ? h('button', { class: 'p3-btn small danger', onclick: () => deactivate(r.id) }, '🚫')
                : null,
            ),
          ));
        });
      }

      if (activeTab === 'reports') {
        const year = new Date().getFullYear();
        const result = await api(`/api/admin/reports/referees?year=${year}`);
        body.appendChild(h('div', { style: 'display:flex; justify-content:space-between; margin-bottom:12px' },
          h('strong', {}, `Einsätze ${year}`),
          h('a', { href: `/api/admin/reports/referees.csv?year=${year}`, class: 'p3-btn small' }, '📥 CSV')
        ));
        const table = h('table', { class: 'p3-table' },
          h('thead', {}, h('tr', {},
            h('th', {}, 'Schiri'),
            h('th', {}, 'Klasse'),
            h('th', {}, 'Total'),
            ...ROLES.map(r => h('th', {}, r.short)),
          )),
          h('tbody', {},
            ...Object.values(result.byReferee || {}).sort((a,b)=>b.totalGames-a.totalGames).map(r =>
              h('tr', { onclick: () => window.openProfile(r.id), style: 'cursor:pointer' },
                h('td', {}, r.displayName),
                h('td', {}, r.level || '—'),
                h('td', {}, String(r.totalGames)),
                ...ROLES.map(role => h('td', {}, String(r.byRole?.[role.code] || 0))),
              )
            )
          )
        );
        body.appendChild(table);
      }
    }

    async function quickScrape(slug) {
      try { await api(`/api/admin/tournaments/${slug}/scrape`, { method: 'POST' }); toast(`Gescraped: ${slug}`, 'success'); }
      catch (e) { toast('Fehler: ' + e.message, 'error'); }
    }
    async function generateCode(id) {
      const result = await api(`/api/admin/referees/${id}/login-code`, { method: 'POST' });
      alert(`Login-Code: ${result.loginCode}\n\nKopieren und an den Schiri senden.`);
      render();
    }
    async function deactivate(id) {
      if (!confirm('Schiri deaktivieren?')) return;
      await api(`/api/admin/referees/${id}`, { method: 'DELETE' }); render();
    }

    const content = h('div', { class: 'p3-modal-content' },
      h('div', { class: 'p3-modal-h' },
        h('h3', {}, 'Master-Admin'),
        h('button', { class: 'p3-close', onclick: closeModal }, '×')),
      tabBar,
      body,
    );
    openModal(content, { wide: true });
    render();
  };

  function openRefereeForm(existing = null) {
    const fields = [
      ['firstName', 'Vorname *'], ['lastName', 'Nachname *'], ['displayName', 'Anzeigename'],
    ];
    const inputs = {};
    fields.forEach(([k]) => { inputs[k] = h('input', { type: 'text', class: 'p3-input', value: existing?.[k] || '' }); });
    const levelSel = h('select', { class: 'p3-input' },
      ...REFEREE_LEVELS.map(l => h('option', { value: l, selected: existing?.level === l }, l))
    );
    const catWrap = h('div', { class: 'p3-pillrow' },
      ...CATEGORIES.map(c => {
        const btn = h('button', { class: 'p3-pillchoice' }, c);
        const active = (existing?.categories || []).includes(c);
        if (active) btn.classList.add('active');
        btn.onclick = () => btn.classList.toggle('active');
        return btn;
      })
    );

    const modal = h('div', { class: 'p3-modal-content' },
      h('div', { class: 'p3-modal-h' },
        h('h3', {}, existing ? 'Schiri editieren' : 'Neuer Schiri'),
        h('button', { class: 'p3-close', onclick: closeModal }, '×')),
      h('div', { class: 'p3-body' },
        ...fields.map(([k, l]) => h('div', { class: 'p3-field' }, h('label', {}, l), inputs[k])),
        h('div', { class: 'p3-field' }, h('label', {}, 'Klasse'), levelSel),
        h('div', { class: 'p3-field' }, h('label', {}, 'Kategorien'), catWrap),
        h('button', {
          class: 'p3-btn primary',
          onclick: async () => {
            const data = {
              firstName: inputs.firstName.value,
              lastName:  inputs.lastName.value,
              displayName: inputs.displayName.value || inputs.firstName.value,
              level: levelSel.value,
              categories: [...catWrap.querySelectorAll('.p3-pillchoice.active')].map(b => b.textContent),
            };
            try {
              if (existing) await api(`/api/admin/referees/${existing.id}`, { method: 'PUT', body: JSON.stringify(data) });
              else          await api('/api/admin/referees', { method: 'POST', body: JSON.stringify(data) });
              toast('Gespeichert', 'success');
              closeModal();
              window.openMasterAdmin();
            } catch (e) { toast('Fehler: ' + e.message, 'error'); }
          },
        }, 'Speichern'),
      ),
    );
    openModal(modal);
  }

  function openTournamentWizard() {
    const urlInput = h('input', { type: 'text', class: 'p3-input', placeholder: 'https://cpt.kayakers.nl/View/…' });
    const resultBox = h('div', { class: 'p3-body' });

    async function analyze() {
      try {
        const result = await api('/api/admin/tournaments/discover', {
          method: 'POST', body: JSON.stringify({ url: urlInput.value.trim() }),
        });
        showWizardStep2(result.result);
      } catch (e) {
        if (e.data?.error === 'manual') {
          showWizardManual(e.data.suggestedSource || {});
        } else {
          toast('Discovery fehlgeschlagen: ' + e.message, 'error');
        }
      }
    }

    function showWizardStep2(disc) {
      resultBox.innerHTML = '';
      const inputs = {
        name: h('input', { type: 'text', class: 'p3-input', value: disc.suggestedName || '' }),
        slug: h('input', { type: 'text', class: 'p3-input', value: disc.suggestedSlug || '' }),
        dates: h('input', { type: 'text', class: 'p3-input', value: (disc.proposedDates || []).join(', ') }),
      };
      const teamPicks = [];
      const teamList = h('div', { class: 'p3-team-pick' });
      (disc.allTeams || []).forEach(t => {
        const cb = h('input', { type: 'checkbox' });
        const labelInput = h('input', { type: 'text', class: 'p3-input small', placeholder: 'Pillen-Label', style: 'width:100px' });
        teamPicks.push({ team: t, cb, labelInput });
        teamList.appendChild(h('label', { class: 'p3-team-row' },
          cb, h('span', {}, t.name), h('span', { class: 'p3-hint' }, ` · ${t.division || ''}`), labelInput));
      });
      resultBox.appendChild(h('div', { class: 'p3-banner ok' },
        disc.hasSchedule ? '✓ Spielplan gefunden' : '⚠ Reduzierte Discovery — Spielplan kommt später'));
      resultBox.appendChild(h('div', { class: 'p3-field' }, h('label', {}, 'Name'), inputs.name));
      resultBox.appendChild(h('div', { class: 'p3-field' }, h('label', {}, 'Slug'), inputs.slug));
      resultBox.appendChild(h('div', { class: 'p3-field' }, h('label', {}, 'Tage (komma-getrennt YYYY-MM-DD)'), inputs.dates));
      if ((disc.allTeams || []).length) {
        resultBox.appendChild(h('div', { class: 'p3-section-title' }, 'Eigene Teams auswählen'));
        resultBox.appendChild(teamList);
      }
      resultBox.appendChild(h('button', {
        class: 'p3-btn primary',
        onclick: async () => {
          const dates = inputs.dates.value.split(',').map(s => s.trim()).filter(Boolean);
          const ourTeams = teamPicks
            .filter(p => p.cb.checked)
            .map(p => {
              const label = p.labelInput.value || codeFromName(p.team.name);
              return {
                code: codeFromName(p.team.name), pillLabel: label, short: p.team.name,
                name: p.team.name, tid: p.team.tid,
              };
            });
          const config = {
            slug: inputs.slug.value.trim(),
            name: inputs.name.value.trim(),
            type: 'tournament',
            connector: disc.connectorId,
            showStandings: false,
            source: disc.source,
            status: disc.hasSchedule ? 'active' : 'awaiting-schedule',
            dates: disc.hasSchedule ? dates : [],
            expectedDates: disc.hasSchedule ? null : dates,
            ourTeams,
          };
          try {
            await api('/api/admin/tournaments', { method: 'POST', body: JSON.stringify({ config }) });
            toast('Turnier angelegt', 'success');
            closeModal();
            window.openMasterAdmin();
          } catch (e) {
            toast('Fehler: ' + e.message, 'error');
          }
        },
      }, 'Speichern'));
    }

    function showWizardManual(suggested) {
      resultBox.innerHTML = '';
      resultBox.appendChild(h('div', { class: 'p3-banner warning' }, 'Keine Discovery möglich. Bitte manuell konfigurieren.'));
      resultBox.appendChild(h('div', { class: 'p3-hint' },
        suggested.viewUrl ? `Vorgeschlagene Info-URL: ${suggested.viewUrl}` : ''));
      // Vereinfachung: in dieser Iteration empfehlen wir, den Wizard zu schließen
      // und das Turnier per JSON-Datei zu erstellen (Phase 1-Stil).
      resultBox.appendChild(h('button', { class: 'p3-btn', onclick: closeModal }, 'Abbrechen'));
    }

    function codeFromName(name) {
      const m = name.match(/U14|U16|U21|Women|Men ?\d?|Damen|Herren/i);
      return m ? m[0].replace(/\s+/g, '') : name.slice(0, 8);
    }

    const content = h('div', { class: 'p3-modal-content' },
      h('div', { class: 'p3-modal-h' },
        h('h3', {}, 'Neues Turnier'),
        h('button', { class: 'p3-close', onclick: closeModal }, '×')),
      h('div', { class: 'p3-body' },
        h('div', { class: 'p3-field' }, h('label', {}, 'Turnier-URL'), urlInput,
          h('div', { class: 'p3-hint' }, 'z.B. https://cpt.kayakers.nl/View/MyTournament')),
        h('button', { class: 'p3-btn primary', onclick: analyze }, 'Analysieren'),
      ),
      resultBox,
    );
    openModal(content, { wide: true });
  }

  // ═══════════════════════════════════════════════════════════════════
  // LANDING-PAGE
  // ═══════════════════════════════════════════════════════════════════
  window.renderLanding = async function() {
    const root = document.getElementById('app') || document.body;
    root.innerHTML = '';
    root.appendChild(h('header', { class: 'p3-landing-h' },
      h('h1', {}, 'VMW Berlin · Live-App'),
      h('button', { class: 'p3-btn small', onclick: window.openLogin }, 'Login'),
    ));
    try {
      const result = await fetch('/api/tournaments').then(r => r.json());
      const groups = { active: [], 'awaiting-schedule': [], draft: [], completed: [] };
      (result.tournaments || []).forEach(t => { (groups[t.status] || (groups.completed)).push(t); });

      const labels = {
        active: '🟢 Läuft gerade',
        'awaiting-schedule': '📅 Geplant',
        draft: '✏ Entwürfe',
        completed: '✅ Beendet',
      };
      for (const status of ['active', 'awaiting-schedule', 'draft', 'completed']) {
        const ts = groups[status];
        if (!ts.length) continue;
        root.appendChild(h('div', { class: 'p3-section-title' }, labels[status]));
        ts.forEach(t => {
          // External Tournaments verlinken auf eine externe URL (z.B. die alte Bundesliga-App)
          const isExternal = t.type === 'external' && t.externalUrl;
          const href = isExternal ? t.externalUrl : `/t/${t.slug}`;
          const cardAttrs = { class: 'p3-tcard', href };
          if (isExternal) { cardAttrs.target = '_blank'; cardAttrs.rel = 'noopener noreferrer'; }

          root.appendChild(h('a', cardAttrs,
            h('div', { class: 'p3-tcard-name' },
              t.name,
              isExternal ? h('span', { class: 'p3-ext-badge' }, '↗ extern') : null
            ),
            h('div', { class: 'p3-tcard-meta' },
              (t.dates?.[0] || t.expectedDates?.[0] || '—') + (t.dates?.length > 1 ? `…${t.dates.at(-1)}` : '')
            ),
          ));
        });
      }
    } catch (e) {
      root.appendChild(h('div', { class: 'p3-banner error' }, 'Fehler beim Laden: ' + e.message));
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // ROUTING: pathname-basiertes Bootstrap
  // ═══════════════════════════════════════════════════════════════════
  //
  // /                 → Landing-Page (übermalt die DC2026-Shell aus app.js)
  // /t/<slug>         → Tournament-Live-View (app.js übernimmt)
  // /admin            → Login-Modal sofort
  // /me/<code>        → Code in localStorage, dann Profil
  //
  // Wichtig: app.js startet immer und füllt die DC2026-Shell. Wir lassen
  // app.js fertig laufen und ersetzen DANACH den DOM. So bricht nichts
  // unerwartet, und wenn die Routing-Logik hier scheitert, hat man wenigstens
  // die alte UI als Fallback.

  function showBody() {
    document.body.style.visibility = 'visible';
  }

  function bootstrapRoute() {
    const pathname = window.location.pathname;

    // /me/<code> — Bookmark-Login für Schiris
    const meMatch = pathname.match(/^\/me\/([A-Z0-9-]+)/i);
    if (meMatch) {
      const code = meMatch[1];
      localStorage.setItem('refereeAuth', code);
      window.state.refereeAuth = code;
      // URL aufräumen und Profil öffnen
      window.history.replaceState({}, '', '/');
      // Body leeren, dann Landing + Profil
      document.body.innerHTML = '';
      showBody();
      window.renderLanding();
      window.openMyProfile();
      return;
    }

    // /admin — Login-Modal sofort
    if (pathname === '/admin') {
      // Body leeren, damit nicht die alte DC2026-UI durchscheint
      document.body.innerHTML = '';
      showBody();
      // Schon eingeloggt? Dann Master-Admin direkt zeigen.
      if (window.state.role === 'master') window.openMasterAdmin();
      else window.openLogin();
      return;
    }

    // / — Landing-Page
    if (pathname === '/') {
      showBody();
      window.renderLanding();
      return;
    }

    // /t/<slug> — app.js rendert die Tournament-View. Sichtbarkeit wird in app.js
    // beim ersten erfolgreichen Render gesetzt (siehe dort: showAppBody()).
    // Falls app.js aus irgendeinem Grund nicht startet (z.B. kein Slug erkannt),
    // sichtbar machen als Fallback:
    setTimeout(showBody, 300);
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', bootstrapRoute);
  } else {
    bootstrapRoute();
  }

})();
