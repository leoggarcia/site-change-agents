import { Link } from 'react-router'
import { api } from '../api'
import { Icon } from '../components/Icon'
import { PageHeader, Skeleton } from '../components/States'
import { useLoad } from '../useLoad'

export function SitesPage() {
  const { data: sites, error, loading } = useLoad(api.sites)

  return (
    <section>
      <PageHeader title="Sites" subtitle="Each site's project summary is written by the Project Indexer agent." />
      {error && <p className="error">{error}</p>}
      <section className="card list-card">
        {loading && !sites && <Skeleton rows={3} />}
        <ul className="ticket-list">
          {sites?.map((site) => (
            <li key={site.id}>
              <Link to={`/sites/${site.id}`} className="ticket-row">
                <span>
                  <strong>{site.name}</strong>
                  <span className="meta">
                    <span className="mono">{site.id}</span> · {site.clientName} · {site.plan} plan
                  </span>
                </span>
                <span className="muted" aria-hidden="true">
                  <Icon name="chevron" size={16} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </section>
  )
}
