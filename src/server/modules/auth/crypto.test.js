// @ts-check
import { describe, expect, it } from 'vitest';
import {
  RECOVERY_CODE_COUNT,
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  generateSessionToken,
  hashRecoveryCode,
  hashSessionToken,
  normalizeRecoveryCode,
} from './crypto.js';
import { FREE_ATTEMPTS, isLocked, lockoutSeconds } from './lockout.js';
import { MIN_PASSWORD_LENGTH, hashPassword, passwordProblem, verifyPassword } from './password.js';
import {
  base32Decode,
  base32Encode,
  generateSecret,
  hotpAt,
  otpauthUri,
  totpAt,
  verifyTotp,
} from './totp.js';

const SECRET = 'x'.repeat(48);

describe('TOTP (RFC 6238)', () => {
  // Vecteurs de l'annexe B de la RFC 6238 (clé ASCII « 12345678901234567890 », SHA-1), 6 chiffres.
  const key = Buffer.from('12345678901234567890');
  const vectors = /** @type {const} */ ([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ]);
  it.each(vectors)('à %i s le code est %s', (seconds, code) => {
    expect(hotpAt(key, Math.floor(seconds / 30))).toBe(code);
    expect(totpAt(base32Encode(key), new Date(seconds * 1000))).toBe(code);
  });

  it('base32 : aller-retour et rejet des caractères invalides', () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(() => base32Decode('1!?')).toThrow();
    expect(base32Decode('mzxw 6ytb-oi')).toEqual(Buffer.from('foobar'));
  });

  it('un secret fait 160 bits, en base32', () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(generateSecret()).not.toBe(secret);
  });

  it('accepte le code courant et ±1 pas, refuse au-delà', () => {
    const secret = generateSecret();
    const at = new Date('2026-11-20T10:00:10Z');
    const step = (/** @type {number} */ offset) =>
      totpAt(secret, new Date(at.getTime() + offset * 30_000));
    expect(verifyTotp(secret, step(0), at)).not.toBeNull();
    expect(verifyTotp(secret, step(-1), at)).not.toBeNull();
    expect(verifyTotp(secret, step(1), at)).not.toBeNull();
    expect(verifyTotp(secret, step(-3), at)).toBeNull();
    expect(verifyTotp(secret, step(3), at)).toBeNull();
  });

  it('refuse le rejeu d’un pas déjà consommé', () => {
    const secret = generateSecret();
    const at = new Date('2026-11-20T10:00:10Z');
    const code = totpAt(secret, at);
    const first = verifyTotp(secret, code, at);
    expect(first).not.toBeNull();
    expect(verifyTotp(secret, code, at, { lastStep: first })).toBeNull();
    // Un pas plus récent reste accepté.
    const later = new Date(at.getTime() + 30_000);
    expect(verifyTotp(secret, totpAt(secret, later), later, { lastStep: first })).not.toBeNull();
  });

  it('refuse les saisies qui ne sont pas 6 chiffres', () => {
    const secret = generateSecret();
    const at = new Date();
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34', '１２３４５６']) {
      expect(verifyTotp(secret, bad, at)).toBeNull();
    }
    const code = totpAt(secret, at);
    // Les espaces saisis par l'utilisatrice sont tolérés.
    expect(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, at)).not.toBeNull();
  });

  it('l’URI du QR code suit le format Key URI', () => {
    const uri = otpauthUri({ secret: 'ABC234', account: 'a@b.fr', issuer: 'L’Atelier des Locks' });
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('secret=ABC234');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
});

describe('secrets au repos', () => {
  it('le secret TOTP est chiffré, déchiffrable avec la bonne clé seulement', () => {
    const sealed = encryptTotpSecret('JBSWY3DPEHPK3PXP', SECRET);
    expect(sealed).not.toContain('JBSWY3DP');
    expect(decryptTotpSecret(sealed, SECRET)).toBe('JBSWY3DPEHPK3PXP');
    expect(decryptTotpSecret(sealed, 'y'.repeat(48))).toBeNull();
    expect(decryptTotpSecret(`${sealed.slice(0, -2)}AA`, SECRET)).toBeNull();
    expect(decryptTotpSecret(null, SECRET)).toBeNull();
    // Deux chiffrements du même secret sont différents (IV aléatoire).
    expect(encryptTotpSecret('JBSWY3DPEHPK3PXP', SECRET)).not.toBe(sealed);
  });

  it('dix codes de secours distincts, hachés avec une clé du serveur', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const c of codes) expect(c).toMatch(/^[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{4}$/);
    const hash = hashRecoveryCode(codes[0], SECRET);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(hashRecoveryCode(codes[0], 'y'.repeat(48)));
    // La saisie tolère la casse, les tirets et les espaces.
    expect(hashRecoveryCode(codes[0].toUpperCase().replaceAll('-', ' '), SECRET)).toBe(hash);
    expect(normalizeRecoveryCode('AbCd-2345 xyz7')).toBe('abcd2345xyz7');
  });

  it('jetons de session : 32 octets, seule l’empreinte est stockée', () => {
    const { token, hash } = generateSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toEqual(hashSessionToken(token));
    expect(hash).toHaveLength(32);
    expect(generateSessionToken().token).not.toBe(token);
  });
});

describe('verrouillage progressif', () => {
  it('rien avant 5 échecs, puis 1, 5, 15 puis 60 minutes', () => {
    expect(FREE_ATTEMPTS).toBe(5);
    for (const n of [0, 1, 4]) expect(lockoutSeconds(n)).toBe(0);
    expect(lockoutSeconds(5)).toBe(60);
    expect(lockoutSeconds(6)).toBe(300);
    expect(lockoutSeconds(7)).toBe(900);
    expect(lockoutSeconds(8)).toBe(3600);
    expect(lockoutSeconds(50)).toBe(3600);
  });

  it('isLocked compare à l’horloge', () => {
    const now = new Date('2026-11-20T10:00:00Z');
    expect(isLocked(null, now)).toBe(false);
    expect(isLocked(new Date('2026-11-20T10:00:01Z'), now)).toBe(true);
    expect(isLocked(new Date('2026-11-20T10:00:00Z'), now)).toBe(false);
  });
});

describe('mots de passe', () => {
  it('argon2id, vérification, mauvais mot de passe, hash invalide', async () => {
    const hash = await hashPassword('un mot de passe solide');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'un mot de passe solide')).toBe(true);
    expect(await verifyPassword(hash, 'un autre')).toBe(false);
    expect(await verifyPassword('pas-un-hash', 'x')).toBe(false);
    expect(await hashPassword('un mot de passe solide')).not.toBe(hash);
  });

  it('règles : longueur, répétitions, adresse email', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
    expect(passwordProblem('court')).toMatch(/12 caractères/);
    expect(passwordProblem('aaaaaaaaaaaaaaaa')).toMatch(/trop simple/);
    expect(passwordProblem('x'.repeat(201) + 'y')).toMatch(/trop long/);
    expect(passwordProblem('Mon-veronique-2026-solide', { email: 'veronique@exemple.fr' })).toMatch(
      /adresse email/,
    );
    expect(passwordProblem('une phrase de passe assez longue')).toBeNull();
  });
});
