# Atribución — kenney-roguelike (default pack)

Este pack combina dos packs CC0 1.0 de Kenney.nl, usados como assets default
del dashboard v3.

## Fuentes

| Componente | Pack | Página de origen |
|---|---|---|
| Interior tiles | Kenney "Roguelike Indoors" | https://kenney.nl/assets/roguelike-indoors |
| Characters | Kenney "Roguelike Characters" | https://kenney.nl/assets/roguelike-characters |

## Licencia

Ambos packs están publicados bajo **Creative Commons Zero (CC0 1.0)**
— dominio público. No requiere atribución, pero la incluimos como
buena práctica.

Texto canónico de la licencia: https://creativecommons.org/publicdomain/zero/1.0/

> The person who associated a work with this deed has dedicated the work
> to the public domain by waiving all of his or her rights to the work
> worldwide under copyright law, including all related and neighboring
> rights, to the extent allowed by law. You can copy, modify, distribute
> and perform the work, even for commercial purposes, all without asking
> permission.

## Política del repo

- Este directorio (`assets/packs/kenney-roguelike/`) contiene **solo**
  el `manifest.json` declarativo + este `ATTRIBUTION.md`. Es lo único
  que viaja en git.
- **Los binarios reales** (PNGs de tilesets y characters) viven en
  `assets/vendor/kenney-roguelike/` y NO están commiteados — esa
  carpeta está en `.gitignore`.
- Para poblar `assets/vendor/`, corre `npm run dashboard:assets`
  (alias de `node scripts/fetch_default_pack.js`). El script descarga
  los ZIPs de la URL declarada en `manifest.json#source_url`, valida
  SHA256 si está fijado, descomprime y deja los archivos finales en
  `assets/vendor/kenney-roguelike/`.

## SHA256

El campo `manifest.json#source_sha256` arranca con un sentinel de 64
ceros (`0000…0000`). En el primer fetch:

1. `scripts/fetch_default_pack.js` descarga el ZIP.
2. Computa SHA256 del binario descargado.
3. Detecta que el manifest tiene el sentinel y NO lo auto-escribe
   (decisión humana — alguien tiene que validar a ojo). Loggea el SHA
   real y pide actualizar el manifest.
4. Una vez fijado el SHA real, futuros runs validan que el ZIP de
   Kenney sigue siendo el mismo binario. Si Kenney rota la URL o
   re-empaqueta, el script falla con instrucciones claras.

## Pack premium (consumer projects)

Si un proyecto consumer compra un pack premium (LimeZu, MetroCity,
Arlan_TR), debe copiar binarios + manifest a `assets/vendor/<otro-pack>/`
y activar el pack vía `DASHBOARD_PACK=<otro-pack> npm run dashboard`.
