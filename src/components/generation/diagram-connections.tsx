"use client";

import { useId, useState } from "react";
import { ChevronDown, GitBranch } from "lucide-react";
import type { DiagramGraph } from "~/features/diagram/graph";
import { connectionRows, evidenceUrl } from "./connection-rows";
import notes from "./generation.module.css";
import styles from "./diagram-connections.module.css";

/**
 * Mermaid arrows are not clickable, so this list is where each arrow shows the
 * file it was read from. Arrows without a cited file say so plainly.
 */
export function DiagramConnections({
  graph,
  repository,
}: {
  graph: DiagramGraph;
  repository: string;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const rows = connectionRows(graph);
  if (!rows.length) return null;
  const cited = rows.filter((row) => row.evidencePath).length;
  // Diagrams made before connections were checked have no field at all:
  // say that, instead of calling every arrow inferred.
  const unchecked = graph.edges.every(
    (edge) => edge.evidencePath === undefined,
  );
  return (
    <div className={notes.notes}>
      <button
        type="button"
        className={notes.notesToggle}
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded((value) => !value)}
      >
        <GitBranch size={15} aria-hidden="true" />
        <span>Connections</span>
        <span className={notes.notesState}>
          {unchecked
            ? `${rows.length}, not checked`
            : `${cited}/${rows.length} with evidence`}
        </span>
        <ChevronDown size={15} className={notes.chevron} aria-hidden="true" />
      </button>
      <div id={id} hidden={!expanded}>
        {expanded && unchecked && (
          <p className={`${notes.prose} ${styles.note}`}>
            This diagram was made before GitDiagram checked connections against
            the code. Regenerate it to see the file behind each arrow.
          </p>
        )}
        {expanded && (
          <ul
            className={`${notes.notesBody} ${notes.prose} ${styles.list}`}
            aria-label="Connections"
          >
            {rows.map((row) => {
              const url = row.evidencePath
                ? evidenceUrl(repository, row.evidencePath)
                : null;
              return (
                <li key={row.key}>
                  <strong>{row.from}</strong>
                  <span aria-label="to"> → </span>
                  <strong>{row.to}</strong>
                  {row.label && `: ${row.label}`}
                  {row.dashed && (
                    <span className={styles.dashed}> (dashed)</span>
                  )}
                  {!unchecked && (
                    <span className={styles.evidence}>
                      {" — "}
                      {row.evidencePath ? (
                        <>
                          evidence:{" "}
                          {url ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <code>{row.evidencePath}</code>
                            </a>
                          ) : (
                            <code>{row.evidencePath}</code>
                          )}
                        </>
                      ) : (
                        <span className={styles.unverified}>
                          no file cited; inferred
                        </span>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
