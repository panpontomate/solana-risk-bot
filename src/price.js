import { getMarkets } from "solana-risk-engine";

// Price alerts. Each one is { mint, label, kind, value, ref, since }:
//   kind "above" / "below": fires once when the price crosses `value` (USD), then it is removed
//   kind "move": fires every time the price moves `value` % away from `ref`, which then becomes the new `ref`

/**
 * Reads what comes after the token in /precio: ">1.5", "<0,8", "1.5", "20%", ">20%", "<20%".
 * A bare number is a target on whichever side of the current price it lies.
 * @returns {{kind, value}|null}
 */
export function parseCondition(text, price) {
  const m = String(text || "").replace(/\s+/g, "").match(/^([<>])?\$?([\d.,]+)\$?(%)?$/);
  if (!m) return null;
  let s = m[2];
  // "1,5" and "1.5" are the same; with both, the last one is the decimal mark ("1.234,5" / "1,234.5")
  const dec = Math.max(s.lastIndexOf(","), s.lastIndexOf("."));
  if (dec >= 0) s = s.slice(0, dec).replace(/[.,]/g, "") + "." + s.slice(dec + 1);
  const n = Number(s);
  if (!(n > 0) || !isFinite(n)) return null;
  if (m[3]) {
    if (!m[1]) return n >= 1 && n <= 1000 ? { kind: "move", value: n } : null;
    if (m[1] === "<" && n >= 100) return null;
    return { kind: m[1] === ">" ? "above" : "below", value: price * (m[1] === ">" ? 1 + n / 100 : 1 - n / 100) };
  }
  return { kind: m[1] === "<" || (!m[1] && n < price) ? "below" : "above", value: n };
}

// What a fresh price means for one alert: null, or { kind, from, to, pct }
export function checkAlert(a, price) {
  if (!(price > 0)) return null;
  if (a.kind === "above" && price >= a.value) return { kind: "above", to: price };
  if (a.kind === "below" && price <= a.value) return { kind: "below", to: price };
  if (a.kind === "move" && a.ref > 0) {
    const pct = (price / a.ref - 1) * 100;
    if (Math.abs(pct) >= a.value - 1e-9) return { kind: pct > 0 ? "up" : "down", from: a.ref, to: price, pct: Math.round(Math.abs(pct)) };
  }
  return null;
}

// Current USD price and best pair of each mint (one DexScreener request per 30 mints). Mints whose
// price could not be read are simply missing: unknown this time, never an alert.
export async function getPrices(client, mints) {
  const out = {};
  if (!mints.length) return out;
  const { data } = await getMarkets(client, mints);
  for (const m of mints) {
    const p = data[m], price = p && Number(p.priceUsd);
    if (price > 0) out[m] = { price, pair: p };
  }
  return out;
}

// Prices from $60,000 down to $0.00000001234, always with 4 meaningful digits
export function priceText(v, lang) {
  const loc = lang === "es" ? "es-ES" : "en-US";
  const n = v >= 1
    ? v.toLocaleString(loc, v >= 1000 ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : v.toLocaleString(loc, { maximumSignificantDigits: 4 });
  return lang === "es" ? n + " $" : "$" + n;
}
