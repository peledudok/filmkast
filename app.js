'use strict';
/* Filmkast: persoonlijke film- en seriecollectie met TMDb. Alles staat lokaal in de browser. */
/* Plak hier je TMDb-sleutel tussen de aanhalingstekens, dan hoef je hem niet meer in de app in te vullen. */
const BAKED_KEY = '7fcbf4f9a1ba7685b97b43366308affd';
const KEY = 'filmkast.v1';
const IMG = 'https://image.tmdb.org/t/p/';
const SORTS = [['title', 'Titel'], ['year', 'Jaar'], ['added', 'Toegevoegd'], ['rating', 'Beoordeling'], ['seen', 'Datum gezien']];
const PUB = [
  { id: 'populair', name: 'Populair', path: '/movie/popular', type: 'movie', region: 1 },
  { id: 'bioscoop', name: 'Nu in de bioscoop', path: '/movie/now_playing', type: 'movie', region: 1 },
  { id: 'beste', name: 'Best beoordeeld', path: '/movie/top_rated', type: 'movie', region: 1 },
  { id: 'binnenkort', name: 'Binnenkort', path: '/movie/upcoming', type: 'movie', region: 1 },
  { id: 'series', name: 'Populaire series', path: '/tv/popular', type: 'tv' },
  { id: 'beste-series', name: 'Best beoordeelde series', path: '/tv/top_rated', type: 'tv' }
];
const ACCENTS = ['#e0a458', '#7fc8bd', '#8fb4ff', '#d98b9b', '#a9d36b'];

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const fmtDate = s => { if (!s) return ''; const d = new Date(s + 'T00:00:00'); return isNaN(d) ? s : d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, ''); };
const plural = (n, a, b) => n + ' ' + (n === 1 ? a : b);

/* ---------- opslag ---------- */
const DEF = () => ({
  v: 1,
  lists: [
    { id: 'movies', name: 'Films', kind: 'movie' },
    { id: 'tv', name: 'Series', kind: 'tv' },
    { id: 'wish', name: 'Verlanglijst' }
  ],
  entries: [],
  settings: { apiKey: '', lang: 'nl-NL', region: 'NL', view: 'list', sortKey: 'title', sortDir: 'asc', accent: ACCENTS[0] },
  genres: { movie: {}, tv: {} }
});
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && Array.isArray(d.entries) && Array.isArray(d.lists) && d.lists.length) {
      d.settings = Object.assign(DEF().settings, d.settings || {});
      d.genres = d.genres || { movie: {}, tv: {} };
      const music = d.lists.filter(l => l.kind === 'music').map(l => l.id);
      if (music.length && d.lists.length > music.length) {
        d.lists = d.lists.filter(l => l.kind !== 'music');
        d.entries = d.entries.filter(e => !music.includes(e.list) && e.type !== 'music');
      }
      return d;
    }
  } catch (e) { /* leeg of beschadigd */ }
  return DEF();
}
let S = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { toast('Opslaan lukt niet. Is de opslag vol of geblokkeerd?'); }
}
const listById = id => S.lists.find(l => l.id === id);
const count = id => S.entries.filter(e => e.list === id).length;

/* ---------- TMDb ---------- */
const CACHE = {};
const cache = it => { CACHE[it.type + '-' + it.tmdbId] = it; return it; };
async function api(path, params) {
  const k = (S.settings.apiKey || BAKED_KEY || '').trim();
  if (!k) throw new Error('GEEN_SLEUTEL');
  const u = new URL('https://api.themoviedb.org/3' + path);
  u.searchParams.set('language', S.settings.lang);
  Object.entries(params || {}).forEach(([a, b]) => { if (b !== undefined && b !== '') u.searchParams.set(a, b); });
  const headers = {};
  if (k.startsWith('eyJ')) headers.Authorization = 'Bearer ' + k; else u.searchParams.set('api_key', k);
  const r = await fetch(u, { headers });
  if (r.status === 401) throw new Error('SLEUTEL_ONGELDIG');
  if (!r.ok) throw new Error('HTTP_' + r.status);
  return r.json();
}
function errMsg(e) {
  const m = e && e.message || '';
  if (m === 'GEEN_SLEUTEL') return 'GEEN_SLEUTEL';
  if (m === 'SLEUTEL_ONGELDIG') return 'TMDb accepteert deze API-sleutel niet. Controleer de sleutel in Instellingen.';
  if (m.startsWith('HTTP_')) return 'TMDb gaf een fout (' + m.slice(5) + '). Probeer het later opnieuw.';
  return 'Geen verbinding met TMDb. Controleer je internet.';
}
async function ensureGenres() {
  const g = S.genres;
  if (g.lang === S.settings.lang && Object.keys(g.movie || {}).length && Object.keys(g.tv || {}).length) return;
  const [m, t] = await Promise.all([api('/genre/movie/list'), api('/genre/tv/list')]);
  S.genres = {
    lang: S.settings.lang,
    movie: Object.fromEntries(m.genres.map(x => [x.id, x.name])),
    tv: Object.fromEntries(t.genres.map(x => [x.id, x.name]))
  };
  save();
}
function norm(r, type) {
  type = r.media_type || type;
  const date = r.release_date || r.first_air_date || '';
  const genres = r.genres ? r.genres.map(g => g.name) : (r.genre_ids || []).map(id => (S.genres[type] || {})[id]).filter(Boolean);
  return {
    tmdbId: r.id, type, title: r.title || r.name || '', year: date.slice(0, 4), poster: r.poster_path || '',
    overview: r.overview || '', rating: r.vote_average ? Math.round(r.vote_average * 10) / 10 : 0, genres,
    runtime: r.runtime || (r.episode_run_time && r.episode_run_time[0]) || 0, seasons: r.number_of_seasons || 0, tagline: r.tagline || ''
  };
}

/* ---------- invoer ---------- */
function addEntry(item, listId) {
  if (item.tmdbId && S.entries.some(e => e.list === listId && e.type === item.type && e.tmdbId === item.tmdbId)) { toast('Staat al in deze lijst'); return null; }
  const e = {
    id: uid(), list: listId, type: item.type, tmdbId: item.tmdbId || 0, title: item.title, year: item.year || '',
    poster: item.poster || '', overview: item.overview || '', rating: item.rating || 0, genres: item.genres || [],
    seen: '', note: '', added: Date.now()
  };
  S.entries.push(e); save(); return e;
}

/* ---------- weergave-hulpjes ---------- */
const I = {
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  filter: '<path d="M3 5h18M6 12h12M10 19h4"/>',
  sort: '<path d="M3 6h18M3 12h12M3 18h6"/>',
  more: '<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>',
  back: '<path d="M19 12H5m6-6-6 6 6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>'
};
const ico = n => '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + I[n] + '</svg>';
function bar(o) {
  const lead = o.menu
    ? '<button class="ib" data-a="drawer" aria-label="Menu">' + ico('menu') + '</button>'
    : '<button class="ib" data-a="back" aria-label="Terug">' + ico('back') + '</button>';
  const acts = (o.acts || []).map(a => '<button class="ib" data-a="' + a[0] + '" aria-label="' + a[2] + '">' + ico(a[1]) + '</button>').join('');
  return '<header class="bar">' + lead + '<div class="tt"><b>' + esc(o.title) + '</b>' + (o.sub ? '<small>' + esc(o.sub) + '</small>' : '') + '</div>' + acts + '</header>';
}
const posterHtml = (it, sz) => it.poster
  ? '<div class="pos"><img loading="lazy" alt="" src="' + IMG + (sz || 'w185') + esc(it.poster) + '"></div>'
  : '<div class="pos">geen<br>afbeelding</div>';
function entryRow(e) {
  return '<a class="row" href="#/e/' + e.id + '">' + posterHtml(e) + '<div class="rb"><div class="rt"><b>' + esc(e.title) + '</b>' +
    (e.year ? ' <i>(' + esc(e.year) + ')</i>' : '') + '</div><div class="rg">' + esc((e.genres || []).join(' · ')) + '</div>' +
    (e.seen ? '<div class="seen">Gezien: ' + fmtDate(e.seen) + '</div>' : '') + '</div></a>';
}
function entryTile(e) {
  return '<a class="tile" href="#/e/' + e.id + '">' + posterHtml(e, 'w342') + '<span>' + esc(e.title) + '</span>' + (e.seen ? '<span class="done">Gezien</span>' : '') + '</a>';
}
function tmdbRow(it, listId) {
  const owned = S.entries.filter(e => e.type === it.type && e.tmdbId === it.tmdbId);
  const inList = listId ? owned.some(e => e.list === listId) : false;
  const href = '#/d/' + it.type + '/' + it.tmdbId;
  const label = inList ? 'In lijst' : (!listId && owned.length ? 'Nog een lijst' : 'Toevoegen');
  return '<div class="row"><a class="pl" href="' + href + '">' + posterHtml(it) + '</a><div class="rb"><a class="rt" href="' + href + '"><b>' + esc(it.title) + '</b>' +
    (it.year ? ' <i>(' + esc(it.year) + ')</i>' : '') + '</a><div class="rg">' + (it.type === 'tv' ? 'Serie · ' : '') + esc(it.genres.join(' · ')) + '</div>' +
    '<button class="btn sm ' + (inList ? 'ghost' : 'pri') + '" data-a="addres" data-k="' + it.type + '-' + it.tmdbId + '"' + (inList ? ' disabled' : '') + '>' + label + '</button></div></div>';
}
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600);
}
function openSheet(html) { $('#sheet').innerHTML = '<div class="sc" data-a="closesheet"></div><div class="sp">' + html + '</div>'; $('#sheet').classList.add('open'); }
function closeSheet() { $('#sheet').classList.remove('open'); $('#sheet').innerHTML = ''; }
let CONFIRM = null;
function confirmSheet(text, okLabel, fn) {
  CONFIRM = fn;
  openSheet('<h3>Weet je het zeker?</h3><p>' + esc(text) + '</p><div class="cols"><button class="btn ghost" data-a="closesheet">Annuleren</button><button class="btn bad" data-a="confirmok">' + esc(okLabel) + '</button></div>');
}
function download(name, text, type) {
  const b = new Blob([text], { type }); const u = URL.createObjectURL(b);
  const a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 3000);
}
const csvCell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
function exportCsv(entries, name) {
  const head = ['Titel', 'Jaar', 'Type', 'Lijst', 'Genres', 'Gezien', 'Beoordeling', 'Notitie'];
  const rows = entries.map(e => [e.title, e.year, e.type, (listById(e.list) || {}).name, (e.genres || []).join(' - '), e.seen, e.rating, e.note].map(csvCell).join(';'));
  download(name, '﻿' + [head.map(csvCell).join(';')].concat(rows).join('\r\n'), 'text/csv;charset=utf-8');
}

/* ---------- menu ---------- */
function renderDrawer() {
  const cur = location.hash;
  $('#drawer').innerHTML = '<div class="scrim" data-a="closedrawer"></div><nav class="panel" aria-label="Hoofdmenu"><div class="dh"><span>Filmkast</span></div>' +
    '<a class="di" href="#/beheer">Lijstbeheer</a><div class="sec">Mijn lijsten</div>' +
    S.lists.map(l => '<a class="di' + (cur === '#/l/' + l.id ? ' on' : '') + '" href="#/l/' + l.id + '"><span>' + esc(l.name) + '</span><b>' + count(l.id) + '</b></a>').join('') +
    '<div class="sec">TMDb-lijsten</div>' +
    PUB.map(p => '<a class="di' + (cur === '#/p/' + p.id ? ' on' : '') + '" href="#/p/' + p.id + '">' + esc(p.name) + '</a>').join('') +
    '<div class="sec">App</div><a class="di" href="#/backup">Back-up en herstel</a><a class="di" href="#/instellingen">Instellingen</a><a class="di" href="#/over">Over</a></nav>';
}
const openDrawer = () => { renderDrawer(); requestAnimationFrame(() => $('#drawer').classList.add('open')); };
const closeDrawer = () => $('#drawer').classList.remove('open');

/* ---------- routes ---------- */
const app = $('#app');
let V = {};
let IO = null;
function route() {
  const p = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  closeDrawer(); closeSheet(); if (IO) { IO.disconnect(); IO = null; }
  window.scrollTo(0, 0);
  const views = { l: vList, p: vPublic, e: vEntry, d: vDetail, beheer: vManage, instellingen: vSettings, backup: vBackup, over: vAbout, toevoegen: vAdd, nieuw: vNew };
  const f = views[p[0]];
  if (!f) { location.replace('#/l/' + S.lists[0].id); return; }
  f(p[1], p[2]);
}

/* eigen lijst */
const cmp = {
  title: (a, b) => a.title.replace(/^(the|de|het|een|a|an)\s+/i, '').localeCompare(b.title.replace(/^(the|de|het|een|a|an)\s+/i, ''), 'nl', { sensitivity: 'base', numeric: true }),
  year: (a, b) => (+a.year || 0) - (+b.year || 0),
  added: (a, b) => a.added - b.added,
  rating: (a, b) => (a.rating || 0) - (b.rating || 0),
  seen: (a, b) => (a.seen || '').localeCompare(b.seen || '')
};
function listItems() {
  const f = V.f, q = V.q.trim().toLowerCase();
  let a = S.entries.filter(e => e.list === V.id);
  if (q) a = a.filter(e => (e.title + ' ' + (e.genres || []).join(' ')).toLowerCase().includes(q));
  if (f.seen === 'seen') a = a.filter(e => e.seen);
  if (f.seen === 'unseen') a = a.filter(e => !e.seen);
  if (f.genre) a = a.filter(e => (e.genres || []).includes(f.genre));
  const k = S.settings.sortKey, d = S.settings.sortDir === 'desc' ? -1 : 1;
  a.sort((x, y) => d * (cmp[k] || cmp.title)(x, y) || cmp.title(x, y));
  return a;
}
function vList(id) {
  if (!listById(id)) { location.replace('#/l/' + S.lists[0].id); return; }
  V = { kind: 'list', id, q: '', sq: false, f: { seen: '', genre: '' } };
  renderList();
}
function renderList() {
  const L = listById(V.id), n = count(V.id);
  app.innerHTML = bar({ menu: true, title: L.name, sub: plural(n, 'titel', 'titels'), acts: [['togglesearch', 'search', 'Zoeken'], ['sheetfilter', 'filter', 'Filteren'], ['sheetsort', 'sort', 'Sorteren'], ['sheetmore', 'more', 'Meer']] }) +
    '<div class="tabs" role="tablist"><button role="tab" data-a="view" data-v="list" class="' + (S.settings.view === 'list' ? 'on' : '') + '">Lijst</button><button role="tab" data-a="view" data-v="tiles" class="' + (S.settings.view === 'tiles' ? 'on' : '') + '">Tegels</button></div>' +
    (V.sq ? '<div class="pad" style="padding-top:10px"><input id="q" class="in" type="search" placeholder="Zoek in ' + esc(L.name) + '" value="' + esc(V.q) + '" data-in="q" autocomplete="off"></div>' : '') +
    '<div id="items"></div><button class="fab" data-a="add" aria-label="Titel toevoegen">' + ico('plus') + '</button>';
  fillItems();
  if (V.sq) { const q = $('#q'); q.focus(); }
}
function fillItems() {
  const a = listItems(), f = V.f, active = f.seen || f.genre;
  let h = active ? '<div class="activef"><span>Filter actief</span><button data-a="clearfilter">Wissen</button></div>' : '';
  if (!a.length) {
    const none = count(V.id) === 0;
    h += '<div class="notice"><b>' + (none ? 'Deze lijst is nog leeg' : 'Niets gevonden') + '</b><span>' + (none ? 'Tik op de plusknop om een titel te zoeken en toe te voegen.' : 'Pas je zoekopdracht of filter aan.') + '</span></div>';
  } else if (S.settings.view === 'tiles') h += '<div class="tiles">' + a.map(entryTile).join('') + '</div>';
  else h += '<div class="rows">' + a.map(entryRow).join('') + '</div>';
  $('#items').innerHTML = h;
}

/* TMDb-lijst */
function vPublic(id) {
  const def = PUB.find(p => p.id === id);
  if (!def) { location.replace('#/p/populair'); return; }
  V = { kind: 'pub', def, items: [], page: 0, total: 1, loading: false, q: '', sq: false, err: '' };
  renderPub(); loadMore();
}
function renderPub() {
  app.innerHTML = bar({ menu: true, title: V.def.name, acts: [['togglesearch', 'search', 'Zoeken op TMDb']] }) +
    (V.sq ? '<div class="pad" style="padding-top:10px"><input id="q" class="in" type="search" placeholder="Zoek film of serie op TMDb" value="' + esc(V.q) + '" data-in="pq" autocomplete="off"></div>' : '') +
    '<div id="items"></div>';
  fillPub();
  if (V.sq) $('#q').focus();
}
function fillPub() {
  let h = '';
  if (V.err === 'GEEN_SLEUTEL') h = '<div class="notice"><b>API-sleutel nodig</b><span>Voor TMDb-lijsten heb je een gratis API-sleutel nodig. Vul die in bij Instellingen.</span><a class="btn pri" href="#/instellingen">Naar instellingen</a></div>';
  else {
    if (V.items.length) h += '<div class="rows">' + V.items.map(it => tmdbRow(it)).join('') + '</div>';
    if (V.err) h += '<div class="notice">' + esc(V.err) + '<button class="btn" data-a="retry">Opnieuw proberen</button></div>';
    else if (V.loading) h += '<div class="spin">Laden…</div>';
    else if (!V.items.length) h += '<div class="notice">Geen resultaten.</div>';
    h += '<div id="sent" style="height:1px"></div>';
  }
  $('#items').innerHTML = h;
  if (IO) IO.disconnect();
  const s = $('#sent');
  if (s && 'IntersectionObserver' in window) { IO = new IntersectionObserver(en => { if (en[0].isIntersecting) loadMore(); }, { rootMargin: '600px' }); IO.observe(s); }
}
async function loadMore() {
  const my = V;
  if (my.kind !== 'pub' || my.loading || my.page >= my.total) return;
  my.loading = true; my.err = ''; fillPub();
  try {
    await ensureGenres();
    const q = my.q.trim();
    const d = q ? await api('/search/multi', { query: q, page: my.page + 1, include_adult: 'false' })
      : await api(my.def.path, { page: my.page + 1, region: my.def.region ? S.settings.region : '' });
    if (V !== my) return;
    const res = (d.results || []).filter(r => !q || r.media_type === 'movie' || r.media_type === 'tv').map(r => cache(norm(r, my.def.type)));
    res.forEach(r => { if (!my.items.some(x => x.type === r.type && x.tmdbId === r.tmdbId)) my.items.push(r); });
    my.page = d.page; my.total = d.total_pages;
  } catch (e) { if (V !== my) return; my.err = errMsg(e); }
  my.loading = false; fillPub();
}

/* toevoegen */
function vAdd(listId) {
  const L = listById(listId);
  if (!L) { location.replace('#/l/' + S.lists[0].id); return; }
  V = { kind: 'add', listId, q: '', items: [], err: '', busy: false };
  app.innerHTML = '<header class="bar"><button class="ib" data-a="back" aria-label="Terug">' + ico('back') + '</button><div class="searchbox"><input id="q" class="in plain" type="search" placeholder="Zoek film of serie voor ' + esc(L.name) + '" data-in="aq" autocomplete="off"></div></header><div id="items"></div>';
  fillAdd(); $('#q').focus();
}
function fillAdd() {
  const manual = '<a class="btn ghost" href="#/nieuw/' + V.listId + '">Handmatig toevoegen</a>';
  let h = '';
  if (V.err === 'GEEN_SLEUTEL') h = '<div class="notice"><b>API-sleutel nodig om te zoeken</b><span>Vul je gratis TMDb-sleutel in bij Instellingen, of voeg een titel handmatig toe.</span><a class="btn pri" href="#/instellingen">Naar instellingen</a>' + manual + '</div>';
  else if (V.err) h = '<div class="notice">' + esc(V.err) + '</div>';
  else if (V.q.trim().length < 2) h = '<div class="notice"><span>Typ minstens twee letters om op TMDb te zoeken.</span>' + manual + '</div>';
  else if (V.busy) h = '<div class="spin">Zoeken…</div>';
  else if (!V.items.length) h = '<div class="notice"><b>Niets gevonden</b>' + manual + '</div>';
  else h = '<div class="rows">' + V.items.map(it => tmdbRow(it, V.listId)).join('') + '</div><div class="pad" style="padding-bottom:40px">' + manual + '</div>';
  $('#items').innerHTML = h;
}
let addT;
function addSearch() {
  clearTimeout(addT);
  const my = V, q = V.q.trim();
  if (q.length < 2) { V.items = []; V.err = ''; V.busy = false; fillAdd(); return; }
  V.busy = true; fillAdd();
  addT = setTimeout(async () => {
    try {
      await ensureGenres();
      const d = await api('/search/multi', { query: q, include_adult: 'false' });
      if (V !== my) return;
      my.items = (d.results || []).filter(r => r.media_type === 'movie' || r.media_type === 'tv').map(r => cache(norm(r))); my.err = '';
    } catch (e) { if (V !== my) return; my.err = errMsg(e); }
    my.busy = false; fillAdd();
  }, 400);
}

/* handmatig toevoegen */
function vNew(listId) {
  const L = listById(listId);
  if (!L) { location.replace('#/l/' + S.lists[0].id); return; }
  V = { kind: 'new', listId };
  app.innerHTML = bar({ title: 'Handmatig toevoegen', sub: L.name }) +
    '<div class="panel2">' +
    '<label class="fld">Soort<select id="n-type" class="in"><option value="movie"' + (L.kind === 'tv' ? '' : ' selected') + '>Film</option><option value="tv"' + (L.kind === 'tv' ? ' selected' : '') + '>Serie</option></select></label>' +
    '<label class="fld">Titel<input id="n-title" class="in" autocomplete="off"></label>' +
    '<label class="fld">Jaar<input id="n-year" class="in" inputmode="numeric" maxlength="4"></label>' +
    '<label class="fld">Genre (optioneel)<input id="n-sub" class="in" autocomplete="off"></label>' +
    '<button class="btn pri" data-a="savenew">Opslaan</button></div>';
}

/* detail */
function vEntry(id) {
  const e = S.entries.find(x => x.id === id);
  if (!e) { location.replace('#/l/' + S.lists[0].id); return; }
  V = { kind: 'det', type: e.type, tmdbId: e.tmdbId, entryId: e.id, err: '' };
  fillDetail();
  if (e.tmdbId && (S.settings.apiKey || BAKED_KEY || '').trim()) enrich(V);
}
function vDetail(type, id) {
  V = { kind: 'det', type, tmdbId: +id, entryId: '', err: '' };
  fillDetail();
  if (!CACHE[type + '-' + id] || !CACHE[type + '-' + id].runtime) enrich(V);
}
async function enrich(my) {
  try {
    await ensureGenres();
    const d = await api('/' + my.type + '/' + my.tmdbId);
    if (V !== my) return;
    const it = norm(d, my.type), k = my.type + '-' + my.tmdbId;
    CACHE[k] = Object.assign(CACHE[k] || {}, it);
    const e = my.entryId && S.entries.find(x => x.id === my.entryId);
    if (e) {
      let ch = false;
      if (!e.overview && it.overview) { e.overview = it.overview; ch = true; }
      if (!(e.genres || []).length && it.genres.length) { e.genres = it.genres; ch = true; }
      if (!e.poster && it.poster) { e.poster = it.poster; ch = true; }
      if (!e.rating && it.rating) { e.rating = it.rating; ch = true; }
      if (ch) save();
    }
  } catch (e) { if (V !== my) return; my.err = errMsg(e); }
  fillDetail();
}
function fillDetail() {
  const e = V.entryId ? S.entries.find(x => x.id === V.entryId) : null;
  if (V.entryId && !e) { location.replace('#/l/' + S.lists[0].id); return; }
  const c = V.tmdbId ? (CACHE[V.type + '-' + V.tmdbId] || {}) : {};
  const g = f => (e && e[f] && (!Array.isArray(e[f]) || e[f].length)) ? e[f] : (c[f] || (f === 'genres' ? [] : ''));
  const title = g('title');
  if (!title) {
    app.innerHTML = bar({ title: 'Titel' }) + (V.err && V.err !== 'GEEN_SLEUTEL' ? '<div class="notice">' + esc(V.err) + '</div>' :
      V.err ? '<div class="notice"><b>API-sleutel nodig</b><span>Vul je TMDb-sleutel in bij Instellingen om deze titel te laden.</span><a class="btn pri" href="#/instellingen">Naar instellingen</a></div>' : '<div class="spin">Laden…</div>');
    return;
  }
  const meta = [g('year'), c.runtime ? c.runtime + ' min' : '', c.seasons ? plural(c.seasons, 'seizoen', 'seizoenen') : '', g('rating') ? '★ ' + g('rating') : ''].filter(Boolean).join(' · ');
  let h = bar({ title: V.type === 'tv' ? 'Serie' : 'Film' }) +
    '<div class="hero">' + posterHtml({ poster: g('poster'), type: V.type }, 'w342') + '<div><h1>' + esc(title) + '</h1><div class="meta">' + esc(meta) + '</div>' +
    ((g('genres') || []).length ? '<div class="chips">' + g('genres').map(x => '<span class="chip">' + esc(x) + '</span>').join('') + '</div>' : '') +
    '</div></div>';
  if (c.tagline) h += '<p class="over small" style="font-style:italic">' + esc(c.tagline) + '</p>';
  if (g('overview')) h += '<p class="over">' + esc(g('overview')) + '</p>';
  if (V.err && V.err !== 'GEEN_SLEUTEL') h += '<p class="over small">' + esc(V.err) + '</p>';
  if (e) {
    h += '<section class="panel2"><h2>In mijn collectie</h2>' +
      '<label class="fld">Lijst<select id="e-list" class="in" data-in="elist">' + S.lists.map(l => '<option value="' + l.id + '"' + (l.id === e.list ? ' selected' : '') + '>' + esc(l.name) + '</option>').join('') + '</select></label>' +
      '<label class="chk"><input type="checkbox" data-in="eseen"' + (e.seen ? ' checked' : '') + '> Gezien</label>' +
      (e.seen ? '<label class="fld">Datum gezien<input type="date" class="in" value="' + esc(e.seen) + '" max="' + today() + '" data-in="edate"></label>' : '') +
      '<label class="fld">Notitie<textarea class="in" data-in="enote" placeholder="Bijvoorbeeld: wil ik met Sam kijken">' + esc(e.note) + '</textarea></label>' +
      '<button class="btn bad" data-a="delentry">Verwijderen uit collectie</button></section>';
  } else {
    const own = S.entries.filter(x => x.type === V.type && x.tmdbId === V.tmdbId);
    if (own.length) h += '<p class="over small">Staat al in: ' + own.map(x => '<a class="link" href="#/e/' + x.id + '">' + esc((listById(x.list) || {}).name) + '</a>').join(', ') + '</p>';
    h += '<section class="panel2"><h2>Toevoegen aan</h2><div class="stack">' + S.lists.map(l => {
      const has = own.some(x => x.list === l.id);
      return '<button class="btn wide ' + (has ? 'ghost' : '') + '" data-a="pickdetail" data-l="' + l.id + '"' + (has ? ' disabled' : '') + '>' + esc(l.name) + (has ? ' · staat al in lijst' : '') + '</button>';
    }).join('') + '</div></section>';
  }
  app.innerHTML = h;
}

/* lijstbeheer */
function vManage() {
  V = { kind: 'manage' };
  app.innerHTML = bar({ title: 'Lijstbeheer' }) + '<section class="panel2"><h2>Mijn lijsten</h2>' +
    S.lists.map(l => '<div class="lrow"><input class="in" value="' + esc(l.name) + '" data-in="rename" data-l="' + l.id + '" aria-label="Naam van lijst"><b>' + count(l.id) + '</b><button class="btn bad sm" data-a="dellist" data-l="' + l.id + '">Wis</button></div>').join('') +
    '</section><section class="panel2"><h2>Nieuwe lijst</h2><input id="nl" class="in" placeholder="Naam van de lijst" autocomplete="off"><button class="btn pri" data-a="addlist">Lijst toevoegen</button></section>';
}

/* back-up */
function vBackup() {
  V = { kind: 'backup' };
  app.innerHTML = bar({ title: 'Back-up en herstel' }) +
    '<section class="panel2"><h2>Back-up maken</h2><p class="small" style="margin:0">Bewaart al je lijsten en titels in één bestand. Je API-sleutel zit er niet in.</p>' +
    '<button class="btn pri" data-a="export">Back-up opslaan (' + plural(S.entries.length, 'titel', 'titels') + ')</button>' +
    '<button class="btn" data-a="exportcsv">Alles als CSV voor Excel</button></section>' +
    '<section class="panel2"><h2>Back-up terugzetten</h2><p class="small" style="margin:0">Kies een eerder opgeslagen back-up (.json). Je kiest daarna of je samenvoegt of vervangt.</p>' +
    '<label class="btn" for="imp">Bestand kiezen</label><input id="imp" type="file" accept=".json,application/json" data-in="import" hidden></section>';
}
let PENDING = null;
function readImport(file) {
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const d = JSON.parse(fr.result);
      if (!d || !Array.isArray(d.entries)) throw new Error('x');
      const skip = (Array.isArray(d.lists) ? d.lists : []).filter(l => l && l.kind === 'music').map(l => String(l.id));
      const entries = d.entries.filter(x => x && typeof x.title === 'string' && x.type !== 'music' && !skip.includes(String(x.list))).map(x => ({
        id: x.id || uid(), list: String(x.list || ''), type: x.type === 'tv' ? 'tv' : 'movie', tmdbId: +x.tmdbId || 0,
        title: x.title, year: String(x.year || ''), poster: String(x.poster || ''), overview: String(x.overview || ''), rating: +x.rating || 0,
        genres: Array.isArray(x.genres) ? x.genres.map(String) : [], seen: String(x.seen || ''),
        note: String(x.note || ''), added: +x.added || Date.now()
      }));
      const lists = Array.isArray(d.lists) ? d.lists.filter(l => l && l.id && l.name && l.kind !== 'music').map(l => ({ id: String(l.id), name: String(l.name), kind: l.kind })) : [];
      PENDING = { entries, lists };
      openSheet('<h3>Back-up gevonden</h3><p>' + plural(entries.length, 'titel', 'titels') + ' in ' + plural(lists.length || 0, 'lijst', 'lijsten') + '.</p>' +
        '<div class="stack"><button class="btn pri" data-a="doimport" data-m="merge">Samenvoegen met wat ik heb</button><button class="btn bad" data-a="doimport" data-m="replace">Alles vervangen</button><button class="btn ghost" data-a="closesheet">Annuleren</button></div>');
    } catch (err) { toast('Dit bestand is geen geldige back-up'); }
  };
  fr.readAsText(file);
}
function doImport(mode) {
  if (!PENDING) return;
  const P = PENDING; PENDING = null;
  if (mode === 'replace') {
    if (P.lists.length) S.lists = P.lists;
    S.entries = [];
  } else P.lists.forEach(l => { if (!listById(l.id)) S.lists.push(l); });
  let added = 0;
  P.entries.forEach(x => {
    if (!listById(x.list)) x.list = S.lists[0].id;
    const dup = S.entries.some(e => e.id === x.id || (e.list === x.list && e.type === x.type && (x.tmdbId ? e.tmdbId === x.tmdbId : e.title === x.title && e.year === x.year)));
    if (!dup) { S.entries.push(x); added++; }
  });
  save(); closeSheet(); toast(plural(added, 'titel', 'titels') + ' hersteld'); vBackup();
}

/* instellingen */
function vSettings() {
  V = { kind: 'settings' };
  const s = S.settings;
  app.innerHTML = bar({ title: 'Instellingen' }) +
    '<section class="panel2"><h2>Algemeen</h2>' +
    (BAKED_KEY ? '<p class="small" style="margin:0">Er is al een sleutel in de app ingebouwd. Hieronder invullen is niet nodig.</p>' : '') + '<label class="fld">TMDb API-sleutel<input id="apikey" class="in" value="' + esc(s.apiKey) + '" data-in="apikey" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Plak hier je sleutel"></label>' +
    '<p class="small" style="margin:0">Gratis aan te vragen op <a class="link" href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener">themoviedb.org/settings/api</a>. Zowel de korte API-sleutel (v3) als de lange toegangstoken (v4) werkt.</p>' +
    '<button class="btn" data-a="testkey">Sleutel testen</button>' +
    '<label class="fld">Taal van titels en beschrijvingen<select class="in" data-in="lang">' + [['nl-NL', 'Nederlands'], ['en-US', 'English']].map(o => '<option value="' + o[0] + '"' + (s.lang === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label>' +
    '<label class="fld">Regio voor bioscooplijsten<select class="in" data-in="region">' + [['NL', 'Nederland'], ['BE', 'België'], ['DE', 'Duitsland'], ['GB', 'Verenigd Koninkrijk'], ['US', 'Verenigde Staten']].map(o => '<option value="' + o[0] + '"' + (s.region === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label></section>' +
    '<section class="panel2"><h2>Sorteren</h2>' + sortFields() + '</section>' +
    '<section class="panel2"><h2>Uiterlijk</h2><div class="fld">Accentkleur</div><div class="sw">' + ACCENTS.map(a => '<button style="background:' + a + '" class="' + (s.accent === a ? 'on' : '') + '" data-a="accent" data-c="' + a + '" aria-label="Kleur ' + a + '"></button>').join('') + '</div></section>' +
    '<section class="panel2"><h2>Info</h2><a class="link" href="#/over">Over Filmkast</a></section>';
}
function sortFields() {
  const s = S.settings;
  return '<label class="fld">Sorteren op<select class="in" data-in="sortkey">' + SORTS.map(o => '<option value="' + o[0] + '"' + (s.sortKey === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label>' +
    '<label class="fld">Volgorde<select class="in" data-in="sortdir"><option value="asc"' + (s.sortDir === 'asc' ? ' selected' : '') + '>Oplopend</option><option value="desc"' + (s.sortDir === 'desc' ? ' selected' : '') + '>Aflopend</option></select></label>';
}
function vAbout() {
  V = { kind: 'about' };
  app.innerHTML = bar({ title: 'Over Filmkast' }) + '<section class="panel2"><h2>Filmkast 1.0</h2>' +
    '<p style="margin:0">Je eigen film- en seriecollectie. Alles wat je invult blijft op dit apparaat. Alleen zoekopdrachten en lijsten gaan naar TMDb.</p>' +
    '<p style="margin:0" class="small">Deze app gebruikt de TMDb API, maar is niet goedgekeurd of gecertificeerd door TMDb. Filmgegevens en posters komen van TMDb.</p></section>';
}

/* bladen */
function sheetSort() {
  const s = S.settings;
  openSheet('<h3>Sorteren</h3><div class="stack">' + SORTS.map(o => '<button class="opt' + (s.sortKey === o[0] ? ' on' : '') + '" data-a="setsort" data-k="' + o[0] + '">' + o[1] + '</button>').join('') + '</div>' +
    '<div class="cols"><button class="opt' + (s.sortDir === 'asc' ? ' on' : '') + '" data-a="setdir" data-d="asc">Oplopend</button><button class="opt' + (s.sortDir === 'desc' ? ' on' : '') + '" data-a="setdir" data-d="desc">Aflopend</button></div>');
}
function sheetFilter() {
  const genres = [...new Set(S.entries.filter(e => e.list === V.id).flatMap(e => e.genres || []))].sort((a, b) => a.localeCompare(b, 'nl'));
  const f = V.f;
  openSheet('<h3>Filteren</h3>' +
    '<label class="fld">Gezien<select class="in" data-in="fseen"><option value="">Alles</option><option value="seen"' + (f.seen === 'seen' ? ' selected' : '') + '>Gezien</option><option value="unseen"' + (f.seen === 'unseen' ? ' selected' : '') + '>Nog niet gezien</option></select></label>' +
    '<label class="fld">Genre<select class="in" data-in="fgenre"><option value="">Alle genres</option>' + genres.map(x => '<option' + (f.genre === x ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></label>' +
    '<div class="cols"><button class="btn ghost" data-a="clearfilter">Wissen</button><button class="btn pri" data-a="closesheet">Klaar</button></div>');
}
function sheetMore() {
  openSheet('<h3>' + esc(listById(V.id).name) + '</h3><div class="stack"><button class="opt" data-a="exportlist">Deze lijst als CSV opslaan</button><a class="opt" href="#/beheer" style="text-decoration:none">Lijsten beheren</a><button class="opt" data-a="clearlist" style="color:var(--bad)">Lijst leegmaken</button></div>');
}
function sheetPick(k) {
  const it = CACHE[k]; if (!it) return;
  openSheet('<h3>Toevoegen aan</h3><div class="stack">' + S.lists.map(l => {
    const has = S.entries.some(e => e.list === l.id && e.type === it.type && e.tmdbId === it.tmdbId);
    return '<button class="btn wide ' + (has ? 'ghost' : '') + '" data-a="pick" data-k="' + k + '" data-l="' + l.id + '"' + (has ? ' disabled' : '') + '>' + esc(l.name) + (has ? ' · staat al in lijst' : '') + '</button>';
  }).join('') + '</div>');
}
function refreshRows() { if (V.kind === 'add') fillAdd(); else if (V.kind === 'pub') fillPub(); }

/* ---------- gebeurtenissen ---------- */
const A = {
  drawer: openDrawer, closedrawer: closeDrawer, closesheet: closeSheet,
  back: () => { if (history.length > 1) history.back(); else location.hash = '#/l/' + S.lists[0].id; },
  confirmok: () => { const f = CONFIRM; CONFIRM = null; closeSheet(); if (f) f(); },
  view: (d) => { S.settings.view = d.v; save(); renderList(); },
  togglesearch: () => { V.sq = !V.sq; if (!V.sq) { V.q = ''; if (V.kind === 'pub') { pubSearchReset(); return; } } if (V.kind === 'pub') renderPub(); else renderList(); },
  sheetfilter: sheetFilter, sheetsort: sheetSort, sheetmore: sheetMore,
  clearfilter: () => { V.f = { seen: '', genre: '' }; closeSheet(); fillItems(); },
  setsort: d => { S.settings.sortKey = d.k; save(); sheetSort(); if (V.kind === 'list') fillItems(); },
  setdir: d => { S.settings.sortDir = d.d; save(); sheetSort(); if (V.kind === 'list') fillItems(); },
  add: () => { location.hash = '#/toevoegen/' + V.id; },
  addres: d => {
    if (V.kind === 'add') { const e = addEntry(CACHE[d.k], V.listId); if (e) { toast('Toegevoegd aan ' + listById(V.listId).name); refreshRows(); } } else sheetPick(d.k);
  },
  pick: d => { const e = addEntry(CACHE[d.k], d.l); if (e) { toast('Toegevoegd aan ' + listById(d.l).name); closeSheet(); refreshRows(); } },
  pickdetail: d => { const e = addEntry(CACHE[V.type + '-' + V.tmdbId], d.l); if (e) { toast('Toegevoegd aan ' + listById(d.l).name); location.replace('#/e/' + e.id); } },
  retry: () => { V.err = ''; loadMore(); },
  savenew: () => {
    const title = $('#n-title').value.trim();
    if (!title) { toast('Vul een titel in'); return; }
    const sub = $('#n-sub').value.trim();
    const e = addEntry({ type: $('#n-type').value, title, year: $('#n-year').value.trim(), genres: sub ? [sub] : [] }, V.listId);
    if (e) location.replace('#/e/' + e.id);
  },
  delentry: () => confirmSheet('Deze titel wordt uit je collectie verwijderd.', 'Verwijderen', () => {
    const e = S.entries.find(x => x.id === V.entryId); const lid = e ? e.list : S.lists[0].id;
    S.entries = S.entries.filter(x => x.id !== V.entryId); save(); toast('Verwijderd'); location.replace('#/l/' + lid);
  }),
  addlist: () => { const n = $('#nl').value.trim(); if (!n) { toast('Geef de lijst een naam'); return; } S.lists.push({ id: uid(), name: n }); save(); vManage(); toast('Lijst toegevoegd'); },
  dellist: d => {
    if (S.lists.length < 2) { toast('Je hebt minstens één lijst nodig'); return; }
    const l = listById(d.l);
    confirmSheet('Lijst "' + l.name + '" en de ' + plural(count(l.id), 'titel', 'titels') + ' erin worden verwijderd.', 'Verwijderen', () => {
      S.entries = S.entries.filter(e => e.list !== l.id); S.lists = S.lists.filter(x => x.id !== l.id); save(); vManage();
    });
  },
  exportlist: () => { closeSheet(); exportCsv(listItems(), 'filmkast-' + listById(V.id).name.toLowerCase().replace(/\W+/g, '-') + '.csv'); },
  clearlist: () => confirmSheet('Alle titels in "' + listById(V.id).name + '" worden verwijderd.', 'Leegmaken', () => {
    S.entries = S.entries.filter(e => e.list !== V.id); save(); renderList(); toast('Lijst geleegd');
  }),
  export: () => {
    const out = { app: 'filmkast', v: 1, saved: new Date().toISOString(), lists: S.lists, entries: S.entries };
    download('filmkast-backup-' + today() + '.json', JSON.stringify(out), 'application/json');
  },
  exportcsv: () => exportCsv(S.entries, 'filmkast-alles-' + today() + '.csv'),
  doimport: d => doImport(d.m),
  accent: d => { S.settings.accent = d.c; save(); applyAccent(); vSettings(); },
  testkey: async () => {
    try { await api('/configuration'); toast('De sleutel werkt'); } catch (e) { const m = errMsg(e); toast(m === 'GEEN_SLEUTEL' ? 'Vul eerst een sleutel in' : m); }
  }
};
function pubSearchReset() { V.items = []; V.page = 0; V.total = 1; V.err = ''; renderPub(); loadMore(); }
let pubT;
const IN = {
  q: el => { V.q = el.value; fillItems(); },
  pq: el => {
    V.q = el.value; clearTimeout(pubT);
    pubT = setTimeout(() => { V.items = []; V.page = 0; V.total = 1; V.err = ''; loadMore(); }, 450);
  },
  aq: el => { V.q = el.value; addSearch(); },
  fseen: el => { V.f.seen = el.value; fillItems(); },
  fgenre: el => { V.f.genre = el.value; fillItems(); },
  elist: el => { const e = S.entries.find(x => x.id === V.entryId); if (e) { e.list = el.value; save(); toast('Verplaatst naar ' + listById(el.value).name); } },
  eseen: el => { const e = S.entries.find(x => x.id === V.entryId); if (e) { e.seen = el.checked ? today() : ''; save(); fillDetail(); } },
  edate: el => { const e = S.entries.find(x => x.id === V.entryId); if (e && el.value) { e.seen = el.value; save(); } },
  enote: el => { const e = S.entries.find(x => x.id === V.entryId); if (e) { e.note = el.value; save(); } },
  rename: el => { const l = listById(el.dataset.l); if (l && el.value.trim()) { l.name = el.value.trim(); save(); } },
  apikey: el => { S.settings.apiKey = el.value.trim(); save(); },
  lang: el => { S.settings.lang = el.value; S.genres = { movie: {}, tv: {} }; save(); },
  region: el => { S.settings.region = el.value; save(); },
  sortkey: el => { S.settings.sortKey = el.value; save(); },
  sortdir: el => { S.settings.sortDir = el.value; save(); },
  import: el => { const f = el.files && el.files[0]; if (f) readImport(f); el.value = ''; }
};
document.addEventListener('click', ev => {
  const a = ev.target.closest('[data-a]');
  if (!a || a.disabled) return;
  const f = A[a.dataset.a];
  if (f) f(a.dataset, a, ev);
});
document.addEventListener('input', ev => {
  const el = ev.target.closest('[data-in]');
  if (el && IN[el.dataset.in]) IN[el.dataset.in](el);
});
window.addEventListener('hashchange', route);
function applyAccent() { document.documentElement.style.setProperty('--acc', S.settings.accent); }
applyAccent();
if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) navigator.serviceWorker.register('sw.js').catch(() => { });
route();
