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

  // ─── Button-Loading-Wrapper ───────────────────────────────────────
  // Setzt den Button auf "lädt …", disabled ihn, und stellt nach der Action
  // den Originalzustand wieder her. Verhindert Doppel-Klicks.
  async function withLoading(button, label, action) {
    const original = button.innerHTML;
    const wasDisabled = button.disabled;
    button.disabled = true;
    button.innerHTML = '<span class="p3-spinner"></span> ' + (label || 'lädt …');
    try {
      await action();
    } finally {
      button.disabled = wasDisabled;
      button.innerHTML = original;
    }
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
    // Landing-Page-Login: nur Master + Schiri. Trainer wird im Tournament-View aufgerufen.
    let activeTab = 'master';
    const tabBar = h('div', { class: 'p3-tabbar' });
    const body = h('div', { class: 'p3-body' });

    function render() {
      tabBar.innerHTML = '';
      ['master', 'schiri'].forEach(t => {
        const btn = h('button', {
          class: 'p3-tab ' + (activeTab === t ? 'active' : ''),
          onclick: () => { activeTab = t; render(); },
        }, t === 'master' ? 'Master' : 'Schiri');
        tabBar.appendChild(btn);
      });

      body.innerHTML = '';
      if (activeTab === 'trainer' || activeTab === 'master') {
        // Username-Input (versteckt) damit Browser-Passwort-Manager triggert
        const usernameInput = h('input', {
          type: 'text', name: 'username', autocomplete: 'username',
          value: activeTab === 'master' ? 'master@vmw-berlin' : 'trainer@vmw-berlin',
          style: 'display:none', readonly: 'readonly',
        });
        const input = h('input', {
          type: 'password', placeholder: '••••••••', class: 'p3-input',
          autocomplete: 'current-password', name: 'password',
        });
        const btn = h('button', { class: 'p3-btn primary', type: 'submit' }, 'Login');
        input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); btn.click(); } };
        setTimeout(() => input.focus(), 50);
        btn.onclick = () => withLoading(btn, 'Prüfe …', async () => {
          try {
            window.state.adminPassword = input.value;
            await api(`/api/admin/login?slug=${encodeURIComponent(window.CURRENT_SLUG || 'dc2026')}`, { method: 'POST', body: '{}' });
            window.state.role = activeTab;
            localStorage.setItem('vmw.adminPwd', input.value);
            localStorage.setItem('vmw.role', activeTab);
            toast(`Eingeloggt als ${activeTab}`, 'success');
            closeModal();
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
        });
        // <form> wrappen — sonst registriert Safari/Chrome das Passwort nicht zum Speichern
        const form = h('form', {
          autocomplete: 'on',
          onsubmit: (e) => { e.preventDefault(); btn.click(); },
        }, h('label', {}, 'Passwort'),
           usernameInput,
           input,
           btn);
        body.appendChild(form);
      } else {
        const input = h('input', { type: 'text', placeholder: 'VMW-XXXX', class: 'p3-input', style: 'text-transform:uppercase' });
        const btn = h('button', { class: 'p3-btn primary' }, 'Einloggen');
        input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); btn.click(); } };
        setTimeout(() => input.focus(), 50);
        btn.onclick = () => withLoading(btn, 'Prüfe …', async () => {
          try {
            const result = await fetch('/api/auth/referee-login', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ code: input.value.replace(/\s+/g, '').toUpperCase() }),
            }).then(r => r.json());
            if (!result.ok) { toast(result.error === 'rate_limited' ? 'Zu viele Versuche — bitte später' : 'Code ungültig', 'error'); return; }
            const normalizedCode = input.value.replace(/\s+/g, '').toUpperCase();
            window.state.refereeAuth = normalizedCode;
            localStorage.setItem('refereeAuth', normalizedCode);
            toast(`Willkommen ${result.referee.displayName}`, 'success');
            closeModal();
            window.openMyProfile();
          } catch (e) {
            toast('Login fehlgeschlagen', 'error');
          }
        });
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
    // Nach Logout immer zurück zur Landing-Page
    window.location.href = '/';
  };

  // Trainer-Login als separates Modal — nur im Tournament-View aufgerufen
  window.openTrainerLogin = function() {
    if (window.state.role === 'trainer') {
      // Bereits eingeloggt — Confirm-Dialog für Logout
      if (confirm('Bereits als Trainer eingeloggt. Ausloggen?')) window.logout();
      return;
    }
    const usernameInput = h('input', {
      type: 'text', name: 'username', autocomplete: 'username',
      value: 'trainer@vmw-berlin', style: 'display:none', readonly: 'readonly',
    });
    const input = h('input', {
      type: 'password', placeholder: '••••••••', class: 'p3-input',
      autocomplete: 'current-password', name: 'password',
    });
    const btn = h('button', { class: 'p3-btn primary', type: 'submit' }, 'Login');
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); btn.click(); } };
    setTimeout(() => input.focus(), 50);
    btn.onclick = () => withLoading(btn, 'Prüfe …', async () => {
      try {
        window.state.adminPassword = input.value;
        const slug = window.CURRENT_SLUG || 'dc2026';
        await api(`/api/admin/login?slug=${encodeURIComponent(slug)}`, { method: 'POST', body: '{}' });
        window.state.role = 'trainer';
        localStorage.setItem('vmw.adminPwd', input.value);
        localStorage.setItem('vmw.role', 'trainer');
        toast('Eingeloggt als Trainer', 'success');
        closeModal();
        if (typeof window.renderActiveTab === 'function') window.renderActiveTab();
      } catch (e) {
        window.state.adminPassword = null;
        toast('Login fehlgeschlagen', 'error');
      }
    });
    const form = h('form', {
      autocomplete: 'on',
      onsubmit: (e) => { e.preventDefault(); btn.click(); },
    },
      h('label', {}, 'Trainer-Passwort'),
      usernameInput, input, btn,
    );
    const modal = h('div', { class: 'p3-modal-content' },
      h('div', { class: 'p3-modal-h' },
        h('h3', {}, 'Trainer-Login'),
        h('button', { class: 'p3-close', onclick: closeModal }, '×')),
      h('div', { class: 'p3-body' },
        h('div', { class: 'p3-hint', style: 'margin-bottom:12px' },
          'Login um Schiri-Einteilungen für dieses Turnier vorzunehmen.'),
        form,
      ),
    );
    openModal(modal);
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
    closeModal();
    try {
      const [profile, entries] = await Promise.all([
        api('/api/me/profile'),
        api(`/api/me/entries?year=${new Date().getFullYear()}`),
      ]);
      const ref = profile.referee;
      const incomplete = !ref.street || !ref.city || !ref.licenseNr;

      // Page-Layout (kein Modal — bleibt persistent)
      document.body.innerHTML = '';
      document.body.classList.remove('p3-landing-mode');
      document.body.classList.add('p3-page', 'p3-page-schiri');
      document.body.style.visibility = 'visible';

      const page = h('div', { class: 'p3-page-wrap' },
        h('header', { class: 'p3-page-header' },
          h('button', { class: 'p3-btn small', onclick: () => {
            document.body.classList.remove('p3-page', 'p3-page-schiri');
            window.renderLanding();
          } }, '← Übersicht'),
          h('h1', {}, `👋 ${ref.displayName || ref.firstName}`),
          h('button', { class: 'p3-btn small', onclick: () => {
            window.logout();
            document.body.classList.remove('p3-page', 'p3-page-schiri');
            window.renderLanding();
          } }, 'Logout'),
        ),
        h('div', { class: 'p3-body' },
          h('div', { class: 'p3-schiri-meta' }, `Klasse ${ref.level || '—'} · ${(ref.categories || []).join(', ')}`),
          incomplete ? h('div', { class: 'p3-banner warning' },
            '⚠ Bitte ergänze deine Adresse + Ausweis-Nr. unten, damit der jährliche Einsatzbogen-Export funktioniert.') : null,

          // Stats
          h('div', { class: 'p3-stat-grid' },
            h('div', { class: 'p3-stat' },
              h('div', { class: 'p3-stat-label' }, `Einsätze ${entries.year}`),
              h('div', { class: 'p3-stat-value' }, String(entries.stats?.totalGames || 0))),
            h('div', { class: 'p3-stat' },
              h('div', { class: 'p3-stat-label' }, 'davon manuell'),
              h('div', { class: 'p3-stat-value' }, String((entries.manualEntries || []).length))),
          ),

          // ─── Einsatz-Tabelle (auto + manuell, wie PDF-Layout) ──────────
          h('div', { class: 'p3-section-title' }, `Einsätze ${entries.year}`),
          renderEntriesTable(entries),

          h('button', {
            class: 'p3-btn primary',
            style: 'margin-top:12px',
            onclick: () => window.openManualEntryForm(),
          }, '+ Manuellen Einsatz ergänzen'),

          // ─── Stammdaten ────────────────────────────────────────────────
          h('div', { class: 'p3-section-title' }, 'Stammdaten'),
          ...renderProfileForm(ref),
        ),
      );
      document.body.appendChild(page);
    } catch (e) {
      toast('Profil konnte nicht geladen werden: ' + e.message, 'error');
    }
  };

  function renderEntriesTable(entries) {
    const ROLE_LABELS = {
      ref1: '1. SR', ref2: '2. SR', scorer: 'Protokoll', timer: 'Zeit',
      shotclock: 'Shotclock', line1: '1. Linie', line2: '2. Linie',
    };
    // Manuelle Einträge holen + flach mappen
    const rows = [];
    (entries.manualEntries || []).forEach(e => {
      rows.push({
        date: e.tournamentDate,
        tournament: e.tournamentName,
        match: e.matchLabel || '—',
        role: ROLE_LABELS[e.role] || e.role,
        source: 'manuell',
        entryId: e.id,
      });
    });
    // Auto-Einträge: aus byTournament hochzählen — Detail-Liste nicht im /me-Endpoint
    // (Wir zeigen für Auto-Einträge nur eine zusammengefasste Zeile pro Turnier + Rolle.)
    Object.values(entries.stats?.byTournament || []).forEach(t => {
      if (t.manual) return; // bereits gerendert
      Object.entries(t.byRole || {}).forEach(([roleCode, count]) => {
        if (!count) return;
        rows.push({
          date: '',
          tournament: t.name,
          match: `${count}× Einsatz`,
          role: ROLE_LABELS[roleCode] || roleCode,
          source: 'auto',
        });
      });
    });
    rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    if (!rows.length) {
      return h('div', { class: 'p3-hint', style: 'padding:16px; text-align:center' },
        'Noch keine Einsätze in diesem Jahr.');
    }

    const tbl = h('table', { class: 'p3-table' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Datum'),
        h('th', {}, 'Veranstaltung'),
        h('th', {}, 'Spiel'),
        h('th', {}, 'Rolle'),
        h('th', {}, 'Quelle'),
        h('th', {}, ''),
      )),
      h('tbody', {},
        ...rows.map(r => h('tr', {},
          h('td', {}, r.date || '—'),
          h('td', {}, r.tournament),
          h('td', {}, r.match),
          h('td', {}, r.role),
          h('td', {}, r.source === 'manuell'
            ? h('span', { class: 'p3-badge', style: 'background:#dbeafe;color:#1e40af' }, '✍ manuell')
            : h('span', { class: 'p3-badge', style: 'background:#dcfce7;color:#166534' }, '🏟️ auto')),
          h('td', {},
            r.entryId
              ? (() => {
                  const b = h('button', { class: 'p3-btn small danger' }, '✕');
                  b.onclick = async () => {
                    if (!confirm('Eintrag löschen?')) return;
                    try {
                      await api(`/api/me/manual-entry/${r.entryId}`, { method: 'DELETE' });
                      window.openMyProfile();
                    } catch (err) { toast('Fehler: ' + err.message, 'error'); }
                  };
                  return b;
                })()
              : ''),
        )),
      ),
    );
    return h('div', { style: 'overflow-x:auto' }, tbl);
  }

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
    // Schließe alle offenen Modals und übernimm die ganze Seite
    closeModal();
    let activeTab = 'tournaments';

    const tabBar = h('div', { class: 'p3-tabbar' });
    const body = h('div', { class: 'p3-body' });

    async function render() {
      tabBar.innerHTML = '';
      for (const t of [['tournaments','Turniere'], ['einteilungen','Einteilungen'], ['referees','Schiris'], ['reports','Reports']]) {
        const btn = h('button', {
          class: 'p3-tab ' + (activeTab === t[0] ? 'active' : ''),
          onclick: () => { activeTab = t[0]; render(); },
        }, t[1]);
        tabBar.appendChild(btn);
      }
      body.innerHTML = '';
      body.appendChild(h('div', { class: 'p3-hint', style: 'padding:8px' }, '🔄 Lade …'));

      try {
        await renderActiveTab();
      } catch (e) {
        body.innerHTML = '';
        body.appendChild(h('div', { class: 'p3-banner error' },
          'Fehler beim Laden: ' + (e.message || 'unbekannt')));
        body.appendChild(h('button', { class: 'p3-btn', onclick: render }, '↻ Erneut versuchen'));
      }
    }

    async function renderActiveTab() {
      body.innerHTML = '';

      if (activeTab === 'einteilungen') {
        // Tournament-Auswahl → dann Spielliste mit Picker-Buttons
        const result = await api('/api/admin/tournaments');
        const tournaments = (result.tournaments || []).filter(t => t.type !== 'external');
        body.appendChild(h('div', { class: 'p3-section-title' }, 'Schiri-Einteilung nach Turnier'));
        if (!tournaments.length) {
          body.appendChild(h('div', { class: 'p3-hint' }, 'Noch keine Turniere angelegt.'));
          return;
        }
        tournaments.forEach(t => {
          body.appendChild(h('div', { class: 'p3-conn-card', onclick: () => openTournamentAssignments(t) },
            h('strong', {}, t.name),
            h('div', { class: 'p3-hint' }, `${t.status} · ${(t.dates || []).length} Tage`),
          ));
        });
        return;
      }

      if (activeTab === 'tournaments') {
        const result = await api('/api/admin/tournaments');
        body.appendChild(h('button', {
          class: 'p3-btn primary', style: 'margin-bottom:12px',
          onclick: () => openTournamentWizard(),
        }, '+ Neues Turnier'));
        result.tournaments.forEach(t => {
          const scrapeBtn = h('button', { class: 'p3-btn small' }, '🔄 Scrape');
          scrapeBtn.onclick = () => withLoading(scrapeBtn, 'Scrape …', () => quickScrape(t.slug));

          const deleteBtn = h('button', { class: 'p3-btn small danger', title: 'Turnier löschen' }, '🗑');
          deleteBtn.onclick = () => withLoading(deleteBtn, '', async () => {
            if (!confirm(`Turnier "${t.name}" wirklich löschen?\nSnapshot + alle Einteilungen werden ebenfalls entfernt.`)) return;
            try {
              await api(`/api/admin/tournaments/${t.slug}`, { method: 'DELETE' });
              toast('Turnier gelöscht', 'success');
              render();
            } catch (e) { toast('Löschen fehlgeschlagen: ' + e.message, 'error'); }
          });

          body.appendChild(h('div', { class: 'p3-admin-row' },
            h('div', {},
              h('strong', {}, t.name),
              h('div', { class: 'p3-hint' }, `${t.status} · ${t.connector || (t.type === 'external' ? 'extern' : '—')} · ${(t.dates || []).length} Tage · ${t.slug}`)
            ),
            h('div', { class: 'p3-row-actions' },
              t.type === 'external' ? null : scrapeBtn,
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
              deleteBtn,
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
          const actions = [];

          // Edit-Button (immer verfügbar)
          actions.push(h('button', { class: 'p3-btn small', onclick: () => openRefereeForm(r) }, 'Edit'));

          if (r.active !== false) {
            // Aktiver Schiri: Code generieren + Soft-Delete (Deaktivieren)
            const codeBtn = h('button', { class: 'p3-btn small' }, '🔑 Code');
            codeBtn.onclick = () => withLoading(codeBtn, 'Generiere …', () => generateCode(r.id));
            actions.push(codeBtn);

            const deactivateBtn = h('button', { class: 'p3-btn small danger', title: 'Deaktivieren (Soft-Delete)' }, '🚫');
            deactivateBtn.onclick = () => withLoading(deactivateBtn, '', async () => {
              if (!confirm(`"${r.displayName}" deaktivieren?\nHistorische Einsätze bleiben in den Reports erhalten.`)) return;
              try { await api(`/api/admin/referees/${r.id}`, { method: 'DELETE' }); toast('Deaktiviert', 'success'); render(); }
              catch (e) { toast('Fehler: ' + e.message, 'error'); }
            });
            actions.push(deactivateBtn);
          } else {
            // Inaktiver Schiri: Reaktivieren + Hard-Delete
            const reactivateBtn = h('button', { class: 'p3-btn small' }, '🔄 Reaktivieren');
            reactivateBtn.onclick = () => withLoading(reactivateBtn, '', async () => {
              try {
                await api(`/api/admin/referees/${r.id}`, { method: 'PUT', body: JSON.stringify({ active: true }) });
                toast('Reaktiviert', 'success'); render();
              } catch (e) { toast('Fehler: ' + e.message, 'error'); }
            });
            actions.push(reactivateBtn);

            const hardDeleteBtn = h('button', { class: 'p3-btn small danger', title: 'Endgültig löschen' }, '🗑 Endgültig');
            hardDeleteBtn.onclick = () => withLoading(hardDeleteBtn, '', async () => {
              if (!confirm(`"${r.displayName}" ENDGÜLTIG löschen?\n\n⚠ Stammdaten + manuelle Einträge werden komplett entfernt.\nHistorische Einsätze in Reports verlieren ihre Auflösung.\n\nDas kann nicht rückgängig gemacht werden.`)) return;
              try {
                await api(`/api/admin/referees/${r.id}?permanent=1`, { method: 'DELETE' });
                toast('Endgültig gelöscht', 'success'); render();
              } catch (e) { toast('Fehler: ' + e.message, 'error'); }
            });
            actions.push(hardDeleteBtn);
          }

          body.appendChild(h('div', { class: 'p3-admin-row' },
            h('div', {},
              h('strong', {}, `${r.firstName} ${r.lastName}`),
              h('span', { class: 'p3-hint' }, ` · "${r.displayName}" · ${r.level || '—'} · ${(r.categories || []).join(', ')}`),
              r.loginCode ? h('div', { class: 'p3-code' }, `Login-Code: ${r.loginCode}`) : null,
              r.active === false ? h('span', { class: 'p3-badge muted' }, 'inaktiv') : null,
            ),
            h('div', { class: 'p3-row-actions' }, ...actions),
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
      showCodeModal(result.loginCode);
      render();
    }
    function showCodeModal(code) {
      const codeBox = h('div', { class: 'p3-code-display' }, code);
      const copyBtn = h('button', { class: 'p3-btn primary' }, '📋 In Zwischenablage kopieren');
      copyBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(code);
          copyBtn.textContent = '✓ Kopiert';
          setTimeout(() => { copyBtn.textContent = '📋 In Zwischenablage kopieren'; }, 2000);
        } catch {
          toast('Kopieren fehlgeschlagen — bitte manuell markieren', 'error');
        }
      };
      const modal = h('div', { class: 'p3-modal-content' },
        h('div', { class: 'p3-modal-h' },
          h('h3', {}, 'Login-Code'),
          h('button', { class: 'p3-close', onclick: closeModal }, '×')),
        h('div', { class: 'p3-body' },
          h('div', { class: 'p3-hint' }, 'Diesen Code an den Schiri weitergeben (z.B. per WhatsApp):'),
          codeBox,
          copyBtn,
          h('div', { class: 'p3-hint', style: 'margin-top:12px' },
            'Der Schiri loggt sich damit unter "Login → Schiri" ein. ' +
            'Bei Verlust kannst du einen neuen Code generieren (der alte wird ungültig).'),
        ),
      );
      openModal(modal);
    }
    async function deactivate(id) {
      if (!confirm('Schiri deaktivieren?')) return;
      await api(`/api/admin/referees/${id}`, { method: 'DELETE' }); render();
    }

    async function openTournamentAssignments(tournament) {
      // Lädt Snapshot + Assignments + Referees, zeigt alle Spiele mit Jury-Team-Match
      // egal welchen Status — Master kann auch beendete Turniere nachpflegen.
      body.innerHTML = '';
      body.appendChild(h('div', { class: 'p3-hint' }, '🔄 Lade Snapshot …'));

      const ROLES = [
        { code: 'ref1', short: '1.SR' }, { code: 'ref2', short: '2.SR' },
        { code: 'scorer', short: 'Prot' }, { code: 'timer', short: 'Zeit' },
        { code: 'shotclock', short: 'Shot' },
        { code: 'line1', short: 'Lin1' }, { code: 'line2', short: 'Lin2' },
      ];

      try {
        const data = await fetch(`/api/data?slug=${encodeURIComponent(tournament.slug)}`).then(r => r.json());
        const snapshot = data.snapshot;
        const assignments = data.assignments || {};
        const referees = data.referees || [];

        if (!snapshot?.matches) {
          body.innerHTML = '';
          body.appendChild(h('div', { class: 'p3-banner warning' },
            'Kein Snapshot vorhanden — Turnier hat noch keinen Spielplan.'));
          body.appendChild(h('button', { class: 'p3-btn', onclick: () => { activeTab = 'einteilungen'; render(); } }, '← Zurück'));
          return;
        }

        // window.state für Picker setzen
        window.state.snapshot = snapshot;
        window.state.assignments = assignments;
        window.state.referees = referees;
        window.CURRENT_SLUG = tournament.slug;

        // Nur Spiele wo eines unserer Teams Schiri ist (analog zu Trainer-Admin)
        const ourMatches = snapshot.matches.filter(m => m.ourReferee).sort((a,b) => {
          // erst nach Tag, dann nach Zeit
          const dayDiff = (a.day || 0) - (b.day || 0);
          if (dayDiff !== 0) return dayDiff;
          return (a.time || '').localeCompare(b.time || '');
        });

        body.innerHTML = '';
        body.appendChild(h('div', { class: 'p3-section-title' },
          h('button', { class: 'p3-btn small', onclick: () => { activeTab = 'einteilungen'; render(); } }, '← Zurück'),
          ' ' + tournament.name + ` · ${ourMatches.length} Jury-Einsätze`));

        if (!ourMatches.length) {
          body.appendChild(h('div', { class: 'p3-hint' }, 'Keine VMW-Schiri-Einsätze in diesem Turnier.'));
          return;
        }

        const refsById = new Map(referees.map(r => [r.id, r]));

        // Gruppieren in: Offen (next/live ohne komplette Einteilung), Beendet
        const grouped = { offen: [], live: [], done: [] };
        ourMatches.forEach(m => {
          if (m.status === 'done') grouped.done.push(m);
          else if (m.status === 'live') grouped.live.push(m);
          else grouped.offen.push(m);
        });

        function renderMatchCard(m) {
          const ass = assignments[m.nr]?.roles || {};
          const card = h('div', { class: 'p3-conn-card', style: 'cursor:default' });
          card.appendChild(h('strong', {}, `#${m.nr} · ${m.teamA?.name} vs ${m.teamB?.name}`));
          card.appendChild(h('div', { class: 'p3-hint' },
            `${m.time || ''} · ${m.division || ''} · ${m.status === 'done' ? 'beendet' : m.status}`));
          const pillRow = h('div', { class: 'p3-pillrow', style: 'margin-top:8px; flex-wrap: wrap' });
          ROLES.forEach(role => {
            const refId = ass[role.code];
            const refName = refId && refsById.get(refId)
              ? refsById.get(refId).displayName || refsById.get(refId).firstName
              : '—';
            const pill = h('button', {
              class: 'p3-pillchoice' + (refId ? ' active' : ''),
              style: 'cursor:pointer',
              onclick: () => window.openRolePicker(m.nr, role.code),
            }, `${role.short}: ${refName}`);
            pillRow.appendChild(pill);
          });
          card.appendChild(pillRow);
          return card;
        }

        for (const [key, label] of [['offen', '⏭ Offen / Live'], ['done', '✅ Beendet']]) {
          if (key === 'offen') grouped.offen.push(...grouped.live);
          if (!grouped[key].length) continue;
          body.appendChild(h('div', { class: 'p3-section-title' }, label));
          grouped[key].forEach(m => body.appendChild(renderMatchCard(m)));
        }
      } catch (e) {
        body.innerHTML = '';
        body.appendChild(h('div', { class: 'p3-banner error' }, 'Fehler: ' + e.message));
      }
    }

    // Page-Layout (kein Modal — bleibt persistent, kein Klick-außerhalb-schließt)
    document.body.innerHTML = '';
    document.body.style.visibility = 'visible';
    document.body.classList.add('p3-page');
    const page = h('div', { class: 'p3-page-wrap' },
      h('header', { class: 'p3-page-header' },
        h('button', { class: 'p3-btn small', onclick: () => { document.body.classList.remove('p3-page'); window.renderLanding(); } }, '← Übersicht'),
        h('h1', {}, 'Master-Admin'),
        h('button', { class: 'p3-btn small', onclick: () => { window.logout(); document.body.classList.remove('p3-page'); window.renderLanding(); } }, 'Logout'),
      ),
      tabBar,
      body,
    );
    document.body.appendChild(page);
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

  // Bekannte Connectoren — Liste passt zu scraper/connectors/index.mjs
  const KNOWN_CONNECTORS = [
    { id: 'kayakers',            label: 'kayakers.nl', supportsListing: true },
    { id: 'bundesligaKanupolio', label: '1. Bundesliga (bundesliga.kanupolo.de)', supportsListing: false },
  ];

  function openTournamentWizard() {
    const resultBox = h('div', { class: 'p3-body' });

    // ─── Schritt 0: Connector-Auswahl ────────────────────────────────
    function renderStep0() {
      resultBox.innerHTML = '';

      // (1) Echte Connectoren mit Discovery
      resultBox.appendChild(h('div', { class: 'p3-section-title' }, '🔌 Mit Connector (automatisch)'));
      KNOWN_CONNECTORS.forEach(c => {
        const card = h('div', {
          class: 'p3-conn-card',
          onclick: () => {
            if (c.supportsListing) loadConnectorTournaments(c.id);
            else renderManualUrlEntry(c.id);
          },
        },
          h('strong', {}, c.label),
          h('div', { class: 'p3-hint' },
            c.supportsListing ? 'Aktuelle Turniere automatisch laden, Spielplan wird gespiegelt' : 'URL manuell eingeben'),
        );
        resultBox.appendChild(card);
      });

      // (2) Externes Turnier ohne Connector — verlinkt nur auf andere Seite
      resultBox.appendChild(h('div', { class: 'p3-section-title', style: 'margin-top:24px' }, '↗ Ohne Connector (nur Verlinkung)'));
      const extCard = h('div', {
        class: 'p3-conn-card p3-conn-card-ext',
        onclick: () => renderExternalForm(),
      },
        h('strong', {}, 'Externes Turnier verlinken'),
        h('div', { class: 'p3-hint' },
          'Für Turniere bei Anbietern ohne Connector (eigene Vereins-App, Toornament, Webseite …). Klick auf das Turnier öffnet die externe URL in neuem Tab. Status (aktiv/beendet) wird automatisch aus dem Datum bestimmt.'),
      );
      resultBox.appendChild(extCard);
    }

    // ─── Schritt 1b: Externes Turnier manuell anlegen ────────────────
    function renderExternalForm() {
      resultBox.innerHTML = '';
      resultBox.appendChild(h('button', { class: 'p3-btn small', onclick: renderStep0 }, '← Zurück'));
      resultBox.appendChild(h('div', { class: 'p3-section-title' }, '↗ Externes Turnier'));
      resultBox.appendChild(h('div', { class: 'p3-hint', style: 'margin-bottom:12px' },
        'Wird auf der Landing-Page mit ↗-Badge angezeigt. Klick → öffnet die externe URL. Schiri-Einsätze müssen manuell ergänzt werden (Self-Service).'));

      const nameInput = h('input', { class: 'p3-input', placeholder: 'z.B. 1. Bundesliga Herren 2026' });
      const slugInput = h('input', { class: 'p3-input', placeholder: 'auto aus Name' });
      const datesInput = h('input', { class: 'p3-input', placeholder: '2026-05-23, 2026-05-24, …' });
      const singleUrlInput = h('input', { class: 'p3-input', placeholder: 'https://…' });

      // Auto-Slug aus Name
      nameInput.oninput = () => {
        if (!slugInput.dataset.touched) {
          slugInput.value = nameInput.value.toLowerCase()
            .replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
        }
      };
      slugInput.oninput = () => { slugInput.dataset.touched = '1'; };

      // Multi-Day-Toggle
      const isMultiDayCb = h('input', { type: 'checkbox' });
      const singleSection = h('div', { class: 'p3-field' }, h('label', {}, 'Externe URL'), singleUrlInput);
      const multiSection = h('div', { style: 'display:none' });
      const dayRows = [];
      function addDayRow(initial = {}) {
        const labelInput = h('input', { class: 'p3-input', placeholder: 'z.B. Spieltag 1 — Berlin', value: initial.label || '' });
        const dateInput  = h('input', { class: 'p3-input', placeholder: '17.-18.05.2026', value: initial.date || '' });
        const urlInput   = h('input', { class: 'p3-input', placeholder: 'https://…', value: initial.url || '' });
        const removeBtn  = h('button', { class: 'p3-btn small danger', title: 'Entfernen', onclick: () => {
          const idx = dayRows.findIndex(r => r.row === row);
          if (idx >= 0) dayRows.splice(idx, 1);
          row.remove();
        }}, '×');
        const row = h('div', { class: 'p3-multiday-row' },
          h('div', { style: 'display:grid; grid-template-columns: 1fr 1fr 2fr auto; gap:6px; align-items:end' },
            h('div', {}, h('label', { style: 'font-size:11px; color:#6b7280' }, 'Label'), labelInput),
            h('div', {}, h('label', { style: 'font-size:11px; color:#6b7280' }, 'Datum'), dateInput),
            h('div', {}, h('label', { style: 'font-size:11px; color:#6b7280' }, 'URL'), urlInput),
            removeBtn,
          ),
        );
        dayRows.push({ labelInput, dateInput, urlInput, row });
        multiSection.appendChild(row);
      }
      isMultiDayCb.onchange = () => {
        const on = isMultiDayCb.checked;
        singleSection.style.display = on ? 'none' : '';
        multiSection.style.display = on ? '' : 'none';
        if (on && dayRows.length === 0) addDayRow();
      };

      const addRowBtn = h('button', { class: 'p3-btn small', onclick: () => addDayRow() }, '+ Spieltag');

      const saveBtn = h('button', { class: 'p3-btn primary' }, 'Speichern');
      saveBtn.onclick = () => withLoading(saveBtn, 'Speichere …', async () => {
        const name = nameInput.value.trim();
        const slug = slugInput.value.trim();
        if (!name) return toast('Name fehlt', 'error');
        if (!/^[a-z0-9-]{3,40}$/.test(slug)) return toast('Slug muss 3-40 Zeichen [a-z0-9-]+ sein', 'error');

        const dates = datesInput.value.split(',').map(s => s.trim()).filter(Boolean);

        const multiDay = isMultiDayCb.checked;
        let externalDays = null;
        let externalUrl = null;
        if (multiDay) {
          externalDays = dayRows
            .filter(r => r.urlInput.value.trim())
            .map(r => ({ date: r.dateInput.value.trim(), label: r.labelInput.value.trim(), url: r.urlInput.value.trim() }));
          if (!externalDays.length) return toast('Mindestens ein Spieltag mit URL erforderlich', 'error');
        } else {
          externalUrl = singleUrlInput.value.trim();
          if (!externalUrl) return toast('URL fehlt', 'error');
          if (!/^https?:\/\//.test(externalUrl)) return toast('URL muss mit http:// oder https:// starten', 'error');
        }

        // Auto-Status nach Datum
        const today = new Date().toISOString().slice(0, 10);
        let status = 'active';
        if (dates.length) {
          if (today < dates[0]) status = 'active';                 // zukünftig — trotzdem als active anzeigen
          else if (today > dates[dates.length - 1]) status = 'completed';
        }

        const config = {
          slug, name, type: 'external',
          connector: null, showStandings: false, showHausliga: false,
          source: null, externalUrl, externalDays,
          status, dates,
          expectedDates: null, timezone: 'Europe/Berlin',
          pendingTeamSelection: false, lastRediscoveryAt: null,
          ourTeams: [],
        };

        try {
          await api('/api/admin/tournaments', { method: 'POST', body: JSON.stringify({ config }) });
          toast('Externes Turnier angelegt', 'success');
          closeModal();
          window.openMasterAdmin();
        } catch (e) {
          toast('Fehler: ' + e.message, 'error');
        }
      });

      resultBox.appendChild(h('div', { class: 'p3-field' }, h('label', {}, 'Name *'), nameInput));
      resultBox.appendChild(h('div', { class: 'p3-field' }, h('label', {}, 'Slug *'), slugInput,
        h('div', { class: 'p3-hint' }, 'URL des Turniers: /t/<slug>')));
      resultBox.appendChild(h('div', { class: 'p3-field' }, h('label', {}, 'Tage (komma-getrennt YYYY-MM-DD)'), datesInput,
        h('div', { class: 'p3-hint' }, 'Bestimmt automatisch ob das Turnier als "aktiv" oder "beendet" angezeigt wird.')));

      resultBox.appendChild(h('div', { class: 'p3-field' },
        h('label', { style: 'display:flex; align-items:center; gap:8px; cursor:pointer' },
          isMultiDayCb,
          h('span', {}, 'Mehrere Spieltage mit jeweils eigenem Link'),
        ),
      ));

      resultBox.appendChild(singleSection);
      resultBox.appendChild(multiSection);
      multiSection.appendChild(addRowBtn);

      resultBox.appendChild(saveBtn);

      setTimeout(() => nameInput.focus(), 50);
    }

    // ─── Schritt 1: Tournament-Liste aus Connector ───────────────────
    async function loadConnectorTournaments(connectorId) {
      resultBox.innerHTML = '';
      resultBox.appendChild(h('div', { class: 'p3-hint', style: 'padding:20px; text-align:center' }, '🔄 Lade Turnier-Liste …'));

      try {
        const result = await api(`/api/admin/discover/list?connector=${encodeURIComponent(connectorId)}&country=DE`);
        renderConnectorTournamentList(connectorId, result.tournaments || []);
      } catch (e) {
        toast('Liste konnte nicht geladen werden: ' + e.message, 'error');
        renderStep0();
      }
    }

    function renderConnectorTournamentList(connectorId, list) {
      resultBox.innerHTML = '';
      const back = h('button', { class: 'p3-btn small', onclick: renderStep0 }, '← Zurück');
      resultBox.appendChild(back);

      resultBox.appendChild(h('div', { class: 'p3-section-title' }, `${list.length} Turniere gefunden`));

      const today = new Date().toISOString().slice(0, 10);
      let timeFilter = 'upcoming';   // 'upcoming' | 'past' | 'all'
      let search = '';

      const filterRow = h('div', { class: 'p3-pillrow', style: 'margin-bottom:8px' });
      [['upcoming', 'Bevorstehend'], ['past', 'Vergangen'], ['all', 'Alle']].forEach(([k, label]) => {
        const btn = h('button', { class: 'p3-pillchoice ' + (timeFilter === k ? 'active' : '') }, label);
        btn.onclick = () => {
          timeFilter = k;
          filterRow.querySelectorAll('.p3-pillchoice').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          render();
        };
        filterRow.appendChild(btn);
      });

      const searchInput = h('input', {
        type: 'text', class: 'p3-input', placeholder: '🔍 Suchen (Name, Land) …',
        style: 'margin-bottom:8px',
      });
      searchInput.oninput = (e) => { search = e.target.value; render(); };

      const listEl = h('div');

      function render() {
        listEl.innerHTML = '';
        const ft = search.trim().toLowerCase();
        let filtered = list.filter(t => {
          if (timeFilter === 'upcoming' && t.dateIso && t.dateIso < today) return false;
          if (timeFilter === 'past'     && t.dateIso && t.dateIso >= today) return false;
          if (!ft) return true;
          return t.name.toLowerCase().includes(ft)
              || (t.countryCode || '').toLowerCase().includes(ft)
              || (t.dateRange || '').toLowerCase().includes(ft);
        });

        // Upcoming: aufsteigend (nächstes zuerst), Past: absteigend (jüngstes zuerst)
        filtered.sort((a, b) => {
          const da = a.dateIso || '9999-99-99';
          const db = b.dateIso || '9999-99-99';
          return timeFilter === 'past' ? db.localeCompare(da) : da.localeCompare(db);
        });

        filtered.forEach(t => {
          const card = h('div', {
            class: 'p3-conn-card',
            onclick: () => analyze(null, t.viewUrl),
          },
            h('strong', {}, t.name),
            h('div', { class: 'p3-hint' },
              h('span', { style: 'font-weight:500; color:#111' }, t.dateRange || 'kein Datum'),
              ' · ',
              t.countryCode || '—',
            ),
          );
          listEl.appendChild(card);
        });
        if (filtered.length === 0) {
          listEl.appendChild(h('div', { class: 'p3-hint', style: 'padding:8px' },
            `Keine Treffer.`));
        }
      }

      resultBox.appendChild(filterRow);
      resultBox.appendChild(searchInput);
      resultBox.appendChild(listEl);
      render();
    }

    function renderManualUrlEntry(connectorId) {
      resultBox.innerHTML = '';
      const back = h('button', { class: 'p3-btn small', onclick: renderStep0 }, '← Zurück');
      resultBox.appendChild(back);
      resultBox.appendChild(h('div', { class: 'p3-section-title' }, 'URL eingeben'));
      const urlInput = h('input', { type: 'text', class: 'p3-input', placeholder: 'https://…' });
      const btn = h('button', { class: 'p3-btn primary' }, 'Analysieren');
      urlInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); btn.click(); } };
      btn.onclick = () => analyze(btn, urlInput.value.trim());
      resultBox.appendChild(h('div', { class: 'p3-field' }, urlInput));
      resultBox.appendChild(btn);
      setTimeout(() => urlInput.focus(), 50);
    }

    async function analyze(btn, url) {
      if (!url) { toast('Bitte URL angeben', 'error'); return; }

      // Progress-Anzeige mit Schritten — Discovery dauert oft 3-10 Sek bei vielen Tagen.
      // Wir können den Backend-Fortschritt nicht streamen, simulieren ihn deshalb mit
      // Heartbeat-Texten alle 2 Sek.
      resultBox.innerHTML = '';
      const progress = h('div', { class: 'p3-progress' },
        h('div', { class: 'p3-progress-icon' }, '🔍'),
        h('div', { class: 'p3-progress-title' }, 'Analysiere Turnier'),
        h('div', { class: 'p3-progress-step', id: 'p3-prog-step' }, 'URL prüfen …'),
        h('div', { class: 'p3-progress-bar' }, h('div', { class: 'p3-progress-bar-fill' })),
      );
      resultBox.appendChild(progress);

      const stepEl = progress.querySelector('#p3-prog-step');
      const steps = [
        'URL prüfen …',
        'Turnier-Seite laden …',
        'Spielplan erfassen (Tag 1) …',
        'Spielplan erfassen (Tag 2-3) …',
        'Teams extrahieren …',
        'Daten zusammenstellen …',
      ];
      let stepIdx = 0;
      const stepTimer = setInterval(() => {
        stepIdx = Math.min(stepIdx + 1, steps.length - 1);
        stepEl.textContent = steps[stepIdx];
      }, 1800);

      try {
        const result = await api('/api/admin/tournaments/discover', {
          method: 'POST', body: JSON.stringify({ url }),
        });
        clearInterval(stepTimer);
        showWizardStep2(result.result);
      } catch (e) {
        clearInterval(stepTimer);
        if (e.data?.error === 'manual') {
          showWizardManual(e.data.suggestedSource || {});
        } else {
          resultBox.innerHTML = '';
          resultBox.appendChild(h('div', { class: 'p3-banner error' },
            'Discovery fehlgeschlagen: ' + e.message));
          const retryBtn = h('button', { class: 'p3-btn', onclick: renderStep0 }, '← Zurück zur Auswahl');
          resultBox.appendChild(retryBtn);
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

      function renderTeamList(filter = '') {
        teamList.innerHTML = '';
        const ft = filter.trim().toLowerCase();
        let shown = 0;
        teamPicks.forEach(p => {
          const matches = !ft || p.team.name.toLowerCase().includes(ft) || (p.team.division || '').toLowerCase().includes(ft);
          if (!matches && !p.cb.checked) return;
          shown++;
          teamList.appendChild(h('label', { class: 'p3-team-row' },
            p.cb, h('span', {}, p.team.name), h('span', { class: 'p3-hint' }, ` · ${p.team.division || ''}`), p.labelInput));
        });
        if (shown === 0) {
          teamList.appendChild(h('div', { class: 'p3-hint', style: 'padding:8px' },
            `Keine Treffer für "${filter}". Tipp: leeres Suchfeld zeigt alle ${teamPicks.length} Teams.`));
        }
      }

      (disc.allTeams || []).forEach(t => {
        const cb = h('input', { type: 'checkbox' });
        const labelInput = h('input', { type: 'text', class: 'p3-input small', placeholder: 'Pillen-Label', style: 'width:100px' });
        teamPicks.push({ team: t, cb, labelInput });
      });

      const searchInput = h('input', {
        type: 'text', class: 'p3-input', placeholder: '🔍 Suchen (z.B. VMW, Berlin, U21) …',
        style: 'margin-bottom:8px',
      });
      searchInput.oninput = (e) => renderTeamList(e.target.value);

      resultBox.appendChild(h('div', { class: 'p3-banner ok' },
        disc.hasSchedule ? '✓ Spielplan gefunden' : '⚠ Reduzierte Discovery — Spielplan kommt später'));
      resultBox.appendChild(h('div', { class: 'p3-field' }, h('label', {}, 'Name'), inputs.name));
      resultBox.appendChild(h('div', { class: 'p3-field' }, h('label', {}, 'Slug'), inputs.slug));
      resultBox.appendChild(h('div', { class: 'p3-field' }, h('label', {}, 'Tage (komma-getrennt YYYY-MM-DD)'), inputs.dates));

      // Hausliga-Toggle
      const hausligaCheckbox = h('input', { type: 'checkbox' });
      resultBox.appendChild(h('div', { class: 'p3-field' },
        h('label', { style: 'display:flex; align-items:center; gap:8px; cursor:pointer' },
          hausligaCheckbox,
          h('span', {}, 'Hausliga aktivieren'),
          h('span', { class: 'p3-hint', style: 'margin-left:8px' },
            '(vereinsinterner Wettkampf zwischen den eigenen Teams)'),
        ),
      ));
      inputs.showHausliga = hausligaCheckbox;

      if (teamPicks.length) {
        resultBox.appendChild(h('div', { class: 'p3-section-title' }, `Eigene Teams auswählen (${teamPicks.length} gefunden)`));
        resultBox.appendChild(searchInput);
        resultBox.appendChild(teamList);
        renderTeamList('');
      }
      const saveBtn = h('button', { class: 'p3-btn primary' }, 'Speichern');
      saveBtn.onclick = () => withLoading(saveBtn, 'Speichere …', async () => {
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
          showHausliga: inputs.showHausliga?.checked === true,
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
      });
      resultBox.appendChild(saveBtn);
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
      resultBox,
    );
    openModal(content, { wide: true });
    renderStep0();
  }

  // ═══════════════════════════════════════════════════════════════════
  // LANDING-PAGE
  // ═══════════════════════════════════════════════════════════════════
  window.renderLanding = async function() {
    document.body.classList.add('p3-landing-mode');
    document.body.innerHTML = '';
    document.body.style.visibility = 'visible';

    const root = h('div', { class: 'p3-landing' });
    document.body.appendChild(root);

    // ─── Hero (VMW-Brand) ─────────────────────────────────────────────
    const isLoggedIn = !!(window.state.role || window.state.refereeAuth);
    const userButton = (() => {
      if (window.state.role === 'master') {
        const b = h('button', { class: 'p3-btn p3-btn-onbrand' }, '⚙ Master-Admin');
        b.onclick = window.openMasterAdmin;
        return b;
      }
      if (window.state.refereeAuth) {
        const b = h('button', { class: 'p3-btn p3-btn-onbrand' }, '👤 Mein Profil');
        b.onclick = window.openMyProfile;
        return b;
      }
      if (window.state.role === 'trainer') {
        const b = h('button', { class: 'p3-btn p3-btn-onbrand' }, '🚪 Logout');
        b.onclick = () => { window.logout(); window.renderLanding(); };
        return b;
      }
      const b = h('button', { class: 'p3-btn p3-btn-onbrand' }, 'Login');
      b.onclick = window.openLogin;
      return b;
    })();

    root.appendChild(h('div', { class: 'p3-hero' },
      h('div', { class: 'p3-hero-inner' },
        h('img', { class: 'p3-hero-logo', src: 'https://vmw-berlin.de/wp-content/uploads/2022/06/cropped-final_logo-3.png', alt: 'VMW Berlin', onerror: 'this.style.display=\'none\'' }),
        h('div', { class: 'p3-hero-text' },
          h('h1', {}, 'VMW Berlin Live-App'),
          h('p', {}, 'Die Vereins-App für Spielpläne, Schiri-Einteilungen und Jahres-Tracking. Familie, Freunde und Vereinsmitglieder verfolgen hier alle Turniere und Ligen, in denen VMW Berlin spielt.'),
        ),
        h('div', { class: 'p3-hero-actions' }, userButton),
      ),
    ));

    // ─── Tournament-Liste ────────────────────────────────────────────
    const listSection = h('div', { class: 'p3-landing-list' });
    root.appendChild(listSection);

    try {
      const result = await fetch('/api/tournaments', {
        headers: window.state.role === 'master' && window.state.adminPassword
          ? { 'x-admin-password': window.state.adminPassword } : {},
      }).then(r => r.json());

      const groups = { active: [], 'awaiting-schedule': [], draft: [], completed: [] };
      (result.tournaments || []).forEach(t => { (groups[t.status] || (groups.completed)).push(t); });

      const labels = {
        active:               { icon: '🟢', title: 'Läuft gerade' },
        'awaiting-schedule':  { icon: '📅', title: 'Geplant' },
        draft:                { icon: '✏️',  title: 'Entwürfe' },
        completed:            { icon: '✅', title: 'Beendet' },
      };
      let anyShown = false;
      for (const status of ['active', 'awaiting-schedule', 'draft', 'completed']) {
        const ts = groups[status];
        if (!ts.length) continue;
        anyShown = true;
        listSection.appendChild(h('h2', { class: 'p3-landing-section' },
          h('span', {}, labels[status].icon),
          ' ' + labels[status].title,
          h('span', { class: 'p3-section-count' }, String(ts.length))));

        const grid = h('div', { class: 'p3-card-grid' });
        ts.forEach(t => grid.appendChild(renderTournamentCard(t)));
        listSection.appendChild(grid);
      }

      if (!anyShown) {
        listSection.appendChild(h('div', { class: 'p3-empty-state' },
          h('div', { class: 'p3-empty-icon' }, '🏆'),
          h('h3', {}, 'Noch keine Turniere'),
          h('p', {}, 'Als Master kannst du oben Login klicken und ein neues Turnier anlegen.'),
        ));
      }
    } catch (e) {
      listSection.appendChild(h('div', { class: 'p3-banner error' }, 'Fehler beim Laden: ' + e.message));
    }

    // Footer
    root.appendChild(h('footer', { class: 'p3-landing-footer' },
      h('p', {}, 'Gebaut von Julius Brüning · ',
        h('a', { href: 'mailto:juliusbruening1994@gmail.com' }, 'Feedback'),
      ),
    ));
  };

  function renderTournamentCard(t) {
    const isExternal = t.type === 'external' && (t.externalUrl || (t.externalDays && t.externalDays.length));
    const status = t.status;
    const statusBadgeText = {
      'active': 'live', 'awaiting-schedule': 'geplant', 'draft': 'draft', 'completed': 'beendet'
    }[status] || status;
    const meta = (t.dates?.[0] || t.expectedDates?.[0] || '—') +
                 (t.dates?.length > 1 ? ` – ${t.dates.at(-1)}` : '');

    // Externes Turnier mit Multi-Day-Linkliste
    if (isExternal && Array.isArray(t.externalDays) && t.externalDays.length) {
      const card = h('div', { class: 'p3-tcard p3-tcard-external' },
        h('div', { class: 'p3-tcard-name' }, t.name,
          h('span', { class: `p3-status-badge p3-status-${status}` }, statusBadgeText)),
        h('div', { class: 'p3-tcard-meta' }, meta),
        h('div', { class: 'p3-tcard-days' },
          ...t.externalDays.map(d => h('a', {
            class: 'p3-day-link', href: d.url, target: '_blank', rel: 'noopener noreferrer'
          }, h('span', { class: 'p3-day-date' }, d.date || ''),
             h('span', { class: 'p3-day-label' }, d.label || ''),
             h('span', { class: 'p3-ext-arrow' }, '↗')))
        ),
      );
      return card;
    }

    // External-Turnier mit single URL → ein Link
    if (isExternal) {
      return h('a', { class: 'p3-tcard p3-tcard-external', href: t.externalUrl, target: '_blank', rel: 'noopener noreferrer' },
        h('div', { class: 'p3-tcard-name' }, t.name,
          h('span', { class: `p3-status-badge p3-status-${status}` }, statusBadgeText),
          h('span', { class: 'p3-ext-badge' }, '↗ extern')),
        h('div', { class: 'p3-tcard-meta' }, meta),
      );
    }

    // Normales Turnier
    return h('a', { class: 'p3-tcard', href: `/t/${t.slug}` },
      h('div', { class: 'p3-tcard-name' }, t.name,
        h('span', { class: `p3-status-badge p3-status-${status}` }, statusBadgeText)),
      h('div', { class: 'p3-tcard-meta' }, meta),
    );
  }

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
