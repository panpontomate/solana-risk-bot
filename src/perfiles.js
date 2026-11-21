// Puntos por apartado (21/11/2026, motor 0.7.0): el archivo diario de la web con lo que no está en la cadena
// (comisiones, actividad, código, desbloqueos…). Se baja cada pocas horas y analyzeToken lo recibe siempre, así el bot
// da el mismo nivel que la web. Si no se puede bajar, se sigue con el de la última vez (o sin él: reglas de meme).
export const PERFILES_URL = "https://solflag.com/datos/perfiles.json";
const FRESCO = 3 * 3600000, REINTENTO = 10 * 60000;
let cache = { t: 0, data: {} };

export async function perfiles(fetchFn = fetch, now = Date.now()) {
  if (cache.t && now - cache.t < FRESCO) return cache.data;
  try {
    const r = await fetchFn(PERFILES_URL);
    const j = r && r.ok ? await r.json() : null;
    if (j && j.t) { cache = { t: now, data: j.t }; return cache.data; }
  } catch {}
  cache.t = now - FRESCO + REINTENTO;   // falló: se vuelve a probar en 10 minutos
  return cache.data;
}

// Envuelve analyzeToken del scanner para que lleve siempre el perfil del token
export function withPerfiles(scanner, get = perfiles) {
  const orig = scanner.analyzeToken;
  scanner.analyzeToken = async (mint, o) => orig(mint, Object.assign({}, o, { perfil: (await get())[mint] || null }));
  return scanner;
}

// Para los tests
export function _reset() { cache = { t: 0, data: {} }; }
