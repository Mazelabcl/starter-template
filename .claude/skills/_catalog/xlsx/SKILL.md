---
name: xlsx
description: Manipulación de Excel/XLSX — lectura, escritura, generación de reportes, parsing de planillas subidas por el usuario, formato condicional, fórmulas. Decide librería según caso (xlsx/exceljs en Node, openpyxl/pandas en Python).
triggers: ["/xlsx", "generar excel", "leer xlsx", "parsear planilla", "exportar a excel", "reporte excel", "xlsx to json"]
allowed-tools: Read, Write, Edit, Glob, Bash
---

# xlsx — manipulación de Excel

Cubre lectura, escritura y generación de archivos XLSX. Especialmente útil en proyectos business donde el cliente vive en planillas y el output esperado también es Excel.

---

## Cuándo activar esta skill

Activa `xlsx` solo si tu proyecto cumple uno o más:

1. **Cliente o usuario vive en Excel** — el deliverable esperado es .xlsx, no CSV ni JSON.
2. **Migrando datos desde planillas** — el origen de datos histórico está en Excel.
3. **Generación de reportes con formato** — colores, formato condicional, fórmulas, gráficos embebidos.
4. **El producto recibe planillas como input** — usuario sube .xlsx y el sistema parsea.

### Cuándo NO activarla

- Cuando CSV alcanza. CSV es más simple, multi-tool, sin lock-in a Excel.
- Cuando el output esperado es un documento (no datos tabulares) — usa `pdf-skill`.
- Cuando el usuario sabe lidiar con JSON y prefiere ese formato.

---

## Qué hace

1. Recomienda librería según caso:
   - **Node, lectura/escritura básica**: `xlsx` (SheetJS) — ligera, sin dependencias.
   - **Node, formato rico** (colores, formato condicional, gráficos): `exceljs`.
   - **Python, exploración + análisis**: `pandas` (lee directo a DataFrame).
   - **Python, formato rico**: `openpyxl`.
2. Genera código mínimo para el caso (lectura, escritura, parsing, generación).
3. Maneja casos comunes:
   - Encoding (UTF-8 vs Latin-1 — Excel viejo es traicionero).
   - Fechas (Excel guarda como número de días desde 1900-01-01, parsing distinto que JSON).
   - Hojas múltiples (workbook con varias sheets).
   - Celdas con fórmula (leer el resultado evaluado vs la fórmula raw).
   - Headers en fila no-1 (planillas humanas son caóticas).
4. Sugiere validación con schema (zod, Joi, pydantic) sobre los datos parseados.

---

## Anti-patrones

- **Asumir que la planilla está limpia.** Headers con typos, celdas vacías mid-tabla, merged cells, formato inconsistente — todo eso pasa.
- **Generar XLSX cuando CSV alcanza.** Excel agrega peso y formato; CSV es plain text universal.
- **Confiar en fórmulas embebidas para datos críticos.** Mejor calcular en código y guardar el resultado, no la fórmula.
- **Parsear sin schema.** Sin validación post-parse, tipos se mezclan (números como strings, fechas como floats).

---

## Próximos pasos (esta skill es STUB)

- [ ] Decision tree formal: caso → librería.
- [ ] Templates de reportes comunes (lista, dashboard tabular, pivot).
- [ ] Helper `src/xlsx_utils.js` o `scripts/xlsx_utils.py` para casos repetitivos.
- [ ] Manejo de planillas humanas caóticas (headers no-1, celdas vacías, merged cells).
- [ ] Ejemplo end-to-end (subir XLSX → validar → cargar a DB).

---

## Versión

v0.1 stub — Sprint 5.2 — invocable, pendiente de decision tree y helpers.
