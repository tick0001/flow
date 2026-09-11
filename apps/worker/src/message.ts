/**
 * Sequences d'echappement ANSI.
 *
 * Playwright colore ses messages d'erreur : « Timeout 30000ms exceeded » arrive
 * avec des codes de mise en forme pour un terminal. Ils ne sont pas visibles la
 * ou ils ont ete ecrits -- une console les interprete -- et le sont partout
 * ailleurs : en base, dans l'interface, dans un courriel de notification. Le
 * premier message qu'on lit devant un echec devient alors
 * « Call log: [2m - navigating to... [22m ».
 *
 * Le motif couvre toute la famille CSI et pas seulement la couleur : on ne veut
 * en garder aucune.
 */
// eslint-disable-next-line no-control-regex
const ANSI = /\u001B\[[0-?]*[ -/]*[@-~]/g;

/**
 * Caracteres de controle a retirer, tabulation et saut de ligne exceptes.
 *
 * Un message passe par une base, du JSON et du HTML : un octet nul ou un
 * retour chariot isole y produit des surprises sans rapport avec ce qui a
 * echoue. La tabulation et le saut de ligne restent, parce qu'une trace
 * multiligne se lit mieux avec.
 */
// eslint-disable-next-line no-control-regex
const CONTROLES = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Nettoie un message avant de l'ecrire.
 *
 * S'applique au journal comme au denouement, et pour la meme raison : ce texte
 * est ecrit par du code qu'on ne controle pas -- Playwright, une bibliotheque
 * tierce, le bot lui-meme -- et il sera lu ailleurs que dans un terminal.
 */
export function assainirMessage(message: string): string {
  return message.replace(ANSI, '').replace(CONTROLES, '');
}

/**
 * Nettoie et borne un message.
 *
 * La coupure est annoncee : une troncature muette ferait chercher longtemps
 * pourquoi un message s'arrete au milieu d'un mot.
 */
export function bornerMessage(message: string, maximum: number): string {
  const propre = assainirMessage(message);

  return propre.length > maximum ? `${propre.slice(0, maximum - 1)}…` : propre;
}
