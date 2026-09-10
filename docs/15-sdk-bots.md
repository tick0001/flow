# Écrire un bot

Un bot est du code : des métadonnées, un schéma de paramètres, et une fonction qui reçoit une page
de navigateur. Ce document dit comment en écrire un, et pourquoi le SDK est fait ainsi.

## 1. Le plus court bot possible

```ts
import { defineBot, z } from '@flow/bot-sdk';

export default defineBot({
  id: 'monorg.titre',
  name: 'Titre de page',
  version: '1.0.0',
  parameters: z.object({
    url: z.url().describe('Adresse de la page à ouvrir.'),
  }),

  async run({ params, page, log }) {
    await page.goto(params.url);
    const titre = await page.title();

    log('info', `Titre : ${titre}`);

    return { message: titre, output: { titre } };
  },
});
```

Le bot de référence [`bots/exemple-bonjour`](../bots/exemple-bonjour) exerce chaque point du SDK et
tourne en test permanent : si le contrat casse, c'est lui qui le dit.

## 2. La `Page` est une vraie `Page` Playwright

Pas une façade. C'est le choix central de Flow&, et il se comprend par ce qu'il remplace :
`BotManager` interposait une interface de **soixante-dix méthodes** pour rendre Playwright et
Selenium interchangeables.

Le prix était visible dans le code : chaque méthode redéléguée à la main dans le décorateur de
diffusion d'images, une implémentation Selenium qui ne tenait pas le contrat — `GetPdfAsync` levait
`NotSupportedException` — et les locators, l'attente automatique, l'interception réseau et le
tracing rendus inatteignables.

Cette interchangeabilité n'a jamais servi. Ce qui sert, c'est tout ce que la façade masquait.

Un bot dispose donc de **tout Playwright**, sa documentation comprise. Le SDK n'ajoute que ce que
Playwright ne fournit pas : de quoi raconter ce qu'on fait, et de quoi s'arrêter quand on le demande.

## 3. Le schéma Zod est la seule description des paramètres

Il sert à trois choses à la fois :

- **valider** à l'exécution, avant la mise en file — un paramètre fautif est un refus immédiat et
  non une exécution qui échoue trente secondes plus tard ;
- **typer** `params` à la compilation, sans que vous les redécriviez ;
- **dessiner le formulaire**, par le JSON Schema qui en est dérivé.

`BotManager` avait un type `BotParameter` avec un énuméré de contrôles et une expression régulière
de validation : un langage de description de formulaire réinventé à côté du système de types, et les
deux pouvaient se contredire.

**`.describe()` n'est pas décoratif** : le texte devient l'aide affichée sous le champ. Un paramètre
sans description arrive à l'écran sans explication.

## 4. Le manifeste est produit à la construction

```json
{
  "scripts": {
    "build": "tsup && flow-bot manifeste dist/index.js"
  }
}
```

`flow-bot manifeste` importe votre module **sur votre machine**, en dérive le manifeste et écrit
`flow.bot.json` à côté. C'est ce fichier que le serveur lit.

Ce détour a une raison, et c'est la plus importante du dispositif : **l'API n'importe jamais le code
d'un bot**. Déposer un bot revient à exécuter son auteur, et rien n'oblige à le faire dans le
processus qui détient les identifiants de la base. Seul le worker importe le module, et seulement
pour l'exécuter.

C'est aussi ce qui permet de déposer un bot **sans rien recompiler** : un dossier, son
`flow.bot.json`, et il apparaît au catalogue après une relecture.

## 5. Le contexte d'exécution

| Champ       | À quoi il sert                                                       |
| ----------- | -------------------------------------------------------------------- |
| `params`    | Vos paramètres, déjà validés et typés                                |
| `page`      | La `Page` Playwright du contexte navigateur isolé de cette exécution |
| `log`       | Une ligne de journal horodatée, persistée au fil de l'eau            |
| `progress`  | L'étape en cours, avec un pourcentage facultatif                     |
| `signal`    | L'annulation demandée                                                |
| `outputDir` | Où déposer ce qui doit survivre : captures, exports                  |

**Pas de `console.log`.** La sortie du worker est partagée par toutes les exécutions en cours :
personne ne pourrait dire laquelle a écrit quoi.

**Le pourcentage est facultatif.** Beaucoup de bots savent nommer leur étape sans savoir combien il
reste ; exiger un chiffre pousse à en inventer un, et une barre qui recule est pire qu'une barre
absente.

**Vérifiez `signal` entre deux étapes.** Un bot qui l'ignore sera interrompu de toute façon par la
fermeture de son contexte navigateur — mais brutalement, sans pouvoir refermer ce qu'il avait
ouvert.

## 6. La version du SDK

Le manifeste porte la **majeure** du SDK, vérifiée au chargement. Un bot écrit pour une majeure que
l'installation ne sert plus est refusé avec ce motif — et reste **visible au catalogue**, avec son
explication. Le faire disparaître enverrait chercher dans les journaux du conteneur une réponse qui
tient en une ligne à l'écran.

Le SDK est en `0.x` et **peut rompre entre versions mineures**. Il ne se figera qu'une fois chaque
point exercé par un usage réel ; le bot de référence ne suffit pas à prouver qu'une interface est
bonne.

## 7. Ce que le SDK ne fera pas

**Vous mettre dans un bac à sable.** Un bot est du code arbitraire exécuté par le worker : c'est la
nature du produit. La frontière de confiance passe au dépôt d'un bot, pas à son exécution — voir
[SECURITY.md](../SECURITY.md).

**Vous fournir des briques hors navigateur** — appels d'API, fichiers, bases de données. Vous
pouvez les faire dans votre propre code ; l'application n'en fournit pas, sans quoi elle deviendrait
un ordonnanceur généraliste et perdrait ce qui la rend utile.

**Vous protéger d'un site qui change.** Aucun outil ne le fait. Écrivez des sélecteurs qui décrivent
l'intention plutôt que la structure, et journalisez assez pour qu'un échec se diagnostique sans
rejouer.
