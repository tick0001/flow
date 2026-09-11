/**
 * L'expression SQL qui reduit un message d'echec a sa signature.
 *
 * **C'est la piece centrale du pilotage.** Les messages d'echec ne se repetent
 * presque jamais a l'identique : ils portent une adresse, un delai, un
 * identifiant, un selecteur. Les regrouper tels quels donne deux cents lignes
 * uniques ou l'on ne voit rien -- alors qu'il n'y a souvent que trois causes.
 *
 * L'ordre des substitutions compte : les formes les plus specifiques d'abord.
 * Remplacer les nombres avant les identifiants transformerait un UUID en une
 * bouillie de tirets et de jetons, et deux UUID differents ne se regrouperaient
 * plus.
 *
 * Les nombres sont remplaces **sans exiger de frontiere de mot**. Une premiere
 * version en demandait une, et « Timeout 30000ms » ne se regroupait alors pas
 * avec « Timeout 45000ms » : le chiffre colle a son unite n'a pas de frontiere
 * apres lui. C'etait exactement le cas le plus frequent -- un delai d'attente --
 * et donc exactement celui qu'il fallait regrouper. Les identifiants et les
 * adresses etant deja remplaces a ce stade, il ne reste rien qu'un chiffre nu
 * puisse abimer.
 *
 * Calculee **a la lecture** et non stockee. Une colonne calculee serait plus
 * rapide, et demanderait une migration plus un remplissage a chaque fois qu'on
 * affine la regle -- or on l'affinera : les messages viennent de bibliotheques
 * qu'on ne controle pas. La periode est bornee et l'index sur l'entite et la
 * date fait le gros du tri ; le jour ou cela ne suffira plus, une colonne
 * generee prendra le relais sans que rien d'autre ne bouge.
 */
export const SIGNATURE_SQL = `
  regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(x.message,
              '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
              '<id>', 'g'),
            '(https?|file|data)://[^\\s"'')]+', '<adresse>', 'g'),
          '"[^"]*"', '<valeur>', 'g'),
        '«[^»]*»', '<valeur>', 'g'),
      '[0-9]+(\\.[0-9]+)?', '<n>', 'g'),
    '\\s+', ' ', 'g')
`;

/**
 * Ce que la signature remplace, pour l'expliquer a l'ecran et dans les tests.
 *
 * Ecrit ici plutot que dans le SQL : c'est la meme liste, et deux listes
 * finiraient par ne plus s'accorder.
 */
export const REMPLACEMENTS = [
  { quoi: 'identifiant', par: '<id>' },
  { quoi: 'adresse', par: '<adresse>' },
  { quoi: 'valeur entre guillemets', par: '<valeur>' },
  { quoi: 'nombre', par: '<n>' },
] as const;
