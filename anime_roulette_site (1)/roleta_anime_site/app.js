(() => {
  'use strict';
  const API = 'https://graphql.anilist.co';
  const TARGET = 2000;
  const PER_PAGE = 50;
  const DB_NAME = 'anime-roulette-local';
  const STORE = 'anime';
  const META_STORE = 'meta';
  const QUERY = `query ($page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { currentPage hasNextPage }
      media(type: ANIME, isAdult: false, startDate_greater: 20101231, startDate_lesser: 20270101, sort: POPULARITY_DESC) {
        id
        title { romaji english native }
        startDate { year }
        format
        episodes
        genres
        averageScore
        description(asHtml: false)
        coverImage { large extraLarge }
        siteUrl
      }
    }
  }`;

  const $ = (id) => document.getElementById(id);
  const els = {
    status: $('statusText'), year: $('yearFilter'), genre: $('genreFilter'), format: $('formatFilter'), search: $('searchFilter'),
    spin: $('spinBtn'), load: $('loadBtn'), pause: $('pauseBtn'), helper: $('helperText'), count: $('resultCount'),
    libraryCount: $('libraryCount'), progress: $('progressBar'), progressText: $('progressText'),
    poster: $('poster'), placeholder: $('placeholder'), empty: $('emptyCopy'), result: $('resultCopy'),
    resultYear: $('resultYear'), resultTitle: $('resultTitle'), resultMeta: $('resultMeta'), resultDesc: $('resultDesc'),
    details: $('detailsLink'), history: $('history'), toast: $('toast'), resultPanel: $('resultPanel')
  };

  let db;
  let animeList = [];
  let history = [];
  let lastIds = [];
  let syncRunning = false;
  let pauseRequested = false;
  let hasNextPage = true;
  let nextPage = 1;
  let toastTimer;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(META_STORE)) d.createObjectStore(META_STORE, { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Não foi possível abrir o armazenamento local.'));
    });
  }
  function transaction(store, mode = 'readonly') { return db.transaction(store, mode).objectStore(store); }
  function getAllAnime() {
    return new Promise((resolve, reject) => {
      const req = transaction(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
  function saveAnime(items) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      items.forEach(item => store.put(item));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Falha ao salvar os animes.'));
    });
  }
  function setMeta(key, value) {
    return new Promise((resolve, reject) => {
      const req = transaction(META_STORE, 'readwrite').put({ key, value });
      req.onsuccess = resolve;
      req.onerror = () => reject(req.error);
    });
  }
  function getMeta(key) {
    return new Promise((resolve, reject) => {
      const req = transaction(META_STORE).get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = () => reject(req.error);
    });
  }
  function safeText(value = '') {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function normalize(item) {
    const title = item.title?.english || item.title?.romaji || item.title?.native || `Anime ${item.id}`;
    return {
      id: item.id,
      title,
      romaji: item.title?.romaji || title,
      year: item.startDate?.year || null,
      format: item.format || 'OTHER',
      episodes: item.episodes || null,
      genres: Array.isArray(item.genres) ? item.genres : [],
      score: item.averageScore || null,
      description: (item.description || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(),
      cover: item.coverImage?.extraLarge || item.coverImage?.large || '',
      url: item.siteUrl || `https://anilist.co/anime/${item.id}`
    };
  }
  function updateStatus() {
    const n = animeList.length;
    els.libraryCount.textContent = `${n.toLocaleString('pt-BR')} / ${TARGET.toLocaleString('pt-BR')}`;
    els.progress.style.width = `${Math.min(100, (n / TARGET) * 100)}%`;
    els.count.textContent = `${getFiltered().length.toLocaleString('pt-BR')} disponíveis`;
    if (n >= TARGET) {
      els.status.textContent = 'Biblioteca pronta';
      els.progressText.textContent = `${n.toLocaleString('pt-BR')} animes salvos neste aparelho`;
      els.load.textContent = 'Biblioteca pronta ✓';
      els.load.disabled = true;
      els.pause.hidden = true;
    } else if (syncRunning) {
      els.status.textContent = 'Preparando biblioteca';
      els.progressText.textContent = `${n.toLocaleString('pt-BR')} salvos • buscando mais títulos…`;
      els.load.textContent = 'Preparando…';
      els.load.disabled = true;
      els.pause.hidden = false;
    } else {
      els.status.textContent = n ? 'Biblioteca salva' : 'Conecte para começar';
      els.progressText.textContent = n ? `${n.toLocaleString('pt-BR')} salvos • pronto para girar` : 'Aguardando conexão';
      els.load.textContent = n ? 'Continuar até 2.000+' : 'Preparar 2.000+';
      els.load.disabled = false;
      els.pause.hidden = true;
    }
  }
  function populateFilters() {
    const currentYear = els.year.value || 'all';
    els.year.innerHTML = '<option value="all">Todos (2011–2026)</option>';
    for (let y = 2026; y >= 2011; y--) {
      const opt = document.createElement('option'); opt.value = String(y); opt.textContent = String(y); els.year.appendChild(opt);
    }
    els.year.value = currentYear;
    const chosen = els.genre.value || 'all';
    const genres = [...new Set(animeList.flatMap(a => a.genres || []))].sort((a,b) => a.localeCompare(b, 'pt-BR'));
    els.genre.innerHTML = '<option value="all">Todos os gêneros</option>';
    genres.forEach(g => { const opt = document.createElement('option'); opt.value = g; opt.textContent = g; els.genre.appendChild(opt); });
    els.genre.value = genres.includes(chosen) ? chosen : 'all';
  }
  function getFiltered() {
    const year = els.year.value;
    const genre = els.genre.value;
    const format = els.format.value;
    const term = els.search.value.trim().toLocaleLowerCase('pt-BR');
    return animeList.filter(a => {
      if (!a.year || a.year < 2011 || a.year > 2026) return false;
      if (year !== 'all' && String(a.year) !== year) return false;
      if (genre !== 'all' && !a.genres.includes(genre)) return false;
      if (format !== 'all' && a.format !== format) return false;
      if (term && !`${a.title} ${a.romaji}`.toLocaleLowerCase('pt-BR').includes(term)) return false;
      return true;
    });
  }
  function showToast(message) {
    els.toast.textContent = message; els.toast.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2800);
  }
  function pickRandom() {
    const pool = getFiltered();
    updateStatus();
    if (!pool.length) { showToast('Nenhum anime encontrado com esses filtros.'); return; }
    if (pool.length === 1) { renderResult(pool[0]); return; }
    const fresh = pool.filter(a => !lastIds.includes(a.id));
    const choices = fresh.length ? fresh : pool;
    const picked = choices[Math.floor(Math.random() * choices.length)];
    lastIds.push(picked.id); if (lastIds.length > Math.min(15, pool.length - 1)) lastIds.shift();
    renderResult(picked);
  }
  function renderResult(a) {
    els.placeholder.hidden = true; els.empty.hidden = true; els.result.hidden = false;
    els.resultYear.textContent = `${a.year || 'Ano não informado'} • ${a.format || 'ANIME'}`;
    els.resultTitle.textContent = a.title;
    els.resultMeta.textContent = [a.genres.slice(0, 3).join(' · '), a.episodes ? `${a.episodes} episódios` : '', a.score ? `Nota ${a.score}/100` : ''].filter(Boolean).join('  |  ');
    els.resultDesc.textContent = a.description || 'Sinopse não disponível nesta ficha.';
    els.details.href = a.url;
    els.poster.classList.remove('loaded');
    els.poster.onload = () => els.poster.classList.add('loaded');
    els.poster.onerror = () => { els.poster.removeAttribute('src'); els.placeholder.hidden = false; els.placeholder.textContent = '🖼️'; };
    if (a.cover) els.poster.src = a.cover; else { els.poster.removeAttribute('src'); els.placeholder.hidden = false; }
    history = [a, ...history.filter(x => x.id !== a.id)].slice(0, 8);
    renderHistory();
    els.resultPanel.classList.remove('spinning'); void els.resultPanel.offsetWidth; els.resultPanel.classList.add('spinning');
  }
  function renderHistory() {
    if (!history.length) { els.history.innerHTML = '<div class="history-empty">Seus resultados recentes aparecem aqui.</div>'; return; }
    els.history.replaceChildren();
    history.forEach(a => {
      const card = document.createElement('div'); card.className = 'history-item';
      const img = document.createElement('img'); img.loading = 'lazy'; img.alt = `Capa de ${a.title}`; img.src = a.cover || '';
      const p = document.createElement('p'); p.textContent = a.title;
      card.append(img, p); card.title = `${a.title} (${a.year || 'ano não informado'})`;
      els.history.appendChild(card);
    });
  }
  function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  async function fetchPage(page) {
    const response = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { page, perPage: PER_PAGE } })
    });
    if (response.status === 429) {
      const retry = Number(response.headers.get('Retry-After'));
      await wait(Math.max(5000, (retry || 30) * 1000));
      return fetchPage(page);
    }
    if (!response.ok) throw new Error(`A fonte respondeu com erro ${response.status}.`);
    const json = await response.json();
    if (json.errors?.length) throw new Error(json.errors[0].message || 'Erro ao consultar a fonte.');
    return json.data.Page;
  }
  async function prepareLibrary() {
    if (syncRunning || animeList.length >= TARGET || !hasNextPage) return;
    syncRunning = true; pauseRequested = false; updateStatus();
    try {
      while (animeList.length < TARGET && hasNextPage && !pauseRequested) {
        const pageData = await fetchPage(nextPage);
        const fresh = pageData.media.map(normalize).filter(a => a.year && a.year >= 2011 && a.year <= 2026 && a.cover);
        if (fresh.length) {
          await saveAnime(fresh);
          const known = new Set(animeList.map(a => a.id));
          fresh.forEach(a => { if (!known.has(a.id)) animeList.push(a); });
          animeList.sort((a,b) => (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title));
          populateFilters(); updateStatus();
        }
        hasNextPage = Boolean(pageData.pageInfo?.hasNextPage);
        nextPage = pageData.pageInfo?.currentPage ? pageData.pageInfo.currentPage + 1 : nextPage + 1;
        await setMeta('nextPage', nextPage); await setMeta('hasNextPage', hasNextPage);
        if (animeList.length < TARGET && hasNextPage && !pauseRequested) await wait(2100);
      }
      if (!hasNextPage && animeList.length < TARGET) showToast(`A fonte terminou com ${animeList.length.toLocaleString('pt-BR')} títulos neste recorte.`);
      else if (animeList.length >= TARGET) showToast('Biblioteca com 2.000+ animes pronta!');
    } catch (error) {
      console.error(error);
      showToast('Não consegui atualizar agora. Os animes já salvos continuam disponíveis.');
      els.progressText.textContent = 'Falha na conexão • tente novamente mais tarde';
    } finally {
      syncRunning = false; updateStatus();
      if (pauseRequested) { els.progressText.textContent = 'Preparação pausada • a roleta continua funcionando'; }
    }
  }
  async function init() {
    for (let y = 2026; y >= 2011; y--) { const opt = document.createElement('option'); opt.value = String(y); opt.textContent = String(y); els.year.appendChild(opt); }
    try {
      db = await openDB();
      animeList = await getAllAnime();
      nextPage = (await getMeta('nextPage')) || 1;
      const savedHasNext = await getMeta('hasNextPage');
      hasNextPage = savedHasNext === null ? true : savedHasNext;
      populateFilters(); updateStatus();
      if (animeList.length) els.helper.textContent = 'Biblioteca local carregada. Você pode girar agora; a atualização acontece em segundo plano.';
      else els.helper.textContent = 'A primeira preparação precisa de internet. Assim que os primeiros títulos chegarem, você já pode girar.';
      if (animeList.length < TARGET && hasNextPage) prepareLibrary();
    } catch (error) {
      console.error(error);
      els.status.textContent = 'Armazenamento indisponível';
      els.progressText.textContent = 'Seu navegador bloqueou o armazenamento local.';
      showToast('Abra o site em um navegador atualizado para guardar a biblioteca.');
    }
  }

  els.spin.addEventListener('click', pickRandom);
  els.load.addEventListener('click', prepareLibrary);
  els.pause.addEventListener('click', () => { pauseRequested = true; els.pause.hidden = true; });
  [els.year, els.genre, els.format].forEach(el => el.addEventListener('change', updateStatus));
  els.search.addEventListener('input', updateStatus);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(err => console.warn('Service worker:', err)));
  }
  init();
})();
