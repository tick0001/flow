import { useTranslation } from 'react-i18next';
import type { ExecutionArtifact } from '@/lib/types';
import { Card, CardBody, CardHeader, LinkButton, SectionTitle } from '@/components/ui/primitives';

/**
 * Taille lisible.
 *
 * En unites rondes : personne ne compare deux traces a l'octet pres, et
 * « 4 187 213 octets » demande de compter les chiffres pour savoir si c'est
 * beaucoup.
 */
function tailleLisible(octets: number): string {
  if (octets < 1024) return `${String(octets)} o`;
  if (octets < 1024 * 1024) return `${(octets / 1024).toFixed(0)} Ko`;

  return `${(octets / (1024 * 1024)).toFixed(1)} Mo`;
}

/**
 * Ce qu'une execution a laisse derriere elle.
 *
 * **Trois natures, trois traitements.** Une capture se montre -- c'est la
 * premiere chose qu'on regarde devant un echec. Une trace se telecharge, parce
 * qu'elle s'ouvre dans l'outil de Playwright et qu'aucune mise en page maison ne
 * remplacerait un rejeu action par action. Un fichier depose appartient au bot :
 * le coeur ne sait rien de sa forme et se garde d'en presumer.
 *
 * Aucune adresse n'est construite ici a partir d'un chemin de stockage : chaque
 * piece se demande par son identifiant, sur une route qui verifie le
 * cloisonnement.
 */
export function PiecesDExecution({
  executionId,
  pieces,
}: {
  executionId: string;
  pieces: ExecutionArtifact[];
}) {
  const { t } = useTranslation();

  if (pieces.length === 0) return null;

  const adresse = (piece: ExecutionArtifact): string =>
    `/api/executions/${executionId}/artifacts/${piece.id}`;

  const capture = pieces.find((piece) => piece.kind === 'screenshot');
  const trace = pieces.find((piece) => piece.kind === 'trace');
  const fichiers = pieces.filter((piece) => piece.kind === 'output');

  return (
    <Card>
      <CardHeader title={t('executions.pieces')} />
      <CardBody className="space-y-5">
        {capture && (
          <div className="space-y-2">
            <SectionTitle>{t('executions.capture')}</SectionTitle>
            <p className="text-muted text-xs">{t('executions.captureAide')}</p>
            {/* Ouvrable en grand dans un onglet : une capture de page entiere
                est haute, et la reduire a la largeur de la carte rend le texte
                des champs illisible -- or c'est souvent lui qu'on vient lire. */}
            <a href={adresse(capture)} target="_blank" rel="noreferrer">
              <img
                src={adresse(capture)}
                alt={t('executions.capture')}
                className="border-line bg-sunken max-h-96 w-full border object-cover object-top"
              />
            </a>
          </div>
        )}

        {trace && (
          <div className="space-y-2">
            <SectionTitle>{t('executions.trace')}</SectionTitle>
            <p className="text-muted text-xs">{t('executions.traceAide')}</p>
            <LinkButton href={adresse(trace)} download={trace.name}>
              {t('executions.telecharger')} · {tailleLisible(trace.sizeBytes)}
            </LinkButton>
          </div>
        )}

        {fichiers.length > 0 && (
          <div className="space-y-2">
            <SectionTitle>{t('executions.fichiers')}</SectionTitle>
            <ul className="divide-line border-line divide-y border">
              {fichiers.map((fichier) => (
                <li
                  key={fichier.id}
                  className="flex flex-wrap items-baseline justify-between gap-3 px-3 py-2"
                >
                  <span className="text-ink min-w-0 font-mono text-xs break-all">
                    {fichier.name}
                  </span>
                  <span className="flex items-baseline gap-3">
                    <span className="text-faint text-xs">{tailleLisible(fichier.sizeBytes)}</span>
                    <a
                      href={adresse(fichier)}
                      download={fichier.name}
                      className="text-brand-ink text-xs font-medium hover:underline"
                    >
                      {t('executions.telecharger')}
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
