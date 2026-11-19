# Sauvegardes chiffrées de la base et des photos.
# Même version de PostgreSQL que la base (pg_dump / pg_restore compatibles) + age (chiffrement)
# + rclone (copie hors serveur, facultative) + curl (signal « tout va bien », facultatif).
FROM postgres:17-alpine
RUN apk add --no-cache age rclone curl tzdata tar
COPY backup.sh restore.sh loop.sh /ops/
RUN chmod 0555 /ops/*.sh
ENV TZ=Europe/Paris
# L'image de PostgreSQL démarre un serveur par défaut : on le remplace.
ENTRYPOINT []
CMD ["/ops/loop.sh"]
