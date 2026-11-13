import { test } from "node:test";
import assert from "node:assert/strict";
import { loadIssuers } from "../src/issuers.js";

const res = (status, body) => ({ ok: status === 200, status, json: async () => body });

test("aplica la lista de emisores.json", async () => {
  let got = null;
  const list = [{ name: "xStocks (Backed)", trusted: true, keys: ["K1"], mints: { M1: "AAPLx" } }];
  const n = await loadIssuers({ fetchFn: async () => res(200, { emisores: list }), apply: (l) => { got = l; return l.length; } });
  assert.equal(n, 1);
  assert.deepEqual(got, list);
});

test("si la web falla o la lista viene vacía, no toca la del motor", async () => {
  let called = false;
  const apply = () => { called = true; return 0; };
  await assert.rejects(loadIssuers({ fetchFn: async () => res(503, null), apply }));
  await assert.rejects(loadIssuers({ fetchFn: async () => res(200, { emisores: [] }), apply }));
  assert.equal(called, false);
});
