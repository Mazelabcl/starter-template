// src/presupuesto.js
// Presupuesto VISIBLE antes de correr bold-rounds o un council: tokens estimados y qué
// parte aproximada de la ventana de 5 horas del plan se lleva. Es una ESTIMACIÓN:
//  - Los perfiles de sesión salen de corridas medidas en este PC (ver PERFILES).
//  - La ventana se calibra con `node src/uso.js ventana` (cortes reales por límite y la
//    utilización que informa `claude -p`); sin calibración se usa VENTANA_POR_DEFECTO.
//  - Cada token se pondera por su precio de lista relativo ("carga"), porque Anthropic
//    no publica cuánto pesa cada tipo de token en el límite del plan.
// Idioma: español neutro.

import { cargaUSD, ventanaCalibrada, fmt } from './uso.js';

// Perfil de una sesión: peticiones, contexto de la primera (sin el archivo de entrada, que
// se suma aparte), cuánto crece por petición y salida total. Ronda real del 2026-11-06 en
// examples/cafeteria-90s (archivo de 6 KB): idear 2 peticiones, 6,1-6,4 K de contexto
// inicial, ~18 K tokens; construir 3 peticiones, 7,9 K inicial, ~40 K tokens. Los perfiles
// dejan ~2x de margen porque un proyecto real tiene archivos más grandes y más ediciones.
export const PERFILES = {
  // Idear: Opus aislado, solo Read, system prompt propio. Mira 1-2 capturas y responde.
  idear: { requests: 3, first: 4500, growth: 3000, output: 2500 },
  // Construir: aislado, Read/Edit/Write/Glob/Grep, con tope de turnos y sin capturas.
  construir: { requests: 6, first: 6500, growth: 3000, output: 6000 },
  // Llamada de texto puro (coach, integrador, persona de audiencia): una petición.
  texto: { requests: 1, first: 3500, growth: 0, output: 2500 },
  // Variante vieja (Weddi, sin aislar ni separar): mediana de 91 variantes reales.
  weddi_variante: { requests: 27, first: 55500, growth: 3400, output: 37000 },
};

// Lo que gasta tu sesión principal (el orquestador) por ronda: mirar capturas, publicar.
export const ORQUESTADOR_RONDA = { requests: 4, first: 60000, growth: 2500, output: 2500 };

/** Tokens de una sesión con contexto que crece: Σ contexto + salida. */
export function sesion({ requests, first, growth, output }, { entrada_extra = 0 } = {}) {
  const f = first + entrada_extra;
  const sumCtx = requests * f + (growth * requests * (requests - 1)) / 2;
  const cache_write = f + growth * Math.max(0, requests - 1);
  const cache_read = Math.max(0, sumCtx - cache_write);
  return { requests, first_context: f, cache_write: Math.round(cache_write), cache_read: Math.round(cache_read), output, total: Math.round(sumCtx + output) };
}

const suma = list => list.reduce((s, x) => ({
  total: s.total + x.total, carga: s.carga + x.carga,
}), { total: 0, carga: 0 });

function conCarga(s, modelo, veces = 1) {
  return { ...s, modelo, veces, total: s.total * veces, carga: cargaUSD(s, modelo) * veces };
}

/** % de la ventana (por carga) y por tokens, con la ventana calibrada. */
export function enVentana({ total, carga }, ventana = ventanaCalibrada()) {
  return {
    tokens: Math.round(total),
    carga_usd: Number(carga.toFixed(2)),
    pct_ventana: Number(((carga / ventana.carga_usd) * 100).toFixed(1)),
    ventana,
  };
}

/**
 * Presupuesto de una corrida de bold-rounds (método B: idear + construir por variante).
 * `entryChars` = tamaño del archivo de entrada (lo lee quien construye).
 */
export function presupuestoRondas({
  rondas = 3, variantes = 2, modeloIdea = 'opus', modeloConstruir = 'sonnet', entryChars = 8000,
  orquestador = 'opus', ventana = ventanaCalibrada(),
} = {}) {
  const extra = Math.round(entryChars / 3.5);
  const n = rondas * variantes;
  const partes = [
    { que: 'idear', ...conCarga(sesion(PERFILES.idear, { entrada_extra: Math.min(extra, 3500) }), modeloIdea, n) },
    { que: 'construir', ...conCarga(sesion(PERFILES.construir, { entrada_extra: extra }), modeloConstruir, n) },
    { que: 'tu sesión (orquestador)', ...conCarga(sesion(ORQUESTADOR_RONDA), orquestador, rondas) },
  ];
  const tot = suma(partes);
  const porVariante = suma(partes.slice(0, 2).map(p => ({ total: p.total / n, carga: p.carga / n })));
  const weddi = conCarga(sesion(PERFILES.weddi_variante), 'opus');
  return {
    ...enVentana(tot, ventana), partes, rondas, variantes,
    por_variante: { tokens: Math.round(porVariante.total), carga_usd: Number(porVariante.carga.toFixed(2)) },
    weddi_por_variante: { tokens: weddi.total, carga_usd: Number(weddi.carga.toFixed(2)) },
  };
}

/** Presupuesto de un council entrevista con llamadas directas (sin sesiones completas). */
export function presupuestoEntrevista({
  coaches = 3, audiencia = 4, rutaCoaches = 'claude', modeloCoaches = 'opus', rutaAudiencia = 'openrouter',
  precioOpenRouter = () => 0, modeloAudiencia = 'haiku', ventana = ventanaCalibrada(),
} = {}) {
  // 4 llamadas de coaches (preguntas, repreguntas, hallazgos, integrar); la de hallazgos
  // y el integrador leen la transcripción entera.
  const coachCalls = [
    sesion({ ...PERFILES.texto, first: 2500 + coaches * 400, output: coaches * 450 }),
    sesion({ ...PERFILES.texto, first: 2500 + audiencia * 900, output: coaches * audiencia * 80 }),
    sesion({ ...PERFILES.texto, first: 4000 + audiencia * 1400, output: coaches * 700 }),
    sesion({ ...PERFILES.texto, first: 5000 + audiencia * 1400 + coaches * 700, output: 3500 }),
  ];
  const audCalls = [
    ...Array.from({ length: audiencia }, () => sesion({ ...PERFILES.texto, first: 1200, output: 900 })),
    ...Array.from({ length: audiencia }, () => sesion({ ...PERFILES.texto, first: 1400, output: 500 })),
  ];
  const plan = [];
  const usd = [];
  const add = (calls, ruta, modelo, que) => {
    const t = calls.reduce((s, c) => s + c.total, 0);
    if (ruta === 'claude') plan.push({ que, ruta, modelo, llamadas: calls.length, total: t, carga: calls.reduce((s, c) => s + cargaUSD(c, modelo), 0) });
    else {
      const d = calls.reduce((s, c) => s + precioOpenRouter(modelo, c.first_context, c.output), 0);
      usd.push({ que, ruta, modelo, llamadas: calls.length, tokens: t, usd: Number(d.toFixed(4)) });
    }
  };
  add(coachCalls, rutaCoaches, modeloCoaches, 'coaches e integrador');
  add(audCalls, rutaAudiencia, modeloAudiencia, 'audiencia');
  const tot = suma(plan.map(p => ({ total: p.total, carga: p.carga })));
  return {
    ...enVentana(tot, ventana), plan, openrouter: usd,
    usd_openrouter: Number(usd.reduce((s, x) => s + x.usd, 0).toFixed(4)),
    llamadas: coachCalls.length + audCalls.length,
    sesiones_completas_antes: coaches * 3 + audiencia * 2 + 1,
  };
}

/** Líneas para mostrar antes de pedir confirmación. */
export function textoPresupuesto(p, { titulo = 'Presupuesto estimado' } = {}) {
  const out = [`${titulo} (ESTIMACIÓN, no es exacto):`];
  out.push(`  ~${fmt(p.tokens)} tokens de tu plan de Claude · ~${String(p.pct_ventana).replace('.', ',')} % de una ventana de 5 h`);
  if (p.partes) for (const x of p.partes) out.push(`    ${x.que}: ${x.veces} × ${x.modelo} → ~${fmt(x.total)} tokens`);
  if (p.plan) for (const x of p.plan) out.push(`    ${x.que}: ${x.llamadas} llamadas ${x.modelo} por claude -p aislado → ~${fmt(x.total)} tokens`);
  if (p.openrouter && p.openrouter.length) for (const x of p.openrouter) out.push(`    ${x.que}: ${x.llamadas} llamadas ${x.modelo} por OpenRouter → ~USD ${x.usd.toFixed(3)} (se cobra aparte, en dólares)`);
  if (p.por_variante) out.push(`  Por variante ~${fmt(p.por_variante.tokens)} tokens (en Weddi cada variante gastaba ~${fmt(p.weddi_por_variante.tokens)}).`);
  if (p.sesiones_completas_antes) out.push(`  ${p.llamadas} llamadas cortas en vez de ${p.sesiones_completas_antes} sesiones completas.`);
  out.push(`  Ventana usada para el cálculo: ~${fmt(p.ventana.tokens)} tokens (${p.ventana.fuente}). Recalíbrala con: node src/uso.js ventana --vivo --guardar`);
  return out.join('\n');
}
