# Politique de sécurité

> **In English.** To report a vulnerability, use GitHub's private reporting on this
> repository — **Security → Report a vulnerability**. Please do not open a public issue for
> anything exploitable. Reports in English are welcome.

## Signaler une faille

Utilisez le **signalement privé de GitHub**, sur l'onglet _Security_ du dépôt → _Report a
vulnerability_. La discussion reste invisible jusqu'à publication d'un correctif.

N'ouvrez pas d'issue publique pour quelque chose d'exploitable : le dépôt est public, et une
issue est indexée dans la minute.

Sans compte GitHub, écrivez à **tick0001@proton.me**. Le signalement par l'onglet _Security_
reste préférable : il crée l'avis, suit le correctif et publie la divulgation tout seul.

Ce qui aide à traiter vite : la version affichée par `GET /api/health`, le mode d'installation,
et la manière de reproduire. Une preuve de concept, même approximative, vaut mieux qu'une
description prudente.

## Versions suivies

**Aucune version n'est encore publiée.** Le projet est au jalon J0 : il n'y a rien à installer,
donc rien à exploiter chez quiconque. Cette section vaut pour la suite — seule la dernière
version étiquetée recevra des correctifs, sans branche de maintenance.

## Ce qui est connu, et assumé

Un projet qui prétend n'avoir aucune limite en cache. Voici les siennes, y compris celles qui
ne sont pas encore écrites en code mais qui sont déjà décidées.

**Un bot est du code arbitraire, exécuté par le worker.** C'est la nature du produit : déposer
un bot dans `bots/`, c'est exécuter son auteur. La frontière de confiance passe donc au dépôt
d'un bot, pas à son exécution — un bot n'est pas un bac à sable, et rien dans l'architecture ne
prétend le contraire. Qui peut déposer un bot peut tout faire sur la machine du worker.

C'est aussi pourquoi le worker est un processus séparé, avec son propre conteneur : ce n'est
pas un isolement de sécurité, mais cela limite ce qu'un bot atteint depuis là où il tourne.

**Un bot pilote un navigateur, donc émet des connexions sortantes arbitraires.** Un bot peut
viser un réseau interne. Il n'existe pas encore de garde-fou, et le jour où il en existera un,
il sera contournable par une résolution DNS qui change entre la vérification et la connexion —
la même limite que Tick& documente pour ses connecteurs.

**Aucun audit externe**, et pour l'instant aucun cloisonnement à auditer : les politiques de
Row-Level Security arrivent au jalon J1.

## Ce sur quoi le projet ne transige pas

Le cloisonnement multi-organisation reposera sur le Row-Level Security de PostgreSQL, et non
sur des conditions applicatives. Une correction qui contourne ce mécanisme pour aller plus vite
sera refusée, même si elle passe les tests : c'est le filet qui rattrape le contrôleur qui
oublie sa vérification.

Le **worker écrit sous le contexte de l'exécution**, jamais avec le rôle propriétaire. Écrire
directement serait plus court et priverait les journaux et les résultats du cloisonnement que
tout le reste de l'application respecte.
