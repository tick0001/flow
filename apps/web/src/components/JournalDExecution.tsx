import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { heureLisible, TON_DU_NIVEAU } from '@/lib/executions';
import type { ExecutionLog, LogLevel } from '@/lib/types';
import { Badge, Button, Field, Input, SectionTitle, Select } from '@/components/ui/primitives';

/** Les gravites egales ou superieures a chacune. L'echelle a un sens. */
const A_PARTIR_DE: Record<LogLevel, LogLevel[]> = {
  debug: ['debug', 'info', 'warning', 'error'],
  info: ['info', 'warning', 'error'],
  warning: ['warning', 'error'],
  error: ['error'],
};

const NIVEAUX: LogLevel[] = ['debug', 'info', 'warning', 'error'];

/**
 * Le journal d'une execution, avec de quoi y retrouver une ligne.
 *
 * **Le filtrage se fait ici et non au serveur**, et c'est un choix : le client
 * tient deja toutes les lignes recues, et les redemander filtrees casserait le
 * flux -- il faudrait rouvrir la connexion a chaque frappe, et les lignes qui
 * arrivent pendant qu'on tape ne passeraient pas par le meme chemin.
 *
 * La route de journal accepte les memes filtres, et ils servent ailleurs : une
 * execution de dix mille lignes n'est pas entierement chargee, et c'est la que la
 * recherche indexee du serveur travaille. Ici, on cherche dans ce qu'on a sous
 * les yeux.
 */
export function JournalDExecution({ lignes, suivi }: { lignes: ExecutionLog[]; suivi: boolean }) {
  const { t, i18n } = useTranslation();
  const [niveau, setNiveau] = useState<LogLevel | ''>('');
  const [texte, setTexte] = useState('');

  const visibles = useMemo(() => {
    const gravites = niveau === '' ? null : A_PARTIR_DE[niveau];
    const cherche = texte.trim().toLocaleLowerCase();

    return lignes.filter((ligne) => {
      if (gravites && !gravites.includes(ligne.level)) return false;
      if (cherche && !ligne.message.toLocaleLowerCase().includes(cherche)) return false;

      return true;
    });
  }, [lignes, niveau, texte]);

  const filtre = niveau !== '' || texte.trim() !== '';

  return (
    <div className="space-y-2">
      <SectionTitle
        action={suivi ? <span className="text-faint text-xs">{t('executions.suivi')}</span> : null}
      >
        {t('executions.journal')}
      </SectionTitle>

      {lignes.length > 0 && (
        <div className="border-line bg-sunken flex flex-wrap items-end gap-3 border p-3">
          <Field label={t('executions.filtrerNiveau')} className="w-40">
            <Select
              value={niveau}
              onChange={(evenement) => {
                setNiveau(evenement.target.value as LogLevel | '');
              }}
            >
              <option value="">{t('executions.tousLesStatuts')}</option>
              {NIVEAUX.map((valeur) => (
                <option key={valeur} value={valeur}>
                  {valeur}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t('executions.filtrerTexte')} className="min-w-48 flex-1">
            <Input
              value={texte}
              placeholder={t('executions.filtrerJournal')}
              onChange={(evenement) => {
                setTexte(evenement.target.value);
              }}
            />
          </Field>

          {filtre && (
            <Button
              taille="sm"
              onClick={() => {
                setNiveau('');
                setTexte('');
              }}
            >
              {t('executions.filtrerEffacer')}
            </Button>
          )}

          {/* Le compte n'apparait que quand un filtre cache quelque chose :
              affiche en permanence, il deviendrait invisible a force. */}
          {filtre && (
            <span className="text-faint text-xs">
              {t('executions.lignesFiltrees', { visibles: visibles.length, total: lignes.length })}
            </span>
          )}
        </div>
      )}

      {lignes.length === 0 ? (
        <p className="text-faint text-sm">{t('executions.journalVide')}</p>
      ) : visibles.length === 0 ? (
        <p className="text-faint text-sm">{t('executions.filtrerAucunResultat')}</p>
      ) : (
        <div className="border-line bg-surface divide-line max-h-[28rem] divide-y overflow-y-auto border">
          {visibles.map((ligne) => (
            <div
              key={ligne.seq}
              className="flex items-baseline gap-3 px-3 py-1.5 font-mono text-xs"
            >
              <span className="text-faint tabular-nums">
                {heureLisible(ligne.at, i18n.language)}
              </span>
              <Badge ton={TON_DU_NIVEAU[ligne.level]}>{ligne.level}</Badge>
              <span className="text-ink min-w-0 break-words whitespace-pre-wrap">
                {ligne.message}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
