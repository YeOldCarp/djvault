/* Mixmap – offline notebook of practiced DJ transitions. No dependencies. */
(() => {
'use strict';

/* ================= helpers ================= */
const KEYS = [];
for (let n = 1; n <= 12; n++) KEYS.push(n + 'A', n + 'B');

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
const uid = () => (self.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const cmp = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });
const byName = (a, b) => cmp(a.artist || '', b.artist || '') || cmp(a.title || '', b.title || '');

const ICON = {
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 000-1.41l-2.34-2.34a.996.996 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  more: 'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
  add: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'
};
const icon = (n, size = 24) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true"><path d="${ICON[n]}"/></svg>`;

const label = t => t ? ([t.artist, t.title].filter(Boolean).join(' – ') || 'Untitled') : 'Deleted track';
const fmtBpm = b => (b == null || b === '') ? '' : String(Math.round(b * 10) / 10);
function keyChip(k) {
  if (!k) return '';
  const n = parseInt(k, 10), b = k.endsWith('B');
  return `<span class="key" style="background:hsl(${(n - 1) * 30},85%,${b ? 74 : 58}%)">${esc(k)}</span>`;
}
const meta = t => (t.bpm != null ? `<span class="bpm">${fmtBpm(t.bpm)}</span>` : '') + keyChip(t.key);
const tagChips = t => (t.tags || []).map(g => `<span class="tag">${esc(g)}</span>`).join('');

function parsePrefill(q) {
  q = (q || '').trim();
  const p = q.split(/\s+[-–—]\s+/);
  return p.length > 1 ? { artist: p[0], title: p.slice(1).join(' - ') } : { artist: '', title: q };
}

/* ================= storage (IndexedDB, mirrored in memory) ================= */
let db;
let tracks = new Map();
let trans = new Map();

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('mixmap', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('tracks', { keyPath: 'id' });
      r.result.createObjectStore('transitions', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const loadAll = store => new Promise((res, rej) => {
  const r = db.transaction(store).objectStore(store).getAll();
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const dbRun = fn => new Promise((res, rej) => {
  const t = db.transaction(['tracks', 'transitions'], 'readwrite');
  fn({ tracks: t.objectStore('tracks'), transitions: t.objectStore('transitions') });
  t.oncomplete = () => res();
  t.onerror = t.onabort = () => rej(t.error);
});
async function safe(fn) {
  try { await fn(); return true; }
  catch (e) { console.error(e); toast('Storage error – nothing was saved'); return false; }
}

const findPair = (from, to) => { for (const x of trans.values()) if (x.from === from && x.to === to) return x; return null; };
const putTrack = async t => { await dbRun(s => s.tracks.put(t)); tracks.set(t.id, t); };
const putTrans = async x => { await dbRun(s => s.transitions.put(x)); trans.set(x.id, x); };
const delTrans = async id => { await dbRun(s => s.transitions.delete(id)); trans.delete(id); };
async function delTrack(id) {
  const ids = [...trans.values()].filter(x => x.from === id || x.to === id).map(x => x.id);
  await dbRun(s => { s.tracks.delete(id); ids.forEach(i => s.transitions.delete(i)); });
  tracks.delete(id);
  ids.forEach(i => trans.delete(i));
}
const allTags = () => {
  const m = new Map();
  tracks.forEach(t => (t.tags || []).forEach(g => m.set(g, (m.get(g) || 0) + 1)));
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
};

/* ================= UI plumbing ================= */
const topbar = $('#topbar'), view = $('#view'), fab = $('#fab'), sheetRoot = $('#sheet-root');
const state = { q: '', tab: 'out' };

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* Bottom sheet. One history entry while open, so the Android back button closes it. */
let sheetOpen = false, closeWaiter = null, sheetEl = null;
function showSheet(html) {
  if (!sheetOpen) { history.pushState({ sheet: true }, ''); sheetOpen = true; }
  sheetRoot.innerHTML = `<div class="scrim"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  sheetEl = $('.sheet', sheetRoot);
  $('.scrim', sheetRoot).addEventListener('pointerdown', e => {
    if (e.target.classList.contains('scrim')) closeAll();
  });
  return sheetEl;
}
function closeSheet() {
  return new Promise(res => {
    if (!sheetOpen) return res();
    sheetOpen = false; sheetRoot.innerHTML = ''; sheetEl = null;
    closeWaiter = res;
    history.back();
  });
}
const closeAll = () => closeSheet().then(renderRoute);

window.addEventListener('popstate', () => {
  if (closeWaiter) { const w = closeWaiter; closeWaiter = null; w(); return; }
  if (sheetOpen) { sheetOpen = false; sheetRoot.innerHTML = ''; sheetEl = null; renderRoute(); }
});
window.addEventListener('hashchange', renderRoute);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheetOpen) closeAll(); });

function dialog({ title, text, buttons }) {
  return new Promise(res => {
    showSheet(`<h2>${esc(title)}</h2><p class="muted" style="margin-top:8px">${esc(text)}</p>
      <div class="btn-col">${buttons.map((b, i) => `<button type="button" class="btn wide ${b.kind || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>`);
    sheetEl.querySelectorAll('[data-i]').forEach(btn => btn.addEventListener('click', () => res(buttons[+btn.dataset.i].value)));
  });
}

/* ================= routing & views ================= */
let lastKey = '';
const currentTrackId = () => { const m = location.hash.match(/^#\/track\/(.+)$/); return m ? decodeURIComponent(m[1]) : null; };

function renderRoute() {
  const id = currentTrackId();
  const key = id ? 't:' + id : 'home';
  const y = key === lastKey ? window.scrollY : 0;
  if (id && !tracks.has(id)) { location.hash = '#/'; return; }
  if (id && key !== lastKey) state.tab = 'out';
  lastKey = key;
  if (id) renderTrack(id); else renderHome();
  window.scrollTo(0, y);
}

function renderHome() {
  topbar.innerHTML = `<div class="title">Mixmap</div><button class="icon-btn" data-action="menu" aria-label="Menu">${icon('more')}</button>`;
  view.innerHTML = `<div class="search"><input id="q" type="search" placeholder="Search artist, title or tag" autocomplete="off" autocapitalize="none" value="${esc(state.q)}"></div><div id="list"></div>`;
  $('#q').addEventListener('input', e => { state.q = e.target.value; renderList(); });
  fab.hidden = false;
  fab.innerHTML = icon('add', 32);
  renderList();
}

function renderList() {
  const list = $('#list');
  if (!list) return;
  if (!tracks.size) {
    list.innerHTML = `<div class="empty"><p><strong>No tracks yet.</strong></p><p>Tap + to add a track you have practiced mixes with.</p></div>`;
    return;
  }
  const tokens = norm(state.q).split(' ').filter(Boolean);
  let arr = [...tracks.values()];
  if (tokens.length) arr = arr.filter(t => {
    const h = norm([t.artist, t.title, ...(t.tags || [])].join(' '));
    return tokens.every(k => h.includes(k));
  });
  arr.sort(byName);
  if (!arr.length) {
    list.innerHTML = `<div class="empty"><p>No match for “${esc(state.q)}”.</p><button class="btn primary" data-action="add-track-q">Add as new track</button></div>`;
    return;
  }
  const outC = new Map(), inC = new Map();
  trans.forEach(x => { outC.set(x.from, (outC.get(x.from) || 0) + 1); inC.set(x.to, (inC.get(x.to) || 0) + 1); });
  const LIMIT = 200;
  list.innerHTML = arr.slice(0, LIMIT).map(t => `
    <a class="card row" href="#/track/${encodeURIComponent(t.id)}">
      <div class="row-main">
        <span class="artist">${esc(t.artist) || '&nbsp;'}</span>
        <span class="title">${esc(t.title)}</span>
        ${(t.tags || []).length ? `<div class="tags">${tagChips(t)}</div>` : ''}
      </div>
      <div class="row-side">
        <div>${meta(t)}</div>
        <div class="counts">→ ${outC.get(t.id) || 0} · ← ${inC.get(t.id) || 0}</div>
      </div>
    </a>`).join('') +
    (arr.length > LIMIT ? `<p class="muted center">Showing first ${LIMIT} of ${arr.length} – refine your search.</p>` : '');
}

function renderTrack(id) {
  const t = tracks.get(id);
  topbar.innerHTML = `
    <button class="icon-btn" data-action="back" aria-label="Back">${icon('back')}</button>
    <div class="title">Track</div>
    <button class="icon-btn" data-action="home" aria-label="Library">${icon('home')}</button>
    <button class="icon-btn" data-action="edit-track" aria-label="Edit track">${icon('edit')}</button>`;
  fab.hidden = true;

  const all = [...trans.values()];
  const outs = all.filter(x => x.from === id), ins = all.filter(x => x.to === id);
  const dir = state.tab;
  const list = dir === 'out' ? outs : ins;
  const otherOf = x => tracks.get(dir === 'out' ? x.to : x.from) || {};
  list.sort((a, b) => byName(otherOf(a), otherOf(b)));

  view.innerHTML = `
    <section class="hero">
      <div class="h-artist">${esc(t.artist) || '&nbsp;'}</div>
      <div class="h-title">${esc(t.title)}</div>
      <div class="h-meta">${meta(t)}${tagChips(t)}</div>
    </section>
    <div class="tabs">
      <button class="tab${dir === 'out' ? ' on' : ''}" data-action="tab" data-tab="out">Plays into →<span class="count">${outs.length}</span></button>
      <button class="tab${dir === 'in' ? ' on' : ''}" data-action="tab" data-tab="in">← Comes from<span class="count">${ins.length}</span></button>
    </div>
    <button class="btn primary wide add" data-action="add-trans">${icon('add')} ${dir === 'out' ? 'Add: plays into…' : 'Add: comes from…'}</button>
    <div id="tlist">${list.length
      ? list.map(x => transCard(x, dir)).join('')
      : `<div class="empty"><p>${dir === 'out' ? 'No transitions out of this track yet.' : 'Nothing logged as leading into this track yet.'}</p></div>`}</div>`;
  markOverflow();
}

function transCard(x, dir) {
  const o = tracks.get(dir === 'out' ? x.to : x.from);
  return `<article class="card tcard">
    <a class="other" href="#/track/${encodeURIComponent(o ? o.id : '')}">
      <div class="o-main"><span class="artist">${esc(o && o.artist) || '&nbsp;'}</span><span class="title">${esc(o ? o.title : 'Deleted track')}</span></div>
      <div class="o-meta">${o ? meta(o) : ''}</div>
    </a>
    ${x.notes ? `<div class="notes clamp" data-action="toggle-notes">${esc(x.notes)}</div>` : '<div class="notes empty">No notes</div>'}
    <div class="card-actions">
      <button class="btn small" data-action="edit-trans" data-id="${x.id}">Edit</button>
      <button class="btn small ghost-danger" data-action="del-trans" data-id="${x.id}">Delete</button>
    </div>
  </article>`;
}

function markOverflow() {
  view.querySelectorAll('.notes.clamp').forEach(n => {
    if (n.scrollHeight > n.clientHeight + 1) n.insertAdjacentHTML('afterend', '<div class="more" data-action="toggle-more">Show more</div>');
  });
}
function toggleNotes(n) {
  if (!n || !n.classList.contains('notes')) return;
  n.classList.toggle('clamp');
  const more = n.nextElementSibling;
  if (more && more.classList.contains('more')) more.textContent = n.classList.contains('clamp') ? 'Show more' : 'Show less';
}

/* ================= track form ================= */
function openTrackForm(opts = {}) {
  const { track = null, prefill = {}, onSaved = null, onCancel = null } = opts;
  const v = {
    artist: track ? track.artist : (prefill.artist || ''),
    title: track ? track.title : (prefill.title || ''),
    bpm: track && track.bpm != null ? String(track.bpm) : '',
    key: track ? (track.key || '') : ''
  };
  let tags = track ? [...(track.tags || [])] : [];
  const artists = [...new Set([...tracks.values()].map(t => t.artist).filter(Boolean))].sort(cmp);

  showSheet(`
    <form id="tf" novalidate>
      <div class="sheet-head"><h2>${track ? 'Edit track' : 'New track'}</h2>
        <button type="button" class="icon-btn" data-s="cancel" aria-label="Close">${icon('close')}</button></div>
      <div class="field"><label for="f-artist">Artist</label>
        <input id="f-artist" list="dl-artists" autocomplete="off" value="${esc(v.artist)}"></div>
      <datalist id="dl-artists">${artists.map(a => `<option value="${esc(a)}">`).join('')}</datalist>
      <div class="field"><label for="f-title">Title</label>
        <input id="f-title" autocomplete="off" value="${esc(v.title)}"></div>
      <div class="row2">
        <div class="field"><label for="f-bpm">BPM</label>
          <input id="f-bpm" inputmode="decimal" autocomplete="off" placeholder="128" value="${esc(v.bpm)}"></div>
        <div class="field"><label for="f-key">Key (Camelot)</label>
          <select id="f-key"><option value="">—</option>${KEYS.map(k => `<option${k === v.key ? ' selected' : ''}>${k}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label for="f-tag">Tags</label>
        <div id="tag-chips" class="chips"></div>
        <input id="f-tag" autocomplete="off" autocapitalize="none" placeholder="Type a tag, press Enter">
        <div id="tag-sugg" class="chips sugg"></div></div>
      <div id="f-msg" class="msg" hidden></div>
      <div class="btn-row">
        ${track ? '<button type="button" class="btn ghost-danger" data-s="delete">Delete</button>' : ''}
        <button type="submit" class="btn primary grow" id="f-save">Save</button>
      </div>
    </form>`);

  const form = $('#tf', sheetEl), chips = $('#tag-chips', sheetEl), sugg = $('#tag-sugg', sheetEl), tagIn = $('#f-tag', sheetEl);
  const msg = txt => { const m = $('#f-msg', sheetEl); m.textContent = txt; m.hidden = !txt; };

  function drawTags() {
    chips.innerHTML = tags.map((g, i) => `<span class="chip">${esc(g)}<button type="button" data-rm="${i}" aria-label="Remove ${esc(g)}">×</button></span>`).join('');
    const q = tagIn.value.trim().toLowerCase();
    sugg.innerHTML = allTags().filter(g => !tags.includes(g) && (!q || g.includes(q))).slice(0, 12)
      .map(g => `<button type="button" class="chip suggest" data-add="${esc(g)}">+ ${esc(g)}</button>`).join('');
  }
  const addTag = raw => { const g = raw.trim().toLowerCase(); if (g && !tags.includes(g)) tags.push(g); };
  const commitTag = () => { addTag(tagIn.value); tagIn.value = ''; drawTags(); };

  tagIn.addEventListener('input', () => {
    if (tagIn.value.includes(',')) {
      const parts = tagIn.value.split(',');
      const rest = parts.pop();
      parts.forEach(addTag);
      tagIn.value = rest;
    }
    drawTags();
  });
  tagIn.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commitTag(); }
    else if (e.key === 'Backspace' && !tagIn.value && tags.length) { tags.pop(); drawTags(); }
  });
  form.addEventListener('click', e => {
    const rm = e.target.closest('[data-rm]'), ad = e.target.closest('[data-add]');
    if (rm) { tags.splice(+rm.dataset.rm, 1); drawTags(); }
    if (ad) { addTag(ad.dataset.add); tagIn.value = ''; drawTags(); }
  });
  drawTags();

  let dupOk = false;
  const resetDup = () => { if (dupOk) { dupOk = false; $('#f-save', sheetEl).textContent = 'Save'; msg(''); } };
  $('#f-artist', sheetEl).addEventListener('input', resetDup);
  $('#f-title', sheetEl).addEventListener('input', resetDup);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    commitTag();
    const artist = $('#f-artist', sheetEl).value.trim();
    const title = $('#f-title', sheetEl).value.trim();
    const bpmRaw = $('#f-bpm', sheetEl).value.trim().replace(',', '.');
    if (!title) return msg('Title is required.');
    let bpm = null;
    if (bpmRaw) {
      bpm = parseFloat(bpmRaw);
      if (!isFinite(bpm) || bpm < 20 || bpm > 300) return msg('BPM must be a number between 20 and 300.');
      bpm = Math.round(bpm * 10) / 10;
    }
    const dup = [...tracks.values()].find(t => (!track || t.id !== track.id) && norm(t.artist) === norm(artist) && norm(t.title) === norm(title));
    if (dup && !dupOk) {
      dupOk = true;
      msg('A track with this artist and title already exists. Save again to add it anyway.');
      $('#f-save', sheetEl).textContent = 'Save anyway';
      return;
    }
    const rec = { id: track ? track.id : uid(), artist, title, bpm, key: $('#f-key', sheetEl).value, tags: [...tags], created: track ? track.created : Date.now() };
    if (!await safe(() => putTrack(rec))) return;
    toast('Track saved');
    if (onSaved) { onSaved(rec); return; }
    await closeSheet();
    if (!track) location.hash = '#/track/' + encodeURIComponent(rec.id);
    else renderRoute();
  });

  form.addEventListener('click', async e => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    if (b.dataset.s === 'cancel') { onCancel ? onCancel() : closeAll(); }
    if (b.dataset.s === 'delete') {
      const n = [...trans.values()].filter(x => x.from === track.id || x.to === track.id).length;
      const ok = await dialog({
        title: 'Delete track?',
        text: `“${label(track)}” and its ${n} transition${n === 1 ? '' : 's'} will be removed.`,
        buttons: [{ label: 'Delete', kind: 'danger', value: true }, { label: 'Cancel', value: false }]
      });
      if (!ok) { openTrackForm(opts); return; }
      if (!await safe(() => delTrack(track.id))) return;
      const wasHere = currentTrackId() === track.id;
      await closeSheet();
      toast('Track deleted');
      if (wasHere) location.hash = '#/'; else renderRoute();
    }
  });

  if (!track) (v.artist ? $('#f-title', sheetEl) : $('#f-artist', sheetEl)).focus();
}

/* ================= transition form ================= */
function flowTrack(t, isCur) {
  return `<div class="flowtrack${isCur ? ' cur' : ''}">
    <div class="ft-main"><span class="artist">${esc(t.artist) || '&nbsp;'}</span><span class="title">${esc(t.title)}</span></div>
    <div class="ft-meta">${meta(t)}</div></div>`;
}

function openTransitionForm({ currentId, dir, otherId = null, transId = null }) {
  const cur = tracks.get(currentId);
  const editing = transId ? trans.get(transId) : null;
  if (editing) otherId = dir === 'out' ? editing.to : editing.from;
  const other = otherId ? tracks.get(otherId) : null;
  if (!other) return openPicker({ currentId, dir });

  const from = dir === 'out' ? cur : other, to = dir === 'out' ? other : cur;
  const existing = editing || findPair(from.id, to.id);

  showSheet(`
    <form id="xf" novalidate>
      <div class="sheet-head"><h2>${existing ? 'Edit transition' : 'New transition'}</h2>
        <button type="button" class="icon-btn" data-s="cancel" aria-label="Close">${icon('close')}</button></div>
      <div class="flow">
        ${flowTrack(from, from.id === currentId)}
        <div class="flow-arrow">↓</div>
        ${flowTrack(to, to.id === currentId)}
      </div>
      ${!editing && existing ? '<div class="msg info">This pair already has a transition – you are editing it.</div>' : ''}
      ${!editing ? '<button type="button" class="btn small" data-s="change">Change track</button>' : ''}
      <div class="field"><label for="f-notes">Notes</label>
        <textarea id="f-notes" placeholder="double: …&#10;slam: …&#10;wordplay: …">
${esc(existing ? existing.notes : '')}</textarea></div>
      <div class="btn-row"><button type="submit" class="btn primary grow">Save</button></div>
    </form>`);

  const ta = $('#f-notes', sheetEl);
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);

  $('#xf', sheetEl).addEventListener('click', e => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    if (b.dataset.s === 'cancel') closeAll();
    if (b.dataset.s === 'change') openPicker({ currentId, dir });
  });
  $('#xf', sheetEl).addEventListener('submit', async e => {
    e.preventDefault();
    const ex = findPair(from.id, to.id);
    const rec = { id: ex ? ex.id : uid(), from: from.id, to: to.id, notes: ta.value.replace(/\s+$/, ''), created: ex ? ex.created : Date.now() };
    if (!await safe(() => putTrans(rec))) return;
    await closeSheet();
    renderRoute();
    toast('Transition saved');
  });
}

function openPicker({ currentId, dir }) {
  const cur = tracks.get(currentId);
  showSheet(`
    <div class="sheet-head"><h2>${dir === 'out' ? 'Plays into…' : 'Comes from…'}</h2>
      <button type="button" class="icon-btn" data-s="cancel" aria-label="Close">${icon('close')}</button></div>
    <p class="muted small">${dir === 'out' ? esc(label(cur)) + ' → ?' : '? → ' + esc(label(cur))}</p>
    <input id="pick-q" type="search" placeholder="Search a track, or type a new one" autocomplete="off" autocapitalize="none">
    <div id="pick-list"></div>`);
  const input = $('#pick-q', sheetEl), list = $('#pick-list', sheetEl);

  function draw() {
    const q = input.value.trim();
    const tokens = norm(q).split(' ').filter(Boolean);
    let arr = [...tracks.values()].filter(t => t.id !== currentId);
    if (tokens.length) arr = arr.filter(t => {
      const h = norm([t.artist, t.title, ...(t.tags || [])].join(' '));
      return tokens.every(k => h.includes(k));
    });
    arr.sort(byName);
    list.innerHTML =
      `<button type="button" class="pick new" data-new="1">${icon('add')}<span>${q ? `New track “${esc(q)}”` : 'New track'}</span></button>` +
      arr.slice(0, 40).map(t => {
        const linked = dir === 'out' ? findPair(currentId, t.id) : findPair(t.id, currentId);
        return `<button type="button" class="pick" data-id="${t.id}">
          <span class="p-main"><span class="artist">${esc(t.artist) || '&nbsp;'}</span><span class="title">${esc(t.title)}</span></span>
          <span class="p-meta">${linked ? '<span class="linked">linked</span>' : ''}${meta(t)}</span></button>`;
      }).join('');
  }
  input.addEventListener('input', draw);
  draw();
  input.focus();

  sheetEl.addEventListener('click', e => {
    const b = e.target.closest('[data-s],[data-id],[data-new]');
    if (!b) return;
    if (b.dataset.s === 'cancel') return closeAll();
    if (b.dataset.id) return openTransitionForm({ currentId, dir, otherId: b.dataset.id });
    if (b.dataset.new) {
      openTrackForm({
        prefill: parsePrefill(input.value),
        onSaved: t => openTransitionForm({ currentId, dir, otherId: t.id }),
        onCancel: () => openPicker({ currentId, dir })
      });
    }
  });
}

/* ================= menu, export, import ================= */
function openMenu() {
  showSheet(`
    <div class="sheet-head"><h2>Mixmap</h2>
      <button type="button" class="icon-btn" data-s="cancel" aria-label="Close">${icon('close')}</button></div>
    <p class="muted">${tracks.size} track${tracks.size === 1 ? '' : 's'} · ${trans.size} transition${trans.size === 1 ? '' : 's'}</p>
    <div class="btn-col">
      <button type="button" class="btn wide" data-s="export">Export backup (JSON)</button>
      <button type="button" class="btn wide" data-s="import">Import backup…</button>
    </div>
    <p class="muted small" id="persist-note" style="margin-top:14px"></p>`);
  sheetEl.addEventListener('click', e => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    if (b.dataset.s === 'cancel') closeAll();
    if (b.dataset.s === 'export') exportData();
    if (b.dataset.s === 'import') $('#file').click();
  });
  if (navigator.storage && navigator.storage.persisted) {
    navigator.storage.persisted().then(p => {
      const n = $('#persist-note', sheetEl || document);
      if (n) n.textContent = p
        ? 'Storage is protected from automatic cleanup.'
        : 'The browser may clear app storage if the phone runs low on space. Export a backup regularly.';
    });
  }
}

function exportData() {
  const data = { app: 'mixmap', version: 1, exportedAt: new Date().toISOString(), tracks: [...tracks.values()], transitions: [...trans.values()] };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `mixmap-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Backup exported');
}

$('#file').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  importFlow(await f.text());
});

async function importFlow(text) {
  let d;
  try { d = JSON.parse(text); } catch { toast('That is not a valid JSON file'); return; }
  if (!d || !Array.isArray(d.tracks) || !Array.isArray(d.transitions)) { toast('Not a Mixmap backup'); return; }

  const str = s => String(s ?? '').trim();
  const cleanT = d.tracks.filter(t => t && typeof t.id === 'string').map(t => {
    const bpm = parseFloat(t.bpm);
    return {
      id: t.id, artist: str(t.artist), title: str(t.title),
      bpm: isFinite(bpm) ? bpm : null,
      key: KEYS.includes(t.key) ? t.key : '',
      tags: Array.isArray(t.tags) ? [...new Set(t.tags.map(g => str(g).toLowerCase()).filter(Boolean))] : [],
      created: t.created || Date.now()
    };
  });
  const cleanX = d.transitions.filter(x => x && typeof x.id === 'string' && x.from && x.to && x.from !== x.to)
    .map(x => ({ id: x.id, from: x.from, to: x.to, notes: String(x.notes ?? ''), created: x.created || Date.now() }));

  const choice = await dialog({
    title: 'Import backup',
    text: `File: ${cleanT.length} tracks, ${cleanX.length} transitions. Currently: ${tracks.size} tracks, ${trans.size} transitions.`,
    buttons: [
      { label: 'Merge (file wins on conflicts)', kind: 'primary', value: 'merge' },
      { label: 'Replace everything', kind: 'danger', value: 'replace' },
      { label: 'Cancel', value: null }
    ]
  });
  if (!choice) { closeAll(); return; }

  const replace = choice === 'replace';
  const nt = replace ? new Map() : new Map(tracks);
  const nx = replace ? new Map() : new Map(trans);
  cleanT.forEach(t => nt.set(t.id, t));
  const pk = x => x.from + '>' + x.to;
  const byPair = new Map();
  nx.forEach(x => byPair.set(pk(x), x.id));
  let skipped = 0;
  cleanX.forEach(x => {
    if (!nt.has(x.from) || !nt.has(x.to)) { skipped++; return; }
    const old = byPair.get(pk(x));
    if (old && old !== x.id) nx.delete(old);
    nx.set(x.id, x);
    byPair.set(pk(x), x.id);
  });

  const ok = await safe(async () => {
    await dbRun(s => {
      s.tracks.clear(); s.transitions.clear();
      nt.forEach(t => s.tracks.put(t));
      nx.forEach(x => s.transitions.put(x));
    });
    tracks = nt; trans = nx;
  });
  await closeSheet();
  renderRoute();
  if (ok) toast(skipped ? `Imported (${skipped} orphaned transitions skipped)` : 'Import complete');
}

/* ================= global click handling ================= */
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const id = el.dataset.id;
  const cur = currentTrackId();
  switch (el.dataset.action) {
    case 'menu': openMenu(); break;
    case 'back': (history.length > 1) ? history.back() : (location.hash = '#/'); break;
    case 'home': location.hash = '#/'; break;
    case 'add-track': openTrackForm(); break;
    case 'add-track-q': openTrackForm({ prefill: parsePrefill(state.q) }); break;
    case 'edit-track': openTrackForm({ track: tracks.get(cur) }); break;
    case 'tab': state.tab = el.dataset.tab; renderRoute(); break;
    case 'add-trans': openTransitionForm({ currentId: cur, dir: state.tab }); break;
    case 'edit-trans': openTransitionForm({ currentId: cur, dir: state.tab, transId: id }); break;
    case 'toggle-notes': toggleNotes(el); break;
    case 'toggle-more': toggleNotes(el.previousElementSibling); break;
    case 'del-trans': {
      const x = trans.get(id);
      if (!x) break;
      const ok = await dialog({
        title: 'Delete transition?',
        text: `${label(tracks.get(x.from))} → ${label(tracks.get(x.to))}`,
        buttons: [{ label: 'Delete', kind: 'danger', value: true }, { label: 'Cancel', value: false }]
      });
      if (ok) { await safe(() => delTrans(id)); toast('Transition deleted'); }
      closeAll();
      break;
    }
  }
});

/* ================= boot ================= */
(async function init() {
  try {
    db = await openDB();
    const [ts, xs] = await Promise.all([loadAll('tracks'), loadAll('transitions')]);
    ts.forEach(t => tracks.set(t.id, t));
    xs.forEach(x => trans.set(x.id, x));
  } catch (e) {
    console.error(e);
    topbar.innerHTML = '<div class="title">Mixmap</div>';
    view.innerHTML = '<div class="empty"><p><strong>Local storage is not available.</strong></p><p>Private browsing or blocked site data prevents Mixmap from saving anything.</p></div>';
    return;
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  renderRoute();
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(console.warn));
  }
})();
})();
