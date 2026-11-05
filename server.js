// =====================================================================
//  UNDERCOVER EN LIGNE - Serveur
//  Le serveur est la seule source de vérité : il garde l'état de chaque
//  salon en mémoire et n'envoie à chaque joueur que ce qu'il a le droit de voir.
// =====================================================================

const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const WORDS = require('./words');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 20;
const MR_WHITE_GUESS_MS = 60 * 1000;     // temps laissé à Mr. White pour deviner
const HOST_GRACE_MS = 15 * 1000;         // délai avant de transférer le rôle d'hôte
const LOBBY_REMOVE_MS = 2 * 60 * 1000;   // un joueur déconnecté au lobby est retiré après ce délai
const AUTO_SKIP_MS = 45 * 1000;          // tour passé automatiquement si le joueur est déconnecté
const ROOM_IDLE_MS = 15 * 60 * 1000;     // salon supprimé si personne n'est connecté pendant ce délai
const EVENT_MAX_AGE_MS = 12 * 1000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.send('ok'));

/** @type {Map<string, any>} */
const rooms = new Map();

// ---------------------------------------------------------------------
//  Utilitaires
// ---------------------------------------------------------------------
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function makeCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  } while (rooms.has(code));
  return code;
}
const randomId = () => crypto.randomBytes(8).toString('hex');

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Normalise un mot pour comparer : minuscules, sans accents, sans articles ni ponctuation
function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[''`]/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(le|la|les|un|une|des|du|de|l|d) /, '')
    .replace(/ /g, '');
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// Tolère les petites fautes : 1 erreur jusqu'à 6 lettres, 2 au-delà
function isCloseEnough(guess, target) {
  const g = normalize(guess), t = normalize(target);
  if (!g || !t) return false;
  if (g === t) return true;
  // pluriel simple
  if (g.replace(/s$/, '') === t.replace(/s$/, '')) return true;
  const allowed = t.length <= 3 ? 0 : t.length <= 6 ? 1 : 2;
  return levenshtein(g, t) <= allowed;
}

function cleanName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, 16);
}

// ---------------------------------------------------------------------
//  Salons et joueurs
// ---------------------------------------------------------------------
function newRoom() {
  const room = {
    code: makeCode(),
    hostId: null,
    players: [],
    settings: { undercovers: 1, mrWhite: false, mode: 'normal' },
    phase: 'lobby', // lobby | clues | vote | mrwhite | end
    gameId: 0,
    round: 0,
    seatOrder: [],
    startSeat: 0,
    turnOrder: [],
    turnIndex: 0,
    turnStartedAt: 0,
    clues: [],
    votes: {},
    voteCandidates: [],
    revote: false,
    used: { normal: new Set(), hard: new Set() },
    civilWord: null,
    undercoverWord: null,
    pairMode: null,
    mrWhiteId: null,
    mrWhiteDeadline: 0,
    winner: null,
    event: null,
    eventSeq: 0,
    lastActivity: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

function newPlayer(name, token) {
  return {
    id: randomId(),
    token: String(token || randomId()).slice(0, 64),
    name,
    socketId: null,
    connected: false,
    disconnectedAt: Date.now(),
    inGame: false,
    alive: false,
    role: null, // civil | undercover | mrwhite
    word: null,
  };
}

const getPlayer = (room, id) => room.players.find(p => p.id === id);
const gamePlayers = room => room.players.filter(p => p.inGame);
const alivePlayers = room => room.players.filter(p => p.inGame && p.alive);
const isInfiltrator = p => p.role === 'undercover' || p.role === 'mrwhite';

function setEvent(room, event) {
  room.eventSeq += 1;
  room.event = { ...event, id: room.eventSeq, at: Date.now() };
}

// ---------------------------------------------------------------------
//  Vue personnalisée envoyée à chaque joueur
//  -> jamais le mot d'un autre joueur avant la fin de la partie
// ---------------------------------------------------------------------
function viewFor(room, viewer) {
  const ended = room.phase === 'end';
  const inProgress = room.phase !== 'lobby' && room.phase !== 'end';

  const players = room.players.map(p => {
    const revealed = ended ? p.inGame : (p.inGame && !p.alive);
    return {
      id: p.id,
      name: p.name,
      connected: p.connected,
      inGame: p.inGame,
      alive: p.alive,
      isHost: p.id === room.hostId,
      role: revealed ? p.role : null,
      word: ended && p.inGame ? p.word : null,
      hasVoted: room.phase === 'vote' ? Object.prototype.hasOwnProperty.call(room.votes, p.id) : false,
    };
  });

  const you = {
    id: viewer.id,
    name: viewer.name,
    isHost: viewer.id === room.hostId,
    inGame: viewer.inGame,
    alive: viewer.alive,
    // Le joueur connaît son mot, mais pas son rôle (sauf Mr. White, ou s'il est éliminé)
    word: viewer.inGame && viewer.role !== 'mrwhite' ? viewer.word : null,
    isMrWhite: viewer.inGame && viewer.role === 'mrwhite',
    role: viewer.inGame && (ended || !viewer.alive) ? viewer.role : null,
  };

  const view = {
    code: room.code,
    phase: room.phase,
    gameId: room.gameId,
    round: room.round,
    settings: room.settings,
    players,
    you,
    clues: inProgress || ended ? room.clues : [],
  };

  if (room.phase === 'clues') {
    view.turn = {
      order: room.turnOrder,
      index: room.turnIndex,
      currentId: room.turnOrder[room.turnIndex] || null,
    };
  }
  if (room.phase === 'vote') {
    view.vote = {
      candidates: room.voteCandidates,
      revote: room.revote,
      yourVote: room.votes[viewer.id] || null,
      votedCount: Object.keys(room.votes).length,
      voterCount: alivePlayers(room).length,
    };
  }
  if (room.phase === 'mrwhite') {
    const mw = getPlayer(room, room.mrWhiteId);
    view.mrWhite = {
      playerId: room.mrWhiteId,
      name: mw ? mw.name : '?',
      remainingMs: Math.max(0, room.mrWhiteDeadline - Date.now()),
    };
  }
  if (ended) {
    view.end = {
      winner: room.winner,
      civilWord: room.civilWord,
      undercoverWord: room.undercoverWord,
      mode: room.pairMode,
    };
  }
  if (room.event && Date.now() - room.event.at < EVENT_MAX_AGE_MS) {
    view.event = { ...room.event, ageMs: Date.now() - room.event.at };
  }
  return view;
}

function broadcast(room) {
  for (const p of room.players) {
    if (p.connected && p.socketId) io.to(p.socketId).emit('state', viewFor(room, p));
  }
}

// ---------------------------------------------------------------------
//  Déroulement de la partie
// ---------------------------------------------------------------------
function validateSettings(room, playerCount) {
  const { undercovers, mrWhite } = room.settings;
  const infiltrators = undercovers + (mrWhite ? 1 : 0);
  const civils = playerCount - infiltrators;
  if (playerCount < 3) return 'Il faut au moins 3 joueurs connectés.';
  if (undercovers < 1) return 'Il faut au moins 1 Undercover.';
  if (civils < 2 || civils <= infiltrators) {
    return 'Trop d\'infiltrés pour ce nombre de joueurs : il faut plus de Civils que d\'infiltrés.';
  }
  return null;
}

function pickPair(room) {
  let mode = room.settings.mode;
  if (mode === 'mixte') {
    const leftN = WORDS.normal.length - room.used.normal.size;
    const leftH = WORDS.hard.length - room.used.hard.size;
    mode = crypto.randomInt(Math.max(1, leftN + leftH)) < leftN ? 'normal' : 'hard';
  }
  const list = WORDS[mode];
  const used = room.used[mode];
  if (used.size >= list.length) used.clear(); // liste épuisée : on recommence
  const available = [];
  for (let i = 0; i < list.length; i++) if (!used.has(i)) available.push(i);
  const idx = available[crypto.randomInt(available.length)];
  used.add(idx);
  const pair = crypto.randomInt(2) === 0 ? list[idx] : [list[idx][1], list[idx][0]];
  return { mode, civil: pair[0], undercover: pair[1] };
}

function startGame(room) {
  const participants = room.players.filter(p => p.connected);
  const err = validateSettings(room, participants.length);
  if (err) return err;

  const pair = pickPair(room);
  room.civilWord = pair.civil;
  room.undercoverWord = pair.undercover;
  room.pairMode = pair.mode;

  for (const p of room.players) {
    p.inGame = false; p.alive = false; p.role = null; p.word = null;
  }
  const shuffled = shuffle(participants);
  shuffled.forEach((p, i) => {
    p.inGame = true;
    p.alive = true;
    if (i < room.settings.undercovers) { p.role = 'undercover'; p.word = pair.undercover; }
    else if (room.settings.mrWhite && i === room.settings.undercovers) { p.role = 'mrwhite'; p.word = null; }
    else { p.role = 'civil'; p.word = pair.civil; }
  });

  room.gameId += 1;
  room.seatOrder = shuffle(participants.map(p => p.id));
  room.round = 0;
  room.clues = [];
  room.votes = {};
  room.winner = null;
  room.mrWhiteId = null;
  room.event = null;
  startRound(room);
  return null;
}

function startRound(room) {
  room.round += 1;
  const seats = room.seatOrder;
  const isAliveId = id => { const p = getPlayer(room, id); return p && p.inGame && p.alive; };

  if (room.round === 1) {
    // Mr. White ne commence jamais le premier tour
    let start = seats.findIndex(id => isAliveId(id) && getPlayer(room, id).role !== 'mrwhite');
    room.startSeat = Math.max(0, start);
  } else {
    // Le joueur suivant (vivant) commence le tour suivant
    for (let k = 1; k <= seats.length; k++) {
      const idx = (room.startSeat + k) % seats.length;
      if (isAliveId(seats[idx])) { room.startSeat = idx; break; }
    }
  }
  const order = [];
  for (let k = 0; k < seats.length; k++) {
    const id = seats[(room.startSeat + k) % seats.length];
    if (isAliveId(id)) order.push(id);
  }
  room.turnOrder = order;
  room.turnIndex = 0;
  room.turnStartedAt = Date.now();
  room.phase = 'clues';
  room.votes = {};
  room.revote = false;
}

function advanceTurn(room) {
  room.turnIndex += 1;
  while (room.turnIndex < room.turnOrder.length) {
    const p = getPlayer(room, room.turnOrder[room.turnIndex]);
    if (p && p.inGame && p.alive) break;
    room.turnIndex += 1;
  }
  room.turnStartedAt = Date.now();
  if (room.turnIndex >= room.turnOrder.length) {
    startVote(room, alivePlayers(room).map(p => p.id), false);
  }
}

function addClue(room, player, text, skipped = false) {
  room.clues.push({ round: room.round, playerId: player.id, name: player.name, text, skipped });
}

function startVote(room, candidates, revote) {
  room.phase = 'vote';
  room.votes = {};
  room.voteCandidates = candidates;
  room.revote = revote;
}

function checkVoteComplete(room) {
  if (room.phase !== 'vote') return;
  const voters = alivePlayers(room);
  const validVotes = Object.keys(room.votes).length;
  if (validVotes === 0) return;
  const waiting = voters.filter(p => p.connected && !room.votes[p.id]);
  if (waiting.length === 0) resolveVote(room);
}

function resolveVote(room) {
  const counts = {};
  const votersByTarget = {};
  for (const [voterId, targetId] of Object.entries(room.votes)) {
    const voter = getPlayer(room, voterId);
    if (!voter || !voter.alive || !room.voteCandidates.includes(targetId)) continue;
    counts[targetId] = (counts[targetId] || 0) + 1;
    (votersByTarget[targetId] = votersByTarget[targetId] || []).push(voter.name);
  }
  const tally = room.voteCandidates
    .map(id => ({ id, name: (getPlayer(room, id) || {}).name || '?', count: counts[id] || 0, voters: votersByTarget[id] || [] }))
    .filter(t => t.count > 0)
    .sort((a, b) => b.count - a.count);

  if (tally.length === 0) { room.votes = {}; return; }
  const max = tally[0].count;
  const top = tally.filter(t => t.count === max).map(t => t.id);

  if (top.length > 1) {
    if (!room.revote) {
      setEvent(room, { type: 'tie', names: top.map(id => getPlayer(room, id).name), tally });
      startVote(room, top, true);
      return;
    }
    // Deuxième égalité de suite : tirage au sort entre les ex aequo
    const chosen = top[crypto.randomInt(top.length)];
    eliminate(room, chosen, { tally, random: true });
    return;
  }
  eliminate(room, top[0], { tally, random: false });
}

function eliminate(room, playerId, info) {
  const p = getPlayer(room, playerId);
  if (!p) return;
  p.alive = false;
  setEvent(room, { type: 'elimination', playerId: p.id, name: p.name, role: p.role, tally: info.tally, random: info.random });
  // Mr. White éliminé (et connecté) : il a une dernière chance de deviner le mot
  if (p.role === 'mrwhite' && p.connected) {
    room.phase = 'mrwhite';
    room.mrWhiteId = p.id;
    room.mrWhiteDeadline = Date.now() + MR_WHITE_GUESS_MS;
    return;
  }
  afterElimination(room);
}

function resolveMrWhiteGuess(room, guess, timeout = false) {
  const mw = getPlayer(room, room.mrWhiteId);
  const correct = !timeout && isCloseEnough(guess, room.civilWord);
  setEvent(room, {
    type: 'guess',
    name: mw ? mw.name : 'Mr. White',
    guess: timeout ? null : String(guess).slice(0, 40),
    correct,
    timeout,
  });
  room.mrWhiteId = null;
  if (correct) endGame(room, 'mrwhite');
  else afterElimination(room);
}

function checkWin(room) {
  const alive = alivePlayers(room);
  const civils = alive.filter(p => p.role === 'civil').length;
  const infiltrators = alive.filter(isInfiltrator).length;
  if (infiltrators === 0) return 'civils';
  if (civils <= 1) return 'infiltres';
  return null;
}

function afterElimination(room) {
  const winner = checkWin(room);
  if (winner) endGame(room, winner);
  else startRound(room);
}

function endGame(room, winner) {
  room.phase = 'end';
  room.winner = winner;
  room.mrWhiteId = null;
}

function backToLobby(room) {
  room.phase = 'lobby';
  room.round = 0;
  room.clues = [];
  room.votes = {};
  room.voteCandidates = [];
  room.winner = null;
  room.mrWhiteId = null;
  room.event = null;
  for (const p of room.players) { p.inGame = false; p.alive = false; p.role = null; p.word = null; }
}

// Un joueur quitte volontairement (ou est exclu)
function removePlayer(room, player, reason) {
  const wasAliveInGame = player.inGame && player.alive && !['lobby', 'end'].includes(room.phase);
  const wasHost = player.id === room.hostId;
  room.players = room.players.filter(p => p.id !== player.id);
  delete room.votes[player.id];

  if (room.players.length === 0) { rooms.delete(room.code); return; }
  if (wasHost) {
    const next = room.players.find(p => p.connected) || room.players[0];
    room.hostId = next.id;
  }

  if (wasAliveInGame) {
    setEvent(room, { type: 'left', name: player.name, role: player.role, reason });
    // Si c'était le Mr. White en train de deviner
    if (room.phase === 'mrwhite' && room.mrWhiteId === player.id) {
      room.mrWhiteId = null;
      afterElimination(room);
      return;
    }
    const winner = checkWin(room);
    if (winner) { endGame(room, winner); return; }
    if (room.phase === 'clues') {
      // Si c'était son tour, on passe au suivant (les joueurs partis sont sautés automatiquement)
      if (room.turnOrder[room.turnIndex] === player.id) advanceTurn(room);
    } else if (room.phase === 'vote') {
      // On relance le vote proprement sans le joueur parti
      const candidates = room.revote
        ? room.voteCandidates.filter(id => id !== player.id)
        : alivePlayers(room).map(p => p.id);
      if (candidates.length < 2) startVote(room, alivePlayers(room).map(p => p.id), false);
      else startVote(room, candidates, room.revote);
    }
  } else if (room.phase === 'vote') {
    checkVoteComplete(room);
  }
}

// ---------------------------------------------------------------------
//  Connexions
// ---------------------------------------------------------------------
function attach(room, player, socket) {
  if (player.socketId && player.socketId !== socket.id) {
    const old = io.sockets.sockets.get(player.socketId);
    if (old) {
      old.data.roomCode = null;
      old.emit('replaced');
      old.disconnect(true);
    }
  }
  // Si ce socket était dans un autre salon, on le détache
  if (socket.data.roomCode && socket.data.roomCode !== room.code) detachSocket(socket);
  player.socketId = socket.id;
  player.connected = true;
  player.disconnectedAt = 0;
  socket.data.roomCode = room.code;
  socket.data.playerId = player.id;
  socket.join(room.code);
  room.lastActivity = Date.now();
  if (!getPlayer(room, room.hostId)) room.hostId = player.id;
}

function detachSocket(socket) {
  const room = rooms.get(socket.data.roomCode);
  socket.data.roomCode = null;
  if (!room) return;
  const p = getPlayer(room, socket.data.playerId);
  if (!p || p.socketId !== socket.id) return;
  p.connected = false;
  p.socketId = null;
  p.disconnectedAt = Date.now();
  room.lastActivity = Date.now();
  if (room.phase === 'vote') checkVoteComplete(room);
  broadcast(room);
}

function ctx(socket) {
  const room = rooms.get(socket.data.roomCode);
  if (!room) return {};
  const player = getPlayer(room, socket.data.playerId);
  if (!player || player.socketId !== socket.id) return {};
  room.lastActivity = Date.now();
  return { room, player };
}

const reply = (cb, data) => { if (typeof cb === 'function') cb(data); };

io.on('connection', socket => {
  socket.on('create', ({ name, token } = {}, cb) => {
    name = cleanName(name);
    if (!name) return reply(cb, { error: 'Choisis un pseudo.' });
    if (socket.data.roomCode) {
      const { room: oldRoom, player: oldPlayer } = ctx(socket);
      socket.data.roomCode = null;
      if (oldRoom && oldPlayer) {
        socket.leave(oldRoom.code);
        removePlayer(oldRoom, oldPlayer, 'quit');
        if (rooms.has(oldRoom.code)) broadcast(oldRoom);
      }
    }
    const room = newRoom();
    const player = newPlayer(name, token);
    room.players.push(player);
    room.hostId = player.id;
    attach(room, player, socket);
    reply(cb, { ok: true, code: room.code });
    broadcast(room);
  });

  socket.on('join', ({ code, name, token } = {}, cb) => {
    name = cleanName(name);
    code = String(code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return reply(cb, { error: 'Salon introuvable. Vérifie le code.' });

    let player = token ? room.players.find(p => p.token === token) : null;
    if (!player) {
      if (!name) return reply(cb, { error: 'Choisis un pseudo.' });
      const same = room.players.find(p => normalize(p.name) === normalize(name));
      if (same && !same.connected) {
        // Le joueur revient (ex : onglet fermé sur mobile) : il reprend sa place
        player = same;
        player.token = String(token || randomId()).slice(0, 64);
      } else if (same) {
        return reply(cb, { error: 'Ce pseudo est déjà pris dans ce salon.' });
      } else {
        if (room.players.length >= MAX_PLAYERS) return reply(cb, { error: 'Le salon est plein (20 joueurs max).' });
        player = newPlayer(name, token);
        room.players.push(player);
      }
    }
    attach(room, player, socket);
    reply(cb, { ok: true, code: room.code });
    broadcast(room);
  });

  socket.on('resume', ({ code, token } = {}, cb) => {
    const room = rooms.get(String(code || '').toUpperCase());
    const player = room && token ? room.players.find(p => p.token === token) : null;
    if (!room || !player) return reply(cb, { error: 'Partie introuvable.' });
    attach(room, player, socket);
    reply(cb, { ok: true, code: room.code });
    broadcast(room);
  });

  socket.on('leave', (_, cb) => {
    const { room, player } = ctx(socket);
    socket.data.roomCode = null;
    if (room && player) {
      socket.leave(room.code);
      removePlayer(room, player, 'quit');
      if (rooms.has(room.code)) broadcast(room);
    }
    reply(cb, { ok: true });
  });

  socket.on('settings', (settings = {}, cb) => {
    const { room, player } = ctx(socket);
    if (!room) return reply(cb, { error: 'Pas de salon.' });
    if (player.id !== room.hostId) return reply(cb, { error: 'Seul l\'hôte peut changer les réglages.' });
    if (!['lobby', 'end'].includes(room.phase)) return reply(cb, { error: 'Partie en cours.' });
    const s = room.settings;
    if (Number.isInteger(settings.undercovers)) s.undercovers = Math.min(9, Math.max(1, settings.undercovers));
    if (typeof settings.mrWhite === 'boolean') s.mrWhite = settings.mrWhite;
    if (['normal', 'hard', 'mixte'].includes(settings.mode)) s.mode = settings.mode;
    reply(cb, { ok: true });
    broadcast(room);
  });

  socket.on('start', (_, cb) => {
    const { room, player } = ctx(socket);
    if (!room) return reply(cb, { error: 'Pas de salon.' });
    if (player.id !== room.hostId) return reply(cb, { error: 'Seul l\'hôte peut lancer la partie.' });
    if (!['lobby', 'end'].includes(room.phase)) return reply(cb, { error: 'Partie déjà en cours.' });
    const err = startGame(room);
    if (err) return reply(cb, { error: err });
    reply(cb, { ok: true });
    broadcast(room);
  });

  socket.on('clue', ({ text } = {}, cb) => {
    const { room, player } = ctx(socket);
    if (!room) return reply(cb, { error: 'Pas de salon.' });
    if (room.phase !== 'clues') return reply(cb, { error: 'Ce n\'est pas le moment des indices.' });
    if (room.turnOrder[room.turnIndex] !== player.id) return reply(cb, { error: 'Ce n\'est pas ton tour.' });
    const clue = String(text || '').trim().replace(/\s+/g, ' ');
    if (!clue) return reply(cb, { error: 'Écris un indice.' });
    if (/\s/.test(clue)) return reply(cb, { error: 'Un seul mot !' });
    if (clue.length > 25) return reply(cb, { error: 'Mot trop long (25 lettres max).' });
    if (player.word && normalize(clue) === normalize(player.word)) {
      return reply(cb, { error: 'Tu ne peux pas donner ton propre mot !' });
    }
    addClue(room, player, clue);
    advanceTurn(room);
    reply(cb, { ok: true });
    broadcast(room);
  });

  socket.on('skip', (_, cb) => {
    const { room, player } = ctx(socket);
    if (!room) return reply(cb, { error: 'Pas de salon.' });
    if (player.id !== room.hostId) return reply(cb, { error: 'Seul l\'hôte peut passer un tour.' });
    if (room.phase !== 'clues') return reply(cb, { error: 'Rien à passer.' });
    const current = getPlayer(room, room.turnOrder[room.turnIndex]);
    if (current) addClue(room, current, '(tour passé)', true);
    advanceTurn(room);
    reply(cb, { ok: true });
    broadcast(room);
  });

  socket.on('vote', ({ targetId } = {}, cb) => {
    const { room, player } = ctx(socket);
    if (!room) return reply(cb, { error: 'Pas de salon.' });
    if (room.phase !== 'vote') return reply(cb, { error: 'Ce n\'est pas le moment de voter.' });
    if (!player.inGame || !player.alive) return reply(cb, { error: 'Tu ne peux plus voter.' });
    if (targetId === player.id) return reply(cb, { error: 'Tu ne peux pas voter contre toi-même.' });
    if (!room.voteCandidates.includes(targetId)) return reply(cb, { error: 'Vote invalide.' });
    room.votes[player.id] = targetId;
    checkVoteComplete(room);
    reply(cb, { ok: true });
    broadcast(room);
  });

  socket.on('guess', ({ text } = {}, cb) => {
    const { room, player } = ctx(socket);
    if (!room) return reply(cb, { error: 'Pas de salon.' });
    if (room.phase !== 'mrwhite' || room.mrWhiteId !== player.id) return reply(cb, { error: 'Ce n\'est pas à toi de deviner.' });
    const guess = String(text || '').trim();
    if (!guess) return reply(cb, { error: 'Écris ta proposition.' });
    resolveMrWhiteGuess(room, guess);
    reply(cb, { ok: true });
    broadcast(room);
  });

  socket.on('kick', ({ playerId } = {}, cb) => {
    const { room, player } = ctx(socket);
    if (!room) return reply(cb, { error: 'Pas de salon.' });
    if (player.id !== room.hostId) return reply(cb, { error: 'Seul l\'hôte peut exclure.' });
    const target = getPlayer(room, playerId);
    if (!target || target.id === player.id) return reply(cb, { error: 'Joueur introuvable.' });
    if (target.socketId) {
      const s = io.sockets.sockets.get(target.socketId);
      if (s) { s.data.roomCode = null; s.leave(room.code); s.emit('kicked'); }
    }
    removePlayer(room, target, 'kick');
    reply(cb, { ok: true });
    if (rooms.has(room.code)) broadcast(room);
  });

  socket.on('stop', (_, cb) => {
    const { room, player } = ctx(socket);
    if (!room) return reply(cb, { error: 'Pas de salon.' });
    if (player.id !== room.hostId) return reply(cb, { error: 'Seul l\'hôte peut arrêter la partie.' });
    backToLobby(room);
    reply(cb, { ok: true });
    broadcast(room);
  });

  socket.on('restart', (_, cb) => {
    const { room, player } = ctx(socket);
    if (!room) return reply(cb, { error: 'Pas de salon.' });
    if (player.id !== room.hostId) return reply(cb, { error: 'Seul l\'hôte peut relancer.' });
    if (room.phase !== 'end') return reply(cb, { error: 'La partie n\'est pas finie.' });
    const err = startGame(room);
    if (err) {
      backToLobby(room);
      broadcast(room);
      return reply(cb, { error: err });
    }
    reply(cb, { ok: true });
    broadcast(room);
  });

  socket.on('lobby', (_, cb) => {
    const { room, player } = ctx(socket);
    if (!room) return reply(cb, { error: 'Pas de salon.' });
    if (player.id !== room.hostId) return reply(cb, { error: 'Seul l\'hôte peut faire ça.' });
    if (room.phase !== 'end') return reply(cb, { error: 'La partie n\'est pas finie.' });
    backToLobby(room);
    reply(cb, { ok: true });
    broadcast(room);
  });

  socket.on('disconnect', () => detachSocket(socket));
});

// ---------------------------------------------------------------------
//  Boucle de maintenance (chaque seconde)
// ---------------------------------------------------------------------
setInterval(() => {
  const now = Date.now();
  for (const room of [...rooms.values()]) {
    let changed = false;
    const anyConnected = room.players.some(p => p.connected);

    // Salon abandonné
    if (!anyConnected && now - room.lastActivity > ROOM_IDLE_MS) { rooms.delete(room.code); continue; }

    // Transfert d'hôte si l'hôte reste déconnecté
    const host = getPlayer(room, room.hostId);
    if ((!host || (!host.connected && now - host.disconnectedAt > HOST_GRACE_MS)) && anyConnected) {
      const next = room.players.find(p => p.connected);
      if (next && next.id !== room.hostId) { room.hostId = next.id; changed = true; }
    }

    // Au lobby / en fin de partie : on retire les joueurs partis depuis longtemps
    if (['lobby', 'end'].includes(room.phase)) {
      for (const p of room.players.slice()) {
        if (!p.connected && now - p.disconnectedAt > LOBBY_REMOVE_MS) { removePlayer(room, p, 'timeout'); changed = true; }
      }
      if (!rooms.has(room.code)) continue;
    }

    // Tour d'un joueur déconnecté : passé automatiquement
    if (room.phase === 'clues') {
      const current = getPlayer(room, room.turnOrder[room.turnIndex]);
      if (current && !current.connected && now - Math.max(current.disconnectedAt, room.turnStartedAt) > AUTO_SKIP_MS) {
        addClue(room, current, '(absent)', true);
        advanceTurn(room);
        changed = true;
      }
    }

    // Temps écoulé pour Mr. White
    if (room.phase === 'mrwhite' && now > room.mrWhiteDeadline) {
      resolveMrWhiteGuess(room, null, true);
      changed = true;
    }

    if (changed) broadcast(room);
  }
}, 1000);

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Undercover lancé sur http://localhost:${PORT}`);
  });
}

module.exports = { server, rooms, isCloseEnough, normalize };
