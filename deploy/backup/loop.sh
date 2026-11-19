#!/bin/sh
# Planificateur : une sauvegarde par jour à BACKUP_HOUR:BACKUP_MINUTE (heure de Paris).
# Vérifie toutes les 30 s : insensible aux changements d'heure et aux redémarrages.
set -u
HOUR=${BACKUP_HOUR:-03}
MINUTE=${BACKUP_MINUTE:-30}
last_day=""
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) backup: planifié chaque jour à $HOUR:$MINUTE (heure de Paris)"
[ "${BACKUP_ON_START:-false}" = true ] && /ops/backup.sh
while true; do
  today=$(date +%Y-%m-%d)
  if [ "$(date +%H:%M)" = "$HOUR:$MINUTE" ] && [ "$today" != "$last_day" ]; then
    last_day=$today
    attempt=1
    # Trois essais espacés de 20 minutes (base en maintenance, réseau momentanément coupé…).
    until /ops/backup.sh; do
      [ "$attempt" -ge 3 ] && break
      attempt=$((attempt + 1)); sleep 1200
    done
  fi
  sleep 30
done
