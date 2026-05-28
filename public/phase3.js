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

  // ─── CSV-Download mit Auth-Header (Browser-Link kann keine Header) ───
  async function downloadCsv(url, filename) {
    return downloadFile(url, filename);
  }
  // Generischer Auth-aware Download (für CSV oder PDF). Sendet beide Header-Typen,
  // damit Master-, Trainer- und Schiri-Endpoints gleichermaßen funktionieren.
  async function downloadFile(url, filename) {
    try {
      const headers = {};
      if (window.state.adminPassword) headers['x-admin-password'] = window.state.adminPassword;
      if (window.state.refereeAuth)   headers['x-personal-token']  = window.state.refereeAuth;
      const res = await fetch(url, { headers });
      if (!res.ok) { toast('Download fehlgeschlagen: HTTP ' + res.status, 'error'); return; }
      const blob = await res.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 100);
    } catch (e) {
      toast('Fehler: ' + e.message, 'error');
    }
  }
  window.downloadCsv = downloadCsv;
  window.downloadFile = downloadFile;

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

  // ═══════════════════════════════════════════════════════════════════
  // TURNIER-EINTEILUNGS-PAGE (Trainer + Master)
  // Standalone-Page mit Filter nach Tag, Klasse und Status
  // ═══════════════════════════════════════════════════════════════════
  window.openTournamentLineup = async function(slug) {
    slug = slug || window.CURRENT_SLUG;
    if (!slug) { toast('Kein Turnier ausgewählt', 'error'); return; }
    if (!window.state.role) {
      toast('Bitte erst als Trainer oder Master einloggen', 'error');
      window.openTrainerLogin();
      return;
    }

    const ROLES = [
      { code: 'ref1', short: '1.SR' }, { code: 'ref2', short: '2.SR' },
      { code: 'scorer', short: 'Prot' }, { code: 'timer', short: 'Zeit' },
      { code: 'shotclock', short: 'Shot' },
      { code: 'line1', short: 'Lin1' }, { code: 'line2', short: 'Lin2' },
    ];

    document.body.innerHTML = '';
    document.body.classList.remove('p3-landing-mode');
    document.body.classList.add('p3-page');
    document.body.style.visibility = 'visible';

    const titleEl = h('h1', {}, 'Schiri-Einteilung');
    const filtersBar = h('div', { class: 'p3-lineup-filters' });
    const body = h('div', { class: 'p3-body' });

    const page = h('div', { class: 'p3-page-wrap' },
      h('header', { class: 'p3-page-header' },
        h('button', { class: 'p3-btn small', onclick: () => {
          document.body.classList.remove('p3-page');
          window.location.href = `/t/${slug}`;
        } }, '← Zum Turnier'),
        titleEl,
        h('button', { class: 'p3-btn small', onclick: () => {
          window.logout();
        } }, 'Logout'),
      ),
      filtersBar,
      body,
    );
    document.body.appendChild(page);

    body.appendChild(h('div', { class: 'p3-hint', style: 'padding:16px' }, '🔄 Lade …'));

    let snapshot, assignments, referees, config, externalAssignments;
    try {
      const data = await fetch(`/api/data?slug=${encodeURIComponent(slug)}`).then(r => r.json());
      snapshot = data.snapshot;
      assignments = data.assignments || {};
      referees = data.referees || [];
      config = data.config;
      externalAssignments = data.externalAssignments || [];
      // Setze globalen state für den Picker
      window.state.snapshot = snapshot;
      window.state.assignments = assignments;
      window.state.referees = referees;
      window.state.externalReferees = referees; // cache für openExternalEntryForm
      window.CURRENT_SLUG = slug;
    } catch (e) {
      body.innerHTML = '';
      body.appendChild(h('div', { class: 'p3-banner error' }, 'Fehler: ' + e.message));
      return;
    }

    titleEl.textContent = `Schiri-Einteilung · ${config.name}`;

    // Filter-State
    const days = config.dates || [];
    let activeDayIdx = 0;     // Index in days; -1 = alle Tage
    let activeDivision = 'all';
    let activeStatus = 'open'; // 'open' | 'all' | 'done-incomplete'

    // Alle Divisionen im Snapshot — für Klassen-Filter
    const divsSeen = new Map();
    snapshot.matches.forEach(m => {
      if (m.divisionCode && !divsSeen.has(m.divisionCode)) {
        divsSeen.set(m.divisionCode, m.division);
      }
    });

    function renderFilters() {
      filtersBar.innerHTML = '';
      // Tag-Filter
      const dayRow = h('div', { class: 'p3-filter-row' });
      dayRow.appendChild(h('span', { class: 'p3-flabel' }, 'Tag:'));
      const allDaysBtn = h('button', { class: 'p3-pillchoice ' + (activeDayIdx === -1 ? 'active' : '') }, 'Alle');
      allDaysBtn.onclick = () => { activeDayIdx = -1; renderFilters(); renderMatches(); };
      dayRow.appendChild(allDaysBtn);
      days.forEach((iso, i) => {
        const d = new Date(iso + 'T12:00:00+02:00');
        const label = d.toLocaleDateString('de-DE', { weekday:'short', day:'numeric', month:'short' });
        const btn = h('button', { class: 'p3-pillchoice ' + (activeDayIdx === i ? 'active' : '') }, label);
        btn.onclick = () => { activeDayIdx = i; renderFilters(); renderMatches(); };
        dayRow.appendChild(btn);
      });
      filtersBar.appendChild(dayRow);

      // Klassen-Filter (aus snapshot)
      if (divsSeen.size > 1) {
        const divRow = h('div', { class: 'p3-filter-row' });
        divRow.appendChild(h('span', { class: 'p3-flabel' }, 'Klasse:'));
        const allBtn = h('button', { class: 'p3-pillchoice ' + (activeDivision === 'all' ? 'active' : '') }, 'Alle');
        allBtn.onclick = () => { activeDivision = 'all'; renderFilters(); renderMatches(); };
        divRow.appendChild(allBtn);
        const order = ['U14','U16','U21','Women','Men1','Men2'];
        const sorted = [...divsSeen.entries()].sort((a,b) => (order.indexOf(a[0]) - order.indexOf(b[0])));
        sorted.forEach(([code, label]) => {
          const btn = h('button', { class: 'p3-pillchoice ' + (activeDivision === code ? 'active' : '') }, label);
          btn.onclick = () => { activeDivision = code; renderFilters(); renderMatches(); };
          divRow.appendChild(btn);
        });
        filtersBar.appendChild(divRow);
      }

      // Status-Filter
      const statusRow = h('div', { class: 'p3-filter-row' });
      statusRow.appendChild(h('span', { class: 'p3-flabel' }, 'Status:'));
      const statusOptions = [
        ['open', 'Offen / Live'],
        ['done-incomplete', 'Beendet & unvollständig'],
        ['all', 'Alle inkl. beendete'],
      ];
      statusOptions.forEach(([k, label]) => {
        const btn = h('button', { class: 'p3-pillchoice ' + (activeStatus === k ? 'active' : '') }, label);
        btn.onclick = () => { activeStatus = k; renderFilters(); renderMatches(); };
        statusRow.appendChild(btn);
      });
      filtersBar.appendChild(statusRow);
    }

    function renderMatches() {
      body.innerHTML = '';
      const refsById = new Map(referees.map(r => [r.id, r]));
      const hasSnapshot = !!snapshot?.matches?.length;

      // ─── Banner bei leerem Spielplan ──────────────────────────────────
      if (!hasSnapshot) {
        body.appendChild(h('div', { class: 'p3-banner warning', style: 'margin-bottom:16px' },
          '⚠ kayakers.nl hat noch keinen Spielplan für dieses Turnier veröffentlicht. ',
          'Du kannst Schiri-Einsätze trotzdem manuell unten anlegen — sie fließen ',
          'genauso in die DKV-Bögen wie auto-zugewiesene Einsätze.'));
      } else {
        // ─── Normale kayakers-Match-Sektion ──────────────────────────────
        let matches = snapshot.matches.filter(m => m.ourReferee);
        if (activeDayIdx !== -1) matches = matches.filter(m => (m.day || 1) - 1 === activeDayIdx);
        if (activeDivision !== 'all') matches = matches.filter(m => m.divisionCode === activeDivision);

        const isIncomplete = (m) => {
          const r = assignments[m.nr]?.roles || {};
          return ROLES.some(role => !r[role.code]);
        };
        if (activeStatus === 'open') matches = matches.filter(m => m.status !== 'done');
        if (activeStatus === 'done-incomplete') matches = matches.filter(m => m.status === 'done' && isIncomplete(m));

        matches.sort((a, b) => {
          const d = (a.day || 0) - (b.day || 0);
          if (d !== 0) return d;
          return (a.time || '').localeCompare(b.time || '');
        });

        if (!matches.length) {
          body.appendChild(h('div', { class: 'p3-hint', style: 'padding:24px; text-align:center' },
            'Keine Spiele für diese Filter.'));
        } else {
          body.appendChild(h('div', { class: 'p3-section-title' }, `${matches.length} kayakers-Spiel${matches.length===1?'':'e'}`));
          matches.forEach(m => {
            const ass = assignments[m.nr]?.roles || {};
            const card = h('div', { class: 'p3-lineup-card' });
            const dateLabel = days[(m.day || 1) - 1] || '';
            const dateDisplay = dateLabel ? new Date(dateLabel + 'T12:00:00+02:00').toLocaleDateString('de-DE', { day:'numeric', month:'short' }) : '';
            card.appendChild(h('div', { class: 'p3-lineup-head' },
              h('span', { class: 'p3-lineup-nr' }, `#${m.nr}`),
              h('span', { class: 'p3-lineup-time' }, `${dateDisplay} ${m.time || ''}`),
              h('span', { class: 'p3-lineup-status p3-status-' + m.status }, m.status === 'done' ? 'beendet' : m.status),
            ));
            card.appendChild(h('div', { class: 'p3-lineup-teams' }, `${m.teamA?.name || ''} vs ${m.teamB?.name || ''}`));
            card.appendChild(h('div', { class: 'p3-lineup-meta' }, `${m.division || ''} · Pitch ${m.pitch || '—'}`));
            const pillRow = h('div', { class: 'p3-pillrow', style: 'margin-top:8px; flex-wrap:wrap' });
            ROLES.forEach(role => {
              const refId = ass[role.code];
              const refName = refId && refsById.get(refId)
                ? refsById.get(refId).displayName || refsById.get(refId).firstName
                : '—';
              const pill = h('button', {
                class: 'p3-pillchoice' + (refId ? ' active' : ''),
                style: 'cursor:pointer',
              }, `${role.short}: ${refName}`);
              pill.onclick = () => window.openRolePicker(m.nr, role.code);
              pillRow.appendChild(pill);
            });
            card.appendChild(pillRow);
            body.appendChild(card);
          });
        }
      }

      // ─── Hybrid: Manuelle Einsätze-Sektion (immer sichtbar) ──────────────
      renderManualSection();
    }

    async function refreshManual() {
      const fresh = await fetch(`/api/data?slug=${encodeURIComponent(slug)}`).then(r => r.json());
      externalAssignments = fresh.externalAssignments || [];
      renderMatches();
    }

    function renderManualSection() {
      const refsById = new Map(referees.map(r => [r.id, r]));
      const section = h('div', { style: 'margin-top:32px' });

      section.appendChild(h('div', { class: 'p3-ext-einsatz-header' },
        h('div', { class: 'p3-section-title' },
          `Manuelle Einsätze${externalAssignments.length ? ` (${externalAssignments.length})` : ''}`),
        h('button', { class: 'p3-btn primary small',
          onclick: () => window.openExternalEntryForm(slug, null, refreshManual) },
          '+ Einsatz anlegen'),
      ));

      if (!externalAssignments.length) {
        section.appendChild(h('div', { class: 'p3-empty-soft' },
          'Noch keine manuellen Einsätze. Nutze diese Sektion z.B. für ',
          'Bracket-Spiele, die kayakers nicht zeigt, oder wenn kayakers überhaupt keinen Spielplan hat.'));
      } else {
        const list = h('div', { class: 'p3-ext-einsatz-list' });
        externalAssignments.forEach(e => {
          list.appendChild(renderExternalEntryCard(slug, e, refsById, true, refreshManual));
        });
        section.appendChild(list);
      }
      body.appendChild(section);
    }

    renderFilters();
    renderMatches();
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
        // Direkt zur Einteilungs-Page
        window.openTournamentLineup(slug);
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
      // currentAssignment kann Felder mit undefined haben — explizit null setzen für leere
      const cleanCurrent = {};
      for (const r of ROLES) cleanCurrent[r.code] = currentAssignment[r.code] || null;
      const newRoles = { ...cleanCurrent, [roleCode]: refId };
      try {
        const slug = window.CURRENT_SLUG || 'dc2026';
        const result = await api(`/api/admin/t/${slug}/assignments/${matchNr}`, {
          method: 'POST',
          body: JSON.stringify({ roles: newRoles }),
        });
        window.state.assignments = result.assignments;
        toast('Gespeichert', 'success');
        closeModal();
        // Falls auf Lineup-Page → neu rendern
        if (typeof window.openTournamentLineup === 'function' && document.body.classList.contains('p3-page')) {
          window.openTournamentLineup(slug);
        } else if (typeof window.renderActiveTab === 'function') {
          window.renderActiveTab();
        }
      } catch (e) {
        // Detaillierte Server-Fehlermeldung statt nur "Fehler"
        const msg = e.data?.message || e.data?.error || e.message || 'unbekannt';
        toast('Fehler: ' + msg, 'error');
      }
    }

    const filters = h('div', { class: 'p3-picker-filters' });
    function renderFilterPills() {
      filters.innerHTML = '';
      filters.appendChild(h('div', { class: 'p3-filter-row' },
        h('span', { class: 'p3-flabel' }, 'Kategorie:'),
        ...['all', ...CATEGORIES].map(c => {
          const btn = h('button', { class: 'p3-pillchoice' + (filterCategory === c ? ' active' : '') },
            c === 'all' ? 'Alle' : c);
          btn.onclick = () => { filterCategory = c; renderFilterPills(); render(); };
          return btn;
        }),
      ));
      filters.appendChild(h('div', { class: 'p3-filter-row' },
        h('span', { class: 'p3-flabel' }, 'Klasse:'),
        ...['all', ...REFEREE_LEVELS].map(l => {
          const btn = h('button', { class: 'p3-pillchoice' + (filterLevel === l ? ' active' : '') },
            l === 'all' ? 'Alle' : l);
          btn.onclick = () => { filterLevel = l; renderFilterPills(); render(); };
          return btn;
        }),
      ));
    }
    renderFilterPills();
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

          // ─── Action-Reihe: manueller Eintrag + DKV-PDF ──────────────────
          h('div', { class: 'p3-row', style: 'gap:8px;flex-wrap:wrap;margin-top:12px' },
            h('button', {
              class: 'p3-btn primary',
              onclick: () => window.openManualEntryForm(),
            }, '+ Manuellen Einsatz ergänzen'),

            h('button', {
              class: 'p3-btn',
              title: incomplete
                ? 'Stammdaten unvollständig — PDF enthält Lücken'
                : 'DKV-Einsatzbogen als PDF herunterladen',
              onclick: (e) => withLoading(e.currentTarget, 'PDF wird erstellt …', async () => {
                const filename = `DKV-Einsatzbogen-${ref.code || ref.id}-${entries.year}.pdf`;
                await window.downloadFile(
                  `/api/me/pdf-einsatzbogen?year=${entries.year}`,
                  filename,
                );
              }),
            }, '⬇ DKV-Einsatzbogen (PDF)'),
          ),

          // ─── Stammdaten (eingeklappt) ──────────────────────────────────
          (() => {
            const details = h('details', { class: 'p3-collapse' });
            if (incomplete) details.open = true; // zwingend offen wenn unvollständig
            details.appendChild(h('summary', {},
              h('span', { class: 'p3-section-title-inline' }, 'Stammdaten'),
              h('span', { class: 'p3-hint' }, incomplete ? ' · ⚠ unvollständig' : ' · vollständig'),
            ));
            renderProfileForm(ref).forEach(el => details.appendChild(el));
            return details;
          })(),
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
    const rows = [];
    // Auto-Einträge — eine Zeile pro Einsatz mit Datum + Spielnummer
    (entries.autoEntries || []).forEach(e => {
      rows.push({
        date: e.date,
        tournament: e.tournamentName,
        match: `#${e.matchNr}`,
        role: ROLE_LABELS[e.role] || e.role,
        source: 'auto',
      });
    });
    // Manuelle Einträge
    (entries.manualEntries || []).forEach(e => {
      rows.push({
        date: e.tournamentDate,
        tournament: e.tournamentName,
        match: e.matchNr ? `#${e.matchNr}` : (e.matchLabel || '—'),
        role: ROLE_LABELS[e.role] || e.role,
        source: 'manuell',
        entryId: e.id,
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
        input('tournamentName', 'Veranstaltung *', { placeholder: 'z.B. Pokal Frühling Cottbus 2026' }),
        input('tournamentDate', 'Datum *', { type: 'date' }),
        input('matchNr', 'Spiel-Nr. *', { placeholder: 'z.B. 42' }),
        select('role', 'Funktion *', ROLES.map(r => ({ value: r.code, label: r.label }))),
        input('notes', 'Bemerkung (optional)'),
        h('button', {
          class: 'p3-btn primary',
          onclick: async () => {
            try {
              const body = {};
              for (const k of Object.keys(inputs)) body[k] = inputs[k].value;
              // matchNr als String hinterlegen, weil DKV-Bogen das so erwartet
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
      for (const t of [['tournaments','Turniere'], ['referees','Schiris'], ['reports','Reports']]) {
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

            // DKV-PDF zentral durch Master herunterladen
            const pdfBtn = h('button', {
              class: 'p3-btn small',
              title: 'DKV-Einsatzbogen für ' + r.displayName + ' herunterladen',
            }, '📄 PDF');
            pdfBtn.onclick = () => withLoading(pdfBtn, 'PDF wird erstellt …', async () => {
              const year = new Date().getFullYear();
              const safeName = (r.displayName || r.firstName || 'schiri').replace(/[^a-z0-9-]/gi, '_');
              await window.downloadFile(
                `/api/admin/referees/${r.id}/pdf-einsatzbogen?year=${year}`,
                `DKV-Einsatzbogen-${safeName}-${year}.pdf`,
              );
            });
            actions.push(pdfBtn);

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
        body.appendChild(h('div', { style: 'display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:12px; flex-wrap:wrap' },
          h('strong', {}, `Einsätze ${year}`),
          h('div', { style: 'display:flex; gap:6px' },
            (() => {
              const link = h('a', { class: 'p3-btn small' }, '📥 Übersicht-CSV');
              link.href = `/api/admin/reports/referees.csv?year=${year}`;
              link.title = 'Eine Zeile pro Schiri, Summen pro Rolle';
              // Mit Auth-Header — Browser-Download via Blob
              link.onclick = (e) => {
                e.preventDefault();
                downloadCsv(`/api/admin/reports/referees.csv?year=${year}`, `einsaetze-uebersicht-${year}.csv`);
              };
              return link;
            })(),
            (() => {
              const link = h('a', { class: 'p3-btn small primary' }, '📥 Detail-CSV (pro Einsatz)');
              link.href = `/api/admin/reports/entries.csv?year=${year}`;
              link.title = 'Eine Zeile pro Einsatz — passt zum DKV-Bogen-Layout';
              link.onclick = (e) => {
                e.preventDefault();
                downloadCsv(`/api/admin/reports/entries.csv?year=${year}`, `einsaetze-detail-${year}.csv`);
              };
              return link;
            })(),
          ),
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

    async function openTournamentAssignments_unused(tournament) {
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
        'Externe Turniere haben Schiri-Einsätze, die Trainer/Master pflegen, plus optionale Links zu externen Spielplänen (PDF, Webseite).'));

      const nameInput = h('input', { class: 'p3-input', placeholder: 'z.B. 1. Bundesliga Herren 2026' });
      const slugInput = h('input', { class: 'p3-input', placeholder: 'auto aus Name' });
      const datesInput = h('input', { class: 'p3-input', placeholder: '2026-05-23, 2026-05-24, …' });

      // Auto-Slug aus Name
      nameInput.oninput = () => {
        if (!slugInput.dataset.touched) {
          slugInput.value = nameInput.value.toLowerCase()
            .replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
        }
      };
      slugInput.oninput = () => { slugInput.dataset.touched = '1'; };

      // ─── Ressourcen-Liste (Multi-Link) ─────────────────────────────
      const resourceSection = h('div', {});
      const resourceRows = [];
      function addResourceRow(initial = {}) {
        const titleInput = h('input', { class: 'p3-input', placeholder: 'z.B. Spielplan (PDF)', value: initial.title || '' });
        const urlInput   = h('input', { class: 'p3-input', placeholder: 'https://…',          value: initial.url   || '' });
        const removeBtn  = h('button', { class: 'p3-btn small danger', title: 'Entfernen', onclick: () => {
          const idx = resourceRows.findIndex(r => r.row === row);
          if (idx >= 0) resourceRows.splice(idx, 1);
          row.remove();
        }}, '×');
        const row = h('div', { class: 'p3-multiday-row' },
          h('div', { style: 'display:grid; grid-template-columns: 1fr 2fr auto; gap:6px; align-items:end' },
            h('div', {}, h('label', { style: 'font-size:11px; color:#6b7280' }, 'Titel'), titleInput),
            h('div', {}, h('label', { style: 'font-size:11px; color:#6b7280' }, 'URL'), urlInput),
            removeBtn,
          ),
        );
        resourceRows.push({ titleInput, urlInput, row });
        resourceSection.appendChild(row);
      }
      addResourceRow();
      const addResourceBtn = h('button', { class: 'p3-btn small', onclick: () => addResourceRow() }, '+ Weitere Ressource');

      // ─── VMW-Teams mit Kategorie ───────────────────────────────────
      const teamSection = h('div', {});
      const teamRows = [];
      function addTeamRow(initial = {}) {
        const codeInput = h('input', { class: 'p3-input', placeholder: 'z.B. Herren1', value: initial.code || '' });
        const catSelect = h('select', { class: 'p3-input' });
        for (const [code, label] of Object.entries(CATEGORY_LABELS)) {
          const opt = h('option', { value: code }, label);
          if (initial.category === code) opt.selected = true;
          catSelect.appendChild(opt);
        }
        const removeBtn  = h('button', { class: 'p3-btn small danger', title: 'Entfernen', onclick: () => {
          const idx = teamRows.findIndex(r => r.row === row);
          if (idx >= 0) teamRows.splice(idx, 1);
          row.remove();
        }}, '×');
        const row = h('div', { class: 'p3-multiday-row' },
          h('div', { style: 'display:grid; grid-template-columns: 1fr 1fr auto; gap:6px; align-items:end' },
            h('div', {}, h('label', { style: 'font-size:11px; color:#6b7280' }, 'Team-Code'), codeInput),
            h('div', {}, h('label', { style: 'font-size:11px; color:#6b7280' }, 'Altersklasse'), catSelect),
            removeBtn,
          ),
        );
        teamRows.push({ codeInput, catSelect, row });
        teamSection.appendChild(row);
      }
      const addTeamBtn = h('button', { class: 'p3-btn small', onclick: () => addTeamRow() }, '+ VMW-Team');

      const saveBtn = h('button', { class: 'p3-btn primary' }, 'Speichern');
      saveBtn.onclick = () => withLoading(saveBtn, 'Speichere …', async () => {
        const name = nameInput.value.trim();
        const slug = slugInput.value.trim();
        if (!name) return toast('Name fehlt', 'error');
        if (!/^[a-z0-9-]{3,40}$/.test(slug)) return toast('Slug muss 3-40 Zeichen [a-z0-9-]+ sein', 'error');

        const dates = datesInput.value.split(',').map(s => s.trim()).filter(Boolean);

        // Ressourcen (optional, kein Pflichtfeld)
        const resources = resourceRows
          .filter(r => r.urlInput.value.trim())
          .map(r => ({
            title: r.titleInput.value.trim() || 'Externer Plan',
            url:   r.urlInput.value.trim(),
          }));
        for (const r of resources) {
          if (!/^https?:\/\//.test(r.url)) return toast(`URL ungültig: ${r.url}`, 'error');
        }

        // VMW-Teams (für Kategorie-Pills auf der Landing)
        const ourTeams = teamRows
          .filter(r => r.codeInput.value.trim())
          .map(r => ({
            code:     r.codeInput.value.trim(),
            name:     `VMW Berlin ${r.codeInput.value.trim()}`,
            category: r.catSelect.value,
          }));

        // Auto-Status nach Datum
        const today = new Date().toISOString().slice(0, 10);
        let status = 'active';
        if (dates.length) {
          if (today < dates[0]) status = 'active';
          else if (today > dates[dates.length - 1]) status = 'completed';
        }

        const config = {
          slug, name, type: 'external',
          connector: null, showStandings: false, showHausliga: false,
          source: null,
          external: { resources },
          status, dates,
          expectedDates: null, timezone: 'Europe/Berlin',
          pendingTeamSelection: false, lastRediscoveryAt: null,
          ourTeams,
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

      // Ressourcen-Section
      resultBox.appendChild(h('div', { class: 'p3-field' },
        h('label', {}, 'Externer Spielplan (optional)'),
        h('div', { class: 'p3-hint', style: 'margin-bottom:8px' },
          'Beliebig viele Links zu externen Plänen — PDFs, Vereinsseiten, Liga-Apps. Bei mehreren Links eine eigene Zeile pro Link.'),
        resourceSection,
        addResourceBtn,
      ));

      // VMW-Teams-Section
      resultBox.appendChild(h('div', { class: 'p3-field' },
        h('label', {}, 'VMW-Teams (für Kategorie-Pills auf der Landing-Page)'),
        h('div', { class: 'p3-hint', style: 'margin-bottom:8px' },
          'Pro VMW-Team eine Zeile: Code + Altersklasse. Wird als „Herren · U21 …" auf der Kachel angezeigt.'),
        teamSection,
        addTeamBtn,
      ));

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
          h('p', {}, 'Übersicht aller Turniere und Ligen, in denen VMW Berlin spielt. Wenn möglich mit Live-Spielständen direkt in der App — sonst mit Verlinkung auf den externen Spielplan. Außerdem zentral für das Tracking der Schiri-Einsätze: Trainer pflegen die Einteilungen, jeder Schiri lädt seinen DKV-Einsatzbogen am Jahresende selbst herunter.'),
        ),
        h('div', { class: 'p3-hero-actions' }, userButton),
      ),
    ));

    // ─── Status-Streifen + Jahres-Tabs (zwischen Hero und Liste) ────────
    const statusBar = h('div', { class: 'p3-statusbar' });
    root.appendChild(statusBar);

    // ─── Tournament-Liste ────────────────────────────────────────────
    const listSection = h('div', { class: 'p3-landing-list' });
    root.appendChild(listSection);

    try {
      const result = await fetch('/api/tournaments', {
        headers: window.state.role === 'master' && window.state.adminPassword
          ? { 'x-admin-password': window.state.adminPassword } : {},
      }).then(r => r.json());

      const allTournaments = result.tournaments || [];

      // Jahr aus Datums extrahieren
      const tournamentYear = (t) => {
        const d = t.dates?.[0] || t.expectedDates?.[0];
        return d ? Number(d.slice(0, 4)) : new Date().getFullYear();
      };
      const yearsAvailable = [...new Set(allTournaments.map(tournamentYear))].sort((a, b) => b - a);
      const defaultYear = yearsAvailable.includes(new Date().getFullYear())
        ? new Date().getFullYear()
        : (yearsAvailable[0] || new Date().getFullYear());
      let activeYear = defaultYear;
      // "Archiv" = alles vor (defaultYear - 1). Eigene Pseudo-Auswahl.
      const archiveYears = yearsAvailable.filter(y => y < defaultYear - 1);

      function renderStatusBar() {
        statusBar.innerHTML = '';

        // Counts berechnen — entweder für aktuelles Jahr oder Archiv
        let tsForCount;
        if (activeYear === 'archive') {
          tsForCount = allTournaments.filter(t => archiveYears.includes(tournamentYear(t)));
        } else {
          tsForCount = allTournaments.filter(t => tournamentYear(t) === activeYear);
        }
        const total    = tsForCount.length;
        const active   = tsForCount.filter(t => t.status === 'active').length;
        const finished = tsForCount.filter(t => t.status === 'completed').length;

        // Stats-Block (links)
        const yearLabel = activeYear === 'archive' ? 'Archiv' : activeYear;
        const stats = h('div', { class: 'p3-stats-line' },
          h('span', {}, h('strong', { class: 'p3-stat-num' }, String(total)),
            ` Turnier${total === 1 ? '' : 'e'} ${yearLabel}`),
          total > 0 ? h('span', { class: 'p3-stat-sep' }, '·') : null,
          total > 0 ? h('span', {}, h('strong', { class: 'p3-stat-num live' }, String(active)),
            ' ', active === 1 ? 'läuft gerade' : 'laufen gerade') : null,
          finished > 0 ? h('span', { class: 'p3-stat-sep' }, '·') : null,
          finished > 0 ? h('span', {}, h('strong', {}, String(finished)), ' beendet') : null,
        );

        // Personalisierter Button (Schiri-DKV-Bogen)
        let personalAction = null;
        if (window.state.refereeAuth && activeYear !== 'archive') {
          const dlBtn = h('button', { class: 'p3-btn small primary' },
            '📄 DKV-Bogen ' + activeYear);
          dlBtn.onclick = (e) => withLoading(e.currentTarget, 'PDF wird erstellt …', async () => {
            await window.downloadFile(
              `/api/me/pdf-einsatzbogen?year=${activeYear}`,
              `DKV-Einsatzbogen-${activeYear}.pdf`,
            );
          });
          personalAction = dlBtn;
        }

        // Jahres-Tabs (rechts)
        const tabs = h('div', { class: 'p3-yeartabs' });
        if (yearsAvailable.length > 1) {
          const recentYears = yearsAvailable.filter(y => y >= defaultYear - 1);
          for (const y of recentYears) {
            const tab = h('button', {
              class: 'p3-yeartab' + (activeYear === y ? ' active' : ''),
            }, String(y));
            tab.onclick = () => { activeYear = y; renderStatusBar(); renderList(); };
            tabs.appendChild(tab);
          }
          if (archiveYears.length) {
            const archiveTab = h('button', {
              class: 'p3-yeartab' + (activeYear === 'archive' ? ' active' : ''),
            }, 'Archiv');
            archiveTab.onclick = () => { activeYear = 'archive'; renderStatusBar(); renderList(); };
            tabs.appendChild(archiveTab);
          }
        }

        statusBar.appendChild(stats);
        if (personalAction) statusBar.appendChild(personalAction);
        statusBar.appendChild(tabs);
      }

      function renderList() {
        listSection.innerHTML = '';

        // Filtern nach aktivem Jahr / Archiv
        let visible;
        if (activeYear === 'archive') {
          visible = allTournaments.filter(t => archiveYears.includes(tournamentYear(t)));
        } else {
          visible = allTournaments.filter(t => tournamentYear(t) === activeYear);
        }

        const groups = { active: [], 'awaiting-schedule': [], draft: [], completed: [] };
        visible.forEach(t => { (groups[t.status] || (groups.completed)).push(t); });

        const labels = {
          active:               { icon: '🟢', title: 'Läuft gerade' },
          'awaiting-schedule':  { icon: '📅', title: 'Geplant' },
          draft:                { icon: '✏️',  title: 'Entwürfe' },
          completed:            { icon: '✅', title: 'Beendet' },
        };

        let anyShown = false;
        for (const status of ['active', 'awaiting-schedule', 'draft']) {
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

        // Beendet — default eingeklappt
        if (groups.completed.length) {
          anyShown = true;
          const summary = h('summary', { class: 'p3-landing-section p3-landing-section-toggle' },
            h('span', {}, labels.completed.icon),
            ' ' + labels.completed.title,
            h('span', { class: 'p3-section-count' }, String(groups.completed.length)),
            h('span', { class: 'p3-toggle-hint' }, ' (klick zum Aufklappen)'));
          const grid = h('div', { class: 'p3-card-grid', style: 'margin-top:12px' });
          groups.completed.forEach(t => grid.appendChild(renderTournamentCard(t)));
          const details = h('details', { class: 'p3-completed-details' }, summary, grid);
          listSection.appendChild(details);
        }

        if (!anyShown) {
          listSection.appendChild(h('div', { class: 'p3-empty-state' },
            h('div', { class: 'p3-empty-icon' }, '🏆'),
            h('h3', {}, 'Keine Turniere in ' + (activeYear === 'archive' ? 'Archiv' : activeYear)),
            h('p', {}, 'Wechsle das Jahr oben, oder leg ein neues Turnier im Master-Admin an.'),
          ));
        }
      }

      renderStatusBar();
      renderList();
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

  // Anzeige-Labels für VMW-Team-Kategorien (intern junioren, Anzeige U21)
  const CATEGORY_LABELS = {
    herren: 'Herren', damen: 'Damen', junioren: 'U21', jugend: 'Jugend', schueler: 'Schüler',
  };

  // Rollen-Labels (UI)
  const ROLE_LABELS_DISPLAY = {
    ref1: '1. SR', ref2: '2. SR', scorer: 'Protokoll',
    timer: 'Zeit', shotclock: 'Shotclock', line1: '1. Linie', line2: '2. Linie',
  };

  // ═══════════════════════════════════════════════════════════════════
  // EXTERNAL-TOURNAMENT DASHBOARD
  // ═══════════════════════════════════════════════════════════════════
  //
  // Layout:
  //   Header (Name + Datum + Status + Trainer-Login-Button)
  //   Ressourcen-Card(s) — externer Spielplan-Link(s)
  //   Schiri-Einsatz-Liste (eine Card pro Spielnummer)
  //   + Einsatz-Anlegen-Button (Trainer/Master only)
  //
  // Datenquelle: /api/data?slug=<slug> mit external=true.
  window.renderExternalDashboard = async function(slug, data) {
    window.CURRENT_SLUG = slug;
    const cfg = data.config;
    const referees = data.referees || [];
    const refsById = new Map(referees.map(r => [r.id, r]));
    const entries  = data.externalAssignments || [];
    const resources = cfg.external?.resources || [];

    const isTrainer = window.state.role === 'master' || window.state.role === 'trainer';

    document.body.innerHTML = '';
    document.body.classList.remove('p3-landing-mode');
    document.body.classList.add('p3-page', 'p3-page-external');
    document.body.style.visibility = 'visible';

    const statusBadge = h('span', { class: `p3-status-badge p3-status-${cfg.status}` },
      ({ active: 'live', 'awaiting-schedule': 'geplant', draft: 'draft', completed: 'beendet' }[cfg.status] || cfg.status));

    const trainerBtn = isTrainer
      ? h('button', { class: 'p3-btn small', onclick: () => window.logout() }, 'Logout')
      : h('button', { class: 'p3-btn small', onclick: () => window.openTrainerLogin(slug) }, '🔑 Trainer-Login');

    const dateStr = formatDateRange(cfg.dates || []);

    // Ressourcen-Section
    const resourcesSection = resources.length
      ? h('div', { class: 'p3-ext-resources' },
          h('div', { class: 'p3-section-title' }, 'Externer Spielplan'),
          ...resources.map(r => renderResourceCard(r)))
      : h('div', { class: 'p3-ext-resources p3-ext-noresource' },
          h('div', { class: 'p3-section-title' }, 'Externer Spielplan'),
          h('div', { class: 'p3-hint' }, 'Kein externer Plan verlinkt — Schiri-Einsätze werden ausschließlich hier verwaltet.'));

    // Einsatz-Section
    const einsatzHeader = h('div', { class: 'p3-ext-einsatz-header' },
      h('div', { class: 'p3-section-title' }, `Schiri-Einsätze (${entries.length})`),
      isTrainer
        ? h('button', { class: 'p3-btn primary small',
            onclick: () => window.openExternalEntryForm(slug, null, refresh) },
            '+ Einsatz anlegen')
        : null,
    );

    const einsatzList = h('div', { class: 'p3-ext-einsatz-list' },
      entries.length
        ? entries.map(e => renderExternalEntryCard(slug, e, refsById, isTrainer, refresh))
        : h('div', { class: 'p3-empty-soft' },
            isTrainer
              ? 'Noch keine Einsätze angelegt. Klicke „+ Einsatz anlegen", um zu starten.'
              : 'Noch keine Einsätze angelegt.'));

    const page = h('div', { class: 'p3-page-wrap' },
      h('header', { class: 'p3-page-header' },
        h('button', { class: 'p3-btn small', onclick: () => {
          document.body.classList.remove('p3-page', 'p3-page-external');
          window.history.pushState({}, '', '/');
          window.renderLanding();
        } }, '← Übersicht'),
        h('div', { class: 'p3-page-title-wrap' },
          h('h1', {}, cfg.name),
          h('div', { class: 'p3-page-sub' },
            h('span', {}, dateStr),
            statusBadge),
        ),
        trainerBtn,
      ),
      h('div', { class: 'p3-body' },
        resourcesSection,
        h('div', { class: 'p3-ext-einsatz-section' },
          einsatzHeader,
          einsatzList,
          h('div', { class: 'p3-ext-footer-hint' },
            '📝 Manuell gepflegt von Trainer/Master · Keine Verbindung zum externen Spielplan'),
        ),
      ),
    );

    document.body.appendChild(page);

    async function refresh() {
      const fresh = await fetch(`/api/data?slug=${encodeURIComponent(slug)}`).then(r => r.json());
      window.renderExternalDashboard(slug, fresh);
    }
  };

  // Eine Ressourcen-Card (Link zu externem PDF/Webseite)
  function renderResourceCard(r) {
    const isPdf = /\.pdf(\?|$)/i.test(r.url || '');
    const icon = isPdf ? '📄' : '🔗';
    const typeBadge = isPdf ? 'PDF' : 'Link';
    let host = '';
    try { host = new URL(r.url).hostname; } catch {}
    return h('a', { class: 'p3-ext-resource-card', href: r.url, target: '_blank', rel: 'noopener noreferrer' },
      h('span', { class: 'p3-ext-resource-icon' }, icon),
      h('div', { class: 'p3-ext-resource-text' },
        h('div', { class: 'p3-ext-resource-title' }, r.title || (isPdf ? 'Spielplan (PDF)' : 'Externer Plan')),
        h('div', { class: 'p3-ext-resource-host' }, host)),
      h('span', { class: 'p3-ext-resource-type' }, typeBadge),
      h('span', { class: 'p3-ext-arrow' }, '↗'),
    );
  }

  // Eine Einsatz-Card (Spielnummer + Rollen-Belegung)
  function renderExternalEntryCard(slug, entry, refsById, isTrainer, refresh) {
    const dateShort = entry.date ? entry.date.split('-').reverse().join('.').slice(0,5) + entry.date.slice(0,4).slice(-2) : '';
    const klasse = entry.spielklasse
      ? (CATEGORY_LABELS[entry.spielklasse] || entry.spielklasse)
      : '—';
    const myRefereeId = window.state.refereeAuth
      ? referees_findIdByCode(window.state.refereeAuth)
      : null;

    const head = h('div', { class: 'p3-ext-entry-head' },
      h('span', { class: 'p3-ext-entry-nr' }, `Spiel ${entry.matchNr}`),
      h('span', { class: 'p3-ext-entry-meta' }, `${entry.date} · ${klasse}`),
      isTrainer
        ? h('div', { class: 'p3-ext-entry-actions' },
            h('button', { class: 'p3-btn xsmall',
              onclick: () => window.openExternalEntryForm(slug, entry, refresh) }, '✏️'),
            h('button', { class: 'p3-btn xsmall danger',
              onclick: async () => {
                if (!confirm('Diesen Einsatz wirklich löschen?')) return;
                try {
                  await api(`/api/admin/t/${slug}/external-entries/${entry.id}`, { method: 'DELETE' });
                  await refresh();
                } catch (e) { toast('Fehler: ' + e.message, 'error'); }
              } }, '🗑️'))
        : null,
    );

    const roleGrid = h('div', { class: 'p3-ext-entry-roles' });
    const visibleRoles = ['ref1', 'ref2', 'scorer', 'timer', 'line1'];
    for (const code of visibleRoles) {
      const refId = entry.roles?.[code];
      const ref = refId ? refsById.get(refId) : null;
      const isMe = myRefereeId && refId === myRefereeId;
      roleGrid.appendChild(h('div', { class: 'p3-ext-role-cell' + (isMe ? ' is-me' : '') },
        h('div', { class: 'p3-ext-role-label' }, ROLE_LABELS_DISPLAY[code]),
        h('div', { class: 'p3-ext-role-name' }, ref?.displayName || (refId ? '?' : '–')),
      ));
    }

    return h('div', { class: 'p3-ext-entry-card' }, head, roleGrid,
      entry.notes ? h('div', { class: 'p3-ext-entry-notes' }, '📝 ' + entry.notes) : null);
  }

  function referees_findIdByCode(/* code */) {
    // Schiri-Auth liefert nur den Code, aber kein Referee-Mapping client-seitig.
    // Highlight für eigene Einsätze erfolgt server-seitig bzw. wird hier
    // best-effort weggelassen (würde extra Round-Trip kosten).
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════
  // EXTERNAL ENTRY-FORM (anlegen + bearbeiten)
  // ═══════════════════════════════════════════════════════════════════
  window.openExternalEntryForm = async function(slug, existing, refresh) {
    // Schiri-Liste für Picker laden (cached via data.referees ggf.)
    let referees = window.state.externalReferees;
    if (!referees) {
      try {
        const data = await fetch(`/api/data?slug=${encodeURIComponent(slug)}`).then(r => r.json());
        referees = data.referees || [];
        window.state.externalReferees = referees;
      } catch { referees = []; }
    }

    const isEdit = !!existing;
    const init = existing || { matchNr: '', date: '', spielklasse: 'herren', roles: {}, notes: '' };
    const modal = h('div', { class: 'p3-modal-bg', onclick: (e) => { if (e.target === e.currentTarget) closeModal(); } });
    const card = h('div', { class: 'p3-modal-card' });
    modal.appendChild(card);

    card.appendChild(h('h2', {}, isEdit ? 'Einsatz bearbeiten' : 'Einsatz anlegen'));

    const matchNrInput = h('input', { type: 'text', placeholder: 'z.B. 12', value: init.matchNr });
    const dateInput    = h('input', { type: 'date', value: init.date });
    const klasseSelect = h('select', {});
    for (const [code, label] of Object.entries(CATEGORY_LABELS)) {
      const opt = h('option', { value: code }, label);
      if (init.spielklasse === code) opt.selected = true;
      klasseSelect.appendChild(opt);
    }

    card.appendChild(formRow('Spiel-Nr.', matchNrInput));
    card.appendChild(formRow('Datum', dateInput));
    card.appendChild(formRow('Spielklasse', klasseSelect));

    // Rollen-Picker
    card.appendChild(h('div', { class: 'p3-section-title' }, 'Rollen-Belegung'));
    const roleSelects = {};
    const allRoles = ['ref1', 'ref2', 'scorer', 'timer', 'shotclock', 'line1', 'line2'];
    for (const code of allRoles) {
      const sel = h('select', {});
      sel.appendChild(h('option', { value: '' }, '— nicht besetzt —'));
      for (const r of referees) {
        const opt = h('option', { value: r.id }, r.displayName + ' (' + (r.level || '?') + ')');
        if (init.roles?.[code] === r.id) opt.selected = true;
        sel.appendChild(opt);
      }
      roleSelects[code] = sel;
      card.appendChild(formRow(ROLE_LABELS_DISPLAY[code], sel));
    }

    const notesInput = h('input', { type: 'text', placeholder: 'optional', value: init.notes || '' });
    card.appendChild(formRow('Bemerkung', notesInput));

    const actions = h('div', { class: 'p3-modal-actions' });
    actions.appendChild(h('button', { class: 'p3-btn', onclick: () => closeModal() }, 'Abbrechen'));
    const saveBtn = h('button', { class: 'p3-btn primary' }, isEdit ? 'Speichern' : 'Anlegen');
    saveBtn.onclick = (e) => withLoading(e.currentTarget, 'speichere …', async () => {
      const payload = {
        matchNr:     matchNrInput.value.trim(),
        date:        dateInput.value,
        spielklasse: klasseSelect.value,
        roles:       Object.fromEntries(
          Object.entries(roleSelects).map(([k, sel]) => [k, sel.value || null]).filter(([, v]) => v)
        ),
        notes:       notesInput.value.trim(),
      };
      try {
        if (isEdit) {
          await api(`/api/admin/t/${slug}/external-entries/${existing.id}`, {
            method: 'PUT', body: JSON.stringify(payload),
          });
        } else {
          await api(`/api/admin/t/${slug}/external-entries`, {
            method: 'POST', body: JSON.stringify(payload),
          });
        }
        closeModal();
        await refresh();
      } catch (err) {
        toast('Fehler: ' + err.message, 'error');
      }
    });
    actions.appendChild(saveBtn);
    card.appendChild(actions);

    document.body.appendChild(modal);
  };

  function formRow(label, control) {
    return h('label', { class: 'p3-formrow' },
      h('span', { class: 'p3-formrow-label' }, label),
      control);
  }

  // Formatiert ein Array von ISO-Datumsstrings als deutsches Range:
  //   ['2026-05-23','2026-05-24','2026-05-25'] → '23.–25. Mai 2026'
  //   ['2026-06-14','2026-06-15']               → '14.–15. Juni 2026'
  //   ['2026-09-12']                            → '12. September 2026'
  //   []                                        → '—'
  function formatDateRange(dates) {
    if (!dates || !dates.length) return '—';
    const MONTHS = ['Januar','Februar','März','April','Mai','Juni',
                    'Juli','August','September','Oktober','November','Dezember'];
    const parse = (iso) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
      return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
    };
    const first = parse(dates[0]);
    const last  = parse(dates[dates.length - 1]);
    if (!first) return dates[0] || '—';
    if (!last || dates.length === 1) return `${first.d}. ${MONTHS[first.m-1]} ${first.y}`;

    // Gleicher Monat + Jahr → "23.–25. Mai 2026"
    if (first.m === last.m && first.y === last.y) {
      return `${first.d}.–${last.d}. ${MONTHS[first.m-1]} ${first.y}`;
    }
    // Gleiches Jahr, verschiedene Monate → "30. Mai – 2. Juni 2026"
    if (first.y === last.y) {
      return `${first.d}. ${MONTHS[first.m-1]} – ${last.d}. ${MONTHS[last.m-1]} ${first.y}`;
    }
    // Verschiedene Jahre
    return `${first.d}. ${MONTHS[first.m-1]} ${first.y} – ${last.d}. ${MONTHS[last.m-1]} ${last.y}`;
  }

  function renderTournamentCard(t) {
    const isExternal = t.type === 'external';
    const status = t.status;
    const statusBadgeText = {
      'active': 'live', 'awaiting-schedule': 'geplant', 'draft': 'draft', 'completed': 'beendet'
    }[status] || status;
    const meta = formatDateRange(t.dates?.length ? t.dates : (t.expectedDates || []));

    // Top-Badge: signalisiert App-Turnier vs Externer Plan
    const topBadge = isExternal
      ? h('span', { class: 'p3-typebadge p3-typebadge-external' }, '🔗 Externer Plan')
      : h('span', { class: 'p3-typebadge p3-typebadge-live' }, '📊 Live-Spielplan');

    // Beide Card-Typen klicken auf /t/<slug> → Dashboard / Live-View
    // (Externe Card hat dort dann den prominenten Externer-Link)
    const cardClass = isExternal ? 'p3-tcard p3-tcard-external' : 'p3-tcard p3-tcard-live';
    return h('a', { class: cardClass, href: `/t/${t.slug}` },
      topBadge,
      h('div', { class: 'p3-tcard-name' }, t.name),
      h('div', { class: 'p3-tcard-meta' }, meta),
      h('div', { class: 'p3-tcard-footer' },
        h('span', { class: `p3-status-badge p3-status-${status}` }, statusBadgeText),
        isExternal
          ? h('span', { class: 'p3-tcard-hint' },
              t.externalResourceCount > 0
                ? `${t.externalResourceCount} Ressource${t.externalResourceCount === 1 ? '' : 'n'} + Einsätze`
                : 'Schiri-Einsätze')
          : h('span', { class: 'p3-tcard-hint' }, 'Spielplan öffnen →'),
      ),
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

    // /t/<slug> — Tournament-View
    //   - Für External-Turniere: phase3.js übernimmt und rendert Dashboard
    //   - Sonst: app.js rendert die Live-Spielplan-View
    const tMatch = pathname.match(/^\/t\/([^/]+)/);
    if (tMatch) {
      const slug = decodeURIComponent(tMatch[1]);
      // Async type-check; falls external → übernehmen, sonst app.js lassen
      fetch(`/api/data?slug=${encodeURIComponent(slug)}`)
        .then(r => r.json())
        .then(data => {
          if (data?.external) {
            window.renderExternalDashboard(slug, data);
          }
          // Sonst: app.js läuft eh, der zeigt body wenn fertig
        })
        .catch(() => { /* app.js bleibt der Default-Pfad */ });
      setTimeout(showBody, 300);
      return;
    }

    setTimeout(showBody, 300);
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', bootstrapRoute);
  } else {
    bootstrapRoute();
  }

})();
