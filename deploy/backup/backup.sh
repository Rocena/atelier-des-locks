#!/bin/sh
# Sauvegarde chiffrée : base PostgreSQL + photos. Lancée chaque nuit par loop.sh,
# ou à la main : docker compose run --rm backup /ops/backup.sh
#
# Chiffrement avec age et une clé PUBLIQUE (BACKUP_AGE_RECIPIENTS) : le serveur peut écrire
# les sauvegardes mais pas les relire. La clé PRIVÉE reste chez la propriétaire.
set -eu

BACKUP_DIR=${BACKUP_DIR:-/backups}
UPLOADS_DIR=${UPLOADS_DIR:-/uploads}
# /work est un disque en mémoire vive (tmpfs) : les copies en clair n'existent jamais sur le disque.
WORK=/work
KEEP_DAILY_DAYS=${BACKUP_KEEP_DAILY_DAYS:-14}
KEEP_WEEKLY_WEEKS=${BACKUP_KEEP_WEEKLY_WEEKS:-8}
KEEP_MONTHLY_MONTHS=${BACKUP_KEEP_MONTHLY_MONTHS:-12}

log() { printf '%s backup: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
ping_url() { # $1 = suffixe ("" ou "/fail")
  [ -n "${BACKUP_PING_URL:-}" ] || return 0
  curl -fsS -m 10 --retry 2 -o /dev/null "${BACKUP_PING_URL}$1" || log "avertissement : signal de supervision non envoyé"
}
fail() { log "ÉCHEC : $*"; ping_url /fail; exit 1; }

[ -n "${BACKUP_AGE_RECIPIENTS:-}" ] || fail "BACKUP_AGE_RECIPIENTS est vide (clé publique age manquante)."
[ -n "${PGHOST:-}" ] && [ -n "${PGDATABASE:-}" ] || fail "PGHOST / PGDATABASE manquants."

# Une ou plusieurs clés publiques (séparées par des espaces ou des virgules).
RECIPIENT_ARGS=""
for key in $(printf '%s' "$BACKUP_AGE_RECIPIENTS" | tr ',' ' '); do
  case "$key" in
    age1[a-z0-9]*) RECIPIENT_ARGS="$RECIPIENT_ARGS -r $key" ;;
    *) fail "clé publique invalide (doit commencer par age1)." ;;
  esac
done

mkdir -p "$BACKUP_DIR" "$WORK"
trap 'rm -rf /work/* 2>/dev/null || true' EXIT

ts=$(date -u +%Y%m%dT%H%M%SZ)
db_out="$BACKUP_DIR/atelier-db-$ts.dump.age"
up_out="$BACKUP_DIR/atelier-uploads-$ts.tar.gz.age"

log "dump de la base « $PGDATABASE »…"
pg_dump --format=custom --no-owner --no-privileges --file="$WORK/db.dump" \
  || fail "pg_dump a échoué (base injoignable ?)."
# Contrôle : le dump doit être lisible et contenir nos tables (sinon on ne le garde pas).
pg_restore --list "$WORK/db.dump" > "$WORK/db.list" || fail "le dump produit est illisible."
for table in appointments clients services users; do
  grep -q "TABLE DATA public $table " "$WORK/db.list" || fail "le dump ne contient pas la table « $table »."
done
# shellcheck disable=SC2086
age $RECIPIENT_ARGS -o "$db_out.part" "$WORK/db.dump" || fail "chiffrement de la base impossible."
mv "$db_out.part" "$db_out"

log "archive des photos…"
if [ -d "$UPLOADS_DIR" ]; then
  tar -C "$UPLOADS_DIR" -czf "$WORK/uploads.tar.gz" . || fail "archive des photos impossible."
  # shellcheck disable=SC2086
  age $RECIPIENT_ARGS -o "$up_out.part" "$WORK/uploads.tar.gz" || fail "chiffrement des photos impossible."
  mv "$up_out.part" "$up_out"
else
  log "avertissement : dossier des photos absent ($UPLOADS_DIR), ignoré."
fi

# --- Rotation : 14 jours en quotidien, 8 semaines (dimanches), 12 mois (le 1er du mois) ---
now=$(date -u +%s)
for f in "$BACKUP_DIR"/atelier-*.age; do
  [ -e "$f" ] || continue
  stamp=$(basename "$f" | sed -n 's/^atelier-[a-z]*-\([0-9]\{8\}\)T\([0-9]\{6\}\)Z\..*/\1 \2/p')
  [ -n "$stamp" ] || continue
  d=${stamp%% *}; t=${stamp##* }
  when="$(printf '%s' "$d" | sed 's/\(....\)\(..\)\(..\)/\1-\2-\3/') $(printf '%s' "$t" | sed 's/\(..\)\(..\)\(..\)/\1:\2:\3/')"
  epoch=$(date -u -d "$when" +%s) || continue
  age_days=$(( (now - epoch) / 86400 ))
  weekday=$(date -u -d "$when" +%u)
  day=${d#??????}
  keep=no
  [ "$age_days" -le "$KEEP_DAILY_DAYS" ] && keep=yes
  [ "$weekday" = 7 ] && [ "$age_days" -le $((KEEP_WEEKLY_WEEKS * 7)) ] && keep=yes
  [ "$day" = 01 ] && [ "$age_days" -le $((KEEP_MONTHLY_MONTHS * 31)) ] && keep=yes
  if [ "$keep" = no ]; then rm -f "$f"; log "ancienne sauvegarde supprimée : $(basename "$f")"; fi
done

# --- Copie hors serveur (facultative mais fortement recommandée) ---
if [ -n "${BACKUP_REMOTE:-}" ]; then
  log "copie hors serveur vers $BACKUP_REMOTE…"
  rclone copy "$BACKUP_DIR" "$BACKUP_REMOTE" --include "atelier-*.age" --ignore-existing --quiet \
    || fail "la copie hors serveur a échoué (la sauvegarde locale, elle, est bonne)."
fi

size_db=$(wc -c < "$db_out" | tr -d ' ')
printf '%s db=%s octets\n' "$ts" "$size_db" > "$BACKUP_DIR/.last-success"
log "terminé : $(basename "$db_out") ($size_db octets)"
ping_url ""
