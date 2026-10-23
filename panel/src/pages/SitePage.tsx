import { Link, useParams } from 'react-router'
import { api } from '../api'
import { formatDate } from '../statuses'
import type { ProjectSummaryRecord } from '../types'
import { useLoad } from '../useLoad'

export function SitePage() {
  const siteId = useParams().id ?? ''
  const { data: record, error, loading } = useLoad(() => api.siteSummary(siteId), [siteId])

  return (
    <>
      <p>
        <Link to="/sites">← All sites</Link>
      </p>
      {loading && <p className="muted">Loading…</p>}
      {error && (
        <section className="card">
          <h1>{siteId}</h1>
          <p className="error">{error}</p>
          <p className="muted">
            Run the Project Indexer: <code>docker compose exec agents index-site {siteId}</code>
          </p>
        </section>
      )}
      {record && <Summary record={record} />}
    </>
  )
}

function Summary({ record }: { record: ProjectSummaryRecord }) {
  const { summary, stats } = record

  return (
    <>
      <section className="card">
        <h1>{summary.site_name}</h1>
        <p className="muted">
          {summary.framework} · indexed {formatDate(record.createdAt)} from <code>{record.sourceRef}</code>
        </p>
        <p>{summary.overview}</p>
        <p className="muted small">
          {record.model} · {stats.turns} turns · {stats.model_calls} model calls · {stats.input_tokens?.toLocaleString()}{' '}
          input / {stats.output_tokens?.toLocaleString()} output tokens · {stats.duration_seconds}s
        </p>
      </section>

      <section className="card">
        <h2>Pages</h2>
        {summary.pages.map((page) => (
          <div key={page.route} className="summary-block">
            <h3>
              {page.title} <code>{page.route}</code>
            </h3>
            <p className="muted small">
              <code>{page.file}</code>
            </p>
            <ul>
              {page.sections.map((section) => (
                <li key={section.name}>
                  <strong>{section.name}</strong>
                  {section.component_file ? (
                    <>
                      {' '}
                      <code>{section.component_file}</code>
                    </>
                  ) : (
                    <span className="muted"> (inline)</span>
                  )}
                  : {section.description}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Where the content lives</h2>
        <dl className="fields">
          {summary.content_locations.map((location) => (
            <div key={location.content + location.file} className="field-row">
              <dt>{location.content}</dt>
              <dd>
                <code>{location.file}</code> — {location.how_to_edit}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="card">
        <h2>Shared components</h2>
        <ul>
          {summary.shared_components.map((component) => (
            <li key={component.file}>
              <code>{component.file}</code>: {component.purpose}
            </li>
          ))}
        </ul>

        <h2>Styling</h2>
        <p>{summary.styling.approach}</p>
        <ul>
          {summary.styling.colors.map((color) => (
            <li key={color}>{color}</li>
          ))}
          {summary.styling.fonts.map((font) => (
            <li key={font}>{font}</li>
          ))}
        </ul>

        {summary.notes.length > 0 && (
          <>
            <h2>Notes</h2>
            <ul>
              {summary.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  )
}
