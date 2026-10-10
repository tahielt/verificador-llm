# verificador-llm

Capa anti-alucinación para agentes de venta: `verificar(texto, hechos)` bloquea montos, monedas, cantidades, links, contactos, códigos, entidades, disponibilidad y promesas que no salen de los hechos. Detalle de uso: `README.md`.

## Comandos
- `npm test` — tests (`node:test`). Incluye ejecutar el Code node de n8n generado.
- `npm run eval` — suite de casos en `eval/inmobiliaria.json`. Tiene que quedar en verde.
- `npm run n8n` — regenera `n8n/verificador.code.js` desde `src/verificador.js`. Correlo después de cada cambio en `src/`.

## Reglas
- Cero dependencias: el archivo tiene que poder pegarse en un Code node de n8n.
- Todo error nuevo que el verificador detecte entra con un caso en `eval/inmobiliaria.json` (uno que bloquee y uno parecido que pase).
- Una limitación aceptada se documenta como caso con `"limitacion"`, no se esconde.
- `plano()` conserva el largo del texto: los índices de `extraerNumeros` sirven sobre el original. Cualquier normalización nueva respeta eso.
