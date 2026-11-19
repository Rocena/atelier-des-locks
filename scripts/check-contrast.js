// @ts-check
/**
 * Vérifie les contrastes WCAG des paires de tokens sémantiques, en clair et en sombre.
 * Lit src/client/styles/tokens.css, résout les var() et convertit OKLCH → sRGB.
 * Usage : npm run check:contrast   (code de sortie 1 si une paire échoue)
 */
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/client/styles/tokens.css', import.meta.url), 'utf8');

/** @param {string} selectorStart */
function block(selectorStart) {
  const start = css.indexOf(selectorStart);
  if (start < 0) throw new Error(`Bloc introuvable : ${selectorStart}`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error('Bloc non fermé');
}

/** @param {string} body */
function props(body) {
  /** @type {Record<string, string>} */
  const out = {};
  // Les valeurs peuvent être réparties sur plusieurs lignes (Prettier) : on normalise les espaces.
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out[m[1]] = m[2].replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();
  }
  return out;
}

const primitives = props(block(':root {'));
const light = { ...primitives, ...props(block(":root,\n  [data-surface='karite']")) };
const dark = { ...light, ...props(block("[data-theme='dark'],\n  [data-surface='ebene']")) };

/** @param {Record<string,string>} map @param {string} name @returns {string} */
function resolve(map, name) {
  const value = map[name];
  if (!value) throw new Error(`Token inconnu : ${name}`);
  const ref = value.match(/^var\((--[\w-]+)\)$/);
  return ref ? resolve(map, ref[1]) : value;
}

/** @param {string} value @returns {[number, number, number]} sRGB linéaire */
function oklchToLinearRgb(value) {
  const m = value.match(/oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)/);
  if (!m) throw new Error(`Valeur non OKLCH : ${value}`);
  const L = Number(m[1]) / 100;
  const C = Number(m[2]);
  const h = (Number(m[3]) * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (/** @type {number} */ x) => Math.min(1, Math.max(0, x));
  return [
    clamp(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s),
  ];
}

/** @param {string} value */
const luminance = (value) => {
  const [r, g, b] = oklchToLinearRgb(value);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** @param {string} a @param {string} b */
function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** [texte, fond, minimum, usage] */
const pairs = [
  ['--text', '--surface', 4.5, 'texte courant'],
  ['--text', '--surface-alt', 4.5, 'texte sur surface alternée'],
  ['--text', '--surface-raised', 4.5, 'texte sur carte'],
  ['--text-muted', '--surface', 4.5, 'texte secondaire'],
  ['--text-muted', '--surface-alt', 4.5, 'texte secondaire sur lin/cacao'],
  ['--accent-text', '--surface', 4.5, 'lien'],
  ['--accent-text', '--surface-alt', 4.5, 'lien sur surface alternée'],
  ['--accent-text', '--surface-raised', 4.5, 'lien sur carte'],
  ['--accent-display', '--surface', 3, 'mot italique des grands titres'],
  ['--on-accent', '--accent', 4.5, 'bouton primaire'],
  ['--on-accent', '--accent-hover', 4.5, 'bouton primaire survolé'],
  ['--line-strong', '--surface', 3, 'bordure de champ (UI)'],
  ['--focus', '--surface', 3, 'anneau de focus'],
  ['--error', '--surface', 4.5, "message d'erreur"],
  ['--success', '--surface', 4.5, 'message de succès'],
  ['--warning', '--surface', 4.5, "message d'alerte"],
];

let failures = 0;
for (const [theme, map] of /** @type {const} */ ([
  ['clair', light],
  ['sombre', dark],
])) {
  console.info(`\nThème ${theme}`);
  for (const [fg, bg, min, usage] of pairs) {
    const r = ratio(resolve(map, String(fg)), resolve(map, String(bg)));
    const ok = r >= Number(min);
    if (!ok) failures++;
    console.info(
      `  ${ok ? '✓' : '✗'} ${r.toFixed(2).padStart(5)}:1 (min ${min}) ${fg} sur ${bg} · ${usage}`,
    );
  }
}
if (failures) {
  console.error(`\n${failures} paire(s) sous le seuil WCAG AA.`);
  process.exit(1);
}
console.info('\nTous les contrastes respectent WCAG AA.');
