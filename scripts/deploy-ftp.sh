#!/usr/bin/env bash
set -e

# Charge les secrets depuis .env.local
if [ -f .env.local ]; then
  set -a
  # shellcheck source=.env.local.example
  source .env.local
  set +a
else
  echo "Fichier .env.local manquant (voir .env.local.example)"
  exit 1
fi

echo "Build Astro..."
npm run build

echo "Deploiement FTP vers $FTP_HOST$FTP_REMOTE_DIR..."
# Utilise lftp ou ncftp selon disponibilite
if command -v lftp &> /dev/null; then
  lftp -c "
    open -u $FTP_USER,$FTP_PASS ftp://$FTP_HOST;
    mirror --reverse --delete --verbose ./dist/ $FTP_REMOTE_DIR;
    quit
  "
elif command -v ncftp &> /dev/null; then
  ncftpput -R -v -u "$FTP_USER" -p "$FTP_PASS" "$FTP_HOST" "$FTP_REMOTE_DIR" ./dist/*
else
  echo "lftp ou ncftp requis: brew install lftp"
  exit 1
fi

echo "Deploiement termine sur https://agilion.ca"
