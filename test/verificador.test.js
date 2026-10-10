import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { verificar, paraVoz, enPalabras, parsearNumero, feedback } from '../src/verificador.js';
import { construir } from '../scripts/n8n.js';

const { hechos, casos } = JSON.parse(readFileSync('eval/inmobiliaria.json', 'utf8'));
const tipos = (texto, h = hechos) => verificar(texto, h).problemas.map((p) => p.tipo);

test('suite inmobiliaria: detecta cada error con su tipo y no bloquea respuestas correctas', () => {
  for (const c of casos.filter((x) => !x.limitacion)) {
    const r = verificar(c.texto, hechos);
    assert.equal(r.ok, c.ok, c.texto);
    for (const t of c.tipos ?? []) assert.ok(tipos(c.texto).includes(t), `${c.texto} → falta ${t}`);
  }
});

test('números: separadores argentinos e ingleses, decimales y multiplicadores', () => {
  assert.equal(parsearNumero('250.000'), 250000);
  assert.equal(parsearNumero('250,000'), 250000);
  assert.equal(parsearNumero('1.250.000,50'), 1250000.5);
  assert.equal(parsearNumero('1,5'), 1.5);
  assert.deepEqual(tipos('Sale USD 1,5 millones', { montos: [{ valor: 1500000, moneda: 'USD' }] }), []);
  assert.deepEqual(tipos('Sale 250k dólares', { montos: [250000] }), []);
});

test('sin hechos, cualquier precio, link o contacto se bloquea', () => {
  assert.deepEqual(tipos('Sale USD 100.000, mirá https://x.com o llamá al 11 4444-5555', {}), ['monto', 'url', 'contacto']);
});

test('voz: números como se dicen y datos largos aparte', () => {
  assert.equal(enPalabras(95000), 'noventa y cinco mil');
  assert.equal(enPalabras(1_250_000), 'un millón doscientos cincuenta mil');
  assert.equal(enPalabras(21_000), 'veintiún mil');
  assert.equal(enPalabras(100), 'cien');
  assert.deepEqual(paraVoz('El Depto Centro sale USD 95.000, 48 m2. Fotos: https://inmolago.com.ar/p/DC-101. Llamá al 2944 55-1234.'), {
    voz: 'El Depto Centro sale noventa y cinco mil dólares, cuarenta y ocho metros cuadrados. Fotos: el link que te paso por escrito. Llamá al número que te paso por escrito.',
    aparte: ['https://inmolago.com.ar/p/DC-101', '2944 55-1234'],
  });
  assert.equal(paraVoz('Tiene 1 baño, 1 cochera y 21 cocheras.').voz, 'Tiene un baño, una cochera y veintiuna cocheras.');
});

test('feedback lista cada problema para el reintento', () => {
  const f = feedback(verificar('Sale USD 92.000', hechos).problemas);
  assert.match(f, /USD 92\.000/);
  assert.match(f, /SOLO los datos provistos/);
});

test('n8n: el Code node generado está al día y funciona con $json', () => {
  const codigo = construir();
  assert.equal(readFileSync('n8n/verificador.code.js', 'utf8'), codigo, 'corré npm run n8n');
  const correr = (texto) => vm.runInNewContext(`(() => {${codigo}})()`, { $json: { texto, hechos } }).json;
  assert.equal(correr('El Lote Dina Huapi sale 35 mil dólares.').voz, 'El Lote Dina Huapi sale treinta y cinco mil dólares.');
  const mal = correr('El Lote Dina Huapi sale 30 mil dólares.');
  assert.equal(mal.ok, false);
  assert.match(mal.feedback, /30 mil dólares/);
});
