import { describe, levelLabel, format, chgDiff } from "solana-risk-engine";
import { escapeHtml as esc } from "./telegram.js";
import { t } from "./texts.js";

// Signals that come and go on their own and would only make noise as alerts:
// daily volume dips, a market getting older, a check that timed out this time
const NOISY = new Set(["MKT_VOLUME_LOW", "MKT_NEW", "CON_UNAVAILABLE", "CON_SKIPPED", "MARKET_UNCHECKED", "NO_INFO"]);
const SEVERITY = { LOW: 1, MEDIUM: 2, HIGH: 3, SPAM: 3 };

// What is remembered about a watched token between checks
export function tokenState(r) {
  return {
    lvl: r.lvl,
    sym: r.sym,
    liq: (r.pair && r.pair.liquidity && r.pair.liquidity.usd) || 0,
    signals: (r.reasons || []).filter((x) => (x.s === "bad" || x.s === "warn") && !NOISY.has(x.code)).map((x) => ({ code: x.code, s: x.s, data: x.data }))
  };
}

/**
 * Changes worth an alert between two token states.
 * @returns {{worse: boolean, better: boolean, level: [from,to]|null, newSignals: [], liqDrop: {pct, from, to}|null}}
 */
export function diffToken(prev, now) {
  const out = { worse: false, better: false, level: null, newSignals: [], liqDrop: null };
  const a = SEVERITY[prev.lvl], b = SEVERITY[now.lvl];
  if (a && b && a !== b) { out.level = [prev.lvl, now.lvl]; if (b > a) out.worse = true; else out.better = true; }
  const had = new Set(prev.signals.map((x) => x.code));
  out.newSignals = now.signals.filter((x) => !had.has(x.code));
  if (out.newSignals.length) out.worse = true;
  if (prev.liq >= 1000 && now.liq < prev.liq * 0.7) {
    out.liqDrop = { pct: Math.round((1 - now.liq / prev.liq) * 100), from: prev.liq, to: now.liq };
    out.worse = true;
  }
  return out;
}

export function formatTokenAlert(label, d, lang) {
  const T = t(lang), f = format(lang);
  const lines = [d.worse ? T.alertToken(esc(label)) : T.alertBetter(esc(label))];
  if (d.level) lines.push(T.level(esc(levelLabel(d.level[0], lang)), esc(levelLabel(d.level[1], lang))));
  for (const s of d.newSignals) lines.push(`${s.s === "bad" ? "🔴" : "🟡"} ${T.newSignal}: ${esc(describe(s, lang))}`);
  if (d.liqDrop) lines.push("📉 " + T.liqDrop(d.liqDrop.pct, f.usd(d.liqDrop.from), f.usd(d.liqDrop.to)));
  return lines.join("\n");
}

// Wallet moves since the last snapshot (same thresholds as the scanner: >= $20 new or sold, >= $50 more or less)
export function walletMoves(prevSnap, nowSnap) {
  return chgDiff(prevSnap || {}, nowSnap || {}).sort((x, y) => y.v - x.v);
}

const MOVE_ICON = { new: "🟢", more: "🟢", less: "🔻", sold: "🔻" };

function moveLines(moves, lang, max) {
  const T = t(lang), f = format(lang);
  const lines = moves.slice(0, max).map((m) => `${MOVE_ICON[m.k]} ${T.moves[m.k]}: <b>$${esc(m.s)}</b> ${f.usd(m.v)}`);
  if (moves.length > max) lines.push("…+" + (moves.length - max));
  return lines;
}

export function formatWalletAlert(label, moves, lang, max = 12) {
  return [t(lang).alertWallet(esc(label))].concat(moveLines(moves, lang, max)).join("\n");
}

// The creator's moves, with sales of the watched token itself first and flagged: the creator dumping
// their own token is the clearest sign they are leaving
export function formatCreatorAlert(label, mint, creator, moves, lang, max = 12) {
  const T = t(lang);
  const own = moves.filter((m) => m.m === mint), rest = moves.filter((m) => m.m !== mint);
  const lines = [T.alertCreator(esc(label), esc(creator))];
  if (own.some((m) => m.k === "less" || m.k === "sold")) lines.push(T.creatorDumping(esc(label)));
  return lines.concat(moveLines(own.concat(rest), lang, max)).join("\n");
}
