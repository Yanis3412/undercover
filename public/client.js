// =====================================================================
//  UNDERCOVER EN LIGNE - Client
//  Le client ne fait qu'afficher l'état envoyé par le serveur.
// =====================================================================
(() => {
  const socket = io();
  const $ = id => document.getElementById(id);

  // ---------- Identité locale ----------
  // sessionStorage : propre à chaque onglet, survit au rechargement de la page
  function makeToken() {
    if (window.crypto && crypto.getRandomValues) {
      const a = new Uint8Array(16);
      crypto.getRandomValues(a);
      return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
    }
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  const store = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
    del(k) { try { sessionStorage.removeItem(k); } catch {} },
    getName() { try { return localStorage.getItem('uc_name') || ''; } catch { return ''; } },
    setName(v) { try { localStorage.setItem('uc_name', v); } catch {} },
  };
  let token = store.get('uc_token');
  if (!token) { token = makeToken(); store.set('uc_token', token); }
  let roomCode = store.get('uc_room');

  let state = null;
  let wordGameId = null;
  let seenEventId = 0;
  let confettiGameId = null;
  let mwDeadline = 0;
  let mwTimer = null;
  let overlayTimer = null;
  let lastClueVisible = false;
  let lastMwVisible = false;

  // ---------- Petits utilitaires ----------
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  const COLORS = ['#ffd166', '#06d6a0', '#7bdff2', '#ff8fab', '#b8a1ff', '#ffb26b', '#9be564', '#f5a3ff', '#5ee7df', '#ffe066'];
  function colorFor(id) {
    let h = 0;
    for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return COLORS[h % COLORS.length];
  }
  function avatar(p) {
    const a = el('span', 'avatar', (p.name || '?').trim().charAt(0).toUpperCase());
    a.style.background = colorFor(p.id);
    return a;
  }
  const ROLE_LABEL = { civil: 'Civil', undercover: 'Undercover', mrwhite: 'Mr. White' };
  const ROLE_EMOJI = { civil: '😇', undercover: '🕵️', mrwhite: '🎩' };
  function roleTag(role) { return el('span', 'tag role-' + role, ROLE_EMOJI[role] + ' ' + ROLE_LABEL[role]); }
  function roleSentence(role) {
    if (role === 'civil') return 'C\'était un Civil 😇';
    if (role === 'undercover') return 'C\'était l\'Undercover 🕵️';
    return 'C\'était Mr. White 🎩';
  }

  let toastTimer = null;
  function toast(msg, isError = false) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, 2800);
  }

  function emit(event, data, onOk) {
    socket.emit(event, data || {}, res => {
      if (res && res.error) toast(res.error, true);
      else if (onOk) onOk(res);
    });
  }

  function showScreen(name) {
    for (const s of document.querySelectorAll('.screen')) s.classList.toggle('active', s.id === 'screen-' + name);
  }
  function toggle(id, visible) { $(id).classList.toggle('show', !!visible); }

  function setUrlRoom(code) {
    const url = new URL(location.href);
    if (code) url.searchParams.set('room', code); else url.searchParams.delete('room');
    history.replaceState(null, '', url.toString());
  }

  function enterRoom(code) {
    roomCode = code;
    store.set('uc_room', code);
    setUrlRoom(code);
  }
  function exitRoom(message) {
    roomCode = null;
    state = null;
    store.del('uc_room');
    setUrlRoom(null);
    hideOverlay();
    showScreen('home');
    if (message) toast(message);
  }

  // ---------- Accueil ----------
  $('home-name').value = store.getName();
  const urlRoom = new URL(location.href).searchParams.get('room');
  if (urlRoom) $('home-code').value = urlRoom.toUpperCase();

  function readName() {
    const name = $('home-name').value.trim();
    if (!name) { toast('Choisis d\'abord un pseudo 🙂', true); $('home-name').focus(); return null; }
    store.setName(name);
    return name;
  }

  $('btn-create').onclick = () => {
    const name = readName();
    if (!name) return;
    emit('create', { name, token }, res => enterRoom(res.code));
  };
  function join() {
    const name = readName();
    if (!name) return;
    const code = $('home-code').value.trim().toUpperCase();
    if (!code) { toast('Entre le code du salon', true); $('home-code').focus(); return; }
    emit('join', { code, name, token }, res => enterRoom(res.code));
  }
  $('btn-join').onclick = join;
  $('home-code').addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
  $('home-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });

  // ---------- Boutons communs ----------
  function leave() {
    if (state && !['lobby', 'end'].includes(state.phase) && state.you.inGame && state.you.alive) {
      if (!confirm('Quitter la partie en cours ? Tu seras éliminé·e.')) return;
    }
    socket.emit('leave', {}, () => {});
    exitRoom();
  }
  $('btn-leave-lobby').onclick = leave;
  $('btn-leave-game').onclick = leave;
  $('btn-leave-end').onclick = leave;

  $('btn-share').onclick = async () => {
    const link = location.origin + '/?room=' + state.code;
    const text = 'Viens jouer à Undercover\u00a0! Code : ' + state.code;
    if (navigator.share) {
      try { await navigator.share({ title: 'Undercover', text, url: link }); return; } catch { /* annulé */ }
    }
    try { await navigator.clipboard.writeText(link); toast('Lien copié ✅'); }
    catch { prompt('Copie ce lien :', link); }
  };

  // Réglages (hôte)
  $('uc-minus').onclick = () => emit('settings', { undercovers: state.settings.undercovers - 1 });
  $('uc-plus').onclick = () => emit('settings', { undercovers: state.settings.undercovers + 1 });
  $('set-mw').onclick = () => emit('settings', { mrWhite: !state.settings.mrWhite });
  for (const b of document.querySelectorAll('#set-mode button')) {
    b.onclick = () => emit('settings', { mode: b.dataset.mode });
  }
  $('btn-start').onclick = () => emit('start');
  $('btn-restart').onclick = () => emit('restart');
  $('btn-to-lobby').onclick = () => emit('lobby');
  $('btn-stop').onclick = () => { if (confirm('Arrêter la partie et revenir au salon ?')) emit('stop'); };
  $('btn-skip').onclick = () => emit('skip');

  // Carte du mot : appuyer pour montrer / cacher
  $('word-card').onclick = () => $('word-card').classList.toggle('flipped');

  $('clue-form').onsubmit = e => {
    e.preventDefault();
    const text = $('clue-input').value.trim();
    if (!text) return;
    if (/\s/.test(text)) { toast('Un seul mot\u00a0!', true); return; }
    emit('clue', { text }, () => { $('clue-input').value = ''; });
  };
  $('mw-form').onsubmit = e => {
    e.preventDefault();
    const text = $('mw-input').value.trim();
    if (!text) return;
    emit('guess', { text }, () => { $('mw-input').value = ''; });
  };

  // ---------- Socket ----------
  socket.on('connect', () => {
    $('conn').style.display = 'none';
    if (roomCode) {
      socket.emit('resume', { code: roomCode, token }, res => {
        if (res && res.error) exitRoom('La partie n\'existe plus.');
      });
    } else {
      showScreen('home');
    }
  });
  socket.on('disconnect', () => { $('conn').style.display = 'block'; });
  socket.on('state', s => { state = s; render(); });
  socket.on('kicked', () => exitRoom('Tu as été retiré·e du salon.'));
  socket.on('replaced', () => {
    roomCode = null;
    state = null;
    showScreen('home');
    toast('Ta partie est ouverte dans un autre onglet.', true);
  });

  // ---------- Rendu ----------
  function render() {
    if (!state) { showScreen('home'); return; }
    if (state.phase === 'lobby') renderLobby();
    else if (state.phase === 'end') renderEnd();
    else renderGame();
    handleEvent();
  }

  function validate(s, count) {
    const inf = s.undercovers + (s.mrWhite ? 1 : 0);
    const civils = count - inf;
    if (count < 3) return { ok: false, msg: 'Il faut au moins 3 joueurs pour lancer.' };
    if (civils < 2 || civils <= inf) return { ok: false, msg: 'Trop d\'infiltrés : il faut plus de Civils que d\'infiltrés.' };
    return { ok: true, civils };
  }

  const MODE_DESC = {
    normal: 'Deux mots proches de la même famille (ex : Chat / Chien).',
    hard: 'Deux mots plus éloignés avec un lien indirect (ex : Chat / Viande). L\'Undercover doit bluffer fort\u00a0!',
    mixte: 'Un coup Normal, un coup Hard, au hasard.',
  };

  function renderLobby() {
    showScreen('lobby');
    const { you, settings } = state;
    $('lobby-code').textContent = state.code;

    const list = $('lobby-players');
    list.replaceChildren();
    for (const p of state.players) {
      const li = el('li', p.connected ? '' : 'offline');
      li.append(avatar(p), el('span', 'name', p.name));
      if (p.isHost) li.append(el('span', 'tag host', '👑 Hôte'));
      if (p.id === you.id) li.append(el('span', 'tag you', 'toi'));
      if (!p.connected) li.append(el('span', 'tag off', 'déconnecté'));
      if (you.isHost && p.id !== you.id) {
        const k = el('button', 'kick', '✕');
        k.title = 'Retirer ' + p.name;
        k.onclick = () => { if (confirm('Retirer ' + p.name + ' du salon ?')) emit('kick', { playerId: p.id }); };
        li.append(k);
      }
      list.append(li);
    }
    const connected = state.players.filter(p => p.connected).length;
    $('lobby-count').textContent = connected;

    // Réglages
    const host = you.isHost;
    $('settings-lock').style.display = host ? 'none' : '';
    $('set-uc').textContent = settings.undercovers;
    $('uc-minus').disabled = !host || settings.undercovers <= 1;
    $('uc-plus').disabled = !host || settings.undercovers >= 9;
    $('set-mw').classList.toggle('on', settings.mrWhite);
    $('set-mw').setAttribute('aria-checked', String(settings.mrWhite));
    $('set-mw').disabled = !host;
    for (const b of document.querySelectorAll('#set-mode button')) {
      b.classList.toggle('active', b.dataset.mode === settings.mode);
      b.disabled = !host;
    }
    $('mode-desc').textContent = MODE_DESC[settings.mode];

    const v = validate(settings, connected);
    const summary = $('lobby-summary');
    summary.replaceChildren();
    if (v.ok) {
      const parts = [v.civils + ' Civil' + (v.civils > 1 ? 's' : ''),
        settings.undercovers + ' Undercover' + (settings.undercovers > 1 ? 's' : '')];
      if (settings.mrWhite) parts.push('1 Mr. White');
      summary.textContent = connected + ' joueurs : ' + parts.join(' · ');
    } else {
      summary.append(el('span', 'warn', v.msg));
    }

    $('btn-start').style.display = host ? '' : 'none';
    $('btn-start').disabled = !v.ok;
    const hostP = state.players.find(p => p.isHost);
    $('lobby-wait').textContent = host ? '' : 'En attente de ' + (hostP ? hostP.name : 'l\'hôte') + ' pour lancer la partie…';
  }

  function renderClues(container, clues, currentRound) {
    container.replaceChildren();
    if (!clues.length) { container.append(el('p', 'empty', 'Aucun indice pour l\'instant.')); return; }
    const rounds = [...new Set(clues.map(c => c.round))].sort((a, b) => b - a);
    for (const r of rounds) {
      const block = el('div', 'clue-round');
      block.append(el('h4', null, 'Tour ' + r + (r === currentRound ? ' (en cours)' : '')));
      const listEl = el('div', 'clue-list');
      for (const c of clues.filter(x => x.round === r)) {
        const chip = el('span', 'clue' + (c.skipped ? ' skipped' : ''));
        chip.append(el('span', 'who', c.name), el('span', 'what', c.text));
        listEl.append(chip);
      }
      block.append(listEl);
      container.append(block);
    }
  }

  function renderGame() {
    showScreen('game');
    const { you, players, phase } = state;
    const byId = id => players.find(p => p.id === id);
    $('game-round').textContent = 'Tour ' + state.round;
    $('game-code').textContent = state.code;

    // Carte du mot (cachée à chaque nouvelle partie)
    const card = $('word-card');
    if (wordGameId !== state.gameId) { wordGameId = state.gameId; card.classList.remove('flipped'); }
    card.style.display = you.inGame ? '' : 'none';
    card.classList.toggle('mrwhite', you.isMrWhite);
    card.classList.toggle('dead', you.inGame && !you.alive);
    if (you.isMrWhite) {
      $('word-label').textContent = 'Tu es';
      $('word-text').textContent = 'Mr. White 🎩';
      $('word-sub').textContent = 'Pas de mot pour toi : écoute les autres et bluffe\u00a0!';
    } else {
      $('word-label').textContent = 'Ton mot';
      $('word-text').textContent = you.word || '';
      $('word-sub').textContent = 'Appuie pour cacher';
    }

    // Bandeau de statut personnel
    const status = $('status-banner');
    status.classList.remove('info');
    if (!you.inGame) {
      status.textContent = 'Partie en cours… tu joueras à la prochaine\u00a0! 👀';
      status.classList.add('info');
      toggle('status-banner', true);
    } else if (!you.alive) {
      status.textContent = 'Tu es éliminé·e — ' + roleSentence(you.role).replace('C\'était', 'tu étais').replace('tu étais un', 'tu étais un');
      toggle('status-banner', true);
    } else {
      toggle('status-banner', false);
    }

    // Bandeau de phase
    const banner = $('phase-banner');
    banner.className = 'phase-banner show';
    banner.replaceChildren();
    let clueVisible = false, voteVisible = false, mwVisible = false;

    if (phase === 'clues') {
      const current = byId(state.turn.currentId);
      if (current && current.id === you.id) {
        banner.classList.add('your-turn');
        banner.append('C\'est ton tour\u00a0!', el('small', null, 'Donne un indice d\'un seul mot'));
        clueVisible = true;
      } else {
        banner.append('Au tour de ' + (current ? current.name : '…'));
        if (current && !current.connected) banner.append(el('small', null, 'Déconnecté·e… tour passé automatiquement s\'il ne revient pas'));
      }
    } else if (phase === 'vote') {
      const v = state.vote;
      if (v.revote) {
        const names = v.candidates.map(id => (byId(id) || {}).name).filter(Boolean).join(', ');
        banner.append('Égalité\u00a0! Nouveau vote', el('small', null, 'Entre : ' + names));
      } else {
        banner.append('Place au vote 🗳️', el('small', null, 'Qui est l\'intrus ?'));
      }
      banner.lastChild.append(' · ' + v.votedCount + '/' + v.voterCount + ' ont voté');
      voteVisible = you.inGame && you.alive;
    } else if (phase === 'mrwhite') {
      const mw = state.mrWhite;
      mwDeadline = Date.now() + mw.remainingMs;
      if (mw.playerId === you.id) {
        banner.classList.add('your-turn');
        banner.append('Devine le mot des Civils\u00a0!', el('small', 'mw-count', ''));
        mwVisible = true;
      } else {
        banner.append(mw.name + ' était Mr. White 🎩', el('small', 'mw-count', ''));
      }
      startMwTimer();
    }
    if (phase !== 'mrwhite') stopMwTimer();

    toggle('clue-box', clueVisible);
    if (clueVisible && !lastClueVisible) setTimeout(() => $('clue-input').focus(), 50);
    lastClueVisible = clueVisible;
    toggle('mw-box', mwVisible);
    if (mwVisible && !lastMwVisible) setTimeout(() => $('mw-input').focus(), 50);
    lastMwVisible = mwVisible;

    // Vote
    toggle('vote-box', voteVisible);
    if (voteVisible) {
      const v = state.vote;
      $('vote-title').textContent = v.revote ? 'Départage les ex aequo' : 'Qui est l\'intrus ?';
      const grid = $('vote-options');
      grid.replaceChildren();
      for (const id of v.candidates) {
        if (id === you.id) continue;
        const p = byId(id);
        if (!p) continue;
        const b = el('button', 'vote-btn' + (v.yourVote === id ? ' selected' : ''));
        b.type = 'button';
        b.append(avatar(p), el('span', 'n', p.name));
        b.onclick = () => emit('vote', { targetId: id });
        grid.append(b);
      }
      $('vote-progress').textContent = v.yourVote
        ? 'Vote enregistré ✅ (tu peux encore changer)'
        : 'Touche un joueur pour voter';
    }

    // Outils de l'hôte
    toggle('host-tools', you.isHost && phase === 'clues');
    if (phase === 'clues') {
      const current = byId(state.turn.currentId);
      $('btn-skip').textContent = '⏭ Passer le tour de ' + (current ? current.name : '…');
    }
    $('btn-stop').style.display = you.isHost ? '' : 'none';

    // Joueurs : dans l'ordre de parole, puis les éliminés, puis les spectateurs
    const grid = $('game-players');
    grid.replaceChildren();
    const ingame = players.filter(p => p.inGame);
    let ordered = ingame;
    if (phase === 'clues') {
      const order = state.turn.order;
      ordered = [...ingame].sort((a, b) => {
        const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
      });
    }
    ordered = [...ordered.filter(p => p.alive), ...ordered.filter(p => !p.alive)];
    for (const p of ordered) {
      const isCurrent = phase === 'clues' && state.turn.currentId === p.id;
      const li = el('li', [isCurrent ? 'current' : '', p.alive ? '' : 'dead', p.connected ? '' : 'offline'].join(' ').trim());
      const info = el('span', 'info');
      info.append(el('span', 'name', p.name + (p.id === you.id ? ' (toi)' : '')));
      if (!p.alive && p.role) info.append(roleTag(p.role));
      else if (!p.connected) info.append(el('span', 'tag off', 'déconnecté'));
      else if (p.isHost) info.append(el('span', 'tag host', '👑 Hôte'));
      li.append(avatar(p), info);
      if (isCurrent) li.append(el('span', 'speaking', '💬'));
      if (phase === 'vote' && p.hasVoted) li.append(el('span', 'voted', '✓'));
      grid.append(li);
    }
    const waiting = players.filter(p => !p.inGame);
    for (const p of waiting) {
      const li = el('li', 'dead' + (p.connected ? '' : ' offline'));
      const info = el('span', 'info');
      info.append(el('span', 'name', p.name), el('span', 'tag', 'en attente'));
      li.style.textDecoration = 'none';
      li.append(avatar(p), info);
      grid.append(li);
    }

    renderClues($('clue-history'), state.clues, state.round);
  }

  function startMwTimer() {
    if (mwTimer) return;
    const tick = () => {
      const s = Math.max(0, Math.ceil((mwDeadline - Date.now()) / 1000));
      for (const n of document.querySelectorAll('.mw-count')) n.textContent = '⏱ ' + s + ' s pour deviner le mot';
    };
    tick();
    mwTimer = setInterval(tick, 250);
  }
  function stopMwTimer() { clearInterval(mwTimer); mwTimer = null; }

  function renderEnd() {
    showScreen('end');
    stopMwTimer();
    const { end, you, players } = state;
    const banner = $('end-banner');
    banner.className = 'end-banner ' + end.winner;
    const texts = {
      civils: ['🎉', 'Victoire des Civils\u00a0!', 'Les infiltrés ont été démasqués.'],
      infiltres: ['😈', 'Victoire des infiltrés\u00a0!', 'Les Civils se sont fait berner.'],
      mrwhite: ['🎩', 'Mr. White a trouvé le mot\u00a0!', 'Il remporte la partie à lui tout seul.'],
    }[end.winner];
    $('end-emoji').textContent = texts[0];
    $('end-title').textContent = texts[1];
    $('end-sub').textContent = texts[2];
    $('end-civil').textContent = end.civilWord;
    $('end-uc').textContent = end.undercoverWord;
    $('end-mode').textContent = end.mode === 'hard' ? 'Mode Hard 🔥' : 'Mode Normal';

    const isWinner = p => end.winner === 'civils' ? p.role === 'civil'
      : end.winner === 'mrwhite' ? p.role === 'mrwhite'
        : p.role === 'undercover' || p.role === 'mrwhite';
    const list = $('end-players');
    list.replaceChildren();
    const ingame = players.filter(p => p.inGame);
    const roleOrder = { undercover: 0, mrwhite: 1, civil: 2 };
    ingame.sort((a, b) => roleOrder[a.role] - roleOrder[b.role]);
    for (const p of ingame) {
      const li = el('li', isWinner(p) ? 'winner' : '');
      li.append(avatar(p));
      const name = el('span', 'name', p.name + (p.id === you.id ? ' (toi)' : '') + (isWinner(p) ? ' 🏆' : ''));
      li.append(name, roleTag(p.role));
      list.append(li);
    }
    renderClues($('end-clues'), state.clues, null);

    $('btn-restart').style.display = you.isHost ? '' : 'none';
    $('btn-to-lobby').style.display = you.isHost ? '' : 'none';
    $('end-wait').style.display = you.isHost ? 'none' : '';
    const connected = players.filter(p => p.connected).length;
    $('btn-restart').disabled = !validate(state.settings, connected).ok;

    if (confettiGameId !== state.gameId) {
      confettiGameId = state.gameId;
      const won = you.inGame && isWinner(players.find(p => p.id === you.id) || {});
      if (won || !you.inGame) confetti();
    }
  }

  // ---------- Événements (élimination, égalité, Mr. White…) ----------
  function handleEvent() {
    const ev = state.event;
    if (!ev || ev.id <= seenEventId) return;
    seenEventId = ev.id;
    if (ev.ageMs > 8000) return; // trop ancien (ex : après un rechargement)
    const card = $('overlay-card');
    card.replaceChildren();
    let duration = 4500;

    if (ev.type === 'elimination') {
      card.append(el('div', 'big', '🗳️'));
      card.append(el('h2', null, ev.name + ' est éliminé·e'));
      if (ev.random) card.append(el('p', null, 'Encore égalité… le sort a décidé\u00a0!'));
      card.append(el('div', 'role-reveal ' + ev.role, roleSentence(ev.role)));
      if (ev.role === 'mrwhite') card.append(el('p', null, 'Il a une dernière chance : deviner le mot des Civils…'));
      card.append(tallyList(ev.tally));
      duration = 5000;
    } else if (ev.type === 'tie') {
      card.append(el('div', 'big', '⚖️'));
      card.append(el('h2', null, 'Égalité\u00a0!'));
      card.append(el('p', null, 'Nouveau vote entre : ' + ev.names.join(', ')));
      card.append(tallyList(ev.tally));
    } else if (ev.type === 'guess') {
      if (ev.timeout) {
        card.append(el('div', 'big', '⏱️'), el('h2', null, 'Temps écoulé\u00a0!'), el('p', null, ev.name + ' n\'a rien proposé.'));
      } else if (ev.correct) {
        card.append(el('div', 'big', '🎩'), el('h2', null, 'Bien joué ' + ev.name + '\u00a0!'), el('p', null, '« ' + ev.guess + ' » : c\'est le bon mot\u00a0!'));
      } else {
        card.append(el('div', 'big', '❌'), el('h2', null, 'Raté\u00a0!'), el('p', null, ev.name + ' a proposé « ' + ev.guess + ' »… mauvaise réponse.'));
      }
    } else if (ev.type === 'left') {
      card.append(el('div', 'big', '🚪'));
      card.append(el('h2', null, ev.name + (ev.reason === 'kick' ? ' a été retiré·e' : ' a quitté la partie')));
      if (ev.role) card.append(el('div', 'role-reveal ' + ev.role, roleSentence(ev.role)));
      duration = 3500;
    } else {
      return;
    }
    card.append(el('p', 'tap', 'Touche pour fermer'));
    $('overlay').classList.add('show');
    clearTimeout(overlayTimer);
    overlayTimer = setTimeout(hideOverlay, duration);
  }
  function tallyList(tally) {
    const ul = el('ul', 'tally');
    for (const t of tally || []) {
      const li = el('li');
      li.append(el('b', null, t.name), ' — ' + t.count + ' vote' + (t.count > 1 ? 's' : '') + ' (' + t.voters.join(', ') + ')');
      ul.append(li);
    }
    return ul;
  }
  function hideOverlay() { $('overlay').classList.remove('show'); clearTimeout(overlayTimer); }
  $('overlay').onclick = hideOverlay;

  function confetti() {
    const box = $('confetti');
    const colors = ['#ff4d8d', '#ffa23c', '#19d3ff', '#2ee59d', '#7b5cff', '#ffe066'];
    for (let i = 0; i < 90; i++) {
      const c = el('i');
      c.style.left = Math.random() * 100 + 'vw';
      c.style.background = colors[i % colors.length];
      c.style.animationDuration = 2.2 + Math.random() * 2 + 's';
      c.style.animationDelay = Math.random() * 0.6 + 's';
      c.style.transform = 'rotate(' + Math.random() * 360 + 'deg)';
      box.append(c);
    }
    setTimeout(() => box.replaceChildren(), 5000);
  }

  showScreen('home');
})();
