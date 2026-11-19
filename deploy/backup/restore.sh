#!/bin/sh
# Restauration d'une sauvegarde chiffrée.
#
#   restore.sh verify [--db FICHIER] [--uploads FICHIER]
#       Répétition : restaure dans une base TEMPORAIRE, affiche les effectifs, puis la supprime.
#       Ne touche à rien de ce qui est en ligne. À faire une fois par mois.
#
#   restore.sh live --yes-replace-live-data [--db FICHIER] [--uploads FICHIER]
#       Remplace la base en ligne (et les photos si --uploads). L'application doit être ARRÊTÉE.
#       Une sauvegarde de sécurité de l'état actuel est faite d'abord.
#
# Par défaut : la sauvegarde la plus récente de /backups, clé privée dans /keys/key.txt.
set -eu

BACKUP_DIR=${BACKUP_DIR:-/backups}
UPLOADS_DIR=${UPLOADS_DIR:-/uploads}
IDENTITY=${AGE_IDENTITY_FILE:-/keys/key.txt}
WORK=/work
log() { printf '%s restauration: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERREUR : $*"; exit 1; }
usage() { sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

MODE=${1:-}
[ -z "$MODE" ] || shift
DB_FILE=""; UP_FILE=""; CONFIRM=no
while [ $# -gt 0 ]; do
  case "$1" in
    --db) DB_FILE=${2:?--db demande un fichier}; shift 2 ;;
    --uploads) UP_FILE=${2:?--uploads demande un fichier}; shift 2 ;;
    --yes-replace-live-data) CONFIRM=yes; shift ;;
    -h|--help) usage 0 ;;
    *) die "option inconnue : $1" ;;
  esac
done
case "$MODE" in verify|live) ;; *) usage 1 ;; esac

[ -r "$IDENTITY" ] || die "clé privée introuvable ($IDENTITY). Voir docs/DEPLOIEMENT.md, « Restaurer »."
[ -n "$DB_FILE" ] || DB_FILE=$(ls -1 "$BACKUP_DIR"/atelier-db-*.dump.age 2>/dev/null | sort | tail -n 1 || true)
[ -n "$DB_FILE" ] && [ -r "$DB_FILE" ] || die "aucune sauvegarde de base trouvée dans $BACKUP_DIR."
[ -z "$UP_FILE" ] || [ -r "$UP_FILE" ] || die "fichier de photos illisible : $UP_FILE"

mkdir -p "$WORK"
trap 'rm -rf /work/* 2>/dev/null || true' EXIT

log "déchiffrement de $(basename "$DB_FILE")…"
age -d -i "$IDENTITY" -o "$WORK/db.dump" "$DB_FILE" || die "déchiffrement impossible : mauvaise clé privée, ou fichier abîmé."
pg_restore --list "$WORK/db.dump" > /dev/null || die "la sauvegarde déchiffrée est illisible."

# Session sur la base d'administration « postgres » (jamais sur la base de l'application).
psql_admin() { psql --no-psqlrc -v ON_ERROR_STOP=1 -d postgres -qAt "$@"; }
# Nom de base issu de l'environnement, validé strictement (un nom ne se paramètre pas en SQL).
case "$PGDATABASE" in *[!a-z0-9_]*|"") die "PGDATABASE invalide : $PGDATABASE" ;; esac

if [ "$MODE" = verify ]; then
  CHECK="restore_check_$(date -u +%Y%m%d%H%M%S)"
  log "restauration d'essai dans une base temporaire ($CHECK)…"
  psql_admin -c "CREATE DATABASE $CHECK"
  trap 'psql_admin -c "DROP DATABASE IF EXISTS $CHECK" >/dev/null 2>&1 || true; rm -rf /work/* 2>/dev/null || true' EXIT
  pg_restore --no-owner --no-privileges --exit-on-error -d "$CHECK" "$WORK/db.dump" || die "la restauration d'essai a échoué."
  log "base restaurée. Effectifs :"
  psql --no-psqlrc -d "$CHECK" -qAt -F ' : ' -c "
    SELECT 'prestations', count(*) FROM services
    UNION ALL SELECT 'clientes', count(*) FROM clients
    UNION ALL SELECT 'rendez-vous', count(*) FROM appointments
    UNION ALL SELECT 'avis', count(*) FROM reviews
    UNION ALL SELECT 'comptes admin', count(*) FROM users
    UNION ALL SELECT 'migrations appliquées', count(*) FROM schema_migrations" \
    | sed 's/^/    /'
  if [ -n "$UP_FILE" ]; then
    age -d -i "$IDENTITY" -o "$WORK/uploads.tar.gz" "$UP_FILE" || die "déchiffrement des photos impossible."
    log "photos : $(tar -tzf "$WORK/uploads.tar.gz" | grep -vc '/$' || true) fichier(s) dans l'archive."
  fi
  log "RÉPÉTITION RÉUSSIE. Base temporaire supprimée, rien n'a été modifié en ligne."
  exit 0
fi

# --- live ---
[ "$CONFIRM" = yes ] || die "restauration réelle : ajoutez --yes-replace-live-data pour confirmer."
[ -n "${BACKUP_AGE_RECIPIENTS:-}" ] || die "BACKUP_AGE_RECIPIENTS manquant : impossible de faire la sauvegarde de sécurité."
others=$(psql_admin -c "SELECT count(*) FROM pg_stat_activity WHERE datname = '$PGDATABASE' AND pid <> pg_backend_pid()")
[ "$others" = 0 ] || die "$others connexion(s) active(s) sur la base : arrêtez l'application d'abord (docker compose stop app)."

SAFE="$BACKUP_DIR/avant-restauration-db-$(date -u +%Y%m%dT%H%M%SZ).dump.age"
log "sauvegarde de sécurité de l'état actuel : $(basename "$SAFE")"
RECIP=""
for k in $(printf '%s' "$BACKUP_AGE_RECIPIENTS" | tr ',' ' '); do RECIP="$RECIP -r $k"; done
pg_dump --format=custom --no-owner --no-privileges --file="$WORK/avant.dump"
# shellcheck disable=SC2086
age $RECIP -o "$SAFE" "$WORK/avant.dump"

log "remplacement de la base « $PGDATABASE »…"
psql_admin -c "DROP DATABASE IF EXISTS $PGDATABASE"
psql_admin -c "CREATE DATABASE $PGDATABASE"
pg_restore --no-owner --no-privileges --exit-on-error -d "$PGDATABASE" "$WORK/db.dump" \
  || die "restauration échouée. L'état d'avant est dans $(basename "$SAFE")."
log "base restaurée."

if [ -n "$UP_FILE" ]; then
  age -d -i "$IDENTITY" -o "$WORK/uploads.tar.gz" "$UP_FILE" || die "déchiffrement des photos impossible."
  mkdir -p "$UPLOADS_DIR"
  tar -C "$UPLOADS_DIR" -xzf "$WORK/uploads.tar.gz"
  # L'application tourne sous l'utilisateur « node » (1000) dans son conteneur.
  chown -R 1000:1000 "$UPLOADS_DIR"
  log "photos restaurées."
fi
log "TERMINÉ. Redémarrez l'application : docker compose up -d app"
