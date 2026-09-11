# Installer, sauvegarder, mettre à jour

Ce document est une marche à suivre. Il a été écrit **en installant**, et chaque commande qu'il
donne a été exécutée telle quelle. Ce qui a coincé en chemin est corrigé dans le code ou dans ces
pages — pas expliqué à l'oral.

Deux voies : **en conteneurs**, qui est la recommandée, et **sans conteneurs**, pour une machine où
Docker n'est pas envisageable.

## 1. Ce qu'il faut avant de commencer

|            | Minimum | Confortable                       |
| ---------- | ------- | --------------------------------- |
| Processeur | 2 cœurs | 4 cœurs et plus                   |
| Mémoire    | 4 Go    | 8 Go et plus                      |
| Disque     | 20 Go   | selon la rétention des exécutions |

**Compter environ un gigaoctet de mémoire et un cœur par exécution simultanée.** Chacune ouvre un
vrai navigateur : c'est le worker qui dimensionne la machine, pas l'API.

Il faut aussi un nom de domaine et un certificat. Le cookie de session est marqué `Secure` : servie
en clair, l'installation accepte la connexion puis renvoie aussitôt à l'écran de connexion, et rien
n'explique pourquoi.

---

## 2. En conteneurs

### 2.1 Poser les fichiers

```bash
sudo mkdir -p /opt/flow && cd /opt/flow
sudo curl -fsSLO https://raw.githubusercontent.com/tick-and/flow/main/docker/compose.production.yaml
sudo curl -fsSL -o .env https://raw.githubusercontent.com/tick-and/flow/main/docker/production.env.example
```

### 2.2 Remplir `.env`

Trois secrets sont à produire, et aucun n'a de valeur par défaut — une valeur par défaut serait la
même sur toutes les installations du monde, et la plupart ne la changeraient jamais.

```bash
openssl rand -base64 48   # SESSION_SECRET
openssl rand -hex 32      # ENCRYPTION_KEY  (exactement 64 caractères hexadécimaux)
openssl rand -hex 12      # le mot de passe de la base, et celui du rôle applicatif
```

Renseigner ensuite `POSTGRES_PASSWORD`, `DATABASE_URL`, `DATABASE_APP_URL`, `API_URL` et `WEB_URL`.
Les deux dernières portent la même adresse : l'interface et l'API partagent une origine.

**`ENCRYPTION_KEY` se sauvegarde avec la base.** La perdre rend illisibles les secrets déjà
chiffrés — aucune restauration ne les récupère.

```bash
sudo chmod 600 .env
```

### 2.3 Migrer

```bash
docker compose -f compose.production.yaml up -d postgres
docker compose -f compose.production.yaml run --rm migrations
```

### 2.4 Changer le mot de passe du rôle applicatif

**Cette étape n'est pas facultative.** La première migration crée le rôle `flow_app` avec un mot de
passe écrit dans le dépôt, donc public. Ce rôle est celui que l'application utilise pour tout son
trafic : il est soumis au Row-Level Security, pas au secret. Tant qu'il n'est pas changé, quiconque
a lu le dépôt et peut joindre la base lit les données de toutes les entités.

Le mot de passe doit être **celui déjà écrit dans `DATABASE_APP_URL`** :

```bash
docker compose -f compose.production.yaml exec postgres \
  psql -U flow -d flow -c "ALTER ROLE flow_app PASSWORD 'celui-de-votre-.env';"
```

### 2.5 Amorcer le compte d'administration

```bash
docker compose -f compose.production.yaml run --rm \
  -e FLOW_ADMIN_PASSWORD='un-mot-de-passe-de-douze-caracteres-au-moins' \
  api node apps/api/dist/cli/initialiser.js
```

Il crée l'entité racine, les profils Administration et Observation, et le compte `admin` — **avec
l'obligation de changer son mot de passe à la première connexion**, puisque celui-ci vient de
passer par l'historique d'un shell.

L'amorçage refuse de s'exécuter sur une base qui porte déjà des comptes : le relancer est sans
danger.

### 2.6 Démarrer

```bash
docker compose -f compose.production.yaml up -d
docker compose -f compose.production.yaml ps
```

Les cinq services doivent être `healthy` — le worker n'a pas de sonde, il n'écoute aucun port.

```bash
curl -s http://127.0.0.1:8080/api/health
# {"status":"ok",...,"checks":{"database":true,"queues":true,"workers":1}}
```

`workers: 1` est la ligne à lire : elle dit qu'un worker a pris la file. À zéro, les exécutions
partiront et resteront en attente.

### 2.7 Mettre un relais TLS devant

L'interface n'écoute que sur `127.0.0.1:8080`. Poser un relais — nginx, Caddy, Traefik — qui
termine le TLS et relaie vers ce port. Le fichier [`deploy/nginx/flow.conf`](../deploy/nginx/flow.conf)
donne une configuration nginx complète ; remplacer `proxy_pass` par `http://127.0.0.1:8080` et
retirer le bloc statique, que le conteneur `web` sert déjà.

### 2.8 Déposer un bot

Une installation neuve contient déjà le bot d'exemple : il sert à vérifier que la chaîne complète
fonctionne. Pour déposer les vôtres :

```bash
docker compose -f compose.production.yaml cp mon-bot flow-api-1:/app/bots/mon-bot
docker compose -f compose.production.yaml cp mon-bot flow-worker-1:/app/bots/mon-bot
```

Puis « Relire le dossier » depuis l'écran des bots.

Un bot déposé doit être **construit** : le dossier contient `flow.bot.json` et `dist/`. Le SDK, lui,
est fourni par l'installation — c'est pourquoi les dépôts vivent dans `/app`, où Node sait le
résoudre.

---

## 3. Sans conteneurs

À réserver aux machines où Docker n'est pas envisageable. Tout y est possible, mais chaque pièce est
à installer et à tenir à jour séparément.

### 3.1 Linux

**Les dépendances :** Node 22 ou plus, pnpm 11, PostgreSQL 18 avec les extensions `ltree`, `citext`
et `unaccent`, Redis 8, et les bibliothèques système de Chromium.

```bash
sudo useradd --system --home /opt/flow --shell /usr/sbin/nologin flow
sudo mkdir -p /opt/flow /var/lib/flow
sudo chown -R flow:flow /opt/flow /var/lib/flow

# Le code, construit sur la machine ou ailleurs puis copié.
sudo -u flow git clone https://github.com/tick-and/flow.git /opt/flow
cd /opt/flow
sudo -u flow pnpm install --frozen-lockfile
sudo -u flow pnpm build
sudo -u flow PLAYWRIGHT_BROWSERS_PATH=/var/lib/flow/navigateurs pnpm navigateurs
```

Poser `.env` à la racine (`chmod 600`, propriétaire `flow`), en pointant `STORAGE_PATH` et
`WORKER_OUTPUT_PATH` vers `/var/lib/flow`. Puis migrer, changer le mot de passe de `flow_app` et
amorcer, comme aux sections 2.3 à 2.5 — sans les préfixes `docker compose` :

```bash
sudo -u flow pnpm db:migrate
sudo -u flow psql "$DATABASE_URL" -c "ALTER ROLE flow_app PASSWORD '...';"
sudo -u flow FLOW_ADMIN_PASSWORD='...' node apps/api/dist/cli/initialiser.js
```

Les services :

```bash
sudo cp deploy/systemd/flow-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now flow-api flow-worker
sudo cp deploy/nginx/flow.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/flow.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 3.2 Windows Server

Mêmes dépendances, et deux modules IIS : **URL Rewrite** et **Application Request Routing**, avec le
relais activé dans la configuration du serveur. Sans ARR, la règle qui relaie `/api` rend une 500
dont le message ne dit pas qu'il manque un module.

```powershell
cd C:\flow
pnpm install --frozen-lockfile
pnpm build
pnpm navigateurs

# Services Windows, redémarrage automatique compris.
.\deploy\windows\installer-services.ps1 -Racine C:\flow
Start-Service FlowApi, FlowWorker
```

Copier `deploy\windows\web.config` à la racine du site IIS, qui pointe sur `C:\flow\apps\web\dist`.

**Une limite à connaître :** un service déclaré par `sc.exe` est _tué_ à l'arrêt, pas arrêté en
douceur. Le worker perd alors ses exécutions en cours, que le balayage déclare abandonnées une
minute plus tard. L'installation en conteneurs n'a pas ce défaut.

---

## 4. Sauvegarder

Trois choses, et les trois ensemble :

| Quoi                  | Pourquoi                                                  |
| --------------------- | --------------------------------------------------------- |
| La base PostgreSQL    | tout l'état : comptes, droits, exécutions, planifications |
| Le volume de stockage | captures, traces, sorties de bots                         |
| `ENCRYPTION_KEY`      | sans elle, les secrets chiffrés en base sont perdus       |

**La base seule ne suffit pas.** Restaurée sans le stockage, elle décrit des exécutions dont les
pièces ont disparu : l'écran affiche une capture qui rend 404, et rien ne dit pourquoi.

```bash
# Base.
docker compose -f compose.production.yaml exec -T postgres \
  pg_dump -U flow -d flow --format=custom > /sauvegardes/flow-$(date +%F).dump

# Stockage. Le volume est copié depuis un conteneur jetable.
docker run --rm -v flow_stockage:/donnees -v /sauvegardes:/sortie alpine \
  tar czf /sortie/flow-stockage-$(date +%F).tar.gz -C /donnees .
```

Les deux commandes ci-dessus ont été exécutées telles quelles, puis la base et le volume ont été
effacés et restaurés : la capture d'une exécution antérieure est resservie à l'identique.

### Restaurer

```bash
docker compose -f compose.production.yaml up -d postgres
docker compose -f compose.production.yaml exec -T postgres \
  pg_restore -U flow -d flow --clean --if-exists < /sauvegardes/flow-2026-09-12.dump

docker run --rm -v flow_stockage:/donnees -v /sauvegardes:/entree alpine \
  sh -c "rm -rf /donnees/* && tar xzf /entree/flow-stockage-2026-09-12.tar.gz -C /donnees"
```

Remettre le même `ENCRYPTION_KEY` dans `.env` **avant** de redémarrer l'API.

Une restauration se répète à blanc avant d'en avoir besoin. Une sauvegarde qu'on n'a jamais
restaurée n'est pas une sauvegarde.

---

## 5. Mettre à jour

Les images sont publiées par version. `latest` existe, et une installation ne devrait pas s'en
servir : une montée de version se décide, elle ne survient pas au prochain redémarrage.

```bash
# 1. Sauvegarder. Toujours, et d'abord.
# 2. Lire le journal des versions : il dit ce qu'il faut faire avant de monter.
# 3. Épingler la nouvelle version dans .env (FLOW_IMAGE_*), puis :

docker compose -f compose.production.yaml pull
docker compose -f compose.production.yaml up -d
```

Les migrations sont jouées par leur propre service, avant que l'API et le worker ne démarrent. Elles
sont **jouées une fois** : une migration déjà appliquée est reconnue à son nom et passée.

### Revenir en arrière

Réépingler l'ancienne version et redémarrer suffit **tant qu'aucune migration n'a été jouée**. Dès
qu'il y en a eu une, c'est la sauvegarde qui fait foi : les migrations ne se défont pas. Le journal
des versions signale celles qui changent la forme des données.

### Ce qu'une montée de version ne touche pas

Les bots et les plugins déposés vivent dans des volumes : ils survivent. Un plugin peut en revanche
viser une version de la surface d'extension que la nouvelle version ne sert plus — il apparaît alors
en « Refusé » avec ce motif, et l'application démarre sans lui plutôt que de rester à terre.

---

## 6. Quand ça ne démarre pas

| Symptôme                                                   | Cause la plus fréquente                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `checks.workers` vaut 0                                    | le worker ne joint pas Redis, ou il est tombé — `docker compose logs worker`    |
| La connexion réussit puis renvoie à la connexion           | `COOKIE_SECURE=true` sur une installation servie en HTTP                        |
| « Identifiants invalides » sur le compte amorcé            | l'amorçage a tourné sur une autre base que celle de `.env`                      |
| Un bot apparaît « Refusé »                                 | son dossier n'est pas construit, ou son manifeste vise une autre majeure de SDK |
| Une exécution reste en file                                | aucun worker n'écoute — voir la première ligne                                  |
| Une capture rend 404                                       | l'API et le worker ne partagent pas le même volume de stockage                  |
| `EACCES` au premier lancement de bot                       | un volume monté sur un chemin absent de l'image, donc créé root                 |
| 502 pendant une trentaine de secondes après un redémarrage | normal : le relais attend que l'API réponde à sa sonde                          |

Les journaux sont le premier endroit à regarder, et ils nomment ce qui manque :

```bash
docker compose -f compose.production.yaml logs -f api worker
# Sans conteneurs :
journalctl -u flow-api -u flow-worker -f
```
