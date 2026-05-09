---
name: pdf-skill
description: Manipulación de PDFs — generación, parsing, extracción de texto/tablas/imágenes, merge/split, formularios. Decide librería apropiada según el caso (pdf-lib para generación, pdf-parse o pdfplumber para parsing, PyMuPDF para casos complejos).
triggers: ["/pdf-skill", "generar pdf", "parsear pdf", "extraer texto pdf", "merge pdf", "rellenar formulario pdf", "pdf to text"]
allowed-tools: Read, Write, Edit, Glob, Bash
---

# pdf-skill — manipulación de PDFs

Cubre generación y parsing de PDFs sin reinventar la rueda. Elige la librería correcta según el caso de uso (no hay una sola que sea buena para todo).

---

## Cuándo activar esta skill

Activa `pdf-skill` solo si tu proyecto cumple uno o más:

1. **El producto genera PDFs** — facturas, reportes, contratos, certificados.
2. **El producto parsea PDFs subidos por el usuario** — extracción de datos, OCR ligero, conversión a texto.
3. **Necesitas merge/split/rotación** de PDFs existentes (gestión documental).
4. **El proyecto incluye formularios PDF rellenables** (AcroForm).

### Cuándo NO activarla

- Proyectos que no tocan PDFs directamente.
- Proyectos donde basta exportar HTML a PDF con la impresora del navegador (no se justifica skill).
- Cuando el output es un documento Word/Excel — usa `xlsx` u otra skill correspondiente.

---

## Qué hace

1. Pregunta el caso de uso concreto y recomienda librería:
   - **Generación rica** (layouts, tablas, imágenes): `pdf-lib` o `pdfmake` (Node), `reportlab` (Python).
   - **Parsing básico** (texto simple): `pdf-parse` (Node), `pdfplumber` (Python).
   - **Casos complejos** (extracción de tablas, OCR ligero, layout análisis): `PyMuPDF` / `fitz` (Python).
   - **Formularios rellenables**: `pdf-lib` (Node), `PyPDF2` o `PyMuPDF` (Python).
2. Genera el código mínimo funcional para el caso.
3. Maneja casos comunes:
   - Encoding de caracteres no-ASCII (acentos, ñ, emoji).
   - Fuentes embebidas (no asumir Helvetica).
   - Compresión y tamaño del archivo.
   - Metadata (title, author, subject).
4. Sugiere validación post-generación (parsea el PDF generado para confirmar que no quedó corrupto).

---

## Anti-patrones

- **Generar PDF con HTML+CSS sin headless browser** y esperar layouts complejos. Usa Puppeteer/Playwright si la fuente es HTML, o librería nativa de PDF si necesitas control fino.
- **Parsear PDFs escaneados sin OCR.** Si el PDF es imagen, ningún parser de texto va a sacar nada. Necesitas Tesseract o equivalente.
- **Asumir que todos los PDFs son iguales.** Hay PDFs nativos (texto extraíble), escaneados (imágenes), híbridos, con formularios, con layers, con encryption. Cada caso es distinto.
- **Hardcodear fuentes que el lector no tenga.** Si embebes Roboto, embebe el archivo de fuente.

---

## Próximos pasos (esta skill es STUB)

- [ ] Decision tree formal: caso de uso → librería recomendada.
- [ ] Templates de generación común (factura, reporte, certificado).
- [ ] Wrapper en `src/pdf_client.js` o `scripts/pdf_utils.py` para casos repetitivos.
- [ ] Manejo de OCR para PDFs escaneados (Tesseract integration).
- [ ] Ejemplo end-to-end (HTML → PDF estilizado).

---

## Versión

v0.1 stub — Sprint 5.2 — invocable, pendiente de decision tree y templates.
