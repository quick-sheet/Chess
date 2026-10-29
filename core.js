/* Chess core: the rules, draws and the computer player. No DOM, so it runs in the page, in worker.js and in Node. */
(function (root) {
'use strict';

/* ---------- Board ----------
   0x88 board: square = row * 16 + col, row 0 is rank 8 (Black's back rank), col 0 is the a-file.
   Pieces: 1 pawn, 2 knight, 3 bishop, 4 rook, 5 queen, 6 king, plus 8 for Black. */
const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6, BLACK = 8;
const NAMES = ['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
const LETTERS = ' pnbrqk';
const VAL = [0, 100, 320, 330, 500, 900, 0];
const KNIGHT = [-33, -31, -18, -14, 14, 18, 31, 33];
const KING = [-17, -16, -15, -1, 1, 15, 16, 17];
const DIAG = [-17, -15, 15, 17];
const ORTH = [-16, -1, 1, 16];
const WK = 1, WQ = 2, BK = 4, BQ = 8;          // castling rights
const CAP = 1, DOUBLE = 2, EP = 4, CASTLE = 8;  // move flags

const sq = (row, col) => row * 16 + col;
const E1 = sq(7, 4), F1 = sq(7, 5), G1 = sq(7, 6), H1 = sq(7, 7), D1 = sq(7, 3), C1 = sq(7, 2), B1 = sq(7, 1), A1 = sq(7, 0);
const E8 = sq(0, 4), F8 = sq(0, 5), G8 = sq(0, 6), H8 = sq(0, 7), D8 = sq(0, 3), C8 = sq(0, 2), B8 = sq(0, 1), A8 = sq(0, 0);
// a move touching one of these squares removes the matching castling rights
const CMASK = new Int8Array(128).fill(15);
CMASK[E1] = 15 & ~(WK | WQ); CMASK[H1] = 15 & ~WK; CMASK[A1] = 15 & ~WQ;
CMASK[E8] = 15 & ~(BK | BQ); CMASK[H8] = 15 & ~BK; CMASK[A8] = 15 & ~BQ;

// Moves are integers: from | to << 7 | promotion piece << 14 | flags << 17
const mFrom = (m) => m & 127, mTo = (m) => (m >> 7) & 127, mPromo = (m) => (m >> 14) & 7, mFlags = (m) => m >> 17;
const mk = (from, to, promo, flags) => from | (to << 7) | (promo << 14) | (flags << 17);

/* ---------- Position keys (Zobrist) ---------- */
let seed = 0x2545F491;
const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; };
const ZP = new Int32Array(16 * 128); for (let i = 0; i < ZP.length; i++) ZP[i] = rnd();
const ZC = new Int32Array(16); for (let i = 0; i < 16; i++) ZC[i] = rnd();
const ZEP = new Int32Array(8); for (let i = 0; i < 8; i++) ZEP[i] = rnd();
const ZSIDE = rnd();

/* ---------- Position ---------- */
function Pos() {
  this.b = new Int8Array(128);
  this.side = 0;          // 0 White to move, 1 Black
  this.castle = 0;
  this.ep = -1;           // en passant target square
  this.half = 0;          // moves since a capture or pawn move, in plies
  this.full = 1;
  this.kings = [-1, -1];
  this.hash = 0;          // pieces, side and castling; en passant is added by key()
  this.stack = [];        // undo records
  this.keys = [];         // key of every position so far, for repetition
  this.moves = [];        // moves played
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function fromFen(fen) {
  const p = new Pos(), f = String(fen || START).trim().split(/\s+/);
  const rows = f[0].split('/');
  if (rows.length !== 8) throw new Error('Bad FEN');
  for (let r = 0; r < 8; r++) {
    let c = 0;
    for (const ch of rows[r]) {
      if (/\d/.test(ch)) { c += +ch; continue; }
      const t = LETTERS.indexOf(ch.toLowerCase());
      if (t < 1) throw new Error('Bad FEN');
      const pc = t | (ch === ch.toLowerCase() ? BLACK : 0);
      p.b[sq(r, c)] = pc;
      if (t === K) p.kings[pc & BLACK ? 1 : 0] = sq(r, c);
      c++;
    }
  }
  p.side = f[1] === 'b' ? 1 : 0;
  const cs = f[2] || '-';
  p.castle = (cs.includes('K') ? WK : 0) | (cs.includes('Q') ? WQ : 0) | (cs.includes('k') ? BK : 0) | (cs.includes('q') ? BQ : 0);
  p.ep = f[3] && f[3] !== '-' ? parseSq(f[3]) : -1;
  p.half = +(f[4] || 0);
  p.full = +(f[5] || 1);
  p.hash = fullHash(p);
  p.keys.push(key(p));
  return p;
}

function fullHash(p) {
  let h = 0;
  for (let s = 0; s < 128; s++) if (!(s & 0x88) && p.b[s]) h ^= ZP[p.b[s] * 128 + s];
  h ^= ZC[p.castle];
  if (p.side) h ^= ZSIDE;
  return h;
}

// The en passant square only counts for repetition when a pawn could actually take there
function key(p) {
  if (p.ep < 0) return p.hash;
  const pawn = p.side ? (P | BLACK) : P, back = p.side ? -16 : 16;
  const a = p.ep + back - 1, c = p.ep + back + 1;
  if ((!(a & 0x88) && p.b[a] === pawn) || (!(c & 0x88) && p.b[c] === pawn)) return p.hash ^ ZEP[p.ep & 7];
  return p.hash;
}

function fen(p) {
  let s = '';
  for (let r = 0; r < 8; r++) {
    let empty = 0;
    for (let c = 0; c < 8; c++) {
      const pc = p.b[sq(r, c)];
      if (!pc) { empty++; continue; }
      if (empty) { s += empty; empty = 0; }
      const ch = LETTERS[pc & 7];
      s += pc & BLACK ? ch : ch.toUpperCase();
    }
    if (empty) s += empty;
    if (r < 7) s += '/';
  }
  const cs = (p.castle & WK ? 'K' : '') + (p.castle & WQ ? 'Q' : '') + (p.castle & BK ? 'k' : '') + (p.castle & BQ ? 'q' : '');
  return `${s} ${p.side ? 'b' : 'w'} ${cs || '-'} ${p.ep >= 0 ? sqName(p.ep) : '-'} ${p.half} ${p.full}`;
}

const sqName = (s) => 'abcdefgh'[s & 7] + (8 - (s >> 4));
function parseSq(t) {
  const c = 'abcdefgh'.indexOf(t[0]), r = 8 - +t[1];
  return c < 0 || !(r >= 0 && r < 8) ? -1 : sq(r, c);
}

/* ---------- Attacks ---------- */
function attacked(p, s, by) {
  const b = p.b, col = by ? BLACK : 0;
  let t;
  if (by) {
    t = s - 15; if (!(t & 0x88) && b[t] === (P | BLACK)) return true;
    t = s - 17; if (!(t & 0x88) && b[t] === (P | BLACK)) return true;
  } else {
    t = s + 15; if (!(t & 0x88) && b[t] === P) return true;
    t = s + 17; if (!(t & 0x88) && b[t] === P) return true;
  }
  const kn = N | col, kg = K | col, bi = B | col, ro = R | col, qu = Q | col;
  for (let i = 0; i < 8; i++) {
    t = s + KNIGHT[i]; if (!(t & 0x88) && b[t] === kn) return true;
    t = s + KING[i]; if (!(t & 0x88) && b[t] === kg) return true;
  }
  for (let i = 0; i < 4; i++) {
    const d = DIAG[i];
    for (t = s + d; !(t & 0x88); t += d) { const x = b[t]; if (x) { if (x === bi || x === qu) return true; break; } }
    const o = ORTH[i];
    for (t = s + o; !(t & 0x88); t += o) { const x = b[t]; if (x) { if (x === ro || x === qu) return true; break; } }
  }
  return false;
}

const inCheck = (p) => attacked(p, p.kings[p.side], p.side ^ 1);

/* ---------- Move generation (pseudo-legal) ----------
   capsOnly: captures and queen promotions, for the computer's capture search */
function gen(p, out, capsOnly) {
  const b = p.b, us = p.side, col = us ? BLACK : 0;
  const fwd = us ? 16 : -16, startRow = us ? 1 : 6, lastRow = us ? 7 : 0;
  for (let s = 0; s < 128; s++) {
    if (s & 0x88) { s += 7; continue; }
    const pc = b[s];
    if (!pc || (pc & BLACK) !== col) continue;
    const t = pc & 7;
    if (t === P) {
      const one = s + fwd;
      if (!(one & 0x88) && !b[one]) {
        if ((one >> 4) === lastRow) promos(out, s, one, 0, capsOnly);
        else if (!capsOnly) {
          out.push(mk(s, one, 0, 0));
          const two = one + fwd;
          if ((s >> 4) === startRow && !b[two]) out.push(mk(s, two, 0, DOUBLE));
        }
      }
      for (let k = -1; k <= 1; k += 2) {
        const to = one + k;
        if (to & 0x88) continue;
        const x = b[to];
        if (x && (x & BLACK) !== col) {
          if ((to >> 4) === lastRow) promos(out, s, to, CAP, capsOnly);
          else out.push(mk(s, to, 0, CAP));
        } else if (!x && to === p.ep) out.push(mk(s, to, 0, CAP | EP));
      }
    } else if (t === N || t === K) {
      const dirs = t === N ? KNIGHT : KING;
      for (let i = 0; i < 8; i++) {
        const to = s + dirs[i];
        if (to & 0x88) continue;
        const x = b[to];
        if (!x) { if (!capsOnly) out.push(mk(s, to, 0, 0)); }
        else if ((x & BLACK) !== col) out.push(mk(s, to, 0, CAP));
      }
    } else {
      const dirs = t === B ? DIAG : t === R ? ORTH : KING;
      for (let i = 0; i < dirs.length; i++) {
        const d = dirs[i];
        for (let to = s + d; !(to & 0x88); to += d) {
          const x = b[to];
          if (!x) { if (!capsOnly) out.push(mk(s, to, 0, 0)); continue; }
          if ((x & BLACK) !== col) out.push(mk(s, to, 0, CAP));
          break;
        }
      }
    }
  }
  if (capsOnly) return out;
  // Castling: the king may not start, pass through or land on an attacked square
  if (!us) {
    if ((p.castle & WK) && !b[F1] && !b[G1] && b[H1] === R && b[E1] === K && !attacked(p, E1, 1) && !attacked(p, F1, 1) && !attacked(p, G1, 1)) out.push(mk(E1, G1, 0, CASTLE));
    if ((p.castle & WQ) && !b[D1] && !b[C1] && !b[B1] && b[A1] === R && b[E1] === K && !attacked(p, E1, 1) && !attacked(p, D1, 1) && !attacked(p, C1, 1)) out.push(mk(E1, C1, 0, CASTLE));
  } else {
    if ((p.castle & BK) && !b[F8] && !b[G8] && b[H8] === (R | BLACK) && b[E8] === (K | BLACK) && !attacked(p, E8, 0) && !attacked(p, F8, 0) && !attacked(p, G8, 0)) out.push(mk(E8, G8, 0, CASTLE));
    if ((p.castle & BQ) && !b[D8] && !b[C8] && !b[B8] && b[A8] === (R | BLACK) && b[E8] === (K | BLACK) && !attacked(p, E8, 0) && !attacked(p, D8, 0) && !attacked(p, C8, 0)) out.push(mk(E8, C8, 0, CASTLE));
  }
  return out;
}

function promos(out, from, to, flags, queenOnly) {
  out.push(mk(from, to, Q, flags));
  if (queenOnly) return;
  out.push(mk(from, to, N, flags), mk(from, to, R, flags), mk(from, to, B, flags));
}

/* ---------- Make and unmake ---------- */
// Plays a pseudo-legal move. Returns false (and leaves the position unchanged) if it would leave the king in check.
function make(p, m) {
  const b = p.b, from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, fl = m >> 17;
  const us = p.side, pc = b[from];
  let capSq = to;
  if (fl & EP) capSq = us ? to - 16 : to + 16;
  const cap = b[capSq];
  p.stack.push(m, cap, p.castle, p.ep, p.half, p.hash);
  let h = p.hash ^ ZP[pc * 128 + from];
  b[from] = 0;
  if (cap) { b[capSq] = 0; h ^= ZP[cap * 128 + capSq]; }
  const np = promo ? (promo | (pc & BLACK)) : pc;
  b[to] = np; h ^= ZP[np * 128 + to];
  if (fl & CASTLE) {
    const rf = to > from ? from + 3 : from - 4, rt = to > from ? from + 1 : from - 1, rk = b[rf];
    b[rf] = 0; b[rt] = rk; h ^= ZP[rk * 128 + rf] ^ ZP[rk * 128 + rt];
  }
  if ((pc & 7) === K) p.kings[us] = to;
  h ^= ZC[p.castle];
  p.castle &= CMASK[from] & CMASK[to];
  h ^= ZC[p.castle];
  p.ep = fl & DOUBLE ? (from + to) >> 1 : -1;
  p.half = cap || (pc & 7) === P ? 0 : p.half + 1;
  if (us) p.full++;
  p.side = us ^ 1;
  p.hash = h ^ ZSIDE;
  p.keys.push(key(p));
  p.moves.push(m);
  if (attacked(p, p.kings[us], us ^ 1)) { unmake(p); return false; }
  return true;
}

function unmake(p) {
  const st = p.stack, b = p.b;
  p.hash = st.pop(); p.half = st.pop(); p.ep = st.pop(); p.castle = st.pop();
  const cap = st.pop(), m = st.pop();
  p.keys.pop(); p.moves.pop();
  const from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, fl = m >> 17;
  p.side ^= 1;
  const us = p.side;
  if (us) p.full--;
  const pc = promo ? (P | (us ? BLACK : 0)) : b[to];
  b[from] = pc; b[to] = 0;
  if (cap) b[fl & EP ? (us ? to - 16 : to + 16) : to] = cap;
  if (fl & CASTLE) {
    const rf = to > from ? from + 3 : from - 4, rt = to > from ? from + 1 : from - 1;
    b[rf] = b[rt]; b[rt] = 0;
  }
  if ((pc & 7) === K) p.kings[us] = from;
}

function legal(p) {
  const out = [], all = gen(p, [], false);
  for (const m of all) if (make(p, m)) { unmake(p); out.push(m); }
  return out;
}

/* ---------- Game state ---------- */
// Not enough pieces left for anyone to checkmate
function insufficient(p) {
  const b = p.b;
  let minors = 0, bishopColours = 0, knights = 0;
  for (let s = 0; s < 128; s++) {
    if (s & 0x88) { s += 7; continue; }
    const t = b[s] & 7;
    if (!t || t === K) continue;
    if (t === P || t === R || t === Q) return false;
    minors++;
    if (t === N) knights++;
    else bishopColours |= 1 << (((s >> 4) + (s & 7)) & 1);
  }
  if (minors <= 1) return true;                       // K v K, K and a minor v K
  return knights === 0 && bishopColours !== 3;        // only bishops, all on one colour
}

// How many times the current position has occurred (positions repeat only with the same side to move)
function repeats(p) {
  const k = p.keys, last = k.length - 1, cur = k[last];
  let n = 1;
  for (let i = last - 2; i >= Math.max(0, last - p.half); i -= 2) if (k[i] === cur) n++;
  return n;
}

// { over, winner: 'w' | 'b' | null, reason: 'checkmate' | 'stalemate' | 'material' | 'repetition' | 'fifty', check }
function status(p) {
  const moves = legal(p), check = inCheck(p);
  if (!moves.length) return check ? { over: true, winner: p.side ? 'w' : 'b', reason: 'checkmate', check } : { over: true, winner: null, reason: 'stalemate', check };
  if (insufficient(p)) return { over: true, winner: null, reason: 'material', check };
  if (repeats(p) >= 3) return { over: true, winner: null, reason: 'repetition', check };
  if (p.half >= 100) return { over: true, winner: null, reason: 'fifty', check };
  return { over: false, winner: null, reason: null, check, moves };
}

/* ---------- Moves as text ---------- */
const uci = (m) => sqName(mFrom(m)) + sqName(mTo(m)) + (mPromo(m) ? LETTERS[mPromo(m)] : '');
function fromUci(p, s) {
  const t = String(s || '');
  const from = parseSq(t.slice(0, 2)), to = parseSq(t.slice(2, 4)), pr = t[4] ? LETTERS.indexOf(t[4]) : 0;
  return legal(p).find((m) => mFrom(m) === from && mTo(m) === to && mPromo(m) === pr) || 0;
}
function fromMoves(list, start) {
  const p = fromFen(start || START);
  for (const s of list || []) { const m = fromUci(p, s); if (!m) break; make(p, m); }
  return p;
}

// What a move does, in words the app can use. Call before the move is played.
function describe(p, m) {
  const from = mFrom(m), to = mTo(m), fl = mFlags(m), pc = p.b[from];
  const capSq = fl & EP ? (p.side ? to - 16 : to + 16) : to;
  const cap = fl & CAP ? p.b[capSq] : 0;
  return {
    colour: pc & BLACK ? 'b' : 'w', piece: NAMES[pc & 7], from: sqName(from), to: sqName(to),
    captured: cap ? NAMES[cap & 7] : null, castle: fl & CASTLE ? (to > from ? 'king' : 'queen') : null,
    promo: mPromo(m) ? NAMES[mPromo(m)] : null, ep: !!(fl & EP),
  };
}

// Board for drawing: 64 entries from a8 to h1, each '' or colour + letter ('wp', 'bk')
function board64(p) {
  const out = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const pc = p.b[sq(r, c)];
    out.push(pc ? (pc & BLACK ? 'b' : 'w') + LETTERS[pc & 7] : '');
  }
  return out;
}

// Pieces each side has taken, worked out from what's missing
function captured(p) {
  const full = { p: 8, n: 2, b: 2, r: 2, q: 1 }, have = { w: {}, b: {} };
  for (const x of board64(p)) if (x && x[1] !== 'k') have[x[0]][x[1]] = (have[x[0]][x[1]] || 0) + 1;
  const lost = { w: [], b: [] };
  let wMat = 0, bMat = 0;
  const v = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  for (const c of ['w', 'b']) {
    // promotions can leave a side with more than it started with; extra pieces cancel missing pawns
    let extra = 0;
    for (const t of ['q', 'r', 'b', 'n']) extra += Math.max(0, (have[c][t] || 0) - full[t]);
    for (const t of ['q', 'r', 'b', 'n', 'p']) {
      let miss = Math.max(0, full[t] - (have[c][t] || 0));
      if (t === 'p') miss = Math.max(0, miss - extra);
      for (let i = 0; i < miss; i++) lost[c].push(t);
    }
    for (const t in have[c]) (c === 'w' ? (wMat += v[t] * have[c][t]) : (bMat += v[t] * have[c][t]));
  }
  // byWhite: black pieces White has taken
  return { byWhite: lost.b, byBlack: lost.w, lead: wMat - bMat };
}

// Hint for one move: could the piece be taken straight after it?
function risky(p, m) {
  if (!make(p, m)) return false;
  const to = mTo(m), dbl = mFlags(m) & DOUBLE;
  let hit = false;
  for (const r of gen(p, [], true)) {
    if (!(mFlags(r) & CAP)) continue;
    const lands = mTo(r) === to || (dbl && (mFlags(r) & EP));
    if (lands && make(p, r)) { unmake(p); hit = true; break; }
  }
  unmake(p);
  return hit;
}

/* ---------- Computer player ---------- */
// Piece-square bonuses from White's side, index row * 8 + col (row 0 is rank 8). Black reads them mirrored.
const PST = [null];
(function buildPst() {
  const cd = (r, c) => Math.max(Math.abs(3.5 - r), Math.abs(3.5 - c));   // 0.5 in the centre, 3.5 on the edge
  const t = (f) => { const a = new Int16Array(64); for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) a[r * 8 + c] = Math.round(f(r, c)); return a; };
  PST[P] = t((r, c) => {
    const adv = 6 - r;
    if (adv < 0 || adv > 5) return 0;
    let v = [0, 4, 10, 20, 36, 62][adv];
    if (c === 3 || c === 4) v += [-12, 4, 14, 12, 8, 6][adv];
    if (c === 0 || c === 7) v -= 4;
    return v;
  });
  PST[N] = t((r, c) => 24 - 14 * cd(r, c) - (r === 7 ? 8 : 0));
  PST[B] = t((r, c) => 12 - 6 * cd(r, c) - (r === 7 ? 8 : 0));
  PST[R] = t((r, c) => (r === 1 ? 16 : 0) + (c >= 2 && c <= 5 ? 4 : 0));
  PST[Q] = t((r, c) => 6 - 3 * cd(r, c));
  PST[K] = t((r, c) => (r === 7 ? [12, 18, 10, -6, -6, -4, 22, 14][c] : r === 6 ? -14 : -40 - (5 - r) * 6));
  PST[7] = t((r, c) => 22 - 12 * cd(r, c));   // king in the endgame: come to the centre
})();

const MATE = 30000, INF = 32000;

// Score from the side to move's point of view, in hundredths of a pawn
function evaluate(p) {
  const b = p.b;
  let mg = 0, kw = 0, kb = 0, npm = 0, wMat = 0, bMat = 0, wb = 0, bb = 0, heavy = false, minors = 0;
  for (let s = 0; s < 128; s++) {
    if (s & 0x88) { s += 7; continue; }
    const pc = b[s];
    if (!pc) continue;
    const t = pc & 7, i = (s >> 4) * 8 + (s & 7);
    if (pc & BLACK) {
      const mi = (7 - (s >> 4)) * 8 + (s & 7);
      if (t === K) { kb = mi; continue; }
      mg -= VAL[t] + PST[t][mi]; bMat += VAL[t];
      if (t === B) bb++;
    } else {
      if (t === K) { kw = i; continue; }
      mg += VAL[t] + PST[t][i]; wMat += VAL[t];
      if (t === B) wb++;
    }
    if (t !== P) npm += VAL[t];
    if (t === P || t === R || t === Q) heavy = true; else minors++;
  }
  if (!heavy && minors <= 1) return 0;
  const eg = 1 - Math.min(npm, 6400) / 6400;
  mg += Math.round((PST[K][kw] - PST[K][kb]) * (1 - eg) + (PST[7][kw] - PST[7][kb]) * eg);
  if (wb >= 2) mg += 30;
  if (bb >= 2) mg -= 30;
  // When clearly winning late in the game, drive the other king to the edge and bring ours close
  const diff = wMat - bMat;
  if (eg > 0.5 && Math.abs(diff) >= 300) {
    const lose = diff > 0 ? kb : kw, win = diff > 0 ? kw : kb;
    const lr = lose >> 3, lc = lose & 7, wr = win >> 3, wc = win & 7;
    const edge = Math.max(Math.abs(3.5 - lr), Math.abs(3.5 - lc));
    const near = 14 - (Math.abs(lr - wr) + Math.abs(lc - wc));
    const mop = Math.round(edge * 14 + near * 5);
    mg += diff > 0 ? mop : -mop;
  }
  return (p.side ? -mg : mg) + 8;
}

// Transposition table: remembers positions already searched
const TT_SIZE = 1 << 18, TT_MASK = TT_SIZE - 1;
const ttKey = new Int32Array(TT_SIZE), ttMove = new Int32Array(TT_SIZE), ttScore = new Int16Array(TT_SIZE);
const ttDepth = new Int8Array(TT_SIZE), ttFlag = new Int8Array(TT_SIZE);
const EXACT = 1, LOWER = 2, UPPER = 3;

function orderScore(p, m, ttm, S, ply) {
  if (m === ttm) return 1e6;
  const fl = m >> 17;
  let v = 0;
  if (fl & CAP) {
    const victim = fl & EP ? P : p.b[(m >> 7) & 127] & 7, attacker = p.b[m & 127] & 7;
    v = 1e5 + victim * 10 - attacker;
  }
  if ((m >> 14) & 7) v += 9e4 + ((m >> 14) & 7);
  if (!v && S) { if (S.killers[ply * 2] === m) v = 8e4; else if (S.killers[ply * 2 + 1] === m) v = 7.9e4; }
  return v;
}

function sortMoves(p, moves, ttm, S, ply) {
  const sc = moves.map((m) => orderScore(p, m, ttm, S, ply));
  const idx = moves.map((_, i) => i).sort((a, b) => sc[b] - sc[a]);
  return idx.map((i) => moves[i]);
}

function tick(S) {
  if ((++S.nodes & 1023) === 0 && S.deadline && Date.now() > S.deadline) S.stop = true;
  return S.stop;
}

function drawnHere(p) {
  if (p.half >= 100) return true;
  const k = p.keys, last = k.length - 1, cur = k[last];
  for (let i = last - 2; i >= Math.max(0, last - p.half); i -= 2) if (k[i] === cur) return true;   // any repeat counts during search
  return false;
}

function qsearch(S, p, alpha, beta, ply, qd) {
  if (tick(S)) return 0;
  const check = qd < 2 && inCheck(p);
  let best = -INF;
  if (!check) {
    best = evaluate(p);
    if (best >= beta || ply >= 60) return best;
    if (best > alpha) alpha = best;
  }
  const moves = sortMoves(p, gen(p, [], !check), 0, null, ply);
  let any = false;
  for (const m of moves) {
    if (!make(p, m)) continue;
    any = true;
    const sc = -qsearch(S, p, -beta, -alpha, ply + 1, qd + 1);
    unmake(p);
    if (S.stop) return 0;
    if (sc > best) { best = sc; if (sc > alpha) { alpha = sc; if (alpha >= beta) break; } }
  }
  if (check && !any) return -MATE + ply;
  return best;
}

function negamax(S, p, depth, alpha, beta, ply) {
  if (tick(S)) return 0;
  if (ply && drawnHere(p)) return 0;
  const check = inCheck(p);
  if (check && ply < 2 * S.maxDepth) depth++;   // look one step further when in check
  if (depth <= 0) return qsearch(S, p, alpha, beta, ply, 0);

  const k = key(p), slot = k & TT_MASK;
  let ttm = 0;
  if (ttKey[slot] === k) {
    ttm = ttMove[slot];
    if (ply && ttDepth[slot] >= depth) {
      let v = ttScore[slot];
      if (v > MATE - 200) v -= ply; else if (v < -MATE + 200) v += ply;
      const f = ttFlag[slot];
      if (f === EXACT || (f === LOWER && v >= beta) || (f === UPPER && v <= alpha)) return v;
    }
  }
  const a0 = alpha;
  const moves = sortMoves(p, gen(p, [], false), ttm, S, ply);
  let best = -INF, bestMove = 0, count = 0;
  for (const m of moves) {
    if (!make(p, m)) continue;
    count++;
    const sc = -negamax(S, p, depth - 1, -beta, -alpha, ply + 1);
    unmake(p);
    if (S.stop) return 0;
    if (sc > best) {
      best = sc; bestMove = m;
      if (sc > alpha) {
        alpha = sc;
        if (alpha >= beta) {
          if (!((m >> 17) & CAP) && S.killers[ply * 2] !== m) { S.killers[ply * 2 + 1] = S.killers[ply * 2]; S.killers[ply * 2] = m; }
          break;
        }
      }
    }
  }
  if (!count) return check ? -MATE + ply : 0;
  let store = best;
  if (store > MATE - 200) store += ply; else if (store < -MATE + 200) store -= ply;
  ttKey[slot] = k; ttMove[slot] = bestMove; ttScore[slot] = store; ttDepth[slot] = depth;
  ttFlag[slot] = best <= a0 ? UPPER : best >= beta ? LOWER : EXACT;
  return best;
}

// The five levels. Depth counts half-moves: 2 is "my move, then your reply".
const LEVELS = [null,
  { kind: 'random' },                              // 1 Snail
  { kind: 'grab' },                                // 2 Bunny
  { kind: 'fixed', depth: 2, noise: 45 },          // 3 Fox
  { kind: 'fixed', depth: 3, noise: 15 },          // 4 Owl
  { kind: 'deep', time: 1500, maxDepth: 12 },      // 5 Lion
];

// rand: a function giving 0 to 1 (Math.random by default, a seeded one in tests)
function think(p, level, opt) {
  opt = opt || {};
  const rand = opt.rand || Math.random, L = Object.assign({}, LEVELS[level] || LEVELS[3], opt.override || {});
  const moves = legal(p);
  if (!moves.length) return null;
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  if (L.kind === 'random') return { move: pick(moves), score: 0, depth: 0, nodes: 0 };
  if (L.kind === 'grab') {
    let bestV = 0, best = [];
    for (const m of moves) {
      if (!(mFlags(m) & CAP)) continue;
      const v = mFlags(m) & EP ? VAL[P] : VAL[p.b[mTo(m)] & 7];
      if (v > bestV) { bestV = v; best = [m]; } else if (v === bestV) best.push(m);
    }
    return { move: best.length ? pick(best) : pick(moves), score: 0, depth: 1, nodes: 0 };
  }

  const S = { nodes: 0, stop: false, deadline: 0, killers: new Int32Array(256), maxDepth: L.depth || L.maxDepth };
  if (L.kind === 'fixed') {
    // every reply searched in full, then a little randomness so it doesn't play the same game twice
    let best = null, bestV = -Infinity;
    const scored = [];
    for (const m of sortMoves(p, moves, 0, S, 0)) {
      make(p, m);
      const sc = -negamax(S, p, L.depth - 1, -INF, INF, 1);
      unmake(p);
      scored.push({ m, sc });
      const v = sc + (Math.abs(sc) > MATE - 200 ? 0 : (rand() * 2 - 1) * L.noise);
      if (v > bestV) { bestV = v; best = { m, sc }; }
    }
    return { move: best.m, score: best.sc, depth: L.depth, nodes: S.nodes };
  }

  // Lion: deepen step by step until time runs out. The first two steps always finish, so there is always a sensible move.
  const started = Date.now(), budget = opt.time != null ? opt.time : L.time;
  let order = sortMoves(p, moves, 0, S, 0), best = order[0], bestScore = 0, done = 0;
  for (let d = 1; d <= L.maxDepth; d++) {
    S.deadline = d <= 2 ? 0 : started + budget;
    if (d > 2 && Date.now() > started + budget * 0.55) break;   // the next step would not finish in time
    const scores = new Map();
    let alpha = -INF, iterBest = 0, iterScore = -INF, first = true;
    for (const m of order) {
      make(p, m);
      let sc;
      if (first) sc = -negamax(S, p, d - 1, -INF, -alpha, 1);
      else {
        sc = -negamax(S, p, d - 1, -alpha - 1, -alpha, 1);    // quick check: can this move beat the best so far?
        if (!S.stop && sc > alpha) sc = -negamax(S, p, d - 1, -INF, -alpha, 1);
      }
      unmake(p);
      if (S.stop) break;
      first = false;
      scores.set(m, sc);
      if (sc > iterScore) { iterScore = sc; iterBest = m; }
      if (sc > alpha) alpha = sc;
    }
    // A step cut short still counts for the moves it finished: the previous best was searched first,
    // so anything it found better than that has been checked in full.
    if (iterBest) { best = iterBest; bestScore = iterScore; done = S.stop ? d - 1 : d; }
    if (S.stop) break;
    order = order.slice().sort((a, b) => (scores.has(b) ? scores.get(b) : -INF) - (scores.has(a) ? scores.get(a) : -INF));
    if (Math.abs(bestScore) > MATE - 200) break;   // found a forced mate
  }
  return { move: best, score: bestScore, depth: done, nodes: S.nodes };
}

function perft(p, depth) {
  if (!depth) return 1;
  let n = 0;
  for (const m of gen(p, [], false)) {
    if (!make(p, m)) continue;
    n += depth === 1 ? 1 : perft(p, depth - 1);
    unmake(p);
  }
  return n;
}

const api = {
  START, NAMES, fromFen, fen, fromMoves, fromUci, uci, legal, make, unmake, status, inCheck, insufficient, repeats,
  describe, board64, captured, risky, think, perft, evaluate, sqName, LEVELS,
  from: mFrom, to: mTo, promo: mPromo, isCapture: (m) => !!(mFlags(m) & CAP),
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.Chess = api;
})(typeof self !== 'undefined' ? self : this);
