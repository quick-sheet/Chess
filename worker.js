/* Chess: the computer thinks here, away from the screen, so the board never freezes. */
importScripts('core.js' + self.location.search);   // same release as the page

self.onmessage = (e) => {
  const { id, moves, level } = e.data || {};
  let move = null;
  try {
    const p = self.Chess.fromMoves(moves || []);
    const r = self.Chess.think(p, level);
    if (r) move = self.Chess.uci(r.move);
  } catch (err) { move = null; }
  self.postMessage({ id, move });
};
