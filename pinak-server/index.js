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
const ORDER = ["3","4","5","6","7","8","9","10","J","Q","K","A"];
const INDEX = Object.fromEntries(ORDER.map((v,i)=>[v,i]));
const WIN_SCORE = 151;

/* ---------- HELPERS ---------- */

function buildDeck() {
  const deck = [];
  for (const s of SUITS)
    for (const v of ["A","2","3","4","5","6","7","8","9","10","J","Q","K"])
      deck.push({
        id: uuid(),
        value: v,
        suit: s,
        points: v === "A" || v === "2" ? 2 : 1
      });
  return deck.sort(() => Math.random() - 0.5);
}

function maskHand(hand) {
  return hand.map(() => ({ value: "?", suit: "?" }));
}

/* ---------- RUN VALIDATION ---------- */

function validRun(cards) {
  if (cards.length < 3) return false;

  const real = cards.filter(c => c.value !== "2");
  const jokers = cards.length - real.length;
  if (real.length < 2) return false;

  const suit = real[0].suit;
  if (!real.every(c => c.suit === suit)) return false;

  const values = real.map(c => c.value);

  // ✅ FIX:
  // Do NOT hard-block "A without K".
  // Example Q + Joker + A should be valid because Joker can represent K.
  // The gap/joker logic below already enforces "Ace only after King" correctly.

  const idx = values.map(v => INDEX[v]).sort((a,b)=>a-b);
  let gaps = 0;
  for (let i = 1; i < idx.length; i++) {
    const diff = idx[i] - idx[i-1] - 1;
    if (diff < 0) return false;
    gaps += diff;
  }
  return gaps <= jokers;
}

/* ---------- GAME STATE ---------- */

const games = {};

/* ---------- SOCKET ---------- */

io.on("connection", socket => {

  /* ---------- CREATE / JOIN ---------- */

  socket.on("createRoom", ({ room, name, teamMode }) => {
    if (!room || !name || games[room]) return;

    const deck = buildDeck();
    games[room] = {
      room,
      teamMode,
      players: [{
        id: socket.id,
        name,
        team: teamMode ? 0 : null,
        hand: deck.splice(0,7),
        openedSets: [],
        opened: false,
        mustDiscard: false,
        canDiscard: false,
        score: 0
      }],
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
      hand: g.closed.splice(0,7),
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
    if (!g || p.id !== socket.id) return;
    if (p.canDiscard) return; // already drew

    p.hand.push(g.closed.pop());
    p.mustDiscard = true;
    p.canDiscard = true;
    emit(room);
  });

  socket.on("drawOpen", ({ room, count }) => {
    const g = games[room];
    const p = g?.players?.[g.turn];
    if (!g || p.id !== socket.id) return;
    if (p.canDiscard) return; // already drew

    p.hand.push(...g.open.splice(-count));
    p.mustDiscard = false;
    p.canDiscard = true;
    emit(room);
  });

  /* ---------- DISCARD ---------- */

  socket.on("discard", ({ room, index }) => {
    const g = games[room];
    const p = g?.players?.[g.turn];
    if (!g || p.id !== socket.id) return;
    if (!p.canDiscard) return;

    g.open.push(p.hand.splice(index,1)[0]);

    p.mustDiscard = false;
    p.canDiscard = false;
    g.turn = (g.turn + 1) % g.players.length;
    emit(room);
  });

  socket.on("endTurn", ({ room }) => {
    const g = games[room];
    const p = g?.players?.[g.turn];
    if (!g || p.id !== socket.id) return;
    if (p.mustDiscard) return;

    p.canDiscard = false;
    g.turn = (g.turn + 1) % g.players.length;
    emit(room);
  });

  /* ---------- OPEN / ADD RUN ---------- */

  socket.on("openRun", ({ room, cardIds }) => {
    const g = games[room];
    const p = g?.players?.[g.turn];
    if (!g || !p || p.id !== socket.id) return;

    const cards = cardIds.map(id => p.hand.find(c => c.id === id));
    if (cards.includes(undefined) || !validRun(cards)) return;

    p.hand = p.hand.filter(c => !cardIds.includes(c.id));
    p.openedSets.push(cards);
    p.opened = true;
    emit(room);
  });

  socket.on("addToRun", ({ room, targetPlayer, runIndex, cardIds }) => {
    const g = games[room];
    if (!g) return;

    const me = g.players.find(p => p.id === socket.id);
    const owner = g.players.find(p => p.id === targetPlayer);
    if (!me || !owner || !me.opened) return;

    if (g.teamMode && me.team !== owner.team) return;
    if (!g.teamMode && me.id !== owner.id) return;

    const add = cardIds.map(id => me.hand.find(c => c.id === id));
    if (add.includes(undefined)) return;

    const original = [...owner.openedSets[runIndex]];
    const hadJoker = original.some(c => c.value === "2");
    const addingJoker = add.some(c => c.value === "2");
    const addingReal = add.some(c => c.value !== "2");

    if (addingJoker && !hadJoker && !addingReal) return;

    const combined = [...original, ...add];
    if (!validRun(combined)) return;

    owner.openedSets[runIndex] = combined;
    me.hand = me.hand.filter(c => !cardIds.includes(c.id));
    emit(room);
  });

  /* ---------- ROUND ---------- */

  socket.on("playerWentOut", ({ room }) => {
    const g = games[room];
    if (!g) return;

    const p = g.players.find(x => x.id === socket.id);
    if (!p || p.hand.length) return;

    g.roundOver = true;
    g.winner = p.id;
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
    g.players.forEach(p => {
      p.hand = deck.splice(0,7);
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

function scoreRound(g) {
  g.players.forEach(p => {
    if (p.id === g.winner) {
      p.score += 10;
      return;
    }
    let pts =
      p.hand.reduce((s,c)=>s+c.points,0) +
      p.openedSets.flat().reduce((s,c)=>s+c.points,0);
    if (!p.opened) pts *= 2;
    p.score -= pts;
  });
}

function checkWin(g) {
  if (!g.teamMode) {
    if (g.players.some(p => p.score >= WIN_SCORE))
      g.gameOver = true;
  } else {
    const teamScores = {};
    g.players.forEach(p => {
      teamScores[p.team] = (teamScores[p.team] || 0) + p.score;
    });
    if (Object.values(teamScores).some(s => s >= WIN_SCORE))
      g.gameOver = true;
  }
}

/* ---------- EMIT ---------- */

function emit(room) {
  const g = games[room];
  if (!g) return;

  g.players.forEach(p => {
    io.to(p.id).emit("gameState", {
      ...g,
      players: g.players.map(x => ({
        ...x,
        hand: x.id === p.id ? x.hand : maskHand(x.hand)
      }))
    });
  });
}