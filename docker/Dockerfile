# syntax=docker/dockerfile:1.7
#
# Les trois images de Flow&, dans un seul fichier.
#
# **Un fichier et trois cibles, plutot que trois fichiers.** Les trois images
# partagent la meme installation de dependances et la meme construction : les
# separer ferait faire trois fois le meme travail -- une installation pnpm et un
# `turbo run build` complets a chaque image --, et rien ne garantirait qu'elles
# sortent du meme code.
#
#   docker build -f docker/Dockerfile --target api    -t flow-api:local .
#   docker build -f docker/Dockerfile --target worker -t flow-worker:local .
#   docker build -f docker/Dockerfile --target web    -t flow-web:local .

# -----------------------------------------------------------------------------
# Socle commun.
#
# `bookworm-slim` et non `alpine` : le worker installe Chromium et ses
# bibliotheques, que Playwright ne publie pas pour musl. Deux bases differentes
# auraient donne deux comportements a diagnostiquer -- une meme dependance
# native se compilant ici et pas la.
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Le telechargement des navigateurs est coupe pour toute la construction : seule
# l'image du worker en a besoin, et elle les installe elle-meme. Sans cela,
# chaque `pnpm install` tirerait trois cents megaoctets pour les jeter.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN corepack enable

WORKDIR /app

# -----------------------------------------------------------------------------
# Construction.
#
# Le depot entier est copie, et `.dockerignore` dit ce qui reste dehors -- a
# commencer par les `node_modules` de la machine, construits pour un autre
# systeme.
# -----------------------------------------------------------------------------
FROM base AS build

COPY . .

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm build

# -----------------------------------------------------------------------------
# Dependances d'execution.
#
# La meme arborescence, debarrassee des dependances de developpement -- qui
# pesent plus lourd que tout le reste : TypeScript, Vitest, Playwright, Turbo.
# Les `dist` deja construits ne bougent pas.
# -----------------------------------------------------------------------------
FROM build AS runtime-deps

# `CI=true` : pnpm refuse de vider un `node_modules` existant sans confirmation,
# et il n'y a pas de terminal pour la donner -- il s'arrete alors sur
# « Aborted removal of modules directory due to no TTY ». C'est exactement le
# cas que ce drapeau decrit.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    CI=true pnpm install --frozen-lockfile --prod --ignore-scripts

# -----------------------------------------------------------------------------
# L'API.
# -----------------------------------------------------------------------------
FROM base AS api

ENV NODE_ENV=production

COPY --from=runtime-deps /app /app

# Les dossiers de depot, et ce qui rend un depot chargeable.
#
# Un bot construit importe `@flow/bot-sdk` a l'execution -- son bundle le laisse
# volontairement dehors, pour que le worker en fournisse **un seul** exemplaire.
# Il faut donc que Node sache le resoudre depuis l'endroit ou le bot est depose.
#
# Node cherche `node_modules` en remontant les dossiers : un lien pose ici suffit
# a ce qu'un bot depose dans `/app/bots/monbot` trouve le SDK, sans que son
# auteur ait rien a installer. Sans lui, le depot echoue sur
# « Cannot find package '@flow/bot-sdk' » -- un message qui accuse le bot alors
# que c'est l'installation qui ne lui offrait rien.
#
# C'est aussi pour cela que les volumes se montent **dans** l'arborescence de
# l'application plutot que dans un `/donnees` a part.
RUN mkdir -p /app/bots/node_modules/@flow /app/plugins/node_modules/@flow \
  && ln -sfn /app/packages/bot-sdk /app/bots/node_modules/@flow/bot-sdk \
  && ln -sfn /app/packages/plugin-sdk /app/plugins/node_modules/@flow/plugin-sdk

# Les dossiers ecrits a l'execution, crees **avant** que les volumes ne s'y
# montent, et donnes au compte qui fera tourner le service.
#
# Un volume nomme herite des droits du point de montage tel qu'il existe dans
# l'image. S'il n'existe pas, Docker le cree appartenant a root -- et le
# conteneur, qui ne tourne pas en root, decouvre qu'il ne peut pas ecrire au
# moment ou un bot rend sa premiere capture. L'erreur dit « EACCES » et nomme un
# chemin ; elle ne dit pas que le probleme etait dans l'image.
RUN mkdir -p /donnees/stockage /donnees/travail && chown -R node:node /donnees

# Ne pas tourner en root. L'image `node` fournit deja un compte `node` sans
# privileges ; l'utiliser coute une ligne et retire une classe entiere de
# mauvaises surprises.
USER node

EXPOSE 3100

# Le point de sante est celui que l'API expose de toute facon : le reutiliser
# evite d'ecrire une seconde definition de « en vie » qui pourrait diverger.
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3100/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "apps/api/dist/main.js"]

# -----------------------------------------------------------------------------
# Le worker.
#
# Il porte Chromium, et c'est pour cela qu'il pese dix fois l'image de l'API. La
# separation se paie ici et se rembourse partout ailleurs : l'API se met a
# l'echelle sans trainer un navigateur, et le worker se redemarre sans couper
# les sessions.
# -----------------------------------------------------------------------------
FROM base AS worker

ENV NODE_ENV=production
# Les navigateurs vivent hors du dossier de l'utilisateur : le conteneur tourne
# sous `node`, et un chemin sous `/root` ne serait pas lisible.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY --from=runtime-deps /app /app

# Les dossiers de depot, et ce qui rend un depot chargeable.
#
# Un bot construit importe `@flow/bot-sdk` a l'execution -- son bundle le laisse
# volontairement dehors, pour que le worker en fournisse **un seul** exemplaire.
# Il faut donc que Node sache le resoudre depuis l'endroit ou le bot est depose.
#
# Node cherche `node_modules` en remontant les dossiers : un lien pose ici suffit
# a ce qu'un bot depose dans `/app/bots/monbot` trouve le SDK, sans que son
# auteur ait rien a installer. Sans lui, le depot echoue sur
# « Cannot find package '@flow/bot-sdk' » -- un message qui accuse le bot alors
# que c'est l'installation qui ne lui offrait rien.
#
# C'est aussi pour cela que les volumes se montent **dans** l'arborescence de
# l'application plutot que dans un `/donnees` a part.
RUN mkdir -p /app/bots/node_modules/@flow /app/plugins/node_modules/@flow \
  && ln -sfn /app/packages/bot-sdk /app/bots/node_modules/@flow/bot-sdk \
  && ln -sfn /app/packages/plugin-sdk /app/plugins/node_modules/@flow/plugin-sdk

# Les dossiers ecrits a l'execution, crees **avant** que les volumes ne s'y
# montent, et donnes au compte qui fera tourner le service.
#
# Un volume nomme herite des droits du point de montage tel qu'il existe dans
# l'image. S'il n'existe pas, Docker le cree appartenant a root -- et le
# conteneur, qui ne tourne pas en root, decouvre qu'il ne peut pas ecrire au
# moment ou un bot rend sa premiere capture. L'erreur dit « EACCES » et nomme un
# chemin ; elle ne dit pas que le probleme etait dans l'image.
RUN mkdir -p /donnees/stockage /donnees/travail && chown -R node:node /donnees

# `--with-deps` installe aussi les bibliotheques systeme que Chromium reclame :
# sans elles il se lance et meurt aussitot, sur un message qui nomme un `.so` et
# non ce qui manque.
RUN pnpm --filter @flow/worker exec playwright install --with-deps chromium \
  && chmod -R a+rx /ms-playwright

USER node

CMD ["node", "--enable-source-maps", "apps/worker/dist/main.js"]

# -----------------------------------------------------------------------------
# Les migrations.
#
# Une image plutot qu'une commande dans l'image de l'API : la pile de production
# la lance **avant** l'API, et une API qui migrerait au demarrage ferait jouer
# les migrations autant de fois qu'il y a d'instances, en meme temps.
# -----------------------------------------------------------------------------
FROM base AS migrations

ENV NODE_ENV=production

COPY --from=runtime-deps /app /app

USER node

CMD ["node", "packages/db/dist/migrate.js"]

# -----------------------------------------------------------------------------
# L'interface.
#
# Servie par nginx, qui relaie aussi `/api` vers le conteneur de l'API : le
# navigateur ne voit donc **qu'une seule origine**. C'est ce qui permet au
# cookie de session d'etre `SameSite=Strict` sans rien configurer, et ce qui
# evite d'ouvrir CORS.
# -----------------------------------------------------------------------------
FROM nginx:1.31-alpine AS web

COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
