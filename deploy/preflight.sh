#!/usr/bin/env bash
# Vérification avant le premier démarrage : « mon fichier .env est-il complet ? »
# Usage (depuis le dossier du projet sur le serveur) :  bash deploy/preflight.sh
# Ne modifie rien, n'affiche jamais un mot de passe.
set -u

ENV_FILE=${1:-.env}
problems=0
ok()   { printf '  \033[32mOK\033[0m      %s\n' "$1"; }
bad()  { printf '  \033[31mÀ CORRIGER\033[0m %s\n' "$1"; problems=$((problems + 1)); }
warn() { printf '  \033[33mAttention\033[0m %s\n' "$1"; }

echo "Vérification de $ENV_FILE"
[ -f "$ENV_FILE" ] || { bad "le fichier $ENV_FILE n'existe pas (cp .env.production.example .env)"; exit 1; }

# Lit une valeur sans exécuter le fichier.
val() { grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
need() { # nom, longueur minimale
  local v; v=$(val "$1")
  if [ -z "$v" ] || [ "$v" = "À REMPLIR" ]; then bad "$1 n'est pas rempli"
  elif [ "${#v}" -lt "${2:-1}" ]; then bad "$1 est trop court (${#v} caractères, il en faut au moins ${2})"
  else ok "$1"; fi
}

if grep -q "À REMPLIR" "$ENV_FILE"; then bad "il reste des « À REMPLIR » dans $ENV_FILE"; fi
need DOMAIN 4
need ACME_EMAIL 6
need POSTGRES_PASSWORD 24
need SESSION_SECRET 43
need BREVO_API_KEY 10
need BREVO_SENDER_EMAIL 6
need OWNER_EMAIL 6
need BACKUP_AGE_RECIPIENTS 20

domain=$(val DOMAIN)
case "$domain" in http*|*/*|www.*) bad "DOMAIN doit être le nom seul, sans https:// ni www. (exemple : atelierdeslocks.fr)";; esac
case "$(val BACKUP_AGE_RECIPIENTS)" in age1*) ;; *) bad "BACKUP_AGE_RECIPIENTS doit commencer par « age1 » (c'est la clé PUBLIQUE)";; esac
case "$(val BACKUP_AGE_RECIPIENTS)" in AGE-SECRET-KEY*) bad "ATTENTION : c'est la clé PRIVÉE. Elle ne doit pas être sur le serveur";; esac
case "$(val POSTGRES_PASSWORD)" in *[!A-Za-z0-9]*) bad "POSTGRES_PASSWORD : lettres et chiffres uniquement (openssl rand -hex 24)";; esac
case "$(val SESSION_SECRET)" in *remplacer*|*exemple*|*changeme*) bad "SESSION_SECRET est une valeur d'exemple";; esac
[ -n "$(val BACKUP_REMOTE)" ] && ok "copie hors serveur configurée" || warn "pas de copie hors serveur (BACKUP_REMOTE vide) : si le serveur est détruit, les sauvegardes le sont aussi"
[ -n "$(val GOOGLE_REVIEW_URL)" ] || warn "GOOGLE_REVIEW_URL vide : pas de lien « Laisser un avis Google »"

# Pages publiques : plus aucun passage « à compléter » (mentions légales, etc.).
if [ -d src/views ]; then
  left=$(grep -rnE "à (compléter|confirmer)]" src/views 2>/dev/null | wc -l | tr -d ' ')
  [ "$left" = 0 ] && ok "textes légaux complets" || warn "$left passage(s) « [à compléter] » dans les pages publiques (mentions légales…) : à renseigner avant l'ouverture"
fi

# Le fichier ne doit être lisible que par son propriétaire.
perm=$(stat -c '%a' "$ENV_FILE" 2>/dev/null || echo "")
if [ -n "$perm" ] && [ "$perm" != "600" ]; then warn "droits du fichier $perm : tapez « chmod 600 $ENV_FILE »"; fi

# Le nom de domaine pointe-t-il bien vers ce serveur ?
if command -v dig >/dev/null 2>&1 && [ -n "$domain" ]; then
  dns_ip=$(dig +short A "$domain" | tail -n 1)
  my_ip=$(curl -fsS -m 5 https://api.ipify.org 2>/dev/null || true)
  if [ -z "$dns_ip" ]; then bad "le domaine $domain ne pointe vers aucune adresse (DNS pas encore propagé ?)"
  elif [ -n "$my_ip" ] && [ "$dns_ip" != "$my_ip" ]; then bad "$domain pointe vers $dns_ip, mais ce serveur est $my_ip"
  else ok "le domaine $domain pointe vers ce serveur"; fi
fi

echo
if [ "$problems" -eq 0 ]; then echo "Tout est bon. Vous pouvez passer à l'étape suivante."; else echo "$problems point(s) à corriger avant de continuer."; exit 1; fi
