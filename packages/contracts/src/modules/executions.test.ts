import { describe, expect, it } from 'vitest';
import {
  TERMINAL_STATUSES,
  executionEventSchema,
  executionStatusSchema,
  isTerminal,
  logLevelSchema,
} from './executions.js';

describe('statuts d’exécution', () => {
  /**
   * L'invariant qui compte : tout statut est soit terminal, soit explicitement
   * reconnu comme en cours. Ajouter un statut sans le classer fait echouer ce
   * test -- ce qui est le but. Sans lui, un nouveau statut passerait pour
   * non terminal par defaut, la purge l'epargnerait et le balayage des
   * executions orphelines le fermerait, chacun pour de mauvaises raisons.
   */
  it('classe chaque statut, sans en oublier', () => {
    const enCours = ['queued', 'running'];
    const tous = executionStatusSchema.options;

    for (const statut of tous) {
      const terminal = isTerminal(statut);
      expect(
        terminal !== enCours.includes(statut),
        `le statut « ${statut} » n'est ni classe terminal ni classe en cours`,
      ).toBe(true);
    }

    expect(TERMINAL_STATUSES.length + enCours.length).toBe(tous.length);
  });

  it('distingue une interruption demandée d’un abandon', () => {
    // Les deux sont terminaux, mais ce sont deux faits differents : l'un vient
    // d'une personne, l'autre d'un worker disparu.
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('abandoned')).toBe(true);
    expect(executionStatusSchema.safeParse('cancelled').success).toBe(true);
    expect(executionStatusSchema.safeParse('abandoned').success).toBe(true);
  });
});

describe('niveaux de journal', () => {
  it('reste une échelle de gravité', () => {
    // `success` n'en fait pas partie, et c'est deliberé : ce n'est pas une
    // gravite, et sa presence rendrait « a partir de l'avertissement » ambigu.
    expect(logLevelSchema.options).toEqual(['debug', 'info', 'warning', 'error']);
    expect(logLevelSchema.safeParse('success').success).toBe(false);
  });
});

describe('événements d’exécution', () => {
  const executionId = '5f8d0d55-b7a6-4f0e-9a1d-2c3b4a5d6e7f';

  it('accepte une progression sans pourcentage', () => {
    // Un bot qui sait ou il en est sans savoir combien il reste doit pouvoir le
    // dire. Exiger un pourcentage le pousserait a en inventer un.
    const resultat = executionEventSchema.safeParse({
      kind: 'progress',
      payload: { executionId, percent: null, step: 'connexion' },
    });
    expect(resultat.success).toBe(true);
  });

  it('refuse un événement dont la charge ne correspond pas au genre', () => {
    const resultat = executionEventSchema.safeParse({
      kind: 'log',
      payload: { executionId, percent: 10, step: 'connexion' },
    });
    expect(resultat.success).toBe(false);
  });
});
