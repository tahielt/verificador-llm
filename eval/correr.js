// Corre la suite de evaluación: qué bloquea bien, qué deja pasar mal y qué limitaciones están documentadas.
import { readFileSync } from 'node:fs';
import { verificar } from '../src/verificador.js';

const archivo = process.argv[2] ?? 'eval/inmobiliaria.json';
const { negocio, hechos, casos } = JSON.parse(readFileSync(archivo, 'utf8'));
const res = casos.map((c) => ({ ...c, r: verificar(c.texto, hechos) }));
const evaluables = res.filter((c) => !c.limitacion);
const bloquear = evaluables.filter((c) => !c.ok), pasar = evaluables.filter((c) => c.ok);
const detectados = bloquear.filter((c) => !c.r.ok && c.tipos.every((t) => c.r.problemas.some((p) => p.tipo === t)));
const falsosPositivos = pasar.filter((c) => !c.r.ok);

console.log(`Suite: ${negocio} · ${casos.length} casos\n`);
console.log(`Errores detectados con el tipo correcto: ${detectados.length}/${bloquear.length}`);
console.log(`Respuestas correctas bloqueadas por error: ${falsosPositivos.length}/${pasar.length}`);
for (const c of [...bloquear.filter((x) => !detectados.includes(x)), ...falsosPositivos]) {
  console.log(`  ✗ "${c.texto}" → ${c.r.ok ? 'pasó' : c.r.problemas.map((p) => p.tipo).join(', ')}`);
}
const lim = res.filter((c) => c.limitacion);
if (lim.length) console.log(`\nLimitaciones conocidas (${lim.length}):\n` + lim.map((c) => `  · ${c.limitacion}`).join('\n'));
process.exitCode = detectados.length === bloquear.length && !falsosPositivos.length ? 0 : 1;
