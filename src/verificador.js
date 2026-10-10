// Verificador anti-alucinación para agentes de venta.
// El texto que genera un LLM solo puede afirmar datos que salen de los hechos (base de datos, API, planilla).
// Sin dependencias: corre en Node, en el Code node de n8n y en el navegador.

/**
 * @typedef {{ valor: number, moneda?: 'USD' | 'ARS' }} Monto
 * @typedef {{ valor: number, unidad: string }} Cantidad
 * @typedef {{
 *   montos?: (Monto | number)[],   // precios y totales permitidos
 *   cantidades?: Cantidad[],       // m2, ambientes, dormitorios, baños, cocheras
 *   entidades?: string[],          // propiedades/productos de los que puede hablar esta respuesta
 *   catalogo?: string[],           // todos los nombres del catálogo (para detectar los que no corresponden)
 *   noDisponibles?: string[],      // vendidas, alquiladas o sin stock
 *   urls?: string[], contactos?: string[], fechas?: string[], codigos?: string[]
 * }} Hechos
 * @typedef {{ tipo: 'monto' | 'moneda' | 'cantidad' | 'url' | 'contacto' | 'entidad' | 'codigo' | 'disponibilidad' | 'promesa', detalle: string }} Problema
 */

/** minúsculas y sin acentos, conservando el largo (los índices siguen sirviendo sobre el texto original) */
const plano = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const URL = /https?:\/\/[^\s)]+/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const TELEFONO = /\+?\(?\d[\d\s()-]{6,18}\d/g;
const esTelefono = (s) => { const n = s.replace(/\D/g, '').length; return n >= 8 && n <= 13 && /[\s()-]|^\+/.test(s) || n >= 10 && n <= 13; };
const CODIGO = /\b[A-Z]{2,5}-\d{2,6}\b/g;

const UNIDADES = [
  ['m2', /^\s?(m2|m²|mts2|mt2|metros cuadrados|metros2)/],
  ['ambientes', /^\s?(ambientes?|amb\b)/],
  ['dormitorios', /^\s?(dormitorios?|dorm\b|habitaciones?|cuartos?)/],
  ['banos', /^\s?(banos?)\b/],
  ['cocheras', /^\s?(cocheras?|garages?)\b/],
];

const FECHA = /\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|manana|pasado manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|esta semana|la semana que viene|en \d+ (?:dias|horas|hs))\b/g;
const GARANTIA = /\b(te garantizo|garantizad[oa]|100 ?% seguro|precio final|ultimo precio|te lo reservo|te la reservo|queda reservad[oa]|aceptan (?:la )?oferta)\b/g;
const AFIRMA = /\b(disponible|esta libre|sigue en venta|sigue disponible|se puede visitar|la tenemos|lo tenemos|hay stock)\b/;
const NIEGA = /\b(no (?:esta|hay|la|lo|sigue|se)|ya no|vendid[oa]|alquilad[oa]|reservad[oa]|sin (?:stock|disponibilidad))\b/;

/** "250.000" · "250,000" · "1,5" · "1.5" → número */
export function parsearNumero(s) {
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ''));
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.'));
  return Number(s.replace(',', '.'));
}

/** Busca montos y cantidades con su moneda o unidad. Los índices apuntan al texto recibido. */
export function extraerNumeros(texto) {
  const t = plano(texto), out = [];
  let hasta = 0;
  for (const m of t.matchAll(/\d+(?:[.,]\d+)*/g)) {
    if (m.index < hasta || /[a-z]/.test(t[m.index - 1] ?? '')) continue; // "m2", "mt2", o ya consumido
    let inicio = m.index, fin = m.index + m[0].length, valor = parsearNumero(m[0]);
    const prefijo = t.slice(Math.max(0, inicio - 5), inicio).match(/(usd|u\$s|us\$|u\$d|\$)\s?$/);
    let resto = t.slice(fin);
    const mult = resto.match(/^\s?(millones|millon|mil|k)\b/);
    if (mult) { valor *= mult[1] === 'mil' || mult[1] === 'k' ? 1e3 : 1e6; fin += mult[0].length; resto = t.slice(fin); }
    const sufijo = resto.match(/^\s?(?:de\s)?(usd|u\$s|dolares|dolar|pesos|ars)\b/);
    let moneda;
    if (prefijo) { moneda = prefijo[1] === '$' ? 'ARS' : 'USD'; inicio -= prefijo[0].length; }
    if (sufijo) { moneda = /^(pesos|ars)$/.test(sufijo[1]) ? 'ARS' : 'USD'; fin += sufijo[0].length; }
    const u = !moneda && UNIDADES.find(([, re]) => re.test(resto));
    if (u) fin += resto.match(u[1])[0].length;
    hasta = fin;
    const tipo = moneda || mult ? 'monto' : u ? 'cantidad' : 'numero';
    out.push({ tipo, valor, moneda, unidad: u ? u[0] : undefined, inicio, fin, crudo: texto.slice(inicio, fin).trim() });
  }
  return out;
}

const digitos = (s) => s.replace(/\D/g, '').slice(-8);
const limpiarUrl = (u) => u.replace(/[).,!?]+$/, '');

/** Saca links, mails y teléfonos (para no confundirlos con montos) y los devuelve aparte. */
function separarContactos(texto) {
  const hallados = { urls: [], emails: [], telefonos: [] };
  const tapar = (re, lista, fn = (x) => x, valido = () => true) => (s) =>
    s.replace(re, (x) => (valido(x) ? (lista.push(fn(x)), ' '.repeat(x.length)) : x));
  const t = [tapar(URL, hallados.urls, limpiarUrl), tapar(EMAIL, hallados.emails), tapar(TELEFONO, hallados.telefonos, (x) => x.trim(), esTelefono)]
    .reduce((s, f) => f(s), texto);
  return { texto: t, ...hallados };
}

/**
 * @param {string} texto respuesta del LLM
 * @param {Hechos} hechos lo único que la respuesta puede afirmar
 * @returns {{ ok: boolean, problemas: Problema[] }}
 */
export function verificar(texto, hechos = {}) {
  /** @type {Problema[]} */
  const problemas = [];
  const add = (tipo, detalle) => problemas.push({ tipo, detalle });
  const { texto: sinContactos, urls, emails, telefonos } = separarContactos(texto);
  const t = plano(sinContactos);

  const montos = (hechos.montos ?? []).map((m) => (typeof m === 'number' ? { valor: m } : m));
  for (const n of extraerNumeros(sinContactos)) {
    if (n.tipo === 'monto') {
      const mismo = montos.filter((m) => Math.abs(m.valor - n.valor) < 0.5);
      if (!mismo.length) add('monto', `"${n.crudo}" no sale de los datos`);
      else if (n.moneda && mismo.every((m) => m.moneda && m.moneda !== n.moneda)) add('moneda', `"${n.crudo}" está en ${mismo[0].moneda}, no en ${n.moneda}`);
    } else if (n.tipo === 'cantidad' && !(hechos.cantidades ?? []).some((c) => c.unidad === n.unidad && c.valor === n.valor)) {
      add('cantidad', `"${n.crudo}" no sale de los datos`);
    }
  }

  const urlsOk = new Set((hechos.urls ?? []).map(limpiarUrl));
  for (const u of urls) if (!urlsOk.has(u)) add('url', `link no generado por el sistema: ${u}`);
  const contactosOk = new Set((hechos.contactos ?? []).map((c) => (c.includes('@') ? c.toLowerCase() : digitos(c))));
  for (const e of emails) if (!contactosOk.has(e.toLowerCase())) add('contacto', `mail no provisto: ${e}`);
  for (const f of telefonos) if (!contactosOk.has(digitos(f))) add('contacto', `teléfono no provisto: ${f}`);
  const codigosOk = new Set(hechos.codigos ?? []);
  for (const c of sinContactos.match(CODIGO) ?? []) if (!codigosOk.has(c)) add('codigo', `código inexistente en la consulta: ${c}`);

  const permitidas = new Set((hechos.entidades ?? []).map(plano));
  for (const e of hechos.catalogo ?? []) {
    if (!permitidas.has(plano(e)) && t.includes(plano(e))) add('entidad', `menciona "${e}", que no corresponde a esta consulta`);
  }
  const oraciones = t.split(/[.!?\n]+/);
  for (const e of hechos.noDisponibles ?? []) {
    const p = plano(e);
    if (oraciones.some((o) => o.includes(p) && AFIRMA.test(o) && !NIEGA.test(o))) add('disponibilidad', `presenta como disponible "${e}"`);
  }

  const fechasOk = new Set((hechos.fechas ?? []).map(plano));
  for (const m of t.matchAll(FECHA)) if (!fechasOk.has(m[1])) add('promesa', `promete fecha o plazo: "${m[1]}"`);
  for (const m of t.matchAll(GARANTIA)) add('promesa', `compromiso que el agente no puede tomar: "${m[1]}"`);

  return { ok: problemas.length === 0, problemas };
}

/** Texto para reintentar UNA vez con el LLM antes de pasar a plantilla o a una persona. */
export function feedback(problemas) {
  return 'Tu respuesta anterior tenía estos errores:\n' + problemas.map((p) => `- ${p.detalle}`).join('\n') +
    '\nReescribila usando SOLO los datos provistos. Si un dato no está, decí que lo consultás. Escribí los números con dígitos.';
}

// ── Voz: se verifica el TEXTO y recién después se convierte para TTS ─────────
const U = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince',
  'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco',
  'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
const D = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const C = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];
const apocope = (s) => s.replace(/veintiuno$/, 'veintiún').replace(/uno$/, 'un');

function menosDeMil(n) {
  if (n === 100) return 'cien';
  const r = n % 100;
  const decenas = r < 30 ? (r ? U[r] : '') : D[Math.floor(r / 10)] + (r % 10 ? ' y ' + U[r % 10] : '');
  return [C[Math.floor(n / 100)], decenas].filter(Boolean).join(' ');
}

/** 250000 → "doscientos cincuenta mil" (hasta 999.999.999) */
export function enPalabras(n) {
  if (!Number.isInteger(n)) {
    const [e, d] = String(n).split('.');
    return `${enPalabras(Number(e))} coma ${[...d].map((x) => U[Number(x)]).join(' ')}`;
  }
  if (n === 0) return 'cero';
  const millones = Math.floor(n / 1e6), miles = Math.floor(n / 1e3) % 1000, resto = n % 1000;
  return [
    millones && (millones === 1 ? 'un millón' : `${apocope(enPalabras(millones))} millones`),
    miles && (miles === 1 ? 'mil' : `${apocope(menosDeMil(miles))} mil`),
    resto && menosDeMil(resto),
  ].filter(Boolean).join(' ');
}

const NOMBRES = {
  USD: ['dólar', 'dólares'], ARS: ['peso', 'pesos'], m2: ['metro cuadrado', 'metros cuadrados'], ambientes: ['ambiente', 'ambientes'],
  dormitorios: ['dormitorio', 'dormitorios'], banos: ['baño', 'baños'], cocheras: ['cochera', 'cocheras', 'f'],
};

/**
 * Prepara un texto YA VERIFICADO para TTS: números y unidades como se dicen; links, mails y teléfonos
 * salen de la voz y se devuelven en `aparte` para mandarlos por escrito.
 */
export function paraVoz(texto) {
  const { urls, emails, telefonos } = separarContactos(texto);
  let t = texto
    .replace(URL, (u) => 'el link que te paso por escrito' + u.slice(limpiarUrl(u).length))
    .replace(EMAIL, 'el mail que te paso por escrito')
    .replace(TELEFONO, (x) => (esTelefono(x) ? 'el número que te paso por escrito' : x))
    .replace(/\b(al|del) el (link|mail|número)/gi, '$1 $2');
  for (const n of extraerNumeros(t).reverse()) {
    const [singular, plural, genero] = NOMBRES[n.moneda ?? n.unidad] ?? [];
    const numero = genero === 'f' ? enPalabras(n.valor).replace(/uno$/, 'una') : apocope(enPalabras(n.valor));
    const palabras = singular ? `${numero} ${n.valor === 1 ? singular : plural}` : enPalabras(n.valor);
    t = t.slice(0, n.inicio) + (t[n.inicio] === ' ' ? ' ' : '') + palabras + t.slice(n.fin);
  }
  return { voz: t.replace(/\s{2,}/g, ' ').trim(), aparte: [...urls, ...emails, ...telefonos] };
}
