// @ts-check
/**
 * Accès aux comptes et aux sessions de l'administration. Seul fichier du module avec du SQL.
 * @typedef {import('pg').Pool | import('pg').PoolClient} Db
 *
 * @typedef {object} User
 * @property {string} id
 * @property {string} email
 * @property {string} displayName
 * @property {string} passwordHash
 * @property {'owner'|'staff'} role
 * @property {string|null} totpSecretEncrypted
 * @property {Date|null} totpConfirmedAt
 * @property {number|null} totpLastStep
 * @property {number} recoveryCodesLeft
 * @property {number} failedLoginCount
 * @property {Date|null} lockedUntil
 * @property {boolean} active
 * @property {number|null} staffId
 */

/** @param {any} r @returns {User} */
const toUser = (r) => ({
  id: r.id,
  email: r.email,
  displayName: r.display_name,
  passwordHash: r.password_hash,
  role: r.role,
  totpSecretEncrypted: r.totp_secret_encrypted,
  totpConfirmedAt: r.totp_confirmed_at,
  totpLastStep: r.totp_last_step == null ? null : Number(r.totp_last_step),
  recoveryCodesLeft: (r.recovery_code_hashes ?? []).length,
  failedLoginCount: r.failed_login_count,
  lockedUntil: r.locked_until,
  active: r.active,
  staffId: r.staff_id == null ? null : Number(r.staff_id),
});

const USER_COLUMNS = `u.id, u.email, u.display_name, u.password_hash, u.role,
  u.totp_secret_encrypted, u.totp_confirmed_at, u.totp_last_step, u.recovery_code_hashes,
  u.failed_login_count, u.locked_until, u.active, u.staff_id`;

/** @param {Db} db @param {string} email @returns {Promise<User|null>} */
export async function findUserByEmail(db, email) {
  const { rows } = await db.query(`SELECT ${USER_COLUMNS} FROM users u WHERE u.email = $1`, [
    email,
  ]);
  return rows[0] ? toUser(rows[0]) : null;
}

/** @param {Db} db @param {string} id @returns {Promise<User|null>} */
export async function findUserById(db, id) {
  const { rows } = await db.query(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = $1`, [id]);
  return rows[0] ? toUser(rows[0]) : null;
}

/**
 * @param {Db} db
 * @param {{ email: string, displayName: string, passwordHash: string, role: 'owner'|'staff', staffId?: number|null }} u
 * @returns {Promise<string>}
 */
export async function insertUser(db, u) {
  const { rows } = await db.query(
    `INSERT INTO users (email, display_name, password_hash, role, staff_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [u.email, u.displayName, u.passwordHash, u.role, u.staffId ?? null],
  );
  return rows[0].id;
}

/** @param {Db} db */
export async function countUsers(db) {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM users');
  return rows[0].n;
}

/** @param {Db} db @param {string} id @param {string} passwordHash */
export async function updatePassword(db, id, passwordHash) {
  await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [id, passwordHash]);
}

/** Échec de connexion : compteur et verrouillage. @param {Db} db @param {string} id @param {Date|null} lockedUntil */
export async function recordFailure(db, id, lockedUntil) {
  const { rows } = await db.query(
    `UPDATE users SET failed_login_count = failed_login_count + 1,
            locked_until = COALESCE($2, locked_until)
      WHERE id = $1 RETURNING failed_login_count`,
    [id, lockedUntil],
  );
  return /** @type {number} */ (rows[0]?.failed_login_count ?? 0);
}

/** @param {Db} db @param {string} id @param {Date} now */
export async function recordSuccess(db, id, now) {
  await db.query(
    `UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = $2 WHERE id = $1`,
    [id, now],
  );
}

/** Enregistre un secret TOTP en attente de confirmation. @param {Db} db @param {string} id @param {string} encrypted */
export async function saveTotpSetup(db, id, encrypted) {
  await db.query(
    `UPDATE users SET totp_secret_encrypted = $2, totp_confirmed_at = NULL, totp_last_step = NULL
      WHERE id = $1 AND totp_confirmed_at IS NULL`,
    [id, encrypted],
  );
}

/**
 * Confirme la 2FA : mémorise le pas utilisé et les codes de secours (hachés).
 * @param {Db} db @param {string} id @param {number} step @param {string[]} recoveryHashes @param {Date} now
 */
export async function confirmTotp(db, id, step, recoveryHashes, now) {
  await db.query(
    `UPDATE users SET totp_confirmed_at = $4, totp_last_step = $2, recovery_code_hashes = $3
      WHERE id = $1`,
    [id, step, recoveryHashes, now],
  );
}

/** @param {Db} db @param {string} id @param {string[]} recoveryHashes */
export async function replaceRecoveryCodes(db, id, recoveryHashes) {
  await db.query('UPDATE users SET recovery_code_hashes = $2 WHERE id = $1', [id, recoveryHashes]);
}

/**
 * Consomme un pas TOTP de façon atomique : refuse le rejeu, même sous concurrence.
 * @param {Db} db @param {string} id @param {number} step
 * @returns {Promise<boolean>}
 */
export async function consumeTotpStep(db, id, step) {
  const { rowCount } = await db.query(
    `UPDATE users SET totp_last_step = $2
      WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)`,
    [id, step],
  );
  return rowCount === 1;
}

/**
 * Consomme un code de secours (usage unique, atomique).
 * @param {Db} db @param {string} id @param {string} hash
 * @returns {Promise<boolean>}
 */
export async function consumeRecoveryCode(db, id, hash) {
  const { rowCount } = await db.query(
    `UPDATE users SET recovery_code_hashes = array_remove(recovery_code_hashes, $2)
      WHERE id = $1 AND $2 = ANY(recovery_code_hashes)`,
    [id, hash],
  );
  return rowCount === 1;
}

/**
 * @typedef {object} SessionRow
 * @property {Buffer} tokenHash
 * @property {string} userId
 * @property {boolean} mfaVerified
 * @property {Date} createdAt
 * @property {Date} lastSeenAt
 * @property {Date} expiresAt
 */

/**
 * @param {Db} db
 * @param {{ tokenHash: Buffer, userId: string, mfaVerified: boolean, now: Date, expiresAt: Date, ip: string|null, userAgent: string|null }} s
 */
export async function insertSession(db, s) {
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, mfa_verified, created_at, last_seen_at, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, $4, $4, $5, $6, $7)`,
    [
      s.tokenHash,
      s.userId,
      s.mfaVerified,
      s.now,
      s.expiresAt,
      s.ip,
      s.userAgent?.slice(0, 300) ?? null,
    ],
  );
}

/**
 * Session non expirée et son compte actif.
 * @param {Db} db @param {Buffer} tokenHash @param {Date} now
 * @returns {Promise<{ session: SessionRow, user: User }|null>}
 */
export async function findSession(db, tokenHash, now) {
  const { rows } = await db.query(
    `SELECT s.token_hash, s.user_id, s.mfa_verified, s.created_at, s.last_seen_at, s.expires_at,
            ${USER_COLUMNS}
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > $2 AND u.active`,
    [tokenHash, now],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    session: {
      tokenHash: r.token_hash,
      userId: r.user_id,
      mfaVerified: r.mfa_verified,
      createdAt: r.created_at,
      lastSeenAt: r.last_seen_at,
      expiresAt: r.expires_at,
    },
    user: toUser(r),
  };
}

/** @param {Db} db @param {Buffer} tokenHash @param {Date} seenAt @param {Date} expiresAt */
export async function touchSession(db, tokenHash, seenAt, expiresAt) {
  await db.query('UPDATE sessions SET last_seen_at = $2, expires_at = $3 WHERE token_hash = $1', [
    tokenHash,
    seenAt,
    expiresAt,
  ]);
}

/** @param {Db} db @param {Buffer} tokenHash */
export async function deleteSession(db, tokenHash) {
  await db.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
}

/** Déconnecte toutes les sessions d'un compte (changement de mot de passe). @param {Db} db @param {string} userId @param {Buffer|null} [except] */
export async function deleteUserSessions(db, userId, except = null) {
  await db.query(
    'DELETE FROM sessions WHERE user_id = $1 AND ($2::bytea IS NULL OR token_hash <> $2)',
    [userId, except],
  );
}

/** @param {Db} db @param {Date} now */
export async function purgeExpiredSessions(db, now) {
  await db.query('DELETE FROM sessions WHERE expires_at < $1', [now]);
}

/**
 * Dépannage (script admin-recover) : remet à zéro le verrouillage d'un compte.
 * @param {Db} db @param {string} email
 * @returns {Promise<string|null>} identifiant du compte, ou null s'il n'existe pas
 */
export async function unlockUserByEmail(db, email) {
  const { rows } = await db.query(
    `UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE email = $1 RETURNING id`,
    [email],
  );
  return rows[0]?.id ?? null;
}

/**
 * Dépannage : la personne a perdu son téléphone ET ses codes de secours. Efface sa 2FA (elle
 * rescannera un QR code à la prochaine connexion), ferme ses sessions et lève le verrouillage.
 * @param {Db} db @param {string} email
 * @returns {Promise<string|null>} identifiant du compte, ou null s'il n'existe pas
 */
export async function resetTwoFactorByEmail(db, email) {
  const { rows } = await db.query(
    `UPDATE users SET totp_secret_encrypted = NULL, totp_confirmed_at = NULL, totp_last_step = NULL,
            recovery_code_hashes = '{}', failed_login_count = 0, locked_until = NULL
      WHERE email = $1 RETURNING id`,
    [email],
  );
  const id = rows[0]?.id ?? null;
  if (id) await db.query('DELETE FROM sessions WHERE user_id = $1', [id]);
  return id;
}
