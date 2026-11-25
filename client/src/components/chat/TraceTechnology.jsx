import { Brand, BrandText } from '../Brand.jsx';
/**
 * The Trace's "Technology and services" tab (#595): the AI model and every
 * outside service plato uses, what each is sent, and which ones this
 * classroom has turned on. `services` is lib/traceView.js technologyFor(...).
 */
function Service({ s }) {
  return (
    <li className="rounded-md border border-border bg-background p-3 space-y-1">
      <h4 className="text-sm font-semibold">{s.name}</h4>
      <p className="text-sm">{s.role}</p>
      <p className="text-sm"><span className="font-medium">What it is sent:</span> {s.sent}</p>
      {s.detail && <p className="text-sm">{s.detail}</p>}
      {s.note && <p className="text-xs text-muted-foreground"><BrandText>{s.note}</BrandText></p>}
    </li>
  );
}

export default function TraceTechnology({ services }) {
  const used = services.filter((s) => s.inUse);
  const unused = services.filter((s) => !s.inUse);
  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted-foreground">
        The technology behind <Brand />, and what is shared with each service. <Brand /> has no analytics or tracking.
      </p>
      <section aria-labelledby="trace-tech-used" className="space-y-2">
        <h3 id="trace-tech-used" className="font-semibold">Used by this classroom</h3>
        <ul className="space-y-2">{used.map((s) => <Service key={s.id} s={s} />)}</ul>
      </section>
      {unused.length > 0 && (
        <section aria-labelledby="trace-tech-unused" className="space-y-2">
          <h3 id="trace-tech-unused" className="font-semibold">Not turned on here</h3>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {unused.map((s) => <li key={s.id}>{s.name}: used only {s.when}.</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
