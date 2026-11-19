// @ts-check
/**
 * Gabarit HTML des emails, aux couleurs de la marque (BRAND.md). Fonctions pures.
 *
 * Contraintes des clients mail (Gmail, Outlook, Apple Mail) : mise en page en tableaux, styles en
 * ligne (les <style> ne servent qu'au responsive et au mode sombre), aucune police web fiable,
 * aucun SVG (logo en PNG), aucun JavaScript. D'où des polices de secours explicites :
 *   - titres : Bodoni Moda → Bodoni 72 / Didot (Apple) → Georgia → serif ;
 *   - texte  : Manrope → Helvetica Neue / Segoe UI → Arial → sans-serif.
 *
 * Contrastes (WCAG AA, cf. BRAND.md) : ébène sur karité 15,6:1 ; karité sur terre cuite 4,95:1 ;
 * laiton uniquement sur fond ébène (6,25:1) ou en filet décoratif.
 */
import { escapeHtml as esc } from '../../lib/format.js';

export const COLORS = {
  ebene: '#1C1310',
  cacao: '#3A2A22',
  terre: '#A9472E',
  laiton: '#B8914A',
  lin: '#E6D6C1',
  karite: '#F4ECE2',
};

const DISPLAY = "'Bodoni Moda', 'Bodoni 72', 'Didot', Georgia, 'Times New Roman', serif";
const TEXT = "'Manrope', 'Helvetica Neue', 'Segoe UI', Arial, Helvetica, sans-serif";

/**
 * Contenu structuré d'un email : sert au HTML et à la version texte.
 * @typedef {object} EmailContent
 * @property {string} subject
 * @property {string} preheader        aperçu dans la boîte de réception (≈ 90 caractères)
 * @property {string} title            titre ; *mot* = mot en italique terre cuite
 * @property {string[]} paragraphs
 * @property {{ label: string, value: string }[]} [details]
 * @property {{ label: string, url: string }} [cta]
 * @property {{ heading: string, items: string[] }} [list]
 * @property {string[]} [notes]        petits textes sous le bouton
 */

/**
 * @typedef {object} LayoutContext
 * @property {string} publicUrl        sans barre finale (le logo est servi par le site)
 * @property {string} salonName
 * @property {string} address          ligne d'adresse du salon
 * @property {string} [phone]
 * @property {string} footerNote       pourquoi la personne reçoit ce message
 */

/** « Un *mot* » → HTML sûr avec le mot en italique terre cuite. @param {string} text */
function accent(text) {
  return esc(text).replace(
    /\*([^*]+)\*/g,
    `<em style="font-style:italic;color:${COLORS.terre};">$1</em>`,
  );
}

/** @param {string} text */
const stripAccent = (text) => text.replace(/\*([^*]+)\*/g, '$1');

/** Bouton « à toute épreuve » (cellule colorée : fonctionne aussi sous Outlook). @param {{ label: string, url: string }} cta */
function button(cta) {
  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0 8px 0;">
  <tr>
    <td align="center" bgcolor="${COLORS.terre}" style="background-color:${COLORS.terre};border-radius:6px;">
      <a href="${esc(cta.url)}" target="_blank" style="display:inline-block;padding:15px 30px;font-family:${TEXT};font-size:16px;font-weight:600;line-height:20px;color:${COLORS.karite};text-decoration:none;border-radius:6px;">${esc(cta.label)}</a>
    </td>
  </tr>
</table>`;
}

/** @param {{ label: string, value: string }[]} details */
function detailsBlock(details) {
  const rows = details
    .map(
      (d, i) => `
    <tr>
      <td class="stack" valign="top" style="padding:${i === 0 ? '0' : '12px'} 0 0 0;width:36%;font-family:${TEXT};font-size:12px;font-weight:600;letter-spacing:1.6px;text-transform:uppercase;line-height:20px;color:${COLORS.cacao};">${esc(d.label)}</td>
      <td class="stack" valign="top" style="padding:${i === 0 ? '0' : '12px'} 0 0 0;font-family:${TEXT};font-size:16px;line-height:22px;color:${COLORS.ebene};">${esc(d.value).replaceAll('\n', '<br>')}</td>
    </tr>`,
    )
    .join('');
  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" bgcolor="${COLORS.lin}" style="margin:24px 0 0 0;background-color:${COLORS.lin};border-radius:8px;border-left:3px solid ${COLORS.laiton};">
  <tr><td style="padding:22px 24px;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">${rows}
    </table>
  </td></tr>
</table>`;
}

/** @param {{ heading: string, items: string[] }} list */
function listBlock(list) {
  const items = list.items
    .map(
      (item) => `
    <tr>
      <td valign="top" style="padding:6px 12px 0 0;font-family:${TEXT};font-size:16px;line-height:24px;color:${COLORS.terre};">&bull;</td>
      <td valign="top" style="padding:6px 0 0 0;font-family:${TEXT};font-size:16px;line-height:24px;color:${COLORS.ebene};">${esc(item)}</td>
    </tr>`,
    )
    .join('');
  return `
<p style="margin:32px 0 4px 0;font-family:${TEXT};font-size:12px;font-weight:600;letter-spacing:1.6px;text-transform:uppercase;line-height:20px;color:${COLORS.cacao};">${esc(list.heading)}</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">${items}
</table>`;
}

/**
 * @param {EmailContent} content
 * @param {LayoutContext} ctx
 * @returns {string}
 */
export function renderHtml(content, ctx) {
  const paragraphs = content.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px 0;font-family:${TEXT};font-size:16px;line-height:26px;color:${COLORS.ebene};">${esc(p)}</p>`,
    )
    .join('\n');
  const notes = (content.notes ?? [])
    .map(
      (n) =>
        `<p style="margin:14px 0 0 0;font-family:${TEXT};font-size:14px;line-height:22px;color:${COLORS.cacao};">${esc(n)}</p>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>${esc(stripAccent(content.subject))}</title>
<style>
  body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table { border-collapse:collapse; }
  img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
  a { color:${COLORS.terre}; }
  @media only screen and (max-width: 620px) {
    .container { width:100% !important; }
    .px { padding-left:22px !important; padding-right:22px !important; }
    .title { font-size:30px !important; line-height:36px !important; }
    .stack { display:block !important; width:100% !important; }
    .logo { width:220px !important; height:auto !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${COLORS.lin};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${COLORS.lin};">${esc(content.preheader)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" bgcolor="${COLORS.lin}" style="background-color:${COLORS.lin};">
<tr><td align="center" style="padding:24px 12px 40px 12px;">
  <table role="presentation" class="container" cellspacing="0" cellpadding="0" border="0" width="600" style="width:600px;max-width:600px;">
    <tr>
      <td align="center" bgcolor="${COLORS.ebene}" style="background-color:${COLORS.ebene};border-radius:10px 10px 0 0;padding:26px 24px 22px 24px;">
        <a href="${esc(ctx.publicUrl)}" target="_blank" style="text-decoration:none;"><img class="logo" src="${esc(ctx.publicUrl)}/brand/logo-email.png" width="280" height="62" alt="${esc(ctx.salonName)}" style="display:block;width:280px;height:auto;font-family:${DISPLAY};font-size:22px;color:${COLORS.karite};"></a>
      </td>
    </tr>
    <tr><td height="3" bgcolor="${COLORS.laiton}" style="height:3px;line-height:3px;font-size:3px;background-color:${COLORS.laiton};">&nbsp;</td></tr>
    <tr>
      <td class="px" bgcolor="${COLORS.karite}" style="background-color:${COLORS.karite};padding:40px 44px 36px 44px;">
        <h1 class="title" style="margin:0 0 22px 0;font-family:${DISPLAY};font-size:36px;font-weight:500;line-height:42px;letter-spacing:-0.3px;color:${COLORS.ebene};">${accent(content.title)}</h1>
        ${paragraphs}
        ${content.details?.length ? detailsBlock(content.details) : ''}
        ${content.cta ? button(content.cta) : ''}
        ${notes}
        ${content.list ? listBlock(content.list) : ''}
      </td>
    </tr>
    <tr>
      <td class="px" bgcolor="${COLORS.ebene}" style="background-color:${COLORS.ebene};border-radius:0 0 10px 10px;padding:28px 44px 30px 44px;">
        <p style="margin:0 0 6px 0;font-family:${DISPLAY};font-size:18px;line-height:24px;color:${COLORS.karite};">${esc(ctx.salonName)}</p>
        <p style="margin:0 0 14px 0;font-family:${TEXT};font-size:14px;line-height:22px;color:${COLORS.lin};">${esc(ctx.address)}${ctx.phone ? `<br>${esc(ctx.phone)}` : ''}</p>
        <p style="margin:0;font-family:${TEXT};font-size:12px;line-height:20px;color:${COLORS.laiton};">${esc(ctx.footerNote)}</p>
      </td>
    </tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

/**
 * Version texte brut (clients sans HTML, et meilleure délivrabilité).
 * @param {EmailContent} content
 * @param {LayoutContext} ctx
 */
export function renderText(content, ctx) {
  const lines = [
    stripAccent(content.title).toUpperCase(),
    '',
    ...content.paragraphs.flatMap((p) => [p, '']),
  ];
  if (content.details?.length) {
    lines.push(...content.details.map((d) => `${d.label} : ${d.value.replaceAll('\n', ', ')}`), '');
  }
  if (content.cta) lines.push(`${content.cta.label} :`, content.cta.url, '');
  for (const n of content.notes ?? []) lines.push(n, '');
  if (content.list)
    lines.push(`${content.list.heading} :`, ...content.list.items.map((i) => `- ${i}`), '');
  lines.push('—', ctx.salonName, ctx.address, ...(ctx.phone ? [ctx.phone] : []), ctx.footerNote);
  return lines.join('\n');
}
