import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import { v4 as uuid } from "uuid";

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log("Server running on", PORT));

/* ---------- CONSTANTS ---------- */

const SUITS = ["♠", "♥", "♦", "♣"];
const ORDER = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const INDEX = Object.fromEntries(ORDER.map((v, i) => [v, i]));
const WIN_SCORE = 151;

const HAND_SIZE = 9;

/* ---------- HELPERS ---------- */

function buildDeck() {
  const deck = [];
  for (const s of SUITS) {
    for (const v of ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]) {
      deck.push({
        id: uuid(),
        value: v,
        suit: s,
        points: v === "A" || v === "2" ? 2 : 1
      });
    }
  }
  return deck.sort(() => Math.random() - 0.5);
}

function maskHand(hand) {
  return hand.map(() => ({ value: "?", suit: "?" }));
}

function initialFor(name) {
  const s = String(name || "").trim();
  return s ? s[0].toUpperCase() : "?";
}

/**
 * Builds g.teams for client display and ensures g.teamScores exists.
 * - label: concatenated initials of teammates (join order)
 * - score: team score
 * - members: player ids
 */
function syncTeams(g) {
  if (!g || !g.teamMode) return;

  if (!g.teamScores) g.teamScores = { 0: 0, 1: 0 };

  const t0Players = g.players.filter((p) => p.team === 0);
  const t1Players = g.players.filter((p) => p.team === 1);

  const label0 = t0Players.map((p) => initialFor(p.name)).join("") || "T0";
  const label1 = t1Players.map((p) => initialFor(p.name)).join("") || "T1";

  g.teams = {
    0: { label: label0, score: g.teamScores[0] || 0, members: t0Players.map((p) => p.id) },
    1: { label: label1, score: g.teamScores[1] || 0, members: t1Players.map((p) => p.id) }
  };

  // compatibility: set each player's score to their team's score (so UI doesn't break)
  g.players.forEach((p) => {
    if (p.team === 0 || p.team === 1) p.score = g.teamScores[p.team] || 0;
  });
}

function teamCount(g, teamId) {
  return g.players.filter((p) => p.team === teamId).length;
}

function pickTeamOrReject(g, requestedTeam) {
  // Only valid in teamMode
  if (!g.teamMode) return null;

  const want = requestedTeam === 0 || requestedTeam === 1 ? requestedTeam : null;

  // If requested explicitly, enforce max 2
  if (want !== null) {
    if (teamCount(g, want) >= 2) return { ok: false, msg: "That team is full (max 2 players)." };
    return { ok: true, team: want };
  }

  // If not requested, choose any available team with space
  const c0 = teamCount(g, 0);
  const c1 = teamCount(g, 1);

  if (c0 < 2 && c1 < 2) return { ok: true, team: c0 <= c1 ? 0 : 1 };
  if (c0 < 2) return { ok: true, team: 0 };
  if (c1 < 2) return { ok: true, team: 1 };

  return { ok: false, msg: "Both teams are full (2v2 max)." };
}
/* ---------- HOUSE RULE HELPERS ---------- */

// Pure run = 3+ consecutive cards of same suit with NO jokers ("2")
function hasPureRun(hand) {
  if (!Array.isArray(hand) || hand.length < 3) return false;

  // group by suit, ignore jokers (value === "2")
  const bySuit = {};
  for (const c of hand) {
    if (!c || c.value === "2") continue;
    (bySuit[c.suit] ||= []).push(INDEX[c.value]);
  }

  // check any suit has 3+ consecutive
  for (const suit of Object.keys(bySuit)) {
    const arr = bySuit[suit].sort((a, b) => a - b);
    let streak = 1;
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] === arr[i - 1] + 1) streak++;
      else if (arr[i] !== arr[i - 1]) streak = 1;

      if (streak >= 3) return true;
    }
  }
  return false;
}

// Can current player legally add something to ANY run they are allowed to add to?
function canAddToAnyRun(g, me) {
  if (!g || !me) return false;
  if (!me.opened) return false; // your existing rule: must have opened before adding
  if (!Array.isArray(me.hand) || me.hand.length === 0) return false;

  // Which runs are legal targets for this player?
  const owners = g.teamMode
    ? g.players.filter((p) => p.team === me.team)
    : [me];

  // Try to find ANY legal add:
  // - any single real card
  // - any single joker onto a run that already had a joker
  // - joker+real pair for adding joker to a run that had no joker (your existing constraint)
  const hand = me.hand;

  for (const owner of owners) {
    const sets = owner.openedSets || [];
    for (let runIndex = 0; runIndex < sets.length; runIndex++) {
      const original = sets[runIndex];
      if (!Array.isArray(original) || original.length < 3) continue;

      const hadJoker = original.some((c) => c.value === "2");

      // 1) single-card adds
      for (const card of hand) {
        if (!card) continue;

        // adding a joker to a run with no joker is NOT legal alone (per your rule)
        if (card.value === "2" && !hadJoker) continue;

        const combined = [...original, card];
        if (validRun(combined)) return true;
      }

      // 2) joker+real pair add (only relevant when run had no joker)
      if (!hadJoker) {
        const jokers = hand.filter((c) => c.value === "2");
        const reals = hand.filter((c) => c.value !== "2");

        if (jokers.length && reals.length) {
          for (const j of jokers) {
            for (const r of reals) {
              const combined = [...original, j, r];
              if (validRun(combined)) return true;
            }
          }
        }
      }
    }
  }

  return false;
}

// Master rule gate used by discard/endTurn:
// When closed is empty, block discard/endTurn if mandatory actions exist
function mustPlayAllMeldsNow(g, p) {
  if (!g || !p) return false;

  // Only applies once closed stack is empty
  if ((g.closed?.length || 0) !== 0) return false;

  // Must have drawn this turn (consistent with your server: open/add requires canDiscard)
  if (!p.canDiscard) return false;

  // Add-to-run mandatory if any add exists
  if (canAddToAnyRun(g, p)) return true;

  // Create-run mandatory ONLY if there exists a pure run in hand (no jokers)
  if (hasPureRun(p.hand || [])) return true;

  return false;
}

/* ---------- RUN VALIDATION ---------- */

function validRun(cards) {
  if (!Array.isArray(cards) || cards.length < 3) return false;

  const real = cards.filter((c) => c.value !== "2");
  const jokers = cards.length - real.length;

// ✅ max 1 joker per run
if (jokers > 1) return false;

  // need at least 2 real cards
  if (real.length < 2) return false;

  // same suit among real cards
  const suit = real[0].suit;
  if (!real.every((c) => c.suit === suit)) return false;

  const idx = real.map((c) => INDEX[c.value]).sort((a, b) => a - b);

  let gaps = 0;
  for (let i = 1; i < idx.length; i++) {
    const diff = idx[i] - idx[i - 1] - 1;
    if (diff < 0) return false;
    gaps += diff;
  }

  return gaps <= jokers;
}

/* ---------- RUN NORMALIZATION (joker placement) ---------- */

function normalizeRun(cards) {
  // assumes validRun(cards) is true
  const jokers = cards.filter((c) => c.value === "2");
  const real = cards
    .filter((c) => c.value !== "2")
    .sort((a, b) => INDEX[a.value] - INDEX[b.value]);

  if (real.length === 0) return cards;

  const suit = real[0].suit;
  const realIdx = real.map((c) => INDEX[c.value]);
  const min = realIdx[0];
  const max = realIdx[realIdx.length - 1];

  const realByIdx = new Map(realIdx.map((idx, i) => [idx, real[i]]));
  const jokerPool = [...jokers];

  const out = [];
  for (let i = min; i <= max; i++) {
    if (realByIdx.has(i)) out.push(realByIdx.get(i));
    else out.push(jokerPool.pop());
  }

  while (jokerPool.length) out.push(jokerPool.pop());

  // set joker suit to run suit for display
  return out.map((c) => (c.value === "2" ? { ...c, suit } : c));
}
function canOpenAnyRunFromHand(hand) {
  if (!Array.isArray(hand) || hand.length < 3) return false;

  const jokers = hand.filter((c) => c.value === "2").length;

  // Need at least 3 total cards and at least 2 real cards in a run (your validRun rule)
  const realBySuit = {};
  for (const c of hand) {
    if (c.value === "2") continue;
    if (!realBySuit[c.suit]) realBySuit[c.suit] = [];
    realBySuit[c.suit].push(INDEX[c.value]);
  }

  for (const suit of Object.keys(realBySuit)) {
    const idx = realBySuit[suit].sort((a, b) => a - b);
    const n = idx.length;

    // Need at least 2 real cards (then jokers can complete to 3+)
    if (n < 2) continue;

    for (let i = 0; i < n; i++) {
      let gaps = 0;
      for (let j = i + 1; j < n; j++) {
        gaps += idx[j] - idx[j - 1] - 1;
        if (gaps > jokers) break;

        const realCount = j - i + 1;

        // validRun requires >=2 real cards AND gaps <= jokers
        // also total cards in the run must be >=3
        if (realCount >= 2 && realCount + jokers >= 3) return true;
      }
    }
  }

  return false;
}

function canAddAnyCardToAllowedRuns(g, me) {
  if (!g || !me || !me.opened) return false;
  if (!Array.isArray(me.hand) || me.hand.length === 0) return false;

  // Which runs are you allowed to add to (respect your existing restrictions)
  const allowedOwners = g.teamMode
    ? g.players.filter((p) => p.team === me.team)
    : [me];

  for (const owner of allowedOwners) {
    const sets = owner.openedSets || [];
    for (let runIndex = 0; runIndex < sets.length; runIndex++) {
      const run = sets[runIndex] || [];
      const runHasJoker = run.some((c) => c.value === "2");

      for (const card of me.hand) {
        // your existing rule: if adding a joker to a run that had no joker,
        // you must include at least one real card too.
        if (card.value === "2" && !runHasJoker) continue;

        const combined = [...run, card];
        if (validRun(combined)) return true;
      }
    }
  }

  return false;
}

function mustPlayAllMeldsNow(g, p) {
  // rule is only active when closed is empty and open still exists
  if (!g) return false;
  if (g.closed.length !== 0) return false;
  if ((g.open?.length || 0) === 0) return false;

  // only enforce AFTER the player has drawn this turn
  if (!p?.canDiscard) return false;

  // if there exists any legal meld move, they must do it first
  if (canOpenAnyRunFromHand(p.hand)) return true;
  if (canAddAnyCardToAllowedRuns(g, p)) return true;

  return false;
}
/* ---------- GAME STATE ---------- */

const games = {};

/* ---------- SOCKET ---------- */

io.on("connection", (socket) => {
/* ---------- CREATE / JOIN ---------- */

socket.on("createRoom", ({ room, name, teamMode, pid, team }) => {
  if (!room || !name || games[room]) return;

  const deck = buildDeck();

  const persistentPid = pid || uuid();

  const isTeam = !!teamMode;

  // ✅ chosen team only matters in team mode
  let chosenTeam = isTeam ? team : null;

  // ✅ must be 0 or 1 in team mode
  if (isTeam && (chosenTeam !== 0 && chosenTeam !== 1)) return;

  // (Optional but recommended) enforce max 2 per team on create too
  if (isTeam) {
  const teamCount = 0; // first player
  if (teamCount >= 2) return;
}

  games[room] = {
    room,
    teamMode: isTeam,
    dealerIndex: 0,
    teamScores: isTeam ? { 0: 0, 1: 0 } : null,
    teams: isTeam ? { 0: { label: "", score: 0, members: [] }, 1: { label: "", score: 0, members: [] } } : null,
    players: [
      {
        id: socket.id,
        pid: persistentPid,
        name,
        team: isTeam ? chosenTeam : null,
        hand: deck.splice(0, HAND_SIZE),
        openedSets: [],
        opened: false,
        mustDiscard: false,
        canDiscard: false,
        score: 0
      }
    ],
    closed: deck,
    open: [deck.pop()],
    turn: 0,
    roundOver: false,
    winner: null,
    gameOver: false,
    log: [`${name} created the room`]
  };

// ✅ starter is left of dealer (will be 0 if only 1 player)
games[room].turn = (games[room].dealerIndex + 1) % games[room].players.length;

  socket.join(room);
  socket.emit("youAre", { pid: persistentPid });
  emit(room);
});

socket.on("joinRoom", ({ room, name, pid, team }) => {
  const g = games[room];
  if (!g || g.players.length >= 4) return;

  const persistentPid = pid || uuid();

  // ✅ rebind existing player (refresh / PWA resume) WITHOUT changing team
  const existing = g.players.find((p) => p.pid === persistentPid);
  if (existing) {
    existing.id = socket.id;
    existing.name = name || existing.name;

    socket.join(room);
    socket.emit("youAre", { pid: persistentPid });
    emit(room);
    return;
  }

  // ✅ team mode: require explicit team pick
  let chosenTeam = g.teamMode ? team : null;

  if (g.teamMode) {
    if (chosenTeam !== 0 && chosenTeam !== 1) return;

    // ✅ enforce max 2 per team
    const teamCount = g.players.filter((p) => p.team === chosenTeam).length;
    if (teamCount >= 2) {
      io.to(socket.id).emit("errorMsg", "That team is full (max 2 players). Pick the other team.");
      return;
    }
  }

  const prevLen = g.players.length;

  g.players.push({
    id: socket.id,
    pid: persistentPid,
    name,
    team: g.teamMode ? chosenTeam : null,
    hand: g.closed.splice(0, HAND_SIZE),
    openedSets: [],
    opened: false,
    mustDiscard: false,
    canDiscard: false,
    score: 0
  });

  // ✅ set Round 1 starting turn once (when the room first reaches 2 players)
  if (
    prevLen === 1 &&
    g.players.length >= 2 &&
    g.players.every((pp) => !pp.canDiscard && !pp.mustDiscard) &&
    !g.roundOver &&
    !g.gameOver
  ) {
    g.turn = (g.dealerIndex + 1) % g.players.length;
  }

  socket.join(room);
  socket.emit("youAre", { pid: persistentPid });

  g.log.push(`${name} joined the room`);
  emit(room);
});
/* ---------- RECONNECT (refresh / PWA resume) ---------- */

socket.on("reconnectRoom", ({ room, pid }) => {
  const g = games[room];
  if (!g || !pid) return;

  const p = g.players.find((x) => x.pid === pid);
  if (!p) return;

  // ✅ rebind the existing player to this new socket connection
  p.id = socket.id;

  socket.join(room);

  // re-confirm identity for client just in case
  socket.emit("youAre", { pid });

  emit(room);
});
  /* ---------- DRAW ---------- */

  socket.on("drawClosed", ({ room }) => {
    const g = games[room];
    const p = g?.players?.[g.turn];
    if (!g || !p || p.id !== socket.id) return;
    if (g.roundOver || g.gameOver) return;
    if (p.canDiscard) return; // already drew this turn
    if (!g.closed.length) return;

    p.hand.push(g.closed.pop());

    // closed draw => discard REQUIRED before end turn
    p.mustDiscard = true;
    p.canDiscard = true;
    p.noDiscardCardId = null;

    emit(room);
  });

socket.on("drawOpen", ({ room, count }) => {
  const g = games[room];
  const p = g?.players?.[g.turn];
  if (!g || !p || p.id !== socket.id) return;
  if (g.roundOver || g.gameOver) return;
  if (p.canDiscard) return; // already drew this turn
  if (!count || count < 1) return;
  if (count > g.open.length) return;

  const preLen = g.open.length;

  // open is stored bottom->top; draw from TOP = last items
  const drawn = g.open.splice(-count);
  p.hand.push(...drawn);

  // If you emptied the open stack, you MUST discard to re-seed it.
  // Otherwise discard stays optional.
  p.mustDiscard = g.open.length === 0;

  p.canDiscard = true;

  // ✅ New rule: ONLY if open had exactly 1 card and you drew that 1,
  // you cannot discard that exact card this turn.
  if (preLen === 1 && count === 1 && drawn[0]?.id) {
    p.noDiscardCardId = drawn[0].id;
  } else {
    p.noDiscardCardId = null;
  }

  emit(room);
});
/* ---------- DISCARD ---------- */

socket.on("discard", ({ room, index }) => {
  const g = games[room];
  const p = g?.players?.[g.turn];
  if (!g || !p || p.id !== socket.id) return;
  if (g.roundOver || g.gameOver) return;
  if (!p.canDiscard) return; // must draw before discard
  if (index == null || index < 0 || index >= p.hand.length) return;

  // 🚫 House rule: closed empty → must play mandatory melds first
  if (mustPlayAllMeldsNow(g, p)) {
    io.to(socket.id).emit("errorMsg", "You must play all mandatory adds/runs before discarding.");
    return;
  }

  // 🚫 New rule: if open had exactly 1 card and you drew it, you can't discard that same card
  if (p.noDiscardCardId && p.hand[index]?.id === p.noDiscardCardId) {
    io.to(socket.id).emit("errorMsg", "You can’t discard the last open-stack card you just drew.");
    return;
  }

  // move card to open stack
  g.open.push(p.hand.splice(index, 1)[0]);

  // ✅ clear the restriction after any successful discard
  p.noDiscardCardId = null;

  // discard completes discard requirement
  p.mustDiscard = false;

  // ✅ if you discarded your last card, you are OUT immediately
  if (p.hand.length === 0) {
    g.roundOver = true;
    g.winner = p.id;      // keep for UI
    g.winnerPid = p.pid;  // stable identity for scoring

    scoreRound(g);
    checkWin(g);

    // lock turn state for clarity
    p.canDiscard = false;

    emit(room);
    return;
  }

  // normal discard ends turn
  p.canDiscard = false;
  g.turn = (g.turn + 1) % g.players.length;

  emit(room);
});

socket.on("endTurn", ({ room }) => {
  const g = games[room];
  const p = g?.players?.[g.turn];
  if (!g || !p || p.id !== socket.id) return;
  if (g.roundOver || g.gameOver) return;

  // must have drawn this turn to end turn
  if (!p.canDiscard) return;

  // if discard required, cannot end turn
  if (p.mustDiscard) return;

  // 🚫 House rule: closed stack empty → must play mandatory melds first
  if (mustPlayAllMeldsNow(g, p)) {
    io.to(socket.id).emit("errorMsg", "You must play all mandatory adds/runs before ending your turn.");
    return;
  }

  // optional-discard path: end turn without discarding
  p.canDiscard = false;

  // ✅ clear the restriction when the turn ends
  p.noDiscardCardId = null;

  g.turn = (g.turn + 1) % g.players.length;

  emit(room);
});
  /* ---------- OPEN / ADD RUN ---------- */

  socket.on("openRun", ({ room, cardIds }) => {
    const g = games[room];
    const p = g?.players?.[g.turn];
    if (!g || !p || p.id !== socket.id) return;
    if (g.roundOver || g.gameOver) return;

    // ✅ must draw before opening any runs
    if (!p.canDiscard) return;

    const ids = Array.isArray(cardIds) ? cardIds : [];
    if (ids.length < 3) return;

    const cards = ids.map((id) => p.hand.find((c) => c.id === id));
    if (cards.includes(undefined)) return;

    const jokerCount = cards.filter((c) => c.value === "2").length;
    if (jokerCount > 1) return; // ✅ max 1 joker per run

    if (!validRun(cards)) return;

    const normalized = normalizeRun(cards);

    p.hand = p.hand.filter((c) => !ids.includes(c.id));
    p.openedSets.push(normalized);
    p.opened = true;

    emit(room);
  });

  socket.on("addToRun", ({ room, targetPlayer, runIndex, cardIds }) => {
    const g = games[room];
    if (!g) return;
    if (g.roundOver || g.gameOver) return;

    const me = g.players.find((pp) => pp.id === socket.id);
    const owner = g.players.find((pp) => pp.id === targetPlayer);
    if (!me || !owner || !me.opened) return;

    // ✅ must draw before adding to any run
    if (!me.canDiscard) return;

    if (runIndex == null || runIndex < 0 || runIndex >= owner.openedSets.length) return;

    // team restriction
    if (g.teamMode && me.team !== owner.team) return;
    if (!g.teamMode && me.id !== owner.id) return;

    const ids = Array.isArray(cardIds) ? cardIds : [];
    if (ids.length < 1) return;

    const add = ids.map((id) => me.hand.find((c) => c.id === id));
    if (add.includes(undefined)) return;

    const original = [...owner.openedSets[runIndex]];

    // counts (supports selecting multiple cards)
    const originalJokers = original.filter((c) => c.value === "2").length;
    const addJokers = add.filter((c) => c.value === "2").length;
    const addReals = add.filter((c) => c.value !== "2").length;

    // ✅ House rule: max 1 joker per run total
    if (originalJokers + addJokers > 1) return;

    // ✅ With max-1-joker, joker-only add is never allowed
    if (addJokers > 0 && addReals === 0) return;

    // ✅ If you are adding a joker (and the run had none), you must include at least one real too
    // (already covered by joker-only check above, but keep explicit for clarity)
    if (addJokers > 0 && originalJokers === 0 && addReals === 0) return;

    const combined = [...original, ...add];
    if (!validRun(combined)) return;
    owner.openedSets[runIndex] = normalizeRun(combined);
    me.hand = me.hand.filter((c) => !ids.includes(c.id));

    emit(room);
  });

  /* ---------- ROUND ---------- */

  socket.on("playerWentOut", ({ room }) => {
    const g = games[room];
    const pTurn = g?.players?.[g.turn];
    if (!g || !pTurn || pTurn.id !== socket.id) return; // ✅ must be current turn player
    if (g.roundOver || g.gameOver) return;

    // must have 0 cards
    if (pTurn.hand.length) return;

    // ✅ MUST have drawn this turn (prevents going out without drawing)
    if (!pTurn.canDiscard) return;

    // ✅ If hand is empty, discard requirement is irrelevant
    pTurn.mustDiscard = false;
    pTurn.canDiscard = false;

    g.roundOver = true;
    g.winner = pTurn.id;
    g.winnerPid = pTurn.pid; // stable identity for scoring

    scoreRound(g);
    checkWin(g);

    emit(room);
  });

  socket.on("continueGame", ({ room }) => {
    const g = games[room];
    if (!g || g.gameOver) return;

    const deck = buildDeck();
    g.closed = deck;
    g.open = [deck.pop()];

    g.players.forEach((p) => {
      p.hand = deck.splice(0, HAND_SIZE);
      p.openedSets = [];
      p.opened = false;
      p.mustDiscard = false;
      p.canDiscard = false;
      // scores persist (team or individual)
    });

    g.roundOver = false;
    g.winner = null;
    g.winnerPid = null;

    // ✅ rotate dealer + starter each round
    g.dealerIndex = ((g.dealerIndex ?? -1) + 1) % g.players.length;  // first continueGame => dealer becomes 0
    g.turn = (g.dealerIndex + 1) % g.players.length;                // starter = player next to dealer

    g.log.push("New round started");
    emit(room);
  });

  /* ---------- NEW GAME (reset scores + fresh round) ---------- */
socket.on("newGame", ({ room }) => {
  const g = games[room];
  if (!g) return;

  // Optional: only allow when the previous game is over
  if (!g.gameOver) return;

  const deck = buildDeck();
  g.closed = deck;
  g.open = [deck.pop()];

  // reset round state
  g.roundOver = false;
  g.winner = null;
  g.winnerPid = null; // ✅ keep consistent with continueGame
  g.gameOver = false;

// ✅ rotate dealer + starter for rematch too
g.dealerIndex = ((g.dealerIndex ?? -1) + 1) % g.players.length;
g.turn = (g.dealerIndex + 1) % g.players.length;

  // reset scores (individual + team)
  if (g.teamMode) {
    g.teamScores = { 0: 0, 1: 0 };
  }

  g.players.forEach((p) => {
    // fresh hands / round state
    p.hand = deck.splice(0, HAND_SIZE);
    p.openedSets = [];
    p.opened = false;
    p.mustDiscard = false;
    p.canDiscard = false;

    // reset per-player score (in team mode we mirror team score anyway)
    p.score = 0;
  });

  g.log.push("New game started (scores reset)");
  emit(room);
});
});

function scoreRound(g) {
  const openedPts = (p) => p.openedSets.flat().reduce((s, c) => s + (c.points || 0), 0);
  const handPts = (p) => p.hand.reduce((s, c) => s + (c.points || 0), 0);

  // ✅ winner identity should be stable (pid). fallback to id if needed.
  const winnerPid =
    g.winnerPid ??
    (g.winner ? g.players.find((pp) => pp.id === g.winner)?.pid : null);

  // INDIVIDUAL MODE
  if (!g.teamMode) {
    g.players.forEach((p) => {
      const isWinner = winnerPid ? p.pid === winnerPid : p.id === g.winner;

      if (isWinner) {
        const gain = openedPts(p) + 10;
        p.score += gain;
        return;
      }

      let net = openedPts(p) - handPts(p);
      if (!p.opened) net *= 2;
      p.score += net;
    });
    return;
  }

  // TEAM MODE
  if (!g.teamScores) g.teamScores = { 0: 0, 1: 0 };

  const teamDelta = { 0: 0, 1: 0 };

  g.players.forEach((p) => {
    const team = p.team;
    if (team !== 0 && team !== 1) return;

    const isWinner = winnerPid ? p.pid === winnerPid : p.id === g.winner;

    if (isWinner) {
      const gain = openedPts(p) + 10;
      teamDelta[team] += gain;
      return;
    }

    let net = openedPts(p) - handPts(p);
    if (!p.opened) net *= 2;
    teamDelta[team] += net;
  });

  g.teamScores[0] = (g.teamScores[0] || 0) + teamDelta[0];
  g.teamScores[1] = (g.teamScores[1] || 0) + teamDelta[1];

  // mirror team score onto each player for compatibility with current UI
  g.players.forEach((p) => {
    if (p.team === 0 || p.team === 1) p.score = g.teamScores[p.team] || 0;
  });
}

function checkWin(g) {
  if (!g.teamMode) {
    if (g.players.some((p) => p.score >= WIN_SCORE)) g.gameOver = true;
    return;
  }

  if (!g.teamScores) g.teamScores = { 0: 0, 1: 0 };
  if ((g.teamScores[0] || 0) >= WIN_SCORE || (g.teamScores[1] || 0) >= WIN_SCORE) {
    g.gameOver = true;
  }
}
/* ---------- EMIT ---------- */

function emit(room) {
  const g = games[room];
  if (!g) return;

  // ensure g.teams is always up to date in team mode
  syncTeams(g);

  g.players.forEach((p) => {
    io.to(p.id).emit("gameState", {
      ...g,
      players: g.players.map((x) => ({
        ...x,
        hand: x.id === p.id ? x.hand : maskHand(x.hand)
      }))
    });
  });
}