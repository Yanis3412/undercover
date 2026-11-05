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
  const session = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
    del(k) { try { sessionStorage.removeItem(k); } catch {} },
  };
  const local = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };

  let token = session.get('uc_token');
  if (!token) { token = makeToken(); session.set('uc_token', token); }
  let roomCode = session.get('uc_room');

  let myAvatar = parseInt(local.get('uc_avatar'), 10);
  if (!(myAvatar >= 0 && myAvatar < window.AVATAR_COUNT)) myAvatar = Math.floor(Math.random() * window.AVATAR_COUNT);

  let state = null;
  let wordGameId = null;
  let seenEventId = 0;
  let mwDeadline = 0;
  let mwTimer = null;
  let overlayTimer = null;
  let lastClueVisible = false;
  let lastMwVisible = false;

  // ---------- Utilitaires ----------
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function avatarEl(index, extraClass) {
    const a = el('span', 'avatar' + (extraClass ? ' ' + extraClass : ''));
    a.innerHTML = window.avatarSVG(index); // SVG généré localement, aucune donnée utilisateur dedans
    return a;
  }
  const ROLE_NAME = { civil: 'Civil', undercover: 'Undercover', mrwhite: 'Mr. White' };
  function roleEl(role, tag = 'span') { return el(tag, 'role ' + role, ROLE_NAME[role]); }
  function verdictText(role) {
    if (role === 'civil') return 'C\'était un Civil';
    if (role === 'undercover') return 'C\'était l\'Undercover';
    return 'C\'était Mr. White';
  }
  function plural(n, word) { return n + ' ' + word + (n > 1 ? 's' : ''); }
  function listNames(names) {
    if (names.length <= 1) return names.join('');
    return names.slice(0, -1).join(', ') + ' et ' + names[names.length - 1];
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

  function setUrlRoom(code) {
    const url = new URL(location.href);
    if (code) url.searchParams.set('room', code); else url.searchParams.delete('room');
    history.replaceState(null, '', url.toString());
  }
  function enterRoom(code) {
    roomCode = code;
    session.set('uc_room', code);
    setUrlRoom(code);
  }
  function exitRoom(message) {
    roomCode = null;
    state = null;
    session.del('uc_room');
    setUrlRoom(null);
    hideOverlay();
    renderPicker($('home-avatars'), myAvatar, pickHomeAvatar);
    showScreen('home');
    if (message) toast(message);
  }

  // ---------- Sélecteur d'avatar ----------
  function renderPicker(container, selected, onPick) {
    if (container.childElementCount !== window.AVATAR_COUNT) {
      container.replaceChildren();
      for (let i = 0; i < window.AVATAR_COUNT; i++) {
        const b = el('button', 'avatar-option');
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-label', 'Avatar ' + (i + 1));
        b.dataset.index = i;
        b.append(avatarEl(i));
        b.onclick = () => onPick(i);
        container.append(b);
      }
    }
    for (const b of container.children) {
      b.setAttribute('aria-checked', String(Number(b.dataset.index) === selected));
    }
  }
  function saveAvatar(i) { myAvatar = i; local.set('uc_avatar', String(i)); }
  function pickHomeAvatar(i) { saveAvatar(i); renderPicker($('home-avatars'), i, pickHomeAvatar); }
  function pickLobbyAvatar(i) {
    saveAvatar(i);
    renderPicker($('lobby-avatars'), i, pickLobbyAvatar);
    emit('avatar', { avatar: i });
  }

  // ---------- Accueil ----------
  $('home-name').value = local.get('uc_name') || '';
  renderPicker($('home-avatars'), myAvatar, pickHomeAvatar);
  const urlRoom = new URL(location.href).searchParams.get('room');
  if (urlRoom) $('home-code').value = urlRoom.toUpperCase();

  function readName() {
    const name = $('home-name').value.trim();
    if (!name) { toast('Choisis d\'abord un pseudo.', true); $('home-name').focus(); return null; }
    local.set('uc_name', name);
    return name;
  }
  $('btn-create').onclick = () => {
    const name = readName();
    if (!name) return;
    emit('create', { name, token, avatar: myAvatar }, res => enterRoom(res.code));
  };
  function join() {
    const name = readName();
    if (!name) return;
    const code = $('home-code').value.trim().toUpperCase();
    if (!code) { toast('Entre le code du salon.', true); $('home-code').focus(); return; }
    emit('join', { code, name, token, avatar: myAvatar }, res => enterRoom(res.code));
  }
  $('btn-join').onclick = join;
  $('home-code').addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
  $('home-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });

  // ---------- Boutons communs ----------
  function leave() {
    if (state && !['lobby', 'end'].includes(state.phase) && state.you.inGame && state.you.alive) {
      if (!confirm('Quitter la partie en cours ? Tu seras éliminé.')) return;
    }
    socket.emit('leave', {}, () => {});
    exitRoom();
  }
  $('btn-leave-lobby').onclick = leave;
  $('btn-leave-game').onclick = leave;
  $('btn-leave-end').onclick = leave;

  $('btn-share').onclick = async () => {
    const link = location.origin + '/?room=' + state.code;
    if (navigator.share) {
      try { await navigator.share({ title: 'Undercover', text: 'Rejoins ma partie d\'Undercover, code ' + state.code, url: link }); return; } catch { /* annulé */ }
    }
    try { await navigator.clipboard.writeText(link); toast('Lien copié'); }
    catch { prompt('Copie ce lien :', link); }
  };

  $('uc-minus').onclick = () => emit('settings', { undercovers: state.settings.undercovers - 1 });
  $('uc-plus').onclick = () => emit('settings', { undercovers: state.settings.undercovers + 1 });
  $('set-mw').onclick = () => emit('settings', { mrWhite: !state.settings.mrWhite });
  for (const b of document.querySelectorAll('#set-mode button')) b.onclick = () => emit('settings', { mode: b.dataset.mode });
  for (const b of document.querySelectorAll('#set-clues button')) b.onclick = () => emit('settings', { cluesPerRound: Number(b.dataset.clues) });
  $('btn-start').onclick = () => emit('start');
  $('btn-restart').onclick = () => emit('restart');
  $('btn-to-lobby').onclick = () => emit('lobby');
  $('btn-stop').onclick = () => { if (confirm('Arrêter la partie et revenir au salon ?')) emit('stop'); };
  $('btn-skip').onclick = () => emit('skip');
  $('word-card').onclick = () => { $('word-card').classList.toggle('revealed'); if (state) render(); };

  $('clue-form').onsubmit = e => {
    e.preventDefault();
    const text = $('clue-input').value.trim();
    if (!text) return;
    if (/\s/.test(text)) { toast('Un seul mot, sans espace.', true); return; }
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
        if (res && res.error) exitRoom('Cette partie n\'existe plus.');
      });
    } else {
      showScreen('home');
    }
  });
  socket.on('disconnect', () => { $('conn').style.display = 'block'; });
  socket.on('state', s => { state = s; render(); });
  socket.on('kicked', () => exitRoom('L\'hôte t\'a retiré du salon.'));
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
    if (civils < 2 || civils <= inf) return { ok: false, msg: 'Trop d\'intrus pour ce nombre de joueurs : il faut plus de Civils que d\'intrus.' };
    return { ok: true, civils };
  }

  const MODE_DESC = {
    normal: 'Deux mots proches, comme Chat et Chien.',
    hard: 'Deux mots éloignés, comme Chat et Viande. L\'Undercover doit bluffer.',
    mixte: 'Normal ou Hard, au hasard à chaque partie.',
  };

  // Construit une colonne de la rangée
  function suspectEl(p, opts = {}) {
    const node = el(opts.button ? 'button' : 'div', 'suspect');
    if (opts.button) node.type = 'button';
    const wall = el('div', 'suspect-wall');
    wall.append(avatarEl(p.avatar));
    wall.append(el('div', 'suspect-name', p.name));
    const meta = el('div', 'suspect-meta');
    wall.append(meta);
    node.append(wall);
    node._meta = meta;
    return node;
  }

  // ----- Salon -----
  function renderLobby() {
    showScreen('lobby');
    const { you, settings } = state;
    $('lobby-code').textContent = state.code;

    const lineup = $('lobby-lineup');
    lineup.replaceChildren();
    for (const p of state.players) {
      const s = suspectEl(p);
      if (!p.connected) { s.classList.add('offline'); s._meta.textContent = 'déconnecté'; }
      else if (p.isHost) { s._meta.textContent = 'hôte'; s._meta.classList.add('host'); }
      else if (p.id === you.id) s._meta.textContent = 'toi';
      if (p.id === you.id && p.isHost) s._meta.textContent = 'hôte, toi';
      if (you.isHost && p.id !== you.id) {
        const k = el('button', 'kick', '×');
        k.type = 'button';
        k.title = 'Retirer ' + p.name;
        k.setAttribute('aria-label', 'Retirer ' + p.name);
        k.onclick = () => { if (confirm('Retirer ' + p.name + ' du salon ?')) emit('kick', { playerId: p.id }); };
        s.append(k);
      }
      lineup.append(s);
    }
    const connected = state.players.filter(p => p.connected).length;
    $('lobby-count').textContent = connected;

    const me = state.players.find(p => p.id === you.id);
    if (me) { myAvatar = me.avatar; local.set('uc_avatar', String(me.avatar)); }
    renderPicker($('lobby-avatars'), myAvatar, pickLobbyAvatar);

    const host = you.isHost;
    $('settings-lock').style.display = host ? 'none' : '';
    $('set-uc').textContent = settings.undercovers;
    $('uc-minus').disabled = !host || settings.undercovers <= 1;
    $('uc-plus').disabled = !host || settings.undercovers >= 9;
    $('set-mw').setAttribute('aria-checked', String(settings.mrWhite));
    $('set-mw').disabled = !host;
    for (const b of document.querySelectorAll('#set-mode button')) {
      b.classList.toggle('active', b.dataset.mode === settings.mode);
      b.disabled = !host;
    }
    for (const b of document.querySelectorAll('#set-clues button')) {
      b.classList.toggle('active', Number(b.dataset.clues) === settings.cluesPerRound);
      b.disabled = !host;
    }
    $('mode-desc').textContent = MODE_DESC[settings.mode];

    const v = validate(settings, connected);
    const summary = $('lobby-summary');
    summary.replaceChildren();
    if (v.ok) {
      const parts = [plural(v.civils, 'Civil'), plural(settings.undercovers, 'Undercover')];
      if (settings.mrWhite) parts.push('1 Mr. White');
      summary.append(el('strong', null, connected + ' joueurs'), ' : ' + parts.join(', ') + '.');
    } else {
      summary.append(el('span', 'warn', v.msg));
    }

    $('btn-start').style.display = host ? '' : 'none';
    $('btn-start').disabled = !v.ok;
    const hostP = state.players.find(p => p.isHost);
    $('lobby-wait').textContent = host ? '' : 'En attente de ' + (hostP ? hostP.name : 'l\'hôte') + ' pour lancer la partie.';
  }

  // Ordre stable des colonnes : l'ordre des sièges, puis les spectateurs
  function orderedPlayers() {
    const seats = state.seats || [];
    const inGame = state.players.filter(p => p.inGame)
      .sort((a, b) => {
        const ia = seats.indexOf(a.id), ib = seats.indexOf(b.id);
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
      });
    return { inGame, spectators: state.players.filter(p => !p.inGame) };
  }

  // Liste des mots d'un joueur : les manches précédentes en discret, la manche en cours en avant
  function cluesEl(playerId, { currentRound, pendingFor, extraFirst } = {}) {
    const ul = el('ul', 'clues');
    if (extraFirst) ul.append(extraFirst);
    const mine = state.clues.filter(c => c.playerId === playerId);
    let lastRound = null;
    for (const c of mine) {
      if (lastRound !== null && c.round !== lastRound) ul.append(el('li', 'round-sep'));
      lastRound = c.round;
      const old = currentRound && c.round < currentRound;
      const li = el('li', (c.skipped ? 'skipped' : '') + (old ? ' old' : ''), c.skipped ? (c.text === '(absent)' ? 'absent' : 'passé') : c.text);
      li.title = 'Manche ' + c.round;
      ul.append(li);
    }
    if (pendingFor === playerId) {
      if (lastRound !== null && lastRound !== currentRound) ul.append(el('li', 'round-sep'));
      ul.append(el('li', 'pending', '…'));
    }
    return ul;
  }

  // Réduit la taille des mots trop longs pour qu'ils tiennent dans leur colonne
  function fitClues(container) {
    for (const li of container.querySelectorAll('.clues li')) {
      if (li.classList.contains('round-sep') || li.classList.contains('pending')) continue;
      li.style.fontSize = '';
      let size = parseFloat(getComputedStyle(li).fontSize);
      while (li.scrollWidth > li.clientWidth && size > 8) {
        size -= 0.5;
        li.style.fontSize = size + 'px';
      }
      li.title = li.textContent;
    }
  }
  window.addEventListener('resize', () => {
    for (const id of ['game-lineup', 'end-lineup']) fitClues($(id));
  });

  // ----- Partie -----
  function renderGame() {
    showScreen('game');
    const { you, phase } = state;
    const byId = id => state.players.find(p => p.id === id);
    const cpr = state.settings.cluesPerRound || 1;

    $('game-round').textContent = 'Manche ' + state.round;
    $('game-pass').textContent =
      phase === 'clues' ? (cpr > 1 ? 'Indice ' + (state.turn.pass + 1) + ' sur ' + cpr : 'Indices')
        : phase === 'vote' ? 'Vote' : 'Dernière chance';
    $('game-code').textContent = state.code;

    // Carte du mot (masquée à chaque nouvelle partie)
    const card = $('word-card');
    if (wordGameId !== state.gameId) { wordGameId = state.gameId; card.classList.remove('revealed'); }
    card.style.display = you.inGame ? '' : 'none';
    card.classList.toggle('mrwhite', you.isMrWhite);
    card.classList.toggle('dead', you.inGame && !you.alive);
    if (you.isMrWhite) {
      $('word-label').textContent = 'Ton rôle';
      $('word-text').textContent = 'Mr. White';
      $('word-hint').textContent = 'Tu n\'as pas de mot. Écoute les autres et bluffe.';
    } else {
      $('word-label').textContent = 'Ton mot';
      $('word-text').textContent = you.word || '';
      $('word-hint').textContent = card.classList.contains('revealed') ? 'Touche pour masquer' : 'Touche pour afficher';
    }
    if (you.inGame && !you.alive && you.role) {
      $('word-hint').textContent = 'Tu es éliminé. Tu étais ' + (you.role === 'civil' ? 'Civil' : you.role === 'undercover' ? 'l\'Undercover' : 'Mr. White') + '.';
    }

    // Invite
    const prompt = $('prompt');
    prompt.classList.remove('active');
    let title = '', sub = '', clueVisible = false, mwVisible = false;
    if (!you.inGame) {
      title = 'Partie en cours';
      sub = 'Tu joueras à la prochaine partie. En attendant, observe.';
    } else if (phase === 'clues') {
      const current = byId(state.turn.currentId);
      if (current && current.id === you.id) {
        title = 'À toi de jouer';
        sub = 'Donne un mot en rapport avec le tien.';
        prompt.classList.add('active');
        clueVisible = true;
      } else {
        title = 'Au tour de ' + (current ? current.name : '…');
        sub = current && !current.connected ? 'Déconnecté. Son tour sera passé s\'il ne revient pas.' : '';
      }
    } else if (phase === 'vote') {
      const v = state.vote;
      const canVote = you.inGame && you.alive;
      title = v.revote ? 'Égalité, on revote' : 'Qui est l\'intrus ?';
      if (canVote) {
        const target = v.yourVote && byId(v.yourVote);
        sub = target
          ? 'Tu votes contre ' + target.name + '. Tu peux changer tant que le vote est ouvert.'
          : (v.revote ? 'Choisis entre les ex aequo. ' : '') + 'Touche le joueur que tu suspectes.';
        prompt.classList.toggle('active', !v.yourVote);
      } else {
        sub = 'Les joueurs encore en jeu votent.';
      }
      sub += ' ' + v.votedCount + ' sur ' + v.voterCount + ' ont voté.';
    } else if (phase === 'mrwhite') {
      const mw = state.mrWhite;
      mwDeadline = Date.now() + mw.remainingMs;
      if (mw.playerId === you.id) {
        title = 'Dernière chance';
        prompt.classList.add('active');
        mwVisible = true;
      } else {
        title = mw.name + ' était Mr. White';
      }
      startMwTimer();
    }
    if (phase !== 'mrwhite') stopMwTimer();
    $('prompt-title').textContent = title;
    $('prompt-sub').textContent = sub;
    if (phase === 'mrwhite') updateMwSub();

    $('clue-form').classList.toggle('show', clueVisible);
    if (clueVisible && !lastClueVisible) setTimeout(() => $('clue-input').focus(), 50);
    lastClueVisible = clueVisible;
    $('mw-form').classList.toggle('show', mwVisible);
    if (mwVisible && !lastMwVisible) setTimeout(() => $('mw-input').focus(), 50);
    lastMwVisible = mwVisible;

    // Rangée
    const lineup = $('game-lineup');
    lineup.replaceChildren();
    const voting = phase === 'vote' && you.inGame && you.alive;
    lineup.classList.toggle('voting', voting);
    const { inGame, spectators } = orderedPlayers();
    const currentId = phase === 'clues' ? state.turn.currentId : null;

    for (const p of inGame) {
      const votable = voting && p.alive && p.id !== you.id && state.vote.candidates.includes(p.id);
      const s = suspectEl(p, { button: votable });
      if (votable) {
        s.classList.add('votable');
        s.setAttribute('aria-label', 'Voter contre ' + p.name);
        s.onclick = () => emit('vote', { targetId: p.id });
      }
      if (p.id === currentId) s.classList.add('current');
      if (!p.alive) s.classList.add('dead');
      if (!p.connected) s.classList.add('offline');
      const selected = voting && state.vote.yourVote === p.id;
      if (selected) s.classList.add('selected');

      const meta = s._meta;
      if (!p.alive && p.role) meta.append(roleEl(p.role));
      else if (selected) meta.textContent = 'ton vote';
      else if (phase === 'vote' && p.alive && p.hasVoted) meta.append(el('span', 'voted-mark', 'a voté'));
      else if (p.id === currentId) meta.textContent = 'parle';
      else if (!p.connected) meta.textContent = 'déconnecté';
      else if (p.id === you.id) meta.textContent = 'toi';

      s.append(cluesEl(p.id, { currentRound: state.round, pendingFor: currentId }));
      lineup.append(s);
    }
    for (const p of spectators) {
      const s = suspectEl(p);
      s.classList.add('spectator');
      s._meta.textContent = 'spectateur';
      s.append(el('ul', 'clues'));
      lineup.append(s);
    }
    fitClues(lineup);
    // Garde le joueur qui parle visible sur petit écran
    const cur = lineup.querySelector('.suspect.current');
    if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });

    // Outils de l'hôte
    const host = you.isHost;
    $('host-tools').style.display = host ? '' : 'none';
    $('btn-skip').style.display = host && phase === 'clues' ? '' : 'none';
    if (phase === 'clues') {
      const current = byId(state.turn.currentId);
      $('btn-skip').textContent = 'Passer le tour de ' + (current ? current.name : '…');
    }
  }

  function updateMwSub() {
    const s = Math.max(0, Math.ceil((mwDeadline - Date.now()) / 1000));
    const mine = state && state.mrWhite && state.mrWhite.playerId === state.you.id;
    $('prompt-sub').textContent = (mine
      ? 'Tu as été démasqué. Trouve le mot des Civils pour gagner quand même.'
      : 'Il tente de deviner le mot des Civils.') + ' Il reste ' + s + ' s.';
  }
  function startMwTimer() {
    if (mwTimer) return;
    mwTimer = setInterval(() => { if (state && state.phase === 'mrwhite') updateMwSub(); }, 250);
  }
  function stopMwTimer() { clearInterval(mwTimer); mwTimer = null; }

  // ----- Fin -----
  function renderEnd() {
    showScreen('end');
    stopMwTimer();
    const { end, you } = state;
    $('end-result').className = 'result ' + end.winner;
    const titles = { civils: 'Les Civils gagnent', infiltres: 'Les intrus gagnent', mrwhite: 'Mr. White gagne' };
    const kickers = {
      civils: 'Tous les intrus ont été démasqués.',
      infiltres: 'Il ne reste qu\'un Civil.',
      mrwhite: 'Démasqué, il a quand même trouvé le mot.',
    };
    $('end-title').textContent = titles[end.winner];
    $('end-kicker').textContent = kickers[end.winner];
    $('end-civil').textContent = end.civilWord;
    $('end-uc').textContent = end.undercoverWord;
    $('end-mode').textContent = 'Mode ' + (end.mode === 'hard' ? 'Hard' : 'Normal') + ', ' + plural(state.round, 'manche') + '.';

    const lineup = $('end-lineup');
    lineup.replaceChildren();
    lineup.classList.remove('voting');
    for (const p of orderedPlayers().inGame) {
      const s = suspectEl(p);
      if (!p.alive) s.classList.add('dead');
      s._meta.append(roleEl(p.role));
      const word = el('li', 'word-reveal', p.role === 'mrwhite' ? 'sans mot' : p.word);
      word.style.color = p.role === 'undercover' ? 'var(--undercover)' : p.role === 'civil' ? 'var(--civil)' : 'var(--grey)';
      const ul = cluesEl(p.id, { extraFirst: word });
      s.append(ul);
      lineup.append(s);
    }
    fitClues(lineup);

    $('btn-restart').style.display = you.isHost ? '' : 'none';
    $('btn-to-lobby').style.display = you.isHost ? '' : 'none';
    $('end-wait').style.display = you.isHost ? 'none' : '';
    const connected = state.players.filter(p => p.connected).length;
    $('btn-restart').disabled = !validate(state.settings, connected).ok;
  }

  // ---------- Annonces (élimination, égalité, Mr. White…) ----------
  function handleEvent() {
    const ev = state.event;
    if (!ev || ev.id <= seenEventId) return;
    seenEventId = ev.id;
    if (ev.ageMs > 8000) return; // trop ancienne (ex : après un rechargement)
    const card = $('overlay-card');
    card.replaceChildren();
    const playerByName = name => state.players.find(p => p.name === name);
    let duration = 4500;

    if (ev.type === 'elimination') {
      const p = state.players.find(x => x.id === ev.playerId);
      if (p) card.append(avatarEl(p.avatar, 'gone'));
      card.append(el('h2', null, ev.name + ' est éliminé'));
      if (ev.random) card.append(el('p', null, 'Nouvelle égalité, le sort a tranché.'));
      const v = el('strong', 'verdict role ' + ev.role, verdictText(ev.role));
      card.append(v);
      if (ev.role === 'mrwhite') card.append(el('p', null, 'Il a une dernière chance : deviner le mot des Civils.'));
      card.append(tallyList(ev.tally));
      duration = 5200;
    } else if (ev.type === 'tie') {
      card.append(el('h2', null, 'Égalité'));
      card.append(el('p', null, 'Nouveau vote entre ' + listNames(ev.names) + '.'));
      card.append(tallyList(ev.tally));
    } else if (ev.type === 'guess') {
      const p = playerByName(ev.name);
      if (p) card.append(avatarEl(p.avatar, ev.correct ? '' : 'gone'));
      if (ev.timeout) {
        card.append(el('h2', null, 'Temps écoulé'), el('p', null, ev.name + ' n\'a rien proposé.'));
      } else if (ev.correct) {
        card.append(el('h2', null, ev.name + ' a trouvé'), el('p', null, '« ' + ev.guess + ' » était le bon mot.'));
      } else {
        card.append(el('h2', null, 'Raté'), el('p', null, ev.name + ' a proposé « ' + ev.guess + ' ».'));
      }
    } else if (ev.type === 'left') {
      const p = playerByName(ev.name);
      if (p) card.append(avatarEl(p.avatar, 'gone'));
      card.append(el('h2', null, ev.name + (ev.reason === 'kick' ? ' a été retiré' : ' a quitté la partie')));
      if (ev.role) card.append(el('strong', 'verdict role ' + ev.role, verdictText(ev.role)));
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
      const left = el('span');
      left.append(el('b', null, t.name), ' par ' + listNames(t.voters));
      li.append(left, el('span', null, plural(t.count, 'vote')));
      ul.append(li);
    }
    return ul;
  }
  function hideOverlay() { $('overlay').classList.remove('show'); clearTimeout(overlayTimer); }
  $('overlay').onclick = hideOverlay;

  showScreen('home');
})();
