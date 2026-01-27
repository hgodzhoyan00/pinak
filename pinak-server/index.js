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

/* ---------- RUN VALIDATION ---------- */

function validRun(cards) {
  if (!Array.isArray(cards) || cards.length < 3) return false;

  const real = cards.filter((c) => c.value !== "2");
  const jokers = cards.length - real.length;

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

/* ---------- GAME STATE ---------- */

const games = {};

/* ---------- SOCKET ---------- */

io.on("connection", (socket) => {
  /* ---------- CREATE / JOIN ---------- */

  socket.on("createRoom", ({ room, name, teamMode }) => {
    if (!room || !name || games[room]) return;

    const deck = buildDeck();

    games[room] = {
      room,
      teamMode: !!teamMode,
      players: [
        {
          id: socket.id,
          name,
          team: teamMode ? 0 : null,
          hand: deck.splice(0, HAND_SIZE),
          openedSets: [],
          opened: false,
          mustDiscard: false,
          canDiscard: false, // true after ANY draw (open or closed)
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

    socket.join(room);
    emit(room);
  });

  socket.on("joinRoom", ({ room, name }) => {
    const g = games[room];
    if (!g || g.players.length >= 4) return;

    g.players.push({
      id: socket.id,
      name,
      team: g.teamMode ? g.players.length % 2 : null,
      hand: g.closed.splice(0, HAND_SIZE),
      openedSets: [],
      opened: false,
      mustDiscard: false,
      canDiscard: false,
      score: 0
    });

    socket.join(room);
    g.log.push(`${name} joined the room`);
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

    // open is stored bottom->top; draw from TOP = last items
    p.hand.push(...g.open.splice(-count));

    // If you emptied the open stack, you MUST discard to re-seed it.
    // Otherwise discard stays optional.
    p.mustDiscard = g.open.length === 0;

    p.canDiscard = true;

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

    g.open.push(p.hand.splice(index, 1)[0]);

    // discard ends turn
    p.mustDiscard = false;
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

    // optional-discard path: end turn without discarding
    p.canDiscard = false;
    g.turn = (g.turn + 1) % g.players.length;

    emit(room);
  });

  /* ---------- OPEN / ADD RUN ---------- */

  socket.on("openRun", ({ room, cardIds }) => {
    const g = games[room];
    const p = g?.players?.[g.turn];
    if (!g || !p || p.id !== socket.id) return;
    if (g.roundOver || g.gameOver) return;

    const ids = Array.isArray(cardIds) ? cardIds : [];
    if (ids.length < 3) return;

    const cards = ids.map((id) => p.hand.find((c) => c.id === id));
    if (cards.includes(undefined)) return;
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

    if (runIndex == null || runIndex < 0 || runIndex >= owner.openedSets.length) return;

    // team restriction
    if (g.teamMode && me.team !== owner.team) return;
    if (!g.teamMode && me.id !== owner.id) return;

    const ids = Array.isArray(cardIds) ? cardIds : [];
    if (ids.length < 1) return;

    const add = ids.map((id) => me.hand.find((c) => c.id === id));
    if (add.includes(undefined)) return;

    const original = [...owner.openedSets[runIndex]];
    const hadJoker = original.some((c) => c.value === "2");
    const addingJoker = add.some((c) => c.value === "2");
    const addingReal = add.some((c) => c.value !== "2");

    // If adding a joker to a run that previously had no joker, must include at least one real card too
    if (addingJoker && !hadJoker && !addingReal) return;

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
    if (pTurn.hand.length) return; // must have 0 cards
    if (pTurn.mustDiscard) return; // ✅ cannot go out while a required discard is pending

    g.roundOver = true;
    g.winner = pTurn.id;

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
    });

    g.roundOver = false;
    g.winner = null;
    g.turn = 0;

    g.log.push("New round started");
    emit(room);
  });
});

/* ---------- SCORING ---------- */
/*
RULES IMPLEMENTED (per your message):
- Winner score gain = (points in opened sets) + 10 bonus
- Other players score gain/loss = (opened sets points) - (hand points)
- Double penalty: only applies to the player who never opened any sets:
    net = (openedPts - handPts) * 2  (openedPts will be 0 if never opened)
- Winner does NOT get any penalty
*/
function scoreRound(g) {
  const openedPts = (p) => p.openedSets.flat().reduce((s, c) => s + (c.points || 0), 0);
  const handPts = (p) => p.hand.reduce((s, c) => s + (c.points || 0), 0);

  g.players.forEach((p) => {
    if (p.id === g.winner) {
      const gain = openedPts(p) + 10;
      p.score += gain;
      return;
    }

    let net = openedPts(p) - handPts(p);

    // double penalty only for this player if they never opened
    if (!p.opened) net *= 2;

    p.score += net;
  });
}

function checkWin(g) {
  if (!g.teamMode) {
    if (g.players.some((p) => p.score >= WIN_SCORE)) g.gameOver = true;
  } else {
    const teamScores = {};
    g.players.forEach((p) => {
      teamScores[p.team] = (teamScores[p.team] || 0) + p.score;
    });
    if (Object.values(teamScores).some((s) => s >= WIN_SCORE)) g.gameOver = true;
  }
}

/* ---------- EMIT ---------- */

function emit(room) {
  const g = games[room];
  if (!g) return;

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