// @ts-check
import { describe, expect, it } from 'vitest';
import { accent, formatDuration, formatPrice, formatRating, plain } from './format.js';

describe('format', () => {
  it('convertit *mot* en <em> après avoir échappé le HTML', () => {
    expect(accent('Vos <b>locks</b>, *un art*')).toBe(
      'Vos &lt;b&gt;locks&lt;/b&gt;, <em>un art</em>',
    );
    expect(plain('Faire naître vos *locks*')).toBe('Faire naître vos locks');
  });

  it('affiche les prix fixes, « à partir de » et sur devis', () => {
    expect(formatPrice({ price: 45, priceFrom: false, onQuote: false })).toBe('45\u00a0€');
    expect(formatPrice({ price: 60, priceFrom: true, onQuote: false })).toBe(
      'à partir de 60\u00a0€',
    );
    expect(formatPrice({ price: null, priceFrom: false, onQuote: true })).toBe('Sur devis');
  });

  it('formate les durées en heures et minutes', () => {
    expect(formatDuration(45, 45)).toBe('45\u00a0min');
    expect(formatDuration(180, 360)).toBe('3\u00a0–\u00a06\u00a0h');
    expect(formatDuration(90, 150)).toBe('1\u00a0h\u00a030\u00a0–\u00a02\u00a0h\u00a030');
  });

  it('arrondit la note à une décimale, à la française', () => {
    expect(formatRating(4.875)).toBe('4,9');
    expect(formatRating(5)).toBe('5,0');
  });
});
