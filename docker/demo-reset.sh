#!/bin/sh
# Remise a zero de la demonstration publique.
#
# Monte dans le conteneur `demo-reset` par docker/compose.demo.yaml. Ce script
# vit dans un fichier plutot que dans le YAML : une boucle shell ecrite dans un
# champ `command` demande d'echapper chaque `$`, se relit mal, et Compose la
# decoupe de facon surprenante.
#
# Il n'a rien a faire sur une installation reelle : `seed.js` tronque toutes les
# tables avant d'ecrire.

set -u

STOCKAGE="${STORAGE_PATH:-/donnees/stockage}"

# Les executions rejouees a chaque remise a zero.
#
# **Le seed ne fabrique aucune piece.** Une capture inventee serait une capture
# de rien, et un lien de telechargement vers un fichier absent. Ces quelques
# lancements-ci sont reels : ils passent par la file, le worker et un vrai
# Chromium, et produisent donc de vraies captures, de vraies traces et de vrais
# journaux -- ce que l'ecran d'historique vient justement montrer.
#
# L'echec est volontaire, et il est le plus utile des quatre : c'est lui qui
# donne a voir la capture au moment de la rupture et la trace Playwright.
#
# Ils verifient aussi la pile a chaque heure. Une demonstration dont le worker
# est mort depuis trois jours ressemble a une demonstration qui marche, jusqu'a
# ce qu'un visiteur clique.
LANCEMENTS='exemple.bonjour {"decor":"tableau","pause":2}
exemple.catalogue {"categorie":"policier","pages":1}
exemple.epreuves {"epreuve":"cadre-imbrique"}
exemple.epreuves {"epreuve":"page-en-erreur"}'

rejouer() {
  echo "$LANCEMENTS" | while IFS=' ' read -r bot parametres; do
    [ -n "$bot" ] || continue

    if node apps/api/dist/cli/lancer.js "$bot" "$parametres" >/dev/null 2>&1; then
      echo "[demo] lance $bot"
    else
      # Un lancement qui ne part pas n'annule pas la remise a zero : le decor
      # est deja en place, et c'est lui qui porte l'essentiel.
      echo "[demo] lancement impossible : $bot" >&2
    fi
  done
}

reinitialiser() {
  echo "[demo] remise a zero $(date -u +%FT%TZ)"

  if ! node apps/api/dist/cli/seed.js; then
    # On ne vide pas le stockage si l'amorcage a echoue : mieux vaut une
    # demonstration figee sur des donnees coherentes qu'une demonstration dont
    # les executions referencent des captures disparues.
    echo "[demo] amorcage en echec, stockage conserve" >&2
    return 1
  fi

  # Les visiteurs produisent des captures et des traces a chaque execution.
  # Sans ce nettoyage, le volume grossit sans fin et la demonstration finit par
  # heberger durablement des fichiers que personne n'a relus.
  find "$STOCKAGE" -mindepth 1 -delete 2>/dev/null || true

  rejouer
  echo "[demo] pret"
}

reinitialiser || true

while true; do
  # Vise l'heure ronde plutot qu'un intervalle depuis le demarrage : on peut
  # alors annoncer « remise a zero a chaque heure » sans mentir.
  sleep $((3600 - $(date +%s) % 3600))
  reinitialiser || true
done
