import { Fragment } from "react";
import { ChevronDown } from "lucide-react";
import type { RelatedDiagrams } from "~/features/browse/related";
import {
  entryPointNames,
  type DiagramReadout,
} from "~/features/diagram/readout";
import { architectureLines } from "./architecture-prose";
import { ReadmeBadgeLink } from "./readme-badge-link";
import theme from "./workspace.module.css";
import styles from "./readout.module.css";

function formatDate(value: string | null): string | null {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time)
    ? new Date(time).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      })
    : null;
}

/**
 * The stored diagram as readable text under the picture: the explanation,
 * then the components and connections behind collapsed disclosures. Rendered
 * on the server, so it is in the page's HTML for search engines and agents.
 * Hidden while the stored diagram is still being drawn and after a new run on
 * the page (readout.module.css), so the first screen is unchanged.
 */
export function RepositoryReadout({
  owner,
  repo,
  readout,
  markdownPath,
  related,
}: {
  owner: string;
  repo: string;
  readout: DiagramReadout;
  markdownPath: string;
  /** Other public diagrams in the same language (none: line left out). */
  related?: RelatedDiagrams | null;
}) {
  const repository = `${owner}/${repo}`;
  const date = formatDate(readout.lastSuccessfulAt);
  const entryNames = entryPointNames(
    readout.entryPoints.map((entry) => entry.path),
  );
  return (
    <section
      className={`${theme.controlsTheme} ${styles.readout}`}
      aria-labelledby="repository-readout-title"
      data-repository-readout
    >
      <h2 id="repository-readout-title" className={styles.title}>
        How {repository} works
      </h2>
      {readout.explanation && (
        <div className={styles.prose}>
          {architectureLines(readout.explanation, styles.subheading)}
        </div>
      )}
      {readout.entryPoints.length > 0 && (
        <p className={styles.entryPoints}>
          <span className={styles.entryPointsLabel}>Main entry points:</span>{" "}
          {readout.entryPoints.map((entry, index) => (
            <Fragment key={entry.path}>
              {index > 0 && (
                <span className={styles.entrySeparator}> &nbsp;·&nbsp; </span>
              )}
              <a
                href={entry.href}
                title={entry.path}
                target="_blank"
                rel="noopener noreferrer"
              >
                <code>{entryNames[index]}</code>
              </a>{" "}
              <span className={styles.entryLabel}>{entry.label}</span>
            </Fragment>
          ))}
        </p>
      )}
      {readout.groups.length > 0 && (
        <details className={styles.details}>
          <summary>
            Components{" "}
            <span className={styles.count}>{readout.componentCount}</span>
            <ChevronDown size={12} aria-hidden="true" />
          </summary>
          <div className={styles.detailBody}>
            {readout.groups.map((group) => (
              <div key={group.id ?? "ungrouped"} className={styles.group}>
                <h3>{group.label}</h3>
                {group.description && <p>{group.description}</p>}
                <ul>
                  {group.components.map((component) => (
                    <li key={component.id}>
                      {component.href ? (
                        <a
                          href={component.href}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {component.label}
                        </a>
                      ) : (
                        <strong>{component.label}</strong>
                      )}
                      {component.description && <> · {component.description}</>}
                      {component.path && (
                        <>
                          {" "}
                          <code>{component.path}</code>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      )}
      {readout.connections.length > 0 && (
        <details className={styles.details}>
          <summary>
            Connections{" "}
            <span className={styles.count}>{readout.connections.length}</span>
            <ChevronDown size={12} aria-hidden="true" />
          </summary>
          <div className={styles.detailBody}>
            <ul>
              {readout.connections.map((connection, index) => (
                <li key={index}>
                  <strong>{connection.from}</strong>
                  <span aria-label="to"> → </span>
                  <strong>{connection.to}</strong>
                  {connection.label && <>: {connection.label}</>}
                  {connection.description && <> · {connection.description}</>}
                  {connection.evidencePath && (
                    <>
                      {" "}
                      <code>{connection.evidencePath}</code>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}
      {related && (
        <p className={styles.related}>
          <span className={styles.relatedLabel}>
            More {related.language} diagrams:
          </span>{" "}
          {related.repositories.map((name, index) => (
            <Fragment key={name}>
              {index > 0 && " · "}
              <a href={`/${name}`}>{name}</a>
            </Fragment>
          ))}
        </p>
      )}
      <p className={styles.meta}>
        Drawn by GitDiagram
        {date && (
          <>
            {" "}
            on{" "}
            <time dateTime={readout.lastSuccessfulAt ?? undefined}>{date}</time>
          </>
        )}{" "}
        from the repository&apos;s file tree, README and source files.{" "}
        <a href={markdownPath} type="text/markdown">
          Read as Markdown
        </a>{" "}
        · <ReadmeBadgeLink owner={owner} repo={repo} />
      </p>
    </section>
  );
}
