// Puntos por apartado en el bot (21/11): el archivo diario se baja con caché y analyzeToken lo recibe siempre;
// el mensaje enseña el apartado, la barra y lo que resta
import test from "node:test";
import assert from "node:assert/strict";
import { perfiles, withPerfiles, _reset } from "../src/perfiles.js";
import { formatToken, formatGroup, bar } from "../src/format.js";

test("perfiles: se baja una vez y se guarda unas horas; si falla, se sigue con lo último", async () => {
  _reset();
  let n = 0;
  const ok = async () => { n++; return { ok: true, json: async () => ({ t: { MINT: { ap: "defi" } } }) }; };
  assert.deepEqual(await perfiles(ok, 1000), { MINT: { ap: "defi" } });
  await perfiles(ok, 2000);
  assert.equal(n, 1);
  const falla = async () => { throw new Error("red"); };
  assert.deepEqual(await perfiles(falla, 1000 + 4 * 3600000), { MINT: { ap: "defi" } });
});

test("withPerfiles: analyzeToken lleva el perfil del token (o null)", async () => {
  const visto = [];
  const sc = withPerfiles({ analyzeToken: async (m, o) => { visto.push([m, o.perfil, o.skipCreator]); return {}; } }, async () => ({ A: { ap: "ia" } }));
  await sc.analyzeToken("A", { skipCreator: true });
  await sc.analyzeToken("B");
  assert.deepEqual(visto, [["A", { ap: "ia" }, true], ["B", null, undefined]]);
});

test("el mensaje de un token enseña el apartado, la barra y lo que resta", () => {
  const r = { mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", sym: "WIF", name: "dogwifhat", lvl: "LOW", tier: "YELLOW", type: null, reasons: [],
    lights: [{ k: "control", s: "ok", items: [{ code: "CTL_NONE", s: "ok" }] }],
    perfil: { ap: "meme", pts: 80, tier: "GREEN", cap: false, trap: false, checks: [{ k: "control", p: 15, col: "suma" }, { k: "wallet", p: -5, col: "resta" }] } };
  const es = formatToken(r, "es");
  assert.match(es, /🟢/);
  assert.match(es, /<i>Meme<\/i>/);
  assert.match(es, /▰{7}▱{3} <b>80<\/b>\/110 puntos/);
  assert.match(es, /Resta: una wallet grande/);
  assert.match(formatToken(r, "en"), /Subtracts: one big wallet/);
  assert.match(formatGroup(r, "es"), /80<\/b>\/110 · Meme/);
  assert.equal(bar(0), "▱".repeat(10)); assert.equal(bar(200), "▰".repeat(10));
});
