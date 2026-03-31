import { useState, useEffect } from 'react';
import { fetchAffiliations } from '../api';

export default function AffiliationSelect({
  id,
  value,
  onChange,
  emptyLabel = 'None',
  label,
  showLabel = true,
  style,
  className = '',
}) {
  const [affiliations, setAffiliations] = useState([]);

  useEffect(() => {
    fetchAffiliations().then(setAffiliations);
  }, []);

  return (
    <div className={showLabel ? 'form-group' : ''}>
      {showLabel && label && (
        <label htmlFor={id}>{label}</label>
      )}
      {!showLabel && label && (
        <label htmlFor={id} className="sr-only">{label}</label>
      )}
      <select
        id={id}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        style={style}
        className={className}
      >
        <option value="">{emptyLabel}</option>
        {affiliations.map((a) => (
          <option key={a} value={a}>{a}</option>
        ))}
      </select>
    </div>
  );
}
