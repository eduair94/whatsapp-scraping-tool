import { useMemo } from 'react';
import { countryName } from '../format';
import { Checker } from '../useChecker';

/** The country that numbers written without a country code belong to. */
export function CountrySelect({ app, id }: { app: Checker; id: string }) {
  const options = useMemo(
    () => app.countries.map((code) => ({ code, name: countryName(code) })).sort((a, b) => a.name.localeCompare(b.name)),
    [app.countries]
  );
  return (
    <select
      id={id}
      className="input"
      value={app.settings?.defaultCountry ?? 'US'}
      onChange={(event) => void app.saveSettings({ defaultCountry: event.target.value })}
    >
      {options.map((o) => (
        <option key={o.code} value={o.code}>
          {o.name}
        </option>
      ))}
    </select>
  );
}
