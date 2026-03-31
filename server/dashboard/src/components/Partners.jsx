import logoUic from '../assets/logo-uic.png';
import logoUll from '../assets/logo-ull.png';
import logoLatech from '../assets/logo-latech.png';
import logoWordpress from '../assets/logo-wordpress.png';

const partners = [
  { name: 'University of Illinois Chicago', logo: logoUic, url: 'https://www.uic.edu' },
  { name: 'University of Louisiana at Lafayette', logo: logoUll, url: 'https://www.louisiana.edu' },
  { name: 'Louisiana Tech University', logo: logoLatech, url: 'https://www.latech.edu' },
  { name: 'WordPress', logo: logoWordpress, url: 'https://wordpress.org' },
];

export default function Partners() {
  return (
    <div
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius)',
        padding: '14px 20px',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 20,
        flexWrap: 'wrap',
      }}
    >
      {partners.map((p) => (
        <a key={p.name} href={p.url} target="_blank" rel="noopener noreferrer">
          <img
            src={p.logo}
            alt={p.name}
            title={p.name}
            style={{ height: 36, width: 'auto', objectFit: 'contain', display: 'block' }}
          />
        </a>
      ))}
    </div>
  );
}
