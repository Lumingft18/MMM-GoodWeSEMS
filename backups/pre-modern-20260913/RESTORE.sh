#!/bin/bash
# Ripristina UI pre-modernizzazione (locale).
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cp -a "$ROOT/backups/pre-modern-20260913/MMM-GoodWeSEMS.js" "$ROOT/MMM-GoodWeSEMS.js"
cp -a "$ROOT/backups/pre-modern-20260913/MMM-GoodWeSEMS.css" "$ROOT/MMM-GoodWeSEMS.css"
cp -a "$ROOT/backups/pre-modern-20260913/it.json" "$ROOT/translations/it.json"
cp -a "$ROOT/backups/pre-modern-20260913/en.json" "$ROOT/translations/en.json"
echo "Ripristinato locale. Sul Pi:"
echo "  rm -rf ~/MagicMirror/modules/MMM-GoodWeSEMS"
echo "  cp -a ~/MagicMirror/backups/MMM-GoodWeSEMS-20260913-133201 ~/MagicMirror/modules/MMM-GoodWeSEMS"
echo "  pm2 restart MagicMirror"
