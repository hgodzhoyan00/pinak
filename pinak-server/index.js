import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import { v4 as uuid } from "uuid";

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

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
  for (const s of SUITS) {
    for (const v of ["A","2","3","4","5","6","7","8","9","10","J","Q","K"]) {
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

function safeError(socket, room, msg) {
  socket.emit("errorMsg", msg);
  // re-emit game state so client always re-syncs after a rejected action
  if (room && games[room]) emit(room);
}

function getGame(room) {
  const g = games[room];
  return g || null;
}

function currentPlayer(g) {
  return g.players[g.turn];
}

function isTurnPlayer(g, socketId) {
  return currentPlayer(g)?.id === socketId;
}

function blockIfOver(g, socket, room) {
  if (g.gameOver) {
    safeError(socket, room, "Game is over.");
    return true;
  }
  if (g.roundOver) {
    safeError(socket, room, "Round is over. Tap Continue / start next round.");
    return true;
  }
  return false;
}

/* ---------- RUN VALIDATION ---------- */

function validRun(cards) {
  if (!Array.isArray(cards) || cards.length < 3) return false;

  const real = cards.filter(c => c?.value !== "2");
  const jokers = cards.length - real.length;
  if (real.length < 2) return false;

  const suit = real[0].suit;
  if (!real.every(c => c.suit === suit)) return false;

  const values = real.map(c => c.value);
  // Ace only after King
  if (values.includes("A") && !values.includes("K")) return false;

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
    if (!room || !name) return safeError(socket, null, "Room and name are required.");
    if (games[room]) return safeError(socket, null, "Room already exists.");

    const deck = buildDeck();

    const p0 = {
      id: socket.id,
      name,
      team: teamMode ? 0 : null,
      hand: deck.splice(0, 7),
      openedSets: [],
      opened: false,
      mustDiscard: false,
      canDiscard: false, // true after drawing (open or closed), cleared after discard/endTurn
      score: 0
    };

    games[room] = {
      room,
      teamMode: !!teamMode,
      players: [p0],
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
    const g = getGame(room);
    if (!g) return safeError(socket, null, "Room not found.");
    if (!name) return safeError(socket, room, "Name is required.");
    if (g.players.length >= 4) return safeError(socket, room, "Room is full (max 4).");

    // prevent duplicate socket join entries
    if (g.players.some(p => p.id === socket.id)) return;

    const p = {
      id: socket.id,
      name,
      team: g.teamMode ? g.players.length % 2 : null,
      hand: g.closed.splice(0, 7),
      openedSets: [],
      opened: false,
      mustDiscard: false,
      canDiscard: false,
      score: 0
    };

    g.players.push(p);
    socket.join(room);
    g.log.push(`${name} joined the room`);
    emit(room);
  });

  /* ---------- DRAW ---------- */

  socket.on("drawClosed", ({ room }) => {
    const g = getGame(room);
    if (!g) return safeError(socket, null, "Room not found.");
    if (blockIfOver(g, socket, room)) return;
    if (!isTurnPlayer(g, socket.id)) return safeError(socket, room, "Not your turn.");

    const p = currentPlayer(g);

    // already drew this turn
    if (p.canDiscard) return safeError(socket, room, "You already drew this turn.");
    // cannot draw if mandatory discard pending
    if (p.mustDiscard) return safeError(socket, room, "You must discard first.");
    if (!g.closed.length) return safeError(socket, room, "Closed deck is empty.");

    p.hand.push(g.closed.pop());
    p.mustDiscard = true;   // closed draw => discard required
    p.canDiscard = true;    // marks 'draw consumed this turn'

    emit(room);
  });

  socket.on("drawOpen", ({ room, count }) => {
    const g = getGame(room);
    if (!g) return safeError(socket, null, "Room not found.");
    if (blockIfOver(g, socket, room)) return;
    if (!isTurnPlayer(g, socket.id)) return safeError(socket, room, "Not your turn.");

    const p = currentPlayer(g);

    if (p.canDiscard) return safeError(socket, room, "You already drew this turn.");
    if (p.mustDiscard) return safeError(socket, room, "You must discard first.");

    if (!Array.isArray(g.open) || g.open.length === 0) {
      return safeError(socket, room, "Open stack is empty.");
    }

    const n = Number(count);
    if (!Number.isFinite(n) || n < 1) return safeError(socket, room, "Invalid open draw count.");
    if (n > g.open.length) return safeError(socket, room, "Not enough cards in open stack.");

    // Open stack: draw top-to-bottom order (top is end of array)
    // We remove the top N cards by slicing from the end.
    // The returned array is bottom-to-top of the selected chunk; that’s okay for hand order.
    const drawn = g.open.splice(-n);

    p.hand.push(...drawn);
    p.mustDiscard = false;  // open draw => discard optional
    p.canDiscard = true;

    emit(room);
  });

  /* ---------- DISCARD ---------- */

  socket.on("discard", ({ room, index }) => {
    const g = getGame(room);
    if (!g) return safeError(socket, null, "Room not found.");
    if (blockIfOver(g, socket, room)) return;
    if (!isTurnPlayer(g, socket.id)) return safeError(socket, room, "Not your turn.");

    const p = currentPlayer(g);

    // must have drawn this turn to discard (optional or required)
    if (!p.canDiscard) return safeError(socket, room, "You can only discard after drawing.");

    const i = Number(index);
    if (!Number.isFinite(i) || i < 0 || i >= p.hand.length) {
      return safeError(socket, room, "Invalid discard selection.");
    }

    const [card] = p.hand.splice(i, 1);
    g.open.push(card);

    // after discard, turn ends
    p.mustDiscard = false;
    p.canDiscard = false;
    g.turn = (g.turn + 1) % g.players.length;

    emit(room);
  });

  socket.on("endTurn", ({ room }) => {
    const g = getGame(room);
    if (!g) return safeError(socket, null, "Room not found.");
    if (blockIfOver(g, socket, room)) return;
    if (!isTurnPlayer(g, socket.id)) return safeError(socket, room, "Not your turn.");

    const p = currentPlayer(g);

    // cannot end if mandatory discard pending
    if (p.mustDiscard) return safeError(socket, room, "Discard is required.");

    // end turn even if p.canDiscard (open draw discard optional)
    p.canDiscard = false;
    g.turn = (g.turn + 1) % g.players.length;

    emit(room);
  });

  /* ---------- OPEN / ADD RUN ---------- */

  socket.on("openRun", ({ room, cardIds }) => {
    const g = getGame(room);
    if (!g) return safeError(socket, null, "Room not found.");
    if (blockIfOver(g, socket, room)) return;
    if (!isTurnPlayer(g, socket.id)) return safeError(socket, room, "Not your turn.");

    const p = currentPlayer(g);

    if (!Array.isArray(cardIds) || cardIds.length < 3) {
      return safeError(socket, room, "Select at least 3 cards.");
    }

    const cards = cardIds.map(id => p.hand.find(c => c.id === id));
    if (cards.some(c => !c)) return safeError(socket, room, "Invalid card selection.");
    if (!validRun(cards)) return safeError(socket, room, "Invalid run.");

    p.hand = p.hand.filter(c => !cardIds.includes(c.id));
    p.openedSets.push(cards);
    p.opened = true;

    emit(room);
  });

  socket.on("addToRun", ({ room, targetPlayer, runIndex, cardIds }) => {
    const g = getGame(room);
    if (!g) return safeError(socket, null, "Room not found.");
    if (blockIfOver(g, socket, room)) return;
    if (!isTurnPlayer(g, socket.id)) return safeError(socket, room, "Not your turn.");

    const me = g.players.find(p => p.id === socket.id);
    const owner = g.players.find(p => p.id === targetPlayer);

    if (!me || !owner) return safeError(socket, room, "Invalid target.");
    if (!me.opened) return safeError(socket, room, "You must have opened at least one set first.");

    if (g.teamMode && me.team !== owner.team) return safeError(socket, room, "Can only add to teammate.");
    if (!g.teamMode && me.id !== owner.id) return safeError(socket, room, "Can only add to your own sets.");

    const idx = Number(runIndex);
    if (!Number.isFinite(idx) || idx < 0 || idx >= owner.openedSets.length) {
      return safeError(socket, room, "Invalid run target.");
    }

    if (!Array.isArray(cardIds) || cardIds.length < 1) {
      return safeError(socket, room, "Select cards to add.");
    }

    const add = cardIds.map(id => me.hand.find(c => c.id === id));
    if (add.some(c => !c)) return safeError(socket, room, "Invalid card selection.");

    const original = [...owner.openedSets[idx]];
    const hadJoker = original.some(c => c.value === "2");
    const addingJoker = add.some(c => c.value === "2");
    const addingReal = add.some(c => c.value !== "2");

    // If adding a joker to a run with no joker, must also add at least one real card
    if (addingJoker && !hadJoker && !addingReal) {
      return safeError(socket, room, "Adding a joker requires adding a real card too.");
    }

    const combined = [...original, ...add];
    if (!validRun(combined)) return safeError(socket, room, "Would make run invalid.");

    owner.openedSets[idx] = combined;
    me.hand = me.hand.filter(c => !cardIds.includes(c.id));

    emit(room);
  });

  /* ---------- ROUND ---------- */

  socket.on("playerWentOut", ({ room }) => {
    const g = getGame(room);
    if (!g) return safeError(socket, null, "Room not found.");
    if (blockIfOver(g, socket, room)) return;
    if (!g.players.some(p => p.id === socket.id)) return safeError(socket, room, "Not in room.");

    const p = g.players.find(x => x.id === socket.id);
    if (!p) return;
    if (p.hand.length) return safeError(socket, room, "You can only end the round with 0 cards.");

    g.roundOver = true;
    g.winner = p.id;

    scoreRound(g);
    checkWin(g);

    emit(room);
  });

  socket.on("continueGame", ({ room }) => {
    const g = getGame(room);
    if (!g) return safeError(socket, null, "Room not found.");
    if (g.gameOver) return safeError(socket, room, "Game is over.");

    const deck = buildDeck();
    g.closed = deck;
    g.open = [deck.pop()];

    g.players.forEach(p => {
      p.hand = deck.splice(0, 7);
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

  /* ---------- DISCONNECT (optional) ---------- */
  socket.on("disconnect", () => {
    // We leave players in games for now; your UI already handles "syncing".
    // If you want full rejoin/disconnect cleanup later, we can add it safely.
  });
});

/* ---------- SCORING ---------- */

function scoreRound(g) {
  g.players.forEach(p => {
    // Winner gets +10 bonus
    if (p.id === g.winner) {
      p.score += 10;
      return;
    }

    // Deduct: remaining hand + opened sets
    let pts =
      p.hand.reduce((s, c) => s + c.points, 0) +
      p.openedSets.flat().reduce((s, c) => s + c.points, 0);

    // Double penalty only for the player with no opened sets
    if (!p.opened) pts *= 2;

    p.score -= pts;
  });
}

function checkWin(g) {
  if (!g.teamMode) {
    if (g.players.some(p => p.score >= WIN_SCORE)) g.gameOver = true;
  } else {
    const teamScores = {};
    g.players.forEach(p => {
      teamScores[p.team] = (teamScores[p.team] || 0) + p.score;
    });
    if (Object.values(teamScores).some(s => s >= WIN_SCORE)) g.gameOver = true;
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