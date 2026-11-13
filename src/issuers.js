// Lista revisada de emisores (https://solflag.com/emisores.json, la misma que usa la web). Con ella el motor sabe
// qué tokens son oficiales de cada emisor (p. ej. los 1.517 de xStocks) y marca en ámbar si a uno le cambian las
// claves. Se lee al arrancar y cada 24 h; si no se puede leer, el motor sigue con la lista que trae de serie.
import { setIssuers } from "solana-risk-engine";

export const ISSUERS_URL = "https://solflag.com/emisores.json";

// Devuelve cuántos emisores quedan en uso, o 0 si no se pudo leer la lista (se queda la de serie)
export async function loadIssuers({ url = ISSUERS_URL, fetchFn = fetch, apply = setIssuers } = {}) {
  const r = await fetchFn(url, { headers: { "cache-control": "no-cache" } });
  if (!r.ok) throw new Error("emisores.json " + r.status);
  const j = await r.json();
  if (!j || !Array.isArray(j.emisores) || !j.emisores.length) throw new Error("emisores.json sin emisores");
  return apply(j.emisores);
}

export function keepIssuersFresh(log, hours = 24) {
  const run = () => loadIssuers()
    .then((n) => log(`emisores: ${n} cargados de ${ISSUERS_URL}`))
    .catch((e) => log("emisores: se queda la lista del motor,", e.message));
  run();
  return setInterval(run, hours * 3600000);
}
