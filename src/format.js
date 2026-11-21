import { explainLight, lightLabel, levelLabel, tierLabel, tierNote, typeInfo, describe, format } from "solana-risk-engine";
import { escapeHtml as esc } from "./telegram.js";
import { t } from "./texts.js";

export const LEVEL_ICON = { HIGH: "🔴", MEDIUM: "🟠", LOW: "🟢", SPAM: "⛔", NO_DATA: "⚪", NO_MARKET: "⚫" };
// The five tiers (engine 0.6.0, 14/11): what the token is. Tokens without a market keep the old label
export const TIER_ICON = { DIAMOND: "💎", GREEN: "🟢", YELLOW: "🟡", ORANGE: "🟠", RED: "🔴" };
// with points by section (engine 0.7.0) the tier shown is the section's, as on the web
const tierOf = (r) => (r.perfil && r.perfil.tier) || r.tier;
export function icon(r) { return (tierOf(r) && TIER_ICON[tierOf(r)]) || LEVEL_ICON[r.lvl] || ""; }
export function label(r, lang) { return tierOf(r) ? tierLabel(Object.assign({}, r, { tier: tierOf(r), tierCap: r.perfil ? r.perfil.cap : r.tierCap }), lang) : levelLabel(r, lang); }
// the bar as text: 10 blocks for 0–110 points
export function bar(pts) { const n = Math.round(Math.max(0, Math.min(110, pts)) / 11); return "▰".repeat(n) + "▱".repeat(10 - n); }
function perfilLines(r, T) {
  const p = r.perfil, out = [];
  out.push(`<i>${esc(T.ap[p.ap] || p.ap)}${p.lanz ? " · " + esc(T.lanz) : ""}</i>`);
  if (!p.trap) out.push(`${bar(p.pts)} <b>${Math.min(110, p.pts)}</b>/110 ${T.puntos}`);
  const rs = p.checks.filter((c) => c.col === "resta" || c.col === "grave").map((c) => T.ck[c.k]).filter(Boolean);
  out.push(rs.length ? `➖ ${T.resta}: ${esc(rs.join(", "))}` : `➕ ${T.nadaResta}`);
  return out;
}
const LIGHT_ICON = { ok: "🟢", na: "⚪", warn: "🟡", bad: "🔴" };

export function short(a) {
  return a.slice(0, 4) + "…" + a.slice(-4);
}

// The same analysis on the web, in the chat's language: solflag.com/?token=<address> opens it directly
export function webLink(addr, lang) {
  return "https://solflag.com/" + (lang === "en" ? "en/" : "") + "?token=" + addr;
}

// What each flag checks and why, on the web
export function howLink(lang) {
  return "https://solflag.com/" + (lang === "en" ? "en/how-it-works/" : "como-funciona/");
}

export function tokenLabel(r) {
  return r.sym && r.sym !== short(r.mint) ? "$" + r.sym : short(r.mint);
}

// One token, as returned by analyzeToken
export function formatToken(r, lang) {
  const T = t(lang), f = format(lang);
  const lines = [`${icon(r)} <b>${esc(tokenLabel(r))}</b>${r.name ? " · " + esc(r.name) : ""} — <b>${esc(label(r, lang))}</b>`];
  if (r.perfil) lines.push(...perfilLines(r, T));
  else if (r.tier) lines.push(`<i>${esc(tierNote(r, lang))}</i>`);
  const ti = typeInfo(r.type, lang);
  if (ti) lines.push(`<i>${esc(ti.label)}</i>`);
  lines.push("");
  if (r.lights) for (const l of r.lights) lines.push(`${LIGHT_ICON[l.s]} <b>${esc(lightLabel(l.k, lang))}</b>: ${esc(explainLight(l, lang))}`);
  else for (const x of r.reasons) lines.push(`• ${esc(describe(x, lang))}`);
  const links = [`<a href="https://solscan.io/token/${r.mint}">Solscan</a>`];
  if (r.pair && r.pair.pairAddress) links.unshift(`<a href="https://dexscreener.com/solana/${esc(r.pair.pairAddress)}">DexScreener</a>`);
  links.unshift(`<a href="${webLink(r.mint, lang)}">SolFlag</a>`);
  if (r.lights) links.push(`<a href="${howLink(lang)}">${T.how}</a>`);
  lines.push("", `<code>${r.mint}</code>`, links.join(" · "));
  return lines.join("\n");
}

// A wallet, as returned by analyzeWallet: riskiest tokens first, spam and no-market only counted
export function formatWallet(w, lang, maxRows = 10) {
  const T = t(lang), f = format(lang);
  const lines = [T.walletHead(short(w.wallet), w.sol.toLocaleString(lang === "es" ? "es-ES" : "en-US", { maximumFractionDigits: 3 }), w.total), ""];
  const listed = w.results.filter((r) => r.lvl !== "SPAM" && r.lvl !== "NO_MARKET");
  const spam = w.results.filter((r) => r.lvl === "SPAM").length, nomk = w.results.filter((r) => r.lvl === "NO_MARKET").length;
  if (!w.results.length) lines.push(T.walletEmpty);
  const shown = listed.slice(0, maxRows);
  for (const r of shown) {
    const why = r.reasons && r.reasons.find((x) => x.s === "bad") || (r.reasons || []).find((x) => x.s === "warn");
    lines.push(`${icon(r)} <b>${esc(tokenLabel(r))}</b> ${f.usd(r.value || 0)} — ${esc(label(r, lang))}${why && r.lvl !== "LOW" ? ": " + esc(describe(why, lang)) : ""}`);
  }
  if (listed.length > shown.length) lines.push(T.walletRest(listed.length - shown.length));
  if (spam || nomk) lines.push("", T.walletSpam(spam, nomk));
  if (w.hidden) lines.push(T.walletHidden(w.hidden));
  lines.push("", `<a href="${webLink(w.wallet, lang)}">SolFlag</a> · <a href="https://solscan.io/account/${w.wallet}">Solscan</a>`);
  return lines.join("\n");
}

// The token's public file (who is behind it), in the chat's language
export function fichaLink(mint, lang) {
  return "https://token.solflag.com/" + (lang === "en" ? "en/" : "") + mint;
}

// Short answer for a group: level, up to 3 red/yellow signals (red first) and the links. The file's preview is
// what the group sees under it
export function formatGroup(r, lang, maxSignals = 3) {
  const T = t(lang);
  const lines = [`${icon(r)} <b>${esc(tokenLabel(r))}</b>${r.name ? " · " + esc(r.name) : ""} — <b>${esc(label(r, lang))}</b>`];
  if (r.perfil && !r.perfil.trap) lines.push(`${bar(r.perfil.pts)} <b>${Math.min(110, r.perfil.pts)}</b>/110 · ${esc(T.ap[r.perfil.ap] || r.perfil.ap)}`);
  const rank = { bad: 0, warn: 1 };
  const bad = (r.lights || []).filter((l) => l.s in rank).sort((a, b) => rank[a.s] - rank[b.s]).slice(0, maxSignals);
  if (bad.length) for (const l of bad) lines.push(`${LIGHT_ICON[l.s]} ${esc(explainLight(l, lang))}`);
  else if (!r.lights) for (const x of (r.reasons || []).filter((x) => x.s in rank).slice(0, maxSignals)) lines.push(`• ${esc(describe(x, lang))}`);
  if (lines.length === 1) lines.push(T.groupNoSignals);
  lines.push("", `<a href="${fichaLink(r.mint, lang)}">${T.groupFicha}</a> · <a href="${webLink(r.mint, lang)}">${T.groupFull}</a>`);
  return lines.join("\n");
}
