# Raccourcis de deploiement et de developpement.
#
# `make` n'est pas requis pour travailler sur le projet : les commandes de
# developpement restent disponibles via `pnpm`. Il l'est en revanche pour
# publier une version et sur le serveur, ou il evite les fautes de frappe qui
# coutent cher -- un `-p` oublie fait tourner la pile de production sur les
# volumes de developpement, et rien ne le signale.

SHELL := /bin/sh

COMPOSE := docker compose
PROD    := $(COMPOSE) -f docker/compose.production.yaml
DEV     := $(COMPOSE) -f docker/compose.yaml

.DEFAULT_GOAL := aide
.PHONY: aide dev dev-services dev-arret dev-remise-a-zero verifier images \
        parcours parcours-ui parcours-installer \
        prod prod-etat prod-journal prod-arret prod-migrer prod-admin \
        version

# --- Aide --------------------------------------------------------------------

aide:
	@echo ''
	@echo 'Developpement'
	@echo '  make dev                  services + API + worker + interface'
	@echo '  make dev-services         PostgreSQL, Redis et OpenLDAP seuls'
	@echo '  make dev-remise-a-zero    base vierge, migree et amorcee'
	@echo '  make verifier             mise en forme, SVG, lint, types et tests'
	@echo '  make images               construit les quatre images en :local'
	@echo '  make parcours             tests de bout en bout dans un vrai navigateur'
	@echo ''
	@echo 'Publication'
	@echo '  make version V=0.1.1      coupe release/0.1.1, prete a fusionner dans main'
	@echo ''
	@echo 'Production'
	@echo '  make prod                 demarre ou met a jour la pile'
	@echo '  make prod-migrer          applique les migrations, sans redemarrer'
	@echo '  make prod-admin           cree le premier administrateur'
	@echo '  make prod-etat            etat et sante des conteneurs'
	@echo '  make prod-journal         suit les journaux (Ctrl-C pour sortir)'
	@echo '  make prod-arret           arrete, sans toucher aux donnees'
	@echo ''
	@echo 'La configuration de production se lit dans docker/.env, jamais a la'
	@echo 'racine : Compose la cherche a cote du premier fichier -f.'
	@echo ''

# --- Developpement -----------------------------------------------------------

dev-services:
	$(DEV) up -d

dev: dev-services
	pnpm dev

dev-arret:
	$(DEV) down

# Detruit les donnees de developpement, puis rejoue migrations et amorcage.
dev-remise-a-zero:
	pnpm db:reset

# L'ordre va du moins cher au plus cher : une faute de mise en forme se voit en
# trois secondes, et il serait absurde de l'apprendre apres huit minutes de
# tests.
verifier:
	pnpm format:check
	pnpm verifier:svg
	pnpm lint
	pnpm typecheck
	pnpm test

images:
	pnpm images

# --- Parcours ----------------------------------------------------------------
#
# Les tests de bout en bout, dans un vrai navigateur. Playwright demarre l'API
# et l'interface lui-meme, mais **pas le worker** : il n'ecoute aucun port, donc
# rien ne permet d'attendre qu'il soit pret. Le cycle d'execution exige qu'il
# tourne a cote (`make dev`).
#
# Les services doivent tourner, et le navigateur avoir ete installe une fois :
# `make parcours-installer`.

parcours:
	pnpm parcours

parcours-ui:
	pnpm --filter @flow/e2e parcours:ui

parcours-installer:
	pnpm navigateurs

# --- Production --------------------------------------------------------------
#
# `up -d` sert aussi bien au premier demarrage qu'a la mise a jour : Compose
# recree les conteneurs dont la definition ou l'image a change, et laisse les
# autres en place.

prod:
	$(PROD) up -d

# Lecture seule : rien n'est demarre, arrete ni recree.
prod-etat:
	$(PROD) ps

prod-journal:
	$(PROD) logs -f --tail 100

# `down` sans `-v` : les volumes survivent, donc la base, les bots deposes et
# les captures aussi. Ajouter `-v` a la main est une decision, pas un raccourci.
prod-arret:
	$(PROD) down

# Rejoue les migrations sans redemarrer l'API. Utile apres une montee de version
# ou le service `migrations` a deja rendu la main.
prod-migrer:
	$(PROD) run --rm migrations

# Sans lui, une base migree est une base dans laquelle personne ne peut entrer.
# Le mot de passe passe par l'environnement et non par un argument : sur un
# serveur, un argument de ligne de commande se lit dans `ps`.
prod-admin:
	@test -n "$(MOT_DE_PASSE)" || { \
		echo 'Usage : make prod-admin MOT_DE_PASSE=... [IDENTIFIANT=...]'; exit 1; }
	$(PROD) run --rm \
		-e FLOW_ADMIN_PASSWORD='$(MOT_DE_PASSE)' \
		-e FLOW_ADMIN_USERNAME='$(IDENTIFIANT)' \
		api node apps/api/dist/cli/initialiser.js

# --- Publication -------------------------------------------------------------
#
# Le numero de version vit dans le nom de la branche, et la fusion de cette
# branche dans `main` declenche tout le reste : etiquette, images, archives.
# Cette cible ne fait que preparer la branche, correctement.
#
# Elle monte le manifeste et ouvre la section du journal -- position, date et
# ligne de lien, qui se trompent en silence. Le contenu s'ecrit a la main : rien
# ne devine ce qu'une version change pour ceux qui l'installent.
#
# Elle refuse de partir d'un `develop` en retard sur `main` : une version coupee
# d'un `develop` non realigne emporte le journal et le manifeste d'avant la
# version precedente, et les ramene en arriere en fusionnant dans `main` -- sans
# conflit, donc sans rien pour alerter.
#
# Elle ne pousse rien et n'ouvre aucune pull request : relire le journal avant
# de publier est le dernier moment ou l'on peut encore corriger ce qu'il annonce.

version:
	@test -n "$(V)" || { echo 'Usage : make version V=0.1.1'; exit 1; }
	@echo "$(V)" | grep -Eq '^[0-9]+[.][0-9]+[.][0-9]+$$' || { echo "'$(V)' n'est pas un numero de version."; exit 1; }
	@git rev-parse --verify --quiet release/$(V) >/dev/null && { echo 'La branche release/$(V) existe deja.'; exit 1; } || true
	@git fetch -q origin main develop
	@test -z "$$(git log --oneline origin/develop..origin/main)" || { echo 'develop est en retard sur main. Realignez avant de couper une version :'; echo '  git switch develop && git merge origin/main && git push'; exit 1; }
	git switch -c release/$(V) origin/develop
	node scripts/version.mjs $(V)
	@echo ''
	@echo 'Branche release/$(V) creee.'
	@echo 'Remplissez la section $(V) du CHANGELOG, puis :'
	@echo '  git commit -am ":bookmark: version $(V)" && git push -u origin release/$(V)'
