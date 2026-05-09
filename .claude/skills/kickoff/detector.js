/**
 * Detector de señales del kickoff v3.
 *
 * La skill /kickoff lee este archivo como referencia LITERAL: ante una frase
 * inicial del usuario, aplica esta función para clasificar tipo, tamaño y output
 * esperado, y elegir qué preguntas adaptativas hacer.
 *
 * Es una función pura (sin LLM, sin red, sin disco) para que el test de
 * integración pueda verificar la lógica determinística sin alucinaciones.
 *
 * Diseño: regex sobre lowercase del input. No empata frases — empata patrones
 * cortos. Se priorizan señales fuertes (build/business) sobre débiles (mixed).
 */

const TYPE_SIGNALS = [
  // Content (creativo, marketing, redes, narrativa corta)
  {
    type: 'content',
    patterns: [
      /\bmeme(s)?\b/, /\bpost(s)?\b/, /\binstagram\b/, /\btiktok\b/, /\blinkedin\b/,
      /\bcampa[nñ]a\b/, /\bcopy\b/, /\bcaption\b/, /\bguion\b/, /\bgui[oó]n\b/,
      /\bilustraci[oó]n\b/, /\bconcept art\b/, /\bcartel\b/, /\bafiche\b/,
      /\bvideo (corto|de \d+\s*(min|seg))\b/, /\breel\b/, /\bshort\b/,
      /\barticulo\b/, /\bart[ií]culo\b/, /\bblog\b/,
    ],
  },
  // Build (software, app, herramienta, automatización)
  {
    type: 'build',
    patterns: [
      /\bapp\b/, /\baplicaci[oó]n\b/, /\bweb\s+(app|site)?\b/, /\blanding\b/,
      /\bdashboard\b/, /\bplataforma\b/, /\bsistema\b/, /\bherramienta\b/,
      /\bcli\b/, /\bapi\b/, /\bbot\b/, /\bautomati[zs]ar\b/, /\bautomati[zs]aci[oó]n\b/,
      /\bscript\b/, /\bcodear\b/, /\bdesarrollar\b/, /\bconstruir\b/,
      /\bdigitali[zs]ar\b/,
    ],
  },
  // Business (operación, ventas, gestión, decisiones de empresa)
  {
    type: 'business',
    patterns: [
      /\bventas?\b/, /\bclientes?\b/, /\bcrm\b/, /\bequipo (interno|de)\b/,
      /\bmi empresa\b/, /\boperaci[oó]n\b/, /\bproceso (de )?(ventas?|operativo|interno)\b/,
      /\bonboarding (de )?(cliente|empleado)/, /\bestrategia (comercial|de negocio)\b/,
      /\bmodelo de negocio\b/, /\bpricing\b/, /\bpitch deck\b/,
    ],
  },
  // Research (investigar, analizar mercado, tesis, estudio)
  {
    type: 'research',
    patterns: [
      /\binvestigar\b/, /\binvestigaci[oó]n\b/, /\bresearch\b/,
      /\banali[zs]ar (el )?mercado\b/, /\bestudio (de|sobre)\b/,
      /\bbenchmark\b/, /\bcompetencia\b/, /\bestado del arte\b/,
      /\bque (hay|existe) sobre\b/, /\btesis\b/, /\bpaper\b/,
      /\bencuesta\b/, /\bdata (de|sobre)\b/, /\btendencias?\b/,
      /\bc[oó]mo est[aá] el\b/, /\bdeep\s*dive\b/,
    ],
  },
  // Personal (organización propia, journaling, agenda, hábitos)
  {
    type: 'personal',
    patterns: [
      /\borganizar (mi|mis)\b/, /\bagenda\b/, /\brutina\b/, /\bh[aá]bito(s)?\b/,
      /\bdiario\b/, /\bjournal\b/, /\bnotas (personales|de)\b/,
      /\bmi vida\b/, /\bproductividad personal\b/,
    ],
  },
];

const SIZE_SIGNALS = [
  {
    size: 'rapido',
    patterns: [
      /\bahora\b/, /\brapido\b/, /\br[aá]pido\b/, /\burgente\b/,
      /\bhoy\b/, /\bya\b/, /\b(en|de)\s*\d+\s*(min|minutos)\b/,
      /\bmeme\b/, /\bpost\b/, /\bsingle\b/, /\bun (solo|[uú]nico)\b/,
    ],
  },
  {
    size: 'grande',
    patterns: [
      /\bvarios?\s*(d[ií]as?|semanas?|meses?)\b/, /\bsprint(s)?\b/,
      /\baplicaci[oó]n\b/, /\bplataforma\b/, /\bsistema\b/,
      /\bdigitali[zs]ar\b/, /\bmigrar\b/, /\bconstruir.*?(app|sistema|plataforma)\b/,
      /\binvestigaci[oó]n (profunda|a fondo|deep)\b/, /\bdeep\s*dive\b/,
      /\ba fondo\b/, /\ba profundidad\b/,
    ],
  },
];

const OUTPUT_SIGNALS = [
  {
    output: 'imagen',
    patterns: [/\bimagen\b/, /\bilustraci[oó]n\b/, /\bmeme\b/, /\bafiche\b/, /\bcartel\b/, /\bconcept art\b/, /\brender\b/, /\bvisual\b/],
  },
  {
    output: 'codigo',
    patterns: [/\bapp\b/, /\baplicaci[oó]n\b/, /\bcli\b/, /\bapi\b/, /\bscript\b/, /\bbot\b/, /\bcodear\b/, /\bdashboard\b/, /\bweb\b/, /\blanding\b/, /\bplataforma\b/, /\bsistema\b/],
  },
  {
    output: 'analisis',
    patterns: [/\banali[zs]ar\b/, /\binvestigar\b/, /\bresearch\b/, /\binforme\b/, /\breporte\b/, /\bestudio\b/, /\bbenchmark\b/, /\btendencias?\b/],
  },
  {
    output: 'documento',
    patterns: [/\barticulo\b/, /\bart[ií]culo\b/, /\bblog\b/, /\bgui[oó]n\b/, /\bcopy\b/, /\bdoc(umento)?\b/, /\bpitch\b/, /\bplan\b/],
  },
  {
    output: 'idea',
    patterns: [/\bidea\b/, /\bdecidir\b/, /\bdecisi[oó]n\b/, /\bbrainstorm\b/, /\bpensar\b/, /\bexplorar\b/],
  },
];

/**
 * Cuenta cuántos patrones de un set hacen match en el texto.
 */
function countMatches(text, patterns) {
  let n = 0;
  for (const p of patterns) {
    if (p.test(text)) n += 1;
  }
  return n;
}

/**
 * Devuelve la entrada con más matches, o null si nadie hizo match.
 * Empate: el primero declarado gana (orden de declaración refleja prioridad).
 */
function topMatch(text, signalSet, key) {
  let best = null;
  let bestScore = 0;
  for (const entry of signalSet) {
    const score = countMatches(text, entry.patterns);
    if (score > bestScore) {
      best = entry[key];
      bestScore = score;
    }
  }
  return { value: best, score: bestScore };
}

/**
 * Detecta señales de la frase inicial del usuario.
 *
 * @param {string} input frase libre del usuario en respuesta al saludo.
 * @returns {{type, size, output, confidence, evidence}}
 *   type ∈ {'research'|'build'|'content'|'business'|'personal'|'mixed'}
 *   size ∈ {'rapido'|'medio'|'grande'}
 *   output ∈ {'imagen'|'codigo'|'analisis'|'documento'|'idea'|'mixed'}
 *   confidence: número de señales fuertes detectadas (≥2 = alta).
 *   evidence: { type, size, output } con conteos crudos por categoría.
 */
export function detectSignals(input) {
  if (!input || typeof input !== 'string') {
    return {
      type: 'mixed', size: 'medio', output: 'mixed',
      confidence: 0,
      evidence: { type: {}, size: {}, output: {} },
    };
  }
  const text = input.toLowerCase().normalize('NFKD');

  // Tipo: si hay >1 categoría con score alto, es mixed.
  // Tiebreaker: cuando build empata con business, build gana — la naturaleza
  // dominante del proyecto es lo que vas a EJECUTAR (build), no para qué área
  // (business). Pasa cuando hay verbo de construcción ("construir una app
  // para gestionar ventas") + keyword de área. Sin esto el escenario B típico
  // (app interna de ventas) cae en mixed y pierde stack relevante.
  const typeScores = TYPE_SIGNALS.map(s => ({ type: s.type, score: countMatches(text, s.patterns) }));
  const sortedTypes = [...typeScores].sort((a, b) => b.score - a.score);
  let type = 'mixed';
  if (sortedTypes[0].score === 0) {
    type = 'mixed';
  } else if (sortedTypes.length > 1 && sortedTypes[0].score - sortedTypes[1].score < 1 && sortedTypes[1].score >= 2) {
    // Empate: aplicamos tiebreaker build > business si ambos están entre los empatados.
    const tiedTypes = sortedTypes.filter(t => t.score === sortedTypes[0].score).map(t => t.type);
    if (tiedTypes.includes('build') && tiedTypes.includes('business')) {
      type = 'build';
    } else {
      type = 'mixed';
    }
  } else {
    type = sortedTypes[0].type;
  }

  // Tamaño: default medio. Solo overrideamos si hay señal clara.
  const sizeMatch = topMatch(text, SIZE_SIGNALS, 'size');
  const size = sizeMatch.score === 0 ? 'medio' : sizeMatch.value;

  // Output: si dos categorías empatadas con score alto → mixed.
  const outputScores = OUTPUT_SIGNALS.map(s => ({ output: s.output, score: countMatches(text, s.patterns) }));
  const sortedOutputs = [...outputScores].sort((a, b) => b.score - a.score);
  let output = 'mixed';
  if (sortedOutputs[0].score === 0) {
    output = 'mixed';
  } else if (sortedOutputs.length > 1 && sortedOutputs[0].score === sortedOutputs[1].score && sortedOutputs[0].score >= 2) {
    output = 'mixed';
  } else {
    output = sortedOutputs[0].value || sortedOutputs[0].output;
  }

  const confidence = Math.max(sortedTypes[0].score, sortedOutputs[0].score);

  return {
    type,
    size,
    output,
    confidence,
    evidence: {
      type: Object.fromEntries(typeScores.map(t => [t.type, t.score])),
      size: Object.fromEntries(SIZE_SIGNALS.map(s => [s.size, countMatches(text, s.patterns)])),
      output: Object.fromEntries(outputScores.map(o => [o.output, o.score])),
    },
  };
}

/**
 * Stack de skills recomendado por tipo de proyecto.
 *
 * Las "core" (pipeline-v2, cold-reader-gate, multimodal-validation, karpathy-rules,
 * confidence-loop, agent-template) NO se listan acá porque siempre están activas;
 * solo aparecen cuando el tipo del proyecto las necesita con prioridad alta.
 *
 * Cada skill viene con `why`: una línea que el kickoff lee al usuario para
 * justificar la recomendación.
 */
const STACK_BY_TYPE = {
  content: [
    { name: 'image-gen', why: 'genera imágenes con identity lock; requerido para visuales.' },
    { name: 'image-explorer', why: 'explora variantes visuales antes de cerrar dirección de arte.' },
    { name: 'brand-guidelines', why: 'mantiene la identidad visual coherente entre piezas.' },
    { name: 'multimodal-validation', why: 'fuerza Read del PNG después de generar; sin esto no hay PASS.' },
    { name: 'marketing', why: 'frameworks de copy (AIDA, PAS, BAB) cuando la pieza necesita CTA o estructura comercial.' },
    { name: 'canvas-design', why: 'visualizaciones programáticas (D3, p5, SVG) cuando el output no es imagen rasterizada.' },
  ],
  build: [
    { name: 'quality-mindset', why: 'criterios duros de calidad antes de cerrar features.' },
    { name: 'agent-template', why: 'crea agentes especializados conforme aparecen módulos del producto.' },
    { name: 'council', why: 'evalúa decisiones técnicas complejas con múltiples voces.' },
    { name: 'karpathy-rules', why: 'reglas core para que el código sea simple y reusable.' },
    { name: 'superpowers-pr', why: 'estandariza Git y Pull Requests si el proyecto usa control de versiones formal.' },
    { name: 'frontend-design', why: 'componentes UI accesibles y semánticos cuando el proyecto tiene superficie web.' },
    { name: 'webapp-testing', why: 'estrategia de testing equilibrada (unit/integration/E2E) cuando el proyecto tiene UI.' },
    { name: 'playwright', why: 'tests E2E resilientes para flujos críticos cuando la webapp ya está definida.' },
  ],
  business: [
    { name: 'council', why: 'decisiones comerciales tienen múltiples ángulos; el council los explicita.' },
    { name: 'pipeline-v2', why: 'evita publicar pitch/decks/propuestas que pasan validación interna pero fallan en frío.' },
    { name: 'seo', why: 'si la operación incluye contenido orgánico para captar clientes.' },
    { name: 'agent-template', why: 'modelar roles de empresa como agentes (ventas, soporte, ops) acelera tareas repetitivas.' },
    { name: 'marketing', why: 'copy comercial recurrente (ads, emails, landing) con frameworks probados.' },
    { name: 'brand-guidelines', why: 'mantiene voz e identidad de la empresa consistente en todo lo que se publica.' },
    { name: 'xlsx', why: 'cuando el cliente vive en planillas Excel y los reportes/inputs son .xlsx.' },
  ],
  research: [
    { name: 'pipeline-v2', why: 'research serio necesita architect → critic → cold-reader para evitar conclusiones débiles.' },
    { name: 'cold-reader-gate', why: 'lee el informe en frío y veta si no se entiende sin contexto interno.' },
    { name: 'firecrawl', why: 'scraping de fuentes web cuando la búsqueda directa no basta.' },
    { name: 'context7', why: 'explora codebases o corpus grandes con búsqueda semántica.' },
  ],
  personal: [
    { name: 'confidence-loop', why: 'mejora artefactos personales (planes, journaling) hasta calidad 95+.' },
    { name: 'pipeline-v2', why: 'útil cuando lo personal cruza a deliverable público.' },
  ],
  mixed: [
    { name: 'pipeline-v2', why: 'flujo seguro para cualquier deliverable mientras se concreta el tipo de proyecto.' },
    { name: 'confidence-loop', why: 'mejora iterativa hasta calidad alta independiente del tipo.' },
    { name: 'web-artifacts-builder', why: 'permite producir un primer artifact navegable mientras se concreta el tipo de proyecto.' },
  ],
};

/**
 * Devuelve el stack de skills recomendado para un tipo de proyecto.
 *
 * NOTA: el orquestador siempre activa además las "core" (pipeline-v2,
 * cold-reader-gate, multimodal-validation, karpathy-rules, confidence-loop,
 * agent-template). Esta función devuelve SOLO las recomendadas según el tipo,
 * sin duplicar las core a menos que sean prioritarias para ese tipo.
 */
export function recommendStack(type) {
  return STACK_BY_TYPE[type] || STACK_BY_TYPE.mixed;
}

/**
 * Las skills core que SIEMPRE se activan en cualquier proyecto.
 * El kickoff las registra con addSkill() automáticamente al confirmar.
 */
export const CORE_SKILLS = [
  'pipeline-v2',
  'cold-reader-gate',
  'multimodal-validation',
  'karpathy-rules',
  'confidence-loop',
  'agent-template',
];

/**
 * Modo recomendado a partir de tipo + tamaño.
 * - rapido: iteraciones cortas, sin pipeline-v2 obligatorio.
 * - profundo: cada deliverable pasa por pipeline-v2 completo.
 */
export function recommendMode(type, size) {
  if (size === 'grande') return 'profundo';
  if (size === 'rapido') return 'rapido';
  // medio: research y build tienden a profundo; content y personal a rapido.
  if (type === 'research' || type === 'build' || type === 'business') return 'profundo';
  return 'rapido';
}

/**
 * Sprint inicial sugerido según perfil. Devuelve un objeto con
 * objective + deliverables. El kickoff lo presenta al usuario antes de persistir.
 */
export function suggestInitialSprint(type, mode) {
  const base = {
    content: {
      objective: 'Producir el primer artefacto creativo y validarlo con cold-reader',
      deliverables: [
        'principles.md y INDEX.md generados por kickoff',
        '1 pieza creativa (imagen/copy/post) pasada por pipeline-v2',
        'Lessons del primer ciclo registradas en lessons.md',
      ],
    },
    build: {
      objective: 'Discovery del producto y primer prototipo navegable',
      deliverables: [
        'principles.md y INDEX.md generados por kickoff',
        'Documento de arquitectura inicial (1 página, sin código)',
        'Prototipo mínimo que prueba el flujo crítico end-to-end',
      ],
    },
    business: {
      objective: 'Mapear el proceso a digitalizar y proponer la primera versión',
      deliverables: [
        'principles.md y INDEX.md generados por kickoff',
        'Mapa actual del proceso (estado AS-IS) en docs/',
        'Propuesta TO-BE con 3 cambios concretos prioritizados',
      ],
    },
    research: {
      objective: 'Plan de investigación y primer hallazgo significativo',
      deliverables: [
        'principles.md y INDEX.md generados por kickoff',
        'Plan de research con preguntas, fuentes y método',
        'Primer hallazgo documentado y validado por cold-reader',
      ],
    },
    personal: {
      objective: 'Definir sistema personal y primera iteración',
      deliverables: [
        'principles.md y INDEX.md generados por kickoff',
        'Plantilla del sistema (rutina/journal/agenda) lista para usar',
        'Primera semana de uso registrada con lessons',
      ],
    },
    mixed: {
      objective: 'Concretar el tipo de proyecto y producir un primer entregable',
      deliverables: [
        'principles.md y INDEX.md generados por kickoff',
        'Primer entregable que aclare hacia dónde va el proyecto',
        'Decisión registrada del tipo final del proyecto',
      ],
    },
  };
  const sprint = base[type] || base.mixed;
  return { ...sprint, mode };
}
