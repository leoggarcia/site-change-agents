import { Link } from 'react-router'
import { api } from '../api'
import { useLoad } from '../useLoad'

export function SitesPage() {
  const { data: sites, error, loading } = useLoad(api.sites)

  return (
    <section>
      <h1>Sites</h1>
      <p className="muted">Each site's project summary is written by the Project Indexer agent.</p>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error">{error}</p>}
      <ul className="ticket-list">
        {sites?.map((site) => (
          <li key={site.id}>
            <Link to={`/sites/${site.id}`} className="card ticket-card">
              <div>
                <strong>{site.name}</strong>
                <span className="muted">
                  {site.id} · {site.plan} plan
                </span>
              </div>
              <span aria-hidden="true">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
