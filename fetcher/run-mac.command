#!/bin/bash
# Double-clique sur ce fichier pour récupérer tes données Garmin (Mac).
# S'il ne s'ouvre pas : clic droit > Ouvrir.

cd "$(dirname "$0")" || exit 1

echo "=== RunLab — préparation ==="

# Trouve Python 3
PY=""
for c in python3 python; do
  if command -v $c >/dev/null 2>&1; then PY=$c; break; fi
done
if [ -z "$PY" ]; then
  echo "[!] Python 3 n'est pas installé."
  echo "    Installe-le depuis https://www.python.org/downloads/ puis relance."
  read -n 1 -s -r -p "Appuie sur une touche pour fermer..."
  exit 1
fi

# Environnement isolé + dépendances (uniquement la 1re fois)
if [ ! -d ".venv" ]; then
  echo "Installation (une seule fois, peut prendre 1-2 min)..."
  $PY -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
python -m pip install --quiet --upgrade pip
python -m pip install --quiet -r requirements.txt

echo ""
python fetch_garmin.py

echo ""
read -n 1 -s -r -p "Terminé. Appuie sur une touche pour fermer cette fenêtre..."
