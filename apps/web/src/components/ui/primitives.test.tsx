import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Checkbox, Field, Pastille } from './primitives';

describe('Field', () => {
  it('associe l’étiquette au contrôle qu’il enveloppe', () => {
    // Sans cette association, cliquer sur l'étiquette ne donne pas le focus au
    // champ, et un lecteur d'écran annonce un champ sans nom.
    render(
      <Field label="Adresse">
        <input />
      </Field>,
    );

    expect(screen.getByLabelText('Adresse')).toBeInTheDocument();
  });

  it('déclare un groupe en fieldset, et non en label', () => {
    // Le piège que `groupe` existe pour éviter : un `<label>` s'associe à un seul
    // contrôle. Trois cases logées dans un label produisent des étiquettes
    // imbriquées — interdites par la norme — et, à l'usage, un clic sur la
    // troisième case qui bascule aussi la première.
    render(
      <Field label="Navigateurs" groupe>
        <Checkbox label="Chromium" />
        <Checkbox label="Firefox" />
      </Field>,
    );

    const groupe = screen.getByRole('group', { name: 'Navigateurs' });

    expect(groupe.tagName).toBe('FIELDSET');
    expect(screen.getByLabelText('Chromium')).toBeInTheDocument();
    expect(screen.getByLabelText('Firefox')).toBeInTheDocument();
  });
});

describe('Pastille', () => {
  it('n’expose que son libellé au texte accessible', () => {
    // Le point coloré est décoratif : il redit ce que le mot dit déjà. Sans
    // `aria-hidden`, un lecteur d'écran annoncerait une image sans nom avant
    // chaque état, sur chaque ligne d'une liste de quarante exécutions.
    const { container } = render(<Pastille ton="critique">En échec</Pastille>);

    expect(screen.getByText('En échec')).toBeInTheDocument();
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
  });
});
