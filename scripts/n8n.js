// Genera n8n/verificador.code.js: la librería entera + el wrapper, para pegar en un Code node.
import { readFileSync, writeFileSync } from 'node:fs';

export function construir() {
  const lib = readFileSync(new URL('../src/verificador.js', import.meta.url), 'utf8').replace(/^export /gm, '');
  return `// GENERADO por scripts/n8n.js desde src/verificador.js — no editar a mano.
// Code node · Mode: Run Once for Each Item
// Entrada:  { texto, hechos }  (hechos: ver README)
// Salida:   { ...entrada, ok, problemas, feedback, voz, aparte }
${lib}
const { texto = '', hechos = {} } = $json;
const r = verificar(texto, hechos);
return { json: { ...$json, ok: r.ok, problemas: r.problemas, feedback: r.ok ? '' : feedback(r.problemas), ...(r.ok ? paraVoz(texto) : {}) } };
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(new URL('../n8n/verificador.code.js', import.meta.url), construir());
  console.log('n8n/verificador.code.js actualizado');
}
