import type { WaterSamplingFieldData } from '../lib/api'

/** Formatta un numero con la virgola decimale italiana. */
function formatNumber(value: number, unit?: string): string {
  const formatted = value.toLocaleString('it-IT', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  })
  return unit ? `${formatted} ${unit}` : formatted
}

/** ISO 8601 (2026-08-05) → formato italiano (05/08/2026). */
function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  return year && month && day ? `${day}/${month}/${year}` : iso
}

interface Row {
  label: string
  value: string | null
}

function buildRows(data: WaterSamplingFieldData): Row[] {
  return [
    { label: "Corso d'Acqua", value: data.corso_acqua },
    {
      label: 'Data di Prelievo',
      value: data.data_prelievo ? formatDate(data.data_prelievo) : null,
    },
    {
      label: "Temperatura dell'Acqua",
      value:
        data.temperatura_acqua_c !== null
          ? formatNumber(data.temperatura_acqua_c, '°C')
          : null,
    },
    {
      label: 'pH',
      value: data.ph !== null ? formatNumber(data.ph, 'U pH') : null,
    },
    {
      label: 'Ossigeno Disciolto',
      value:
        data.ossigeno_disciolto_mg_l !== null
          ? formatNumber(data.ossigeno_disciolto_mg_l, 'mg/l')
          : null,
    },
  ]
}

/**
 * Parametri da campo del verbale di campionamento, resi come lista
 * etichetta/valore. I campi non trovati restano visibili come "Non rilevato":
 * in un verbale ambientale l'assenza di un dato è essa stessa un'informazione.
 */
export function FieldDataCard({ data }: { data: WaterSamplingFieldData }) {
  const rows = buildRows(data)

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-sm font-semibold text-neutral-900">
          Parametri da campo
        </h4>
        <span className="shrink-0 text-[11px] text-neutral-400">
          Verbale di campionamento acque
        </span>
      </div>

      <dl className="mt-3 divide-y divide-neutral-100">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-baseline justify-between gap-4 py-2"
          >
            <dt className="text-sm text-neutral-500">{row.label}</dt>
            <dd
              className={
                row.value !== null
                  ? 'text-right text-sm font-medium text-neutral-900'
                  : 'text-right text-sm italic text-neutral-400'
              }
            >
              {row.value ?? 'Non rilevato'}
            </dd>
          </div>
        ))}
      </dl>

      {!data.has_any_value && (
        <p className="mt-3 border-t border-neutral-100 pt-3 text-xs text-neutral-400">
          Nessun parametro compilato nel documento: il file analizzato è un
          modulo in bianco oppure un verbale di tipo diverso.
        </p>
      )}
    </div>
  )
}
