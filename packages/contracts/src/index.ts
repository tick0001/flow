/**
 * Contrats partages entre l'API, le worker, l'interface et les extensions.
 *
 * Tout ce qui traverse une frontiere de processus est decrit ici une seule fois,
 * sous forme de schema Zod, dont les types TypeScript sont deduits. Un schema est
 * a la fois la documentation, la validation a l'execution et le type statique :
 * les trois ne peuvent pas diverger.
 *
 * Flow& a trois processus et non deux -- l'API, le worker et le navigateur --, si
 * bien que ce paquet porte plus que des formes de requetes HTTP : les messages
 * publies dans Redis et les manifestes charges par le worker passent par les
 * memes schemas.
 */
export * from './modules/common.js';
export * from './modules/executions.js';
export * from './modules/queue.js';
export * from './modules/bots.js';
export * from './modules/auth.js';
export * from './modules/admin.js';
