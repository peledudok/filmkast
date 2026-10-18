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
const PLAT = [['bios', 'Bios'], ['netflix', 'Netflix'], ['sky', 'SkyShowtime'], ['hbo', 'HBO Max'], ['prime', 'Prime Video'], ['npo', 'NPO Start'], ['vl', 'Videoland'], ['disney', 'Disney+'], ['apple', 'Apple TV'], ['pathe', 'Pathé'], ['oscar', 'Oscar'], ['globe', 'Golden Globe'], ['grammy', 'Grammy']];
const ACCENTS = ['#e0a458', '#7fc8bd', '#8fb4ff', '#d98b9b', '#a9d36b'];

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const fmtDate = s => { if (!s) return ''; if (!/^\d{4}-/.test(s)) return 'datum onbekend'; const d = new Date(s + 'T00:00:00'); return isNaN(d) ? s : d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, ''); };
const isoOf = ts => { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const ago = ts => {
  const days = Math.max(0, Math.floor((Date.now() - ts) / 864e5));
  if (days < 1) return 'vandaag';
  if (days < 14) return plural(days, 'dag', 'dagen');
  if (days < 60) return plural(Math.floor(days / 7), 'week', 'weken');
  if (days < 730) return plural(Math.floor(days / 30), 'maand', 'maanden');
  return plural(Math.floor(days / 365), 'jaar', 'jaar');
};
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
  genres: { movie: {}, tv: {} },
  del: {},
  delLists: {}
});
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && Array.isArray(d.entries) && Array.isArray(d.lists) && d.lists.length) {
      d.settings = Object.assign(DEF().settings, d.settings || {});
      d.genres = d.genres || { movie: {}, tv: {} };
      d.del = d.del || {};
      d.delLists = d.delLists || {};
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
function commit() { save(); scheduleSync(); }
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
    seen: '', note: '', tags: [], sn: [], where: [], ns: false, why: '', added: Date.now(), u: Date.now()
  };
  S.entries.push(e); commit(); return e;
}

/* ---------- weergave-hulpjes ---------- */
const I = {
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  filter: '<path d="M3 5h18M6 12h12M10 19h4"/>',
  sort: '<path d="M3 6h18M3 12h12M3 18h6"/>',
  more: '<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>',
  back: '<path d="M19 12H5m6-6-6 6 6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>'
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
    (e.seen ? '<div class="seen">Gezien: ' + fmtDate(e.seen) + '</div>' : '') +
    (e.list === 'wish' && e.added ? '<div class="since">Op lijst sinds ' + fmtDate(isoOf(e.added)) + ' · ' + ago(e.added) + '</div>' : '') + '</div></a>';
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
  const head = ['Titel', 'Jaar', 'Type', 'Lijst', 'Genres', 'Gezien', 'Beoordeling', 'Notitie', 'Tags', 'Waar', 'Niet gezien', 'Reden'];
  const rows = entries.map(e => [e.title, e.year, e.type, (listById(e.list) || {}).name, (e.genres || []).join(' - '), e.seen, e.rating, e.note, (e.tags || []).join(', '), (e.where || []).map(k => (PLAT.find(q => q[0] === k) || [])[1]).join(', '), e.ns ? 'ja' : '', e.why || ''].map(csvCell).join(';'));
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
  const views = { l: vList, p: vPublic, e: vEntry, d: vDetail, beheer: vManage, instellingen: vSettings, backup: vBackup, over: vAbout, toevoegen: vAdd, nieuw: vNew, c: vCollection, s: vSeason, import: vImport };
  const f = views[p[0]];
  if (!f) { location.replace('#/l/' + S.lists[0].id); return; }
  f(p[1], p[2], p[3]);
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
  if (q) a = a.filter(e => (e.title + ' ' + (e.genres || []).join(' ') + ' ' + (e.tags || []).join(' ')).toLowerCase().includes(q));
  if (f.seen === 'seen') a = a.filter(e => e.seen);
  if (f.seen === 'unseen') a = a.filter(e => !e.seen);
  if (f.genre) a = a.filter(e => (e.genres || []).includes(f.genre));
  if (f.tag) a = a.filter(e => (e.tags || []).includes(f.tag));
  if (f.plat) a = a.filter(e => (e.where || []).includes(f.plat));
  if (f.seen === 'ns') a = a.filter(e => e.ns);
  const k = S.settings.sortKey, d = S.settings.sortDir === 'desc' ? -1 : 1;
  a.sort((x, y) => d * (cmp[k] || cmp.title)(x, y) || cmp.title(x, y));
  return a;
}
function vList(id) {
  if (!listById(id)) { location.replace('#/l/' + S.lists[0].id); return; }
  V = { kind: 'list', id, q: '', sq: false, f: { seen: '', genre: '', tag: '', plat: '' } };
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
  const a = listItems(), f = V.f, active = f.seen || f.genre || f.tag || f.plat;
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
const hasKey = () => !!(S.settings.apiKey || BAKED_KEY || '').trim();
const money = n => n ? new Intl.NumberFormat('nl-NL').format(n) + ' USD' : '--';
const dsec = (label, html) => '<section class="dsec"><h2>' + label + '</h2><div class="dv">' + html + '</div></section>';
const dsec2 = (l1, v1, l2, v2) => '<section class="dsec two"><div><h2>' + l1 + '</h2><div class="dv">' + v1 + '</div></div><div><h2>' + l2 + '</h2><div class="dv">' + v2 + '</div></div></section>';

function vEntry(id) {
  const e = S.entries.find(x => x.id === id);
  if (!e) { location.replace('#/l/' + S.lists[0].id); return; }
  V = { kind: 'det', type: e.type, tmdbId: e.tmdbId, entryId: e.id, err: '' };
  fillDetail();
  if (e.tmdbId && !(e.d && 'ss' in e.d && e.d.altv === 2) && hasKey()) enrich(V);
}
function vDetail(type, id) {
  V = { kind: 'det', type, tmdbId: +id, entryId: '', err: '' };
  fillDetail();
  const c = CACHE[type + '-' + id];
  if (!(c && c.d && 'ss' in c.d)) enrich(V);
}
const seasonsOf = (e, d) => (e && Array.isArray(e.seasons)) ? e.seasons : ((d && d.ss) || []);
function certOf(d, type) {
  const reg = S.settings.region;
  if (type === 'movie') {
    const rs = (d.release_dates && d.release_dates.results) || [];
    for (const code of [reg, 'US']) {
      const r = rs.find(x => x.iso_3166_1 === code);
      const c = r && r.release_dates.map(x => x.certification).find(Boolean);
      if (c) return c;
    }
    return '';
  }
  const rs = (d.content_ratings && d.content_ratings.results) || [];
  for (const code of [reg, 'US']) { const r = rs.find(x => x.iso_3166_1 === code); if (r && r.rating) return r.rating; }
  return '';
}
const countryName = iso => { try { return new Intl.DisplayNames([S.settings.lang], { type: 'region' }).of(iso); } catch (e) { return iso; } };
function compact(d, type) {
  const cr = d.credits || {};
  const crew = cr.crew || [];
  const prod = [...new Set(crew.filter(p => p.job === 'Producer').map(p => p.name))].slice(0, 6);
  const vids = ((d.videos && d.videos.results) || []).filter(v => v.site === 'YouTube' && v.type === 'Trailer');
  const tr = vids.find(v => v.official) || vids[0];
  const col = d.belongs_to_collection;
  const alt = ((d.alternative_titles && (d.alternative_titles.titles || d.alternative_titles.results)) || []).filter(x => ['NL', 'BE', 'US', 'GB', 'DE', 'FR'].includes(x.iso_3166_1) && /^[\u0020-\u024F]+$/.test(x.title || '')).map(x => x.title).filter(Boolean);
  return {
    altv: 2,
    ss: (d.seasons || []).filter(x => x.season_number > 0).map(x => ({ n: x.season_number, name: x.name || '', poster: x.poster_path || '', eps: x.episode_count || 0, date: x.air_date || '' })),
    orig: d.original_title || d.original_name || '', alt: [...new Set(alt)].slice(0, 8),
    tagline: d.tagline || '', release: d.release_date || d.first_air_date || '',
    runtime: d.runtime || (d.episode_run_time && d.episode_run_time[0]) || 0,
    seasons: d.number_of_seasons || 0, episodes: d.number_of_episodes || 0, status: d.status || '', cert: certOf(d, type),
    backdrop: d.backdrop_path || '', votes: d.vote_count || 0,
    cast: (cr.cast || []).slice(0, 15).map(p => ({ n: p.name, c: p.character || '', p: p.profile_path || '' })),
    producers: prod, creators: (d.created_by || []).map(x => x.name), networks: (d.networks || []).map(x => x.name),
    companies: (d.production_companies || []).map(x => x.name),
    countries: (d.production_countries || []).map(x => countryName(x.iso_3166_1)),
    budget: d.budget || 0, revenue: d.revenue || 0,
    collection: col ? { id: col.id, name: col.name, backdrop: col.backdrop_path || '' } : null,
    trailer: tr ? tr.key : '', imdb: d.imdb_id || (d.external_ids && d.external_ids.imdb_id) || ''
  };
}
async function enrich(my) {
  try {
    await ensureGenres();
    const extra = my.type === 'movie' ? 'credits,release_dates,videos,alternative_titles' : 'credits,content_ratings,videos,external_ids,alternative_titles';
    const d = await api('/' + my.type + '/' + my.tmdbId, { append_to_response: extra, include_video_language: 'nl,en,null' });
    if (V !== my) return;
    const it = norm(d, my.type), k = my.type + '-' + my.tmdbId;
    it.d = compact(d, my.type);
    CACHE[k] = Object.assign(CACHE[k] || {}, it);
    const e = my.entryId && S.entries.find(x => x.id === my.entryId);
    if (e) {
      if (!e.overview && it.overview) e.overview = it.overview;
      if (!(e.genres || []).length && it.genres.length) e.genres = it.genres;
      if (!e.poster && it.poster) e.poster = it.poster;
      if (!e.rating && it.rating) e.rating = it.rating;
      e.d = it.d; save();
    }
  } catch (err) { if (V !== my) return; my.err = errMsg(err); }
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
  const d = (e && e.d) || c.d || null;
  const poster = posterHtml({ poster: g('poster'), type: V.type }, 'w342');
  const playSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg>';
  const posterBlock = d && d.trailer
    ? '<a class="pwrap" href="https://www.youtube.com/watch?v=' + esc(d.trailer) + '" target="_blank" rel="noopener" aria-label="Trailer bekijken">' + poster + '<span class="play">' + playSvg + '</span></a>'
    : poster;
  const rating = g('rating');
  let h = '<div class="dhero">' + (d && d.backdrop ? '<img alt="" src="' + IMG + 'w780' + esc(d.backdrop) + '">' : '') +
    '<div class="dtop"><div class="dl"><button class="ib glass" data-a="back" aria-label="Terug">' + ico('back') + '</button><button class="ib glass" data-a="drawer" aria-label="Lijsten">' + ico('menu') + '</button></div>' +
    (V.tmdbId ? '<button class="ib glass" data-a="share" aria-label="Delen">' + ico('share') + '</button>' : '') + '</div></div>' +
    '<div class="dmain">' + posterBlock + '<div class="dside">' +
    (d && d.cert ? '<span class="cert">' + esc(d.cert) + '</span>' : '') +
    (rating ? '<a class="score" href="https://www.themoviedb.org/' + V.type + '/' + V.tmdbId + '" target="_blank" rel="noopener" aria-label="Open op TMDb"><b>' + Number(rating).toFixed(1).replace('.', ',') + '</b><small>TMDb ›</small></a>' : '') +
    (d && d.imdb ? '<a class="btn sm" href="https://www.imdb.com/title/' + esc(d.imdb) + '/" target="_blank" rel="noopener">IMDb</a>' : '') +
    '</div></div><h1 class="dtitle">' + esc(title) + '</h1>';
  if (d && d.orig && d.orig.toLowerCase() !== String(title).toLowerCase()) h += '<p class="over otitle">(' + esc(d.orig) + ')</p>';
  const tag = (d && d.tagline) || c.tagline;
  if (tag) h += '<p class="over small" style="font-style:italic;margin-top:0">' + esc(tag) + '</p>';
  if (V.err && V.err !== 'GEEN_SLEUTEL') h += '<p class="over small">' + esc(V.err) + '</p>';
  if (e) {
    h += '<section class="panel2 pcoll"><h2>In mijn collectie</h2>' +
      '<label class="fld">Lijst<select id="e-list" class="in" data-in="elist">' + S.lists.filter(l => l.id === e.list || !((e.type === 'tv' && l.id === 'movies') || (e.type === 'movie' && l.id === 'tv'))).map(l => '<option value="' + l.id + '"' + (l.id === e.list ? ' selected' : '') + '>' + esc(l.name) + '</option>').join('') + '</select></label>' +
      '<div class="chkrow"><label class="chk"><input type="checkbox" data-in="eseen"' + (e.seen ? ' checked' : '') + '> Gezien</label>' +
      '<label class="chk"><input type="checkbox" data-in="ens"' + (e.ns ? ' checked' : '') + '> Niet gezien</label></div>' +
      (e.ns ? '<label class="fld">Waarom niet gezien?<input class="in" data-in="ewhy" value="' + esc(e.why || '') + '" placeholder="Bijvoorbeeld: geen interesse, te eng"></label>' : '') +
      (e.seen ? '<label class="fld">Datum gezien<input type="date" class="in" value="' + esc(/^\d{4}-/.test(e.seen) ? e.seen : '') + '" max="' + today() + '" data-in="edate"></label>' : '') +
      '<div class="fold"><button class="foldh" data-a="toggletags" aria-expanded="' + (V.tagsOpen ? 'true' : 'false') + '"><span>Tags</span><small>' +
      esc((e.where || []).map(k => (PLAT.find(q => q[0] === k) || [])[1]).filter(Boolean).join(', ') || 'Geen gekozen') + '</small><i>' + (V.tagsOpen ? '▴' : '▾') + '</i></button>' +
      (V.tagsOpen ? '<div class="foldb"><div class="chkrow">' + PLAT.map(q => '<label class="chk"><input type="checkbox" data-in="eplat" data-k="' + q[0] + '"' + ((e.where || []).includes(q[0]) ? ' checked' : '') + '> ' + q[1] + '</label>').join('') + '</div>' +
        '<label class="fld">Toegevoegd op<input type="date" class="in" value="' + esc(isoOf(e.added || Date.now())) + '" max="' + today() + '" data-in="eadded"></label></div>' : '') + '</div>' +
      '<div class="cols"><button class="btn" data-a="editdata">Gegevens bewerken</button>' +
      '<button class="btn bad" data-a="delentry">Verwijderen</button></div></section>';
  } else {
    const own = S.entries.filter(x => x.type === V.type && x.tmdbId === V.tmdbId);
    if (own.length) h += '<p class="over small">Staat al in: ' + own.map(x => '<a class="link" href="#/e/' + x.id + '">' + esc((listById(x.list) || {}).name) + '</a>').join(', ') + '</p>';
    h += '<section class="panel2"><h2>Toevoegen aan</h2><div class="stack">' + S.lists.map(l => {
      const has = own.some(x => x.list === l.id);
      return '<button class="btn wide ' + (has ? 'ghost' : '') + '" data-a="pickdetail" data-l="' + l.id + '"' + (has ? ' disabled' : '') + '>' + esc(l.name) + (has ? ' · staat al in lijst' : '') + '</button>';
    }).join('') + '</div></section>';
  }
  if (V.type === 'tv') {
    const list = seasonsOf(e, d);
    if (list.length || e) {
      const open = V.seasonsOpen !== false, ed = !!V.seasonEdit && !!e;
      h += '<section class="dsec"><div class="sech"><button class="foldh plain" data-a="toggleseasons" aria-expanded="' + open + '"><span>Seizoenen</span><small>' + plural(list.length, 'seizoen', 'seizoenen') + '</small><i>' + (open ? '▴' : '▾') + '</i></button>' +
        (e ? '<button class="btn sm' + (ed ? ' pri' : '') + '" data-a="editseasons">' + (ed ? 'Klaar' : 'Bewerken') + '</button><button class="btn sm" data-a="addseason">+ Seizoen</button>' : '') + '</div>';
      if (open) h += '<div class="seasons">' + (list.length ? list.map(q => '<div class="srow"><a class="sa" href="#/s/' + V.tmdbId + '/' + q.n + '">' +
        '<div class="spos">' + (q.poster ? '<img loading="lazy" alt="" src="' + IMG + 'w185' + esc(q.poster) + '">' : '') + '</div>' +
        '<div class="sb"><b>' + esc(q.name || 'Seizoen ' + q.n) + '</b><span>' + [q.eps ? plural(q.eps, 'aflevering', 'afleveringen') : '', q.date ? q.date.slice(0, 4) : ''].filter(Boolean).join(' · ') + '</span></div></a>' +
        (ed ? '<button class="ib" data-a="renameseason" data-n="' + q.n + '" aria-label="Naam wijzigen">' + ico('edit') + '</button><button class="ib" data-a="delseason" data-n="' + q.n + '" aria-label="Seizoen verwijderen">' + ico('trash') + '</button>'
          : (e ? '<label class="chk sgz"><input type="checkbox" data-in="eseason" data-n="' + q.n + '"' + ((e.sn || []).includes(q.n) ? ' checked' : '') + '> Gezien</label>' : '')) + '</div>').join('') : '<p class="small" style="margin:8px 0">Nog geen seizoenen. Voeg er een toe met de knop hierboven.</p>') + '</div>';
      h += '</section>';
    }
  }
  const rel = d && d.release ? fmtDate(d.release) : (g('year') || '--');
  if (V.type === 'tv') {
    const seasons = d && d.seasons ? plural(d.seasons, 'seizoen', 'seizoenen') + (d.episodes ? ' · ' + d.episodes + ' afl.' : '') : '--';
    h += dsec2('Eerste uitzending', esc(rel), 'Seizoenen', esc(seasons));
  } else {
    h += dsec2('Verschijningsdatum', esc(rel), 'Speelduur', d && d.runtime ? d.runtime + ' min' : '--');
  }
  if (d && d.alt && d.alt.length) {
    const seenT = new Set([String(title).toLowerCase(), String(d.orig || '').toLowerCase()]);
    const others = d.alt.filter(x => { const k = x.toLowerCase(); if (seenT.has(k)) return false; seenT.add(k); return true; }).slice(0, 6);
    if (others.length) h += dsec('Andere titels', others.map(x => esc(x)).join('<br>'));
  }
  if (g('genres').length) h += dsec('Genre', esc(g('genres').join(' - ')));
  if (g('overview')) h += dsec('Beschrijving', esc(g('overview')));
  if (d && d.cast.length) {
    h += '<section class="dsec"><h2>Acteurs</h2><div class="cast">' + d.cast.map(p => '<div class="cm">' +
      (p.p ? '<img loading="lazy" alt="" src="' + IMG + 'w185' + esc(p.p) + '">' : '<div class="ph"></div>') +
      '<b>' + esc(p.n) + '</b><span>' + esc(p.c) + '</span></div>').join('') + '</div></section>';
  }
  if (d) {
    if (V.type === 'movie' && d.producers.length) h += dsec('Producenten', esc(d.producers.join(', ')));
    if (V.type === 'tv' && d.creators.length) h += dsec('Makers', esc(d.creators.join(', ')));
    if (V.type === 'tv' && d.networks.length) h += dsec('Netwerk', esc(d.networks.join(', ')));
    if (d.companies.length) h += dsec('Productiebedrijven', d.companies.map(x => esc(x)).join('<br>'));
    if (d.countries.length) h += dsec('Land', esc(d.countries.join(', ')));
    if (V.type === 'movie') h += dsec2('Productiekosten', money(d.budget), 'Opbrengst', money(d.revenue));
    if (d.collection) {
      h += '<a class="coll" href="#/c/' + d.collection.id + '">' +
        (d.collection.backdrop ? '<img alt="" loading="lazy" src="' + IMG + 'w780' + esc(d.collection.backdrop) + '">' : '') +
        '<span>' + esc(d.collection.name) + '</span></a>';
    }
  } else if (hasKey() && !V.err) h += '<div class="spin">Meer gegevens laden…</div>';
  if (e) h += '<section class="panel2"><h2>Notitie</h2><textarea class="in" data-in="enote" placeholder="Bijvoorbeeld: wil ik met Sam kijken">' + esc(e.note) + '</textarea></section>';
  h += '<div style="height:40px"></div>';
  const keep = window.scrollY;
  app.innerHTML = h;
  window.scrollTo(0, keep);
}

/* seizoen */
async function vSeason(id, n) {
  V = { kind: 'season', tmdbId: +id, n: +n, d: null, err: '' };
  const my = V;
  renderSeason();
  try {
    if (!my.tmdbId) throw new Error('GEEN_DATA');
    const d = await api('/tv/' + id + '/season/' + n);
    if (V !== my) return;
    my.d = d;
  } catch (err) { if (V !== my) return; my.err = errMsg(err); }
  renderSeason();
}
function renderSeason() {
  const c = CACHE['tv-' + V.tmdbId] || {};
  const own = S.entries.find(x => x.type === 'tv' && x.tmdbId === V.tmdbId);
  const show = (own && own.title) || c.title || '';
  const d = V.d;
  let h = bar({ title: (d && d.name) || 'Seizoen ' + V.n, sub: show });
  if (V.err === 'GEEN_SLEUTEL') h += '<div class="notice"><b>API-sleutel nodig</b><a class="btn pri" href="#/instellingen">Naar instellingen</a></div>';
  else if (V.err) h += '<div class="notice"><b>Geen afleveringsgegevens</b><span>Voor dit seizoen zijn geen gegevens van TMDb beschikbaar. Dit gebeurt bij zelf toegevoegde seizoenen of series.</span></div>';
  else if (!d) h += '<div class="spin">Laden…</div>';
  else {
    h += '<div class="hero">' + posterHtml({ poster: d.poster_path || '', type: 'tv' }, 'w342') + '<div><h1>' + esc(show ? show + ' – ' + (d.name || 'Seizoen ' + V.n) : (d.name || '')) + '</h1>' +
      '<div class="meta">' + [d.air_date ? d.air_date.slice(0, 4) : '', plural((d.episodes || []).length, 'aflevering', 'afleveringen')].filter(Boolean).join(' · ') + '</div></div></div>';
    if (d.overview) h += dsec('Beschrijving', esc(d.overview));
    h += '<section class="dsec"><h2>Afleveringen</h2></section><div class="eps">' + (d.episodes || []).map(x =>
      '<article class="ep"><div class="eh"><div class="et"><b>' + x.episode_number + '. ' + esc(x.name || 'Aflevering ' + x.episode_number) + '</b>' +
      '<span>' + [x.air_date ? fmtDate(x.air_date) : '', x.runtime ? x.runtime + ' min' : ''].filter(Boolean).join(' · ') + '</span></div>' +
      (x.still_path ? '<img class="still" loading="lazy" alt="" src="' + IMG + 'w300' + esc(x.still_path) + '">' : '') + '</div>' +
      (x.overview ? '<p>' + esc(x.overview) + '</p>' : '') + '</article>').join('') + '</div><div style="height:40px"></div>';
  }
  app.innerHTML = h;
}

/* collectie */
async function vCollection(id) {
  V = { kind: 'coll', id: +id, d: null, parts: [], err: '' };
  const my = V;
  renderColl();
  try {
    await ensureGenres();
    const d = await api('/collection/' + id);
    if (V !== my) return;
    my.d = d;
    my.parts = (d.parts || []).slice().sort((a, b) => (a.release_date || '9').localeCompare(b.release_date || '9')).map(p => cache(norm(p, 'movie')));
  } catch (err) { if (V !== my) return; my.err = errMsg(err); }
  renderColl();
}
function renderColl() {
  const n = V.parts.length;
  let h = bar({ title: V.d ? V.d.name : 'Collectie', sub: V.d ? plural(n, 'film', 'films') : '' });
  if (V.err === 'GEEN_SLEUTEL') h += '<div class="notice"><b>API-sleutel nodig</b><a class="btn pri" href="#/instellingen">Naar instellingen</a></div>';
  else if (V.err) h += '<div class="notice">' + esc(V.err) + '</div>';
  else if (!V.d) h += '<div class="spin">Laden…</div>';
  else h += (V.d.overview ? '<p class="over">' + esc(V.d.overview) + '</p>' : '') + '<div class="rows">' + V.parts.map(it => tmdbRow(it)).join('') + '</div>';
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
    '<label class="btn" for="imp">Bestand kiezen</label><input id="imp" type="file" accept=".json,application/json" data-in="import" hidden></section>' +
    '<section class="panel2"><h2>Importeren uit MovieMeter</h2><p class="small" style="margin:0">Heb je een CSV-export uit MovieMeter? De app zoekt de films bij TMDb op en zet ze in je lijsten.</p><a class="btn" href="#/import">CSV importeren</a></section>' + skipSection();
}
function skipSection() {
  const a = S.settings.impSkipped || [];
  if (!a.length) return '';
  return '<section class="panel2"><h2>Niet geïmporteerd (' + a.length + ')</h2><p class="small" style="margin:0">Deze titels heb je overgeslagen of zijn niet gevonden. Zoek ze zelf op via Toevoegen.</p>' +
    '<div class="small" style="max-height:260px;overflow:auto">' + a.map(x => esc(x.t + (x.a ? ' (' + x.a.slice(0, 4) + ')' : '') + ' – ' + x.s)).join('<br>') + '</div>' +
    '<button class="btn" data-a="skipcsv">Lijst downloaden (CSV)</button><button class="btn ghost" data-a="skipclear">Lijst wissen</button></section>';
}
/* ---------- import uit CSV (MovieMeter-export) ---------- */
const IMPK = { Amazon: 'prime', Apple: 'apple', Disney: 'disney', HBO: 'hbo', Netflix: 'netflix', Pathe: 'pathe', SkyShowtime: 'sky', Videoland: 'vl', Oscar: 'oscar', GoldenGlobe: 'globe' };
let IMP = null;
const plainT = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' en ').replace(/[^a-z0-9]+/g, ' ').trim();
function csvDecode(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { return new TextDecoder('windows-1252').decode(buf); }
}
function parseCsv(t, d) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === d) { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c === '\r') { /* negeren */ }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const SEEN0 = new Set('1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,23,25,26,30,31,32,35,38,39,41,42,43,44,49,51,53,54,55,56,57,58,59,61,63,65,66,67,69,70,71,72,73,74,75,76,77,78,79,80,81,82,85,86,87,89,90,91,92,93,94,95,96,99,101,103,108,109,111,112,113,115,117,118,119,121,122,123,124,125,129,130,132,133,135,136,138,139,140,141,144,145,147,149,150,151,154,155,156,157,159,161,163,164,165,166,168,169,170,171,172,173,174,175,176,178,179,180,181,182,183,184,187,188,189,190,192,193,195,197,198,199,201,203,205,207,208,209,210,211,212,213,214,215,216,217,218,219,220,221,222,223,225,226,227,228,229,230,231,232,233,234,236,240,242,243,244,246,247,248,249,250,254,257,259,260,261,262,263,265,266,267,269,270,271,273,274,275,276,277,278,279,280,281,283,284,286,287,290,291,292,294,295,296,297,298,299,302,303,304,305,306,307,308,310,312,319,320,322,323,324,325,326,330,337,340,342,343,344,345,346,347,348,349,358,359,360,361,365,366,367,371,374,377,379,387,389,390,395,398,402,407,413,416,422,423,426,430,434,438,441,443,447,449,454,461,466,468,475,486,488,491,494,504,514,563,584,586,587,612,622,654,715,719,721,722,725,787,830,838,851,901,912,924,935,940,997,1008,1087,1095,1117,1197,1214,1236,1251,1261,1314,1337,1396,1422,1430,1431,1434,1447,1451'.split(','));
const WHY = {
  'fifty shades of grey': 'Te oud - verwijderd', 'minions': 'Niet gedownload', 'youth': 'Niet afgekeken',
  'morbius': 'Te oud, horror, verwijderd', 'the shift': 'Niet gekeken',
  'hot milk': 'Niet gekeken'
};
function buildPlan(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split('\n')[0];
  const d = first.split(';').length > first.split(',').length ? ';' : ',';
  const t = parseCsv(text, d);
  const h = (t[0] || []).map(x => x.trim());
  if (!h.includes('OriginalTitle')) throw new Error('KOLOMMEN');
  const dateOk = s => /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
  return t.slice(1).filter(r => r.length > 3).map(r => {
    const o = {}; h.forEach((k, i) => { o[k] = (r[i] || '').trim(); });
    const where = new Set();
    Object.keys(IMPK).forEach(k => { if (o[k] === 'True') where.add(IMPK[k]); });
    if (o.Bioscoopfilm === 'True' || /^bi[os]/i.test(o.MediaLabel || '')) where.add('bios');
    if (/^netflix$/i.test(o.MediaLabel || '')) where.add('netflix');
    const color = +o.ColorTag || 0;
    const watched = dateOk(o.DateWatched), added = dateOk(o.Date);
    const ns = !!color || o.nietgezien === 'True';
    let list = 'movies', seen = '', why = '';
    if (ns) { if (color) why = 'Kleur ' + color + ' – reden nog invullen'; }
    else if (watched) seen = watched;
    else if (SEEN0.has(o.Number)) seen = 'onbekend';
    else list = 'wish';
    const fix = WHY[(o.OriginalTitle || '').trim().toLowerCase()];
    if (fix && ns) why = fix;
    const im = (o.URL || '').match(/imdb\.com\/title\/(tt\d+)/);
    return {
      title: o.OriginalTitle, tr: o.TranslatedTitle || '', type: o.Serie === 'True' ? 'tv' : 'movie', added, seen, ns, why, list,
      where: [...where], imdb: im ? im[1] : '', note: (o.Comments || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim(), res: null, pick: null
    };
  }).filter(x => x.title);
}
async function apiRetry(path, params) {
  let last;
  for (let i = 0; i < 4; i++) {
    try { return await api(path, params); }
    catch (e) {
      last = e;
      const m = String(e.message);
      if (m === 'GEEN_SLEUTEL' || m === 'SLEUTEL_ONGELDIG' || m === 'HTTP_404') throw e;
      await new Promise(r => setTimeout(r, 700 * (i + 1)));
    }
  }
  throw last;
}
async function matchOne(rec) {
  if (rec.imdb) {
    const r = await apiRetry('/find/' + rec.imdb, { external_source: 'imdb_id' });
    const hit = ((rec.type === 'tv' ? r.tv_results : r.movie_results) || [])[0];
    if (hit) return { auto: hit, cands: [hit] };
  }
  const want = [rec.title, rec.tr].filter(Boolean), wk = want.map(plainT);
  const ay = +rec.added.slice(0, 4) || 9999;
  const all = [];
  for (const q of want) {
    const r = await apiRetry('/search/' + rec.type, { query: q, include_adult: 'false' });
    (r.results || []).slice(0, 10).forEach(c => { if (!all.some(x => x.id === c.id)) all.push(c); });
    if (all.some(c => wk.includes(plainT(c.title || c.name)) || wk.includes(plainT(c.original_title || c.original_name)))) break;
  }
  const yr = c => +(c.release_date || c.first_air_date || '').slice(0, 4) || 0;
  const exact = all.filter(c => wk.includes(plainT(c.title || c.name)) || wk.includes(plainT(c.original_title || c.original_name)));
  const rest = all.filter(c => !exact.includes(c));
  const cands = exact.concat(rest).slice(0, 6);
  if (exact.length) {
    const pl = exact.filter(c => !yr(c) || yr(c) <= ay + 1).sort((a, b) => (ay - (yr(a) || ay)) - (ay - (yr(b) || ay)));
    if (exact.length === 1) return { auto: exact[0], cands };
    const pool = (pl.length ? pl : exact).slice().sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    // alleen vragen als twee echte kanshebbers ongeveer even bekend zijn
    if (pool.length === 1 || (pool[0].popularity || 0) >= 3 * (pool[1].popularity || 0)) return { auto: pool[0], cands };
  }
  return { cands };
}
function vImport() {
  V = { kind: 'imp' };
  if (!IMP || IMP.phase === 'done') IMP = { phase: 'pick' };
  renderImp();
}
function impCounts() {
  const c = { seen: 0, ns: 0, wish: 0 };
  IMP.recs.forEach(r => { if (r.ns) c.ns++; else if (r.seen) c.seen++; else c.wish++; });
  return c;
}
function renderImp() {
  if (V.kind !== 'imp' || !IMP) return;
  const I = IMP;
  let h = bar({ title: 'Importeren uit CSV' });
  if (I.err) h += '<div class="notice">' + (I.err === 'GEEN_SLEUTEL' ? '<b>API-sleutel nodig</b><span>Vul eerst je TMDb-sleutel in bij Instellingen.</span>' : esc(I.err)) + '</div>';
  if (I.phase === 'pick') {
    h += '<section class="panel2"><h2>Bestand kiezen</h2><p class="small" style="margin:0">Kies het CSV-bestand uit MovieMeter (films). De app zoekt elke titel bij TMDb op. Laat dit scherm open tijdens het importeren.</p>' +
      '<label class="btn pri" for="impf">CSV-bestand kiezen</label><input id="impf" type="file" accept=".csv,text/csv,text/plain" data-in="impfile" hidden></section>';
  } else if (I.phase === 'ready') {
    const c = impCounts();
    h += '<section class="panel2"><h2>Dit gaat er gebeuren</h2><p style="margin:0">' + plural(I.recs.length, 'titel', 'titels') + ' in het bestand:</p>' +
      '<div class="stack small"><div>• <b style="color:var(--fg)">' + c.seen + '</b> gezien, naar de lijst Films (bij sommige is de datum onbekend)</div>' +
      '<div>• <b style="color:var(--fg)">' + c.ns + '</b> niet gezien (gekleurd of "niet gezien"), naar de lijst Films</div>' +
      '<div>• <b style="color:var(--fg)">' + c.wish + '</b> zonder kijkdatum, naar de Verlanglijst</div></div>' +
      '<p class="small" style="margin:0">Opmerkingen worden je notitie. De datum van toevoegen wordt "Toegevoegd op". Vinkjes zoals Netflix, Bios en Oscar worden overgenomen.</p>' +
      '<button class="btn pri" data-a="impstart">Importeren starten</button><label class="btn ghost" for="impf">Ander bestand kiezen</label><input id="impf" type="file" accept=".csv,text/csv,text/plain" data-in="impfile" hidden></section>';
  } else if (I.phase === 'run') {
    const pct = Math.round(100 * I.done / I.recs.length);
    h += '<section class="panel2"><h2>Bezig met opzoeken</h2><p style="margin:0">' + I.done + ' van ' + I.recs.length + '</p>' +
      '<div class="pbar"><i style="width:' + pct + '%"></i></div><p class="small" style="margin:0">Dit duurt een paar minuten. Laat dit scherm open.</p>' +
      '<button class="btn ghost" data-a="impcancel">Stoppen</button></section>';
  } else if (I.phase === 'review') {
    const i = I.todo[I.ri], r = I.recs[i];
    h += '<section class="panel2"><h2>Controleren ' + (I.ri + 1) + ' van ' + I.todo.length + '</h2>' +
      '<div><b style="font-size:21px">' + esc(r.title) + '</b>' + (r.tr ? '<div class="small">' + esc(r.tr) + '</div>' : '') +
      '<div class="small">' + (r.added ? 'Toegevoegd op ' + esc(fmtDate(r.added)) : '') + '</div></div>' +
      (r.res.cands.length ? '<div class="stack">' + r.res.cands.map(c => '<button class="btn wide" data-a="imppick" data-id="' + c.id + '">' +
        esc((c.title || c.name || '') + ' (' + ((c.release_date || c.first_air_date || '').slice(0, 4) || '?') + ')') +
        ((c.original_title || c.original_name) && (c.original_title || c.original_name) !== (c.title || c.name) ? ' – ' + esc(c.original_title || c.original_name) : '') + '</button>').join('') + '</div>'
        : '<p class="small" style="margin:0">Niets gevonden bij TMDb.</p>') +
      '<button class="btn ghost" data-a="impskip">Overslaan</button>' +
      '<button class="btn ghost" data-a="impautoall">De rest automatisch kiezen (' + (I.todo.length - I.ri) + ')</button></section>';
  } else if (I.phase === 'done') {
    h += '<section class="panel2"><h2>Klaar</h2><p style="margin:0"><b>' + plural(I.added, 'titel', 'titels') + '</b> toegevoegd.' + (I.dup ? ' ' + plural(I.dup, 'titel stond', 'titels stonden') + ' al in je collectie.' : '') + '</p>' +
      (I.skipped.length ? '<p class="small" style="margin:0">Niet geïmporteerd (' + I.skipped.length + '), voeg deze zelf toe:</p><div class="small" style="max-height:260px;overflow:auto">' + I.skipped.map(x => esc(x)).join('<br>') + '</div>' : '') +
      '<p class="small" style="margin:0">Deze lijst blijft bewaard onder Back-up en herstel.</p><a class="btn pri" href="#/l/movies">Naar mijn films</a></section>';
  }
  app.innerHTML = h;
}
async function impRun() {
  const I = IMP; I.phase = 'run'; I.done = 0; I.err = ''; I.cancel = false; renderImp();
  try { await ensureGenres(); } catch (e) { I.err = errMsg(e); I.phase = 'ready'; renderImp(); return; }
  const queue = I.recs.map((r, i) => i).filter(i => !I.recs[i].res);
  I.done = I.recs.length - queue.length;
  async function worker() {
    while (queue.length && !I.cancel) {
      const r = I.recs[queue.shift()];
      try { r.res = await matchOne(r); }
      catch (e) {
        const m = String(e.message);
        if (m === 'GEEN_SLEUTEL' || m === 'SLEUTEL_ONGELDIG') { I.err = errMsg(e); I.cancel = true; return; }
        r.res = { cands: [] };
      }
      I.done++;
      if (I.done % 8 === 0) renderImp();
    }
  }
  await Promise.all(Array.from({ length: 5 }, worker));
  if (I.err) { I.phase = 'ready'; renderImp(); return; }
  if (I.cancel) { I.phase = 'ready'; renderImp(); return; }
  I.todo = I.recs.map((r, i) => i).filter(i => !I.recs[i].res.auto);
  I.ri = 0;
  if (I.todo.length) { I.phase = 'review'; renderImp(); } else impFinish();
}
function impNext() { IMP.ri++; if (IMP.ri >= IMP.todo.length) impFinish(); else renderImp(); }
function impFinish() {
  const I = IMP; let added = 0, dup = 0; const skipped = [], skipRecs = [];
  const lid = id => (listById(id) ? id : S.lists[0].id);
  I.recs.forEach(r => {
    const hit = r.pick || (r.res && r.res.auto);
    if (!hit) { skipped.push(r.title + (r.added ? ' (' + r.added.slice(0, 4) + ')' : '')); skipRecs.push({ t: r.title, tr: r.tr, a: r.added, l: (listById(lid(r.list)) || {}).name || '', s: r.ns ? 'niet gezien' : r.seen ? 'gezien' : 'verlanglijst', n: r.note }); return; }
    const it = norm(hit, r.type);
    if (S.entries.some(e => e.type === r.type && e.tmdbId === it.tmdbId)) { dup++; return; }
    const ts = r.added ? new Date(r.added + 'T12:00:00').getTime() : Date.now();
    S.entries.push({
      id: uid(), list: lid(r.list), type: r.type, tmdbId: it.tmdbId, title: it.title || r.title, year: it.year, poster: it.poster, overview: it.overview,
      rating: it.rating, genres: it.genres, seen: r.seen, note: r.note, tags: [], sn: [], where: r.where.slice(), ns: r.ns, why: r.why, added: ts, u: Date.now()
    });
    added++;
  });
  S.settings.impSkipped = skipRecs;
  commit();
  I.phase = 'done'; I.added = added; I.dup = dup; I.skipped = skipped;
  renderImp();
}

function cleanEntry(x) {
  return {
    id: String(x.id || uid()), list: String(x.list || ''), type: x.type === 'tv' ? 'tv' : 'movie', tmdbId: +x.tmdbId || 0,
    title: String(x.title || ''), year: String(x.year || ''), poster: String(x.poster || ''), overview: String(x.overview || ''), rating: +x.rating || 0,
    genres: Array.isArray(x.genres) ? x.genres.map(String) : [], seen: String(x.seen || ''), note: String(x.note || ''),
    seasons: Array.isArray(x.seasons) ? x.seasons.filter(q => q && +q.n > 0).map(q => ({ n: +q.n, name: String(q.name || ''), eps: +q.eps || 0, date: String(q.date || ''), poster: String(q.poster || '') })) : undefined,
    sn: Array.isArray(x.sn) ? x.sn.map(Number).filter(n => n > 0) : [],
    tags: Array.isArray(x.tags) ? x.tags.map(String).filter(Boolean) : [], where: Array.isArray(x.where) ? x.where.map(String).filter(k => PLAT.some(q => q[0] === k)) : [], ns: !!x.ns, why: String(x.why || ''),
    added: +x.added || Date.now(), u: +x.u || 0
  };
}
let PENDING = null;
function readImport(file) {
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const d = JSON.parse(fr.result);
      if (!d || !Array.isArray(d.entries)) throw new Error('x');
      const skip = (Array.isArray(d.lists) ? d.lists : []).filter(l => l && l.kind === 'music').map(l => String(l.id));
      const entries = d.entries.filter(x => x && typeof x.title === 'string' && x.type !== 'music' && !skip.includes(String(x.list))).map(cleanEntry);
      const lists = Array.isArray(d.lists) ? d.lists.filter(l => l && l.id && l.name && l.kind !== 'music').map(l => ({ id: String(l.id), name: String(l.name), kind: l.kind, u: Date.now() })) : [];
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
    if (P.lists.length) {
      S.lists.forEach(l => { if (!P.lists.some(q => q.id === l.id)) S.delLists[l.id] = Date.now(); });
      S.lists = P.lists;
    }
    S.entries.forEach(e => { S.del[e.id] = Date.now(); });
    S.entries = [];
  } else P.lists.forEach(l => { if (!listById(l.id)) S.lists.push(l); });
  let added = 0;
  P.entries.forEach(x => {
    if (!listById(x.list)) x.list = S.lists[0].id;
    const dup = S.entries.some(e => e.id === x.id || (e.list === x.list && e.type === x.type && (x.tmdbId ? e.tmdbId === x.tmdbId : e.title === x.title && e.year === x.year)));
    if (!dup) { x.u = Date.now(); S.entries.push(x); added++; }
  });
  commit(); closeSheet(); toast(plural(added, 'titel', 'titels') + ' hersteld'); vBackup();
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
    syncSection() +
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
  const tags = [...new Set(S.entries.filter(e => e.list === V.id).flatMap(e => e.tags || []))].sort((a, b) => a.localeCompare(b, 'nl'));
  openSheet('<h3>Filteren</h3>' +
    '<label class="fld">Gezien<select class="in" data-in="fseen"><option value="">Alles</option><option value="seen"' + (f.seen === 'seen' ? ' selected' : '') + '>Gezien</option><option value="unseen"' + (f.seen === 'unseen' ? ' selected' : '') + '>Nog niet gezien</option><option value="ns"' + (f.seen === 'ns' ? ' selected' : '') + '>Bewust niet gezien</option></select></label>' +
    '<label class="fld">Tags<select class="in" data-in="fplat"><option value="">Overal</option>' + PLAT.map(q => '<option value="' + q[0] + '"' + (f.plat === q[0] ? ' selected' : '') + '>' + q[1] + '</option>').join('') + '</select></label>' +
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
function refreshRows() { if (V.kind === 'add') fillAdd(); else if (V.kind === 'pub') fillPub(); else if (V.kind === 'coll') renderColl(); }

/* ---------- synchroniseren (geheime GitHub Gist) ---------- */
const GIST_DESC = 'Filmkast sync', GIST_FILE = 'filmkast.json';
let syncing = false, syncT = 0, lastSync = +(S.settings.lastSync || 0);
const syncOn = () => !!(S.settings.syncToken || '').trim();
function scheduleSync() {
  if (!syncOn() || syncing) return;
  clearTimeout(syncT);
  syncT = setTimeout(() => syncNow(true), 4000);
}
function syncText() {
  if (!syncOn()) return 'Niet ingesteld.';
  return S.settings.lastSync
    ? 'Laatst gesynchroniseerd: ' + new Date(+S.settings.lastSync).toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' })
    : 'Nog niet gesynchroniseerd.';
}
function setSyncStatus(t) { const el = $('#syncstat'); if (el) el.textContent = t; }
function syncSection() {
  return '<section class="panel2"><h2>Synchroniseren</h2>' +
    '<p class="small" style="margin:0">Houd je computer en telefoon gelijk via een geheim bestand (Gist) op je eigen GitHub-account. Vul op elk apparaat dezelfde toegangscode in.</p>' +
    '<label class="fld">GitHub-toegangscode<input id="synctoken" class="in" value="' + esc(S.settings.syncToken || '') + '" data-in="synctoken" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="ghp_…"></label>' +
    '<button class="btn" data-a="syncnow">Nu synchroniseren</button>' +
    '<p class="small" id="syncstat" style="margin:0">' + esc(syncText()) + '</p>' +
    '<details class="how"><summary>Zo maak je de toegangscode</summary><ol>' +
    '<li>Ga op github.com naar je profielfoto en kies <b>Settings</b>.</li>' +
    '<li>Kies onderaan links <b>Developer settings</b>, dan <b>Personal access tokens</b>, dan <b>Tokens (classic)</b>.</li>' +
    '<li>Kies <b>Generate new token</b> en dan <b>Generate new token (classic)</b>.</li>' +
    '<li>Noem hem "Filmkast", kies bij Expiration <b>No expiration</b> en vink alleen <b>gist</b> aan.</li>' +
    '<li>Klik onderaan op <b>Generate token</b>, kopieer de code (begint met ghp_) en plak hem hierboven.</li></ol></details></section>';
}
async function gh(path, opt) {
  opt = opt || {};
  const headers = { Authorization: 'Bearer ' + S.settings.syncToken.trim(), Accept: 'application/vnd.github+json' };
  if (opt.body) headers['Content-Type'] = 'application/json';
  const r = await fetch('https://api.github.com' + path, { method: opt.method || 'GET', headers, body: opt.body ? JSON.stringify(opt.body) : undefined });
  if (r.status === 401 || r.status === 403) throw new Error('SYNC_AUTH');
  if (!r.ok) throw new Error('SYNC_HTTP_' + r.status);
  return r.json();
}
async function findGist() {
  if (S.settings.gistId) return S.settings.gistId;
  const list = await gh('/gists?per_page=100');
  const g = list.find(x => x.description === GIST_DESC && x.files && x.files[GIST_FILE]);
  return g ? g.id : '';
}
const maxMap = (a, b) => { const o = Object.assign({}, a || {}); for (const k in (b || {})) o[k] = Math.max(o[k] || 0, b[k]); return o; };
function payload() { return { app: 'filmkast', v: 2, lists: S.lists, entries: S.entries.map(cleanEntry), del: S.del, delLists: S.delLists }; }
const fp = o => JSON.stringify([
  (o.entries || []).map(e => e.id + ':' + (e.u || 0)).sort(),
  (o.lists || []).map(l => l.id + ':' + l.name + ':' + (l.u || 0)).sort(),
  Object.keys(o.del || {}).sort(), Object.keys(o.delLists || {}).sort()
]);
function mergeData(R) {
  const del = maxMap(S.del, R.del), delL = maxMap(S.delLists, R.delLists);
  const rLists = (R.lists || []).filter(l => l && l.id && l.name).map(l => ({ id: String(l.id), name: String(l.name), kind: l.kind, u: +l.u || 0 }));
  const lm = new Map();
  S.lists.concat(rLists).forEach(l => { const o = lm.get(l.id); if (!o || (l.u || 0) > (o.u || 0)) lm.set(l.id, l); });
  const order = [...new Set(S.lists.map(l => l.id).concat(rLists.map(l => l.id)))];
  let lists = order.filter(id => !(delL[id] && delL[id] > (lm.get(id).u || 0))).map(id => lm.get(id));
  if (!lists.length) lists = [DEF().lists[0]];
  const em = new Map();
  S.entries.concat((R.entries || []).filter(x => x && typeof x.title === 'string' && x.title).map(cleanEntry)).forEach(e => {
    const o = em.get(e.id);
    if (!o) { em.set(e.id, e); return; }
    if ((e.u || 0) > (o.u || 0)) { if (o.d && !e.d) e.d = o.d; em.set(e.id, e); }
    else if (e.d && !o.d) o.d = e.d;
  });
  const entries = [...em.values()].filter(e => !(del[e.id] && del[e.id] >= (e.u || 0)) && lists.some(l => l.id === e.list));
  return { lists, entries, del, delLists: delL };
}
function syncErr(e) {
  const m = e && e.message || '';
  if (m === 'SYNC_AUTH') return 'GitHub weigert de toegangscode. Controleer of hij klopt, niet verlopen is en het recht "gist" heeft.';
  if (m.startsWith('SYNC_HTTP_')) return 'GitHub gaf een fout (' + m.slice(10) + '). Probeer het later opnieuw.';
  return 'Geen verbinding met GitHub.';
}
async function syncNow(auto) {
  if (!syncOn() || syncing) return;
  syncing = true; clearTimeout(syncT);
  setSyncStatus('Bezig met synchroniseren…');
  try {
    let id = await findGist(), R = null;
    if (id) {
      const g = await gh('/gists/' + id);
      const f = g.files && g.files[GIST_FILE];
      if (f) {
        let txt = f.content;
        if (f.truncated) txt = await (await fetch(f.raw_url)).text();
        try { R = JSON.parse(txt); } catch (err) { R = null; }
      }
    }
    let changed = false;
    if (R && Array.isArray(R.entries)) {
      const before = fp({ entries: S.entries, lists: S.lists, del: S.del, delLists: S.delLists });
      const m = mergeData(R);
      S.lists = m.lists; S.entries = m.entries; S.del = m.del; S.delLists = m.delLists;
      changed = fp(m) !== before;
    }
    const out = payload();
    if (!id) {
      const g = await gh('/gists', { method: 'POST', body: { description: GIST_DESC, public: false, files: { [GIST_FILE]: { content: JSON.stringify(out) } } } });
      id = g.id;
    } else if (!R || !Array.isArray(R.entries) || fp(R) !== fp(out)) {
      await gh('/gists/' + id, { method: 'PATCH', body: { files: { [GIST_FILE]: { content: JSON.stringify(out) } } } });
    }
    S.settings.gistId = id; lastSync = Date.now(); S.settings.lastSync = lastSync; save();
    setSyncStatus(syncText());
    if (changed) {
      if (V.kind === 'list') { if (V.sq) fillItems(); else renderList(); }
      else if (V.kind === 'det' && V.entryId) fillDetail();
    }
    if (!auto) toast('Gesynchroniseerd');
  } catch (e) {
    const m = syncErr(e);
    setSyncStatus(m);
    if (!auto) toast(m);
  }
  syncing = false;
}

/* ---------- gebeurtenissen ---------- */
const A = {
  drawer: openDrawer, closedrawer: closeDrawer, closesheet: closeSheet,
  back: () => { if (history.length > 1) history.back(); else location.hash = '#/l/' + S.lists[0].id; },
  confirmok: () => { const f = CONFIRM; CONFIRM = null; closeSheet(); if (f) f(); },
  view: (d) => { S.settings.view = d.v; save(); renderList(); },
  togglesearch: () => { V.sq = !V.sq; if (!V.sq) { V.q = ''; if (V.kind === 'pub') { pubSearchReset(); return; } } if (V.kind === 'pub') renderPub(); else renderList(); },
  sheetfilter: sheetFilter, sheetsort: sheetSort, sheetmore: sheetMore,
  clearfilter: () => { V.f = { seen: '', genre: '', tag: '', plat: '' }; closeSheet(); fillItems(); },
  setsort: d => { S.settings.sortKey = d.k; save(); sheetSort(); if (V.kind === 'list') fillItems(); },
  setdir: d => { S.settings.sortDir = d.d; save(); sheetSort(); if (V.kind === 'list') fillItems(); },
  add: () => { location.hash = '#/toevoegen/' + V.id; },
  addres: d => {
    if (V.kind === 'add') { const e = addEntry(CACHE[d.k], V.listId); if (e) { toast('Toegevoegd aan ' + listById(V.listId).name); refreshRows(); } } else sheetPick(d.k);
  },
  pick: d => { const e = addEntry(CACHE[d.k], d.l); if (e) { toast('Toegevoegd aan ' + listById(d.l).name); closeSheet(); refreshRows(); } },
  pickdetail: d => { const e = addEntry(CACHE[V.type + '-' + V.tmdbId], d.l); if (e) { toast('Toegevoegd aan ' + listById(d.l).name); location.replace('#/e/' + e.id); } },
  retry: () => { V.err = ''; loadMore(); },
  share: async () => {
    const c = CACHE[V.type + '-' + V.tmdbId] || {};
    const e = V.entryId && S.entries.find(x => x.id === V.entryId);
    const title = (e && e.title) || c.title || 'Titel';
    const url = 'https://www.themoviedb.org/' + V.type + '/' + V.tmdbId;
    try {
      if (navigator.share) await navigator.share({ title, url });
      else { await navigator.clipboard.writeText(url); toast('Link gekopieerd'); }
    } catch (err) { /* geannuleerd */ }
  },
  saveseen: () => {
    const e = S.entries.find(x => x.id === V.entryId), v = $('#sd') && $('#sd').value;
    if (!e) return;
    if (!v) { toast('Kies een datum'); return; }
    e.seen = v; e.ns = false; e.u = Date.now(); commit(); closeSheet(); fillDetail();
  },
  editseasons: () => { V.seasonEdit = !V.seasonEdit; fillDetail(); },
  addseason: () => {
    const e = S.entries.find(x => x.id === V.entryId); if (!e) return;
    const list = seasonsOf(e, e.d || (CACHE[V.type + '-' + V.tmdbId] || {}).d);
    const next = list.reduce((m, q) => Math.max(m, q.n), 0) + 1;
    openSheet('<h3>Seizoen toevoegen</h3><label class="fld">Nummer<input id="ss-n" class="in" inputmode="numeric" value="' + next + '"></label>' +
      '<label class="fld">Naam (mag leeg)<input id="ss-name" class="in" placeholder="Seizoen ' + next + '"></label>' +
      '<div class="cols"><button class="btn ghost" data-a="closesheet">Annuleren</button><button class="btn pri" data-a="saveaddseason">Toevoegen</button></div>');
  },
  saveaddseason: async () => {
    const e = S.entries.find(x => x.id === V.entryId); if (!e) return;
    const n = parseInt($('#ss-n').value, 10), name = $('#ss-name').value.trim();
    if (!(n > 0)) { toast('Geef een seizoensnummer'); return; }
    const list = seasonsOf(e, e.d || (CACHE[V.type + '-' + V.tmdbId] || {}).d).map(q => Object.assign({}, q));
    if (list.some(q => q.n === n)) { toast('Dit seizoen bestaat al'); return; }
    let q = { n, name: name || 'Seizoen ' + n, eps: 0, date: '', poster: '' };
    if (e.tmdbId) {
      toast('Seizoen controleren…');
      try {
        const d = await api('/tv/' + e.tmdbId + '/season/' + n);
        q = { n, name: name || d.name || 'Seizoen ' + n, eps: (d.episodes || []).length, date: d.air_date || '', poster: d.poster_path || '' };
      } catch (err) {
        toast(String(err.message) === 'HTTP_404' ? 'Seizoen ' + n + ' bestaat niet bij TMDb' : 'Controleren lukt niet. Probeer het later opnieuw.');
        return;
      }
    }
    list.push(q); list.sort((a, b) => a.n - b.n);
    e.seasons = list; e.u = Date.now(); commit(); closeSheet(); fillDetail(); toast('Seizoen toegevoegd');
  },
  renameseason: d => {
    const e = S.entries.find(x => x.id === V.entryId); if (!e) return;
    const q = seasonsOf(e, e.d).find(x => x.n === +d.n); if (!q) return;
    openSheet('<h3>Naam wijzigen</h3><label class="fld">Naam<input id="ss-name" class="in" value="' + esc(q.name || 'Seizoen ' + q.n) + '"></label>' +
      '<div class="cols"><button class="btn ghost" data-a="closesheet">Annuleren</button><button class="btn pri" data-a="saverename" data-n="' + q.n + '">Opslaan</button></div>');
  },
  saverename: d => {
    const e = S.entries.find(x => x.id === V.entryId); if (!e) return;
    const list = seasonsOf(e, e.d).map(q => Object.assign({}, q));
    const q = list.find(x => x.n === +d.n); if (!q) return;
    q.name = $('#ss-name').value.trim() || 'Seizoen ' + q.n;
    e.seasons = list; e.u = Date.now(); commit(); closeSheet(); fillDetail();
  },
  delseason: d => {
    const e = S.entries.find(x => x.id === V.entryId); if (!e) return;
    confirmSheet('Seizoen ' + d.n + ' wordt uit deze serie gehaald.', 'Verwijderen', () => {
      e.seasons = seasonsOf(e, e.d).filter(q => q.n !== +d.n).map(q => Object.assign({}, q));
      e.sn = (e.sn || []).filter(n => n !== +d.n); e.u = Date.now(); commit(); fillDetail();
    });
  },
  toggleseasons: () => { V.seasonsOpen = V.seasonsOpen === false; fillDetail(); },
  toggletags: () => { V.tagsOpen = !V.tagsOpen; fillDetail(); },
  addtag: () => {
    const e = S.entries.find(x => x.id === V.entryId), inp = $('#tagin');
    if (!e || !inp) return;
    const t = inp.value.trim().replace(/\s+/g, ' ');
    if (!t) return;
    e.tags = e.tags || [];
    if (!e.tags.some(x => x.toLowerCase() === t.toLowerCase())) { e.tags.push(t); e.u = Date.now(); commit(); }
    fillDetail(); const n = $('#tagin'); if (n) n.focus();
  },
  deltag: d => { const e = S.entries.find(x => x.id === V.entryId); if (e) { e.tags = (e.tags || []).filter(x => x !== d.t); e.u = Date.now(); commit(); fillDetail(); } },
  editdata: () => {
    const e = S.entries.find(x => x.id === V.entryId); if (!e) return;
    openSheet('<h3>Gegevens bewerken</h3>' +
      '<label class="fld">Titel<input id="ed-title" class="in" value="' + esc(e.title) + '"></label>' +
      '<label class="fld">Jaar<input id="ed-year" class="in" inputmode="numeric" value="' + esc(e.year) + '"></label>' +
      '<label class="fld">Genres (met komma ertussen)<input id="ed-genres" class="in" value="' + esc((e.genres || []).join(', ')) + '"></label>' +
      '<label class="fld">Beschrijving<textarea id="ed-over" class="in" style="min-height:140px">' + esc(e.overview) + '</textarea></label>' +
      '<div class="cols"><button class="btn ghost" data-a="closesheet">Annuleren</button><button class="btn pri" data-a="saveedit">Opslaan</button></div>');
  },
  saveedit: () => {
    const e = S.entries.find(x => x.id === V.entryId); if (!e) return;
    const t = $('#ed-title').value.trim();
    if (!t) { toast('Een titel is nodig'); return; }
    e.title = t; e.year = $('#ed-year').value.trim(); e.overview = $('#ed-over').value.trim();
    e.genres = $('#ed-genres').value.split(',').map(x => x.trim()).filter(Boolean);
    e.u = Date.now(); commit(); closeSheet(); fillDetail(); toast('Opgeslagen');
  },
  impstart: () => impRun(),
  impcancel: () => { if (IMP) IMP.cancel = true; },
  imppick: d => { const r = IMP.recs[IMP.todo[IMP.ri]]; r.pick = r.res.cands.find(c => String(c.id) === d.id) || null; impNext(); },
  skipcsv: () => {
    const q = v => '"' + String(v || '').replace(/"/g, '""') + '"';
    const rows = [['Titel', 'Vertaalde titel', 'Toegevoegd', 'Hoort in', 'Status', 'Notitie']].concat((S.settings.impSkipped || []).map(x => [x.t, x.tr, x.a, x.l, x.s, x.n]));
    download('niet-geimporteerd.csv', '\ufeff' + rows.map(r => r.map(q).join(';')).join('\n'), 'text/csv');
  },
  skipclear: () => { S.settings.impSkipped = []; save(); vBackup(); },
  impskip: () => impNext(),
  impautoall: () => { const I = IMP; for (; I.ri < I.todo.length; I.ri++) { const r = I.recs[I.todo[I.ri]]; r.pick = r.res.cands[0] || null; } impFinish(); },
  syncnow: () => { if (!syncOn()) { toast('Vul eerst je toegangscode in'); return; } syncNow(false); },
  savenew: () => {
    const title = $('#n-title').value.trim();
    if (!title) { toast('Vul een titel in'); return; }
    const sub = $('#n-sub').value.trim();
    const e = addEntry({ type: $('#n-type').value, title, year: $('#n-year').value.trim(), genres: sub ? [sub] : [] }, V.listId);
    if (e) location.replace('#/e/' + e.id);
  },
  delentry: () => confirmSheet('Deze titel wordt uit je collectie verwijderd.', 'Verwijderen', () => {
    const e = S.entries.find(x => x.id === V.entryId); const lid = e ? e.list : S.lists[0].id;
    S.del[V.entryId] = Date.now(); S.entries = S.entries.filter(x => x.id !== V.entryId); commit(); toast('Verwijderd'); location.replace('#/l/' + lid);
  }),
  addlist: () => { const n = $('#nl').value.trim(); if (!n) { toast('Geef de lijst een naam'); return; } S.lists.push({ id: uid(), name: n, u: Date.now() }); commit(); vManage(); toast('Lijst toegevoegd'); },
  dellist: d => {
    if (S.lists.length < 2) { toast('Je hebt minstens één lijst nodig'); return; }
    const l = listById(d.l);
    confirmSheet('Lijst "' + l.name + '" en de ' + plural(count(l.id), 'titel', 'titels') + ' erin worden verwijderd.', 'Verwijderen', () => {
      const now = Date.now();
      S.entries.filter(e => e.list === l.id).forEach(e => { S.del[e.id] = now; });
      S.delLists[l.id] = now;
      S.entries = S.entries.filter(e => e.list !== l.id); S.lists = S.lists.filter(x => x.id !== l.id); commit(); vManage();
    });
  },
  exportlist: () => { closeSheet(); exportCsv(listItems(), 'filmkast-' + listById(V.id).name.toLowerCase().replace(/\W+/g, '-') + '.csv'); },
  clearlist: () => confirmSheet('Alle titels in "' + listById(V.id).name + '" worden verwijderd.', 'Leegmaken', () => {
    const now = Date.now();
    S.entries.filter(e => e.list === V.id).forEach(e => { S.del[e.id] = now; });
    S.entries = S.entries.filter(e => e.list !== V.id); commit(); renderList(); toast('Lijst geleegd');
  }),
  export: () => {
    const out = { app: 'filmkast', v: 1, saved: new Date().toISOString(), lists: S.lists, entries: S.entries.map(cleanEntry) };
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
  impfile: el => {
    const f = el.files && el.files[0]; if (!f) return;
    f.arrayBuffer().then(buf => {
      try { const recs = buildPlan(csvDecode(buf)); if (!recs.length) throw new Error('LEEG'); IMP = { phase: 'ready', recs }; }
      catch (e) { IMP = { phase: 'pick', err: 'Dit bestand lijkt geen MovieMeter-CSV te zijn.' }; }
      renderImp();
    });
  },
  fgenre: el => { V.f.genre = el.value; fillItems(); },
  ftag: el => { V.f.tag = el.value; fillItems(); },
  fplat: el => { V.f.plat = el.value; fillItems(); },
  elist: el => { const e = S.entries.find(x => x.id === V.entryId); if (e) { e.list = el.value; e.u = Date.now(); commit(); toast('Verplaatst naar ' + listById(el.value).name); } },
  eseen: el => {
    const e = S.entries.find(x => x.id === V.entryId); if (!e) return;
    if (el.checked) {
      openSheet('<h3>Wanneer heb je het gezien?</h3><label class="fld">Datum gezien<input id="sd" type="date" class="in" value="' + today() + '" max="' + today() + '"></label>' +
        '<div class="cols"><button class="btn ghost" data-a="closesheet">Annuleren</button><button class="btn pri" data-a="saveseen">Opslaan</button></div>');
      fillDetail();
    } else { e.seen = ''; e.u = Date.now(); commit(); fillDetail(); }
  },
  eadded: el => { const e = S.entries.find(x => x.id === V.entryId); if (e && el.value) { e.added = new Date(el.value + 'T12:00:00').getTime(); e.u = Date.now(); commit(); } },
  eseason: el => { const e = S.entries.find(x => x.id === V.entryId); if (!e) return; const w = new Set(e.sn || []); const n = +el.dataset.n; if (el.checked) w.add(n); else w.delete(n); e.sn = [...w].sort((a, b) => a - b); e.u = Date.now(); commit(); },
  ens: el => { const e = S.entries.find(x => x.id === V.entryId); if (e) { e.ns = el.checked; if (el.checked) e.seen = ''; e.u = Date.now(); commit(); fillDetail(); } },
  ewhy: el => { const e = S.entries.find(x => x.id === V.entryId); if (e) { e.why = el.value; e.u = Date.now(); commit(); } },
  eplat: el => { const e = S.entries.find(x => x.id === V.entryId); if (!e) return; const w = new Set(e.where || []); if (el.checked) w.add(el.dataset.k); else w.delete(el.dataset.k); e.where = [...w]; e.u = Date.now(); commit(); },
  edate: el => { const e = S.entries.find(x => x.id === V.entryId); if (e && el.value) { e.seen = el.value; e.u = Date.now(); commit(); } },
  enote: el => { const e = S.entries.find(x => x.id === V.entryId); if (e) { e.note = el.value; e.u = Date.now(); commit(); } },
  rename: el => { const l = listById(el.dataset.l); if (l && el.value.trim()) { l.name = el.value.trim(); l.u = Date.now(); commit(); } },
  synctoken: el => {
    S.settings.syncToken = el.value.trim(); S.settings.gistId = ''; save();
    clearTimeout(syncT);
    if (syncOn()) syncT = setTimeout(() => syncNow(false), 1500);
  },
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
document.addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target && ev.target.id === 'tagin') { ev.preventDefault(); A.addtag(); } });
document.addEventListener('input', ev => {
  const el = ev.target.closest('[data-in]');
  if (el && IN[el.dataset.in]) IN[el.dataset.in](el);
});
window.addEventListener('hashchange', route);
function applyAccent() { document.documentElement.style.setProperty('--acc', S.settings.accent); }
applyAccent();
if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) navigator.serviceWorker.register('sw.js').catch(() => { });
route();
if (syncOn()) syncNow(true);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && syncOn() && Date.now() - lastSync > 30000) syncNow(true);
});
