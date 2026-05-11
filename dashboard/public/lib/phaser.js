// dashboard/public/lib/phaser.js
//
// Re-export único de Phaser 3.80.1 desde esm.sh. Es el ÚNICO punto del frontend
// que debe referenciar la URL del CDN. Si en el futuro pasamos a vendor local
// (scripts/vendor_phaser.js), basta cambiar el import acá.
//
// ADR-01 v3.1: Phaser por CDN ESM, sin bundler. Verificado: sirve application/javascript
// con default + named exports.

export { default } from 'https://esm.sh/phaser@3.80.1';
export * from 'https://esm.sh/phaser@3.80.1';
