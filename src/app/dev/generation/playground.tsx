"use client";

import { useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { loadDiagramRenderer } from "~/components/generation/load-diagram-renderer";
import { ConceptWorkspace } from "./concept-workspace";
import { PreviewControls } from "./preview-controls";
import { APPROACHES, usePreview, type Approach } from "./use-preview";
import styles from "./playground.module.css";

export default function GenerationPlayground({
  focused = false,
  initialApproach = "inline",
}: {
  focused?: boolean;
  initialApproach?: Approach;
}) {
  const [showControls, setShowControls] = useState(!focused);
  const [approach, setApproach] = useState<Approach>(initialApproach);
  const { preview, stream, terminal, dispatch } = usePreview();
  useEffect(() => {
    void loadDiagramRenderer();
  }, []);

  function chooseApproach(value: Approach) {
    setApproach(value);
    const url = new URL(window.location.href);
    url.searchParams.set("approach", value);
    window.history.replaceState(null, "", url);
  }

  return (
    <main
      className={styles.tester}
      data-generation-tester
      data-controls={showControls}
    >
      <div className={styles.topline}>
        <h1>Generation preview</h1>
        <span>Local demo · no credits used</span>
      </div>
      <div className={styles.designBar}>
        <fieldset className={styles.approaches}>
          <legend className="sr-only">Design approach</legend>
          {APPROACHES.map((item) => (
            <label
              key={item.id}
              className={styles.approach}
              data-selected={approach === item.id}
            >
              <input
                type="radio"
                name="approach"
                value={item.id}
                checked={approach === item.id}
                onChange={() => chooseApproach(item.id)}
              />
              <span>{item.label}</span>
            </label>
          ))}
        </fieldset>
        <button
          type="button"
          className={styles.controlsToggle}
          aria-label="Preview controls"
          onClick={() => setShowControls((value) => !value)}
          aria-expanded={showControls}
          aria-controls="preview-controls"
        >
          <SlidersHorizontal size={14} aria-hidden="true" />
          <span>Controls</span>
        </button>
      </div>
      <p className={styles.caption}>
        {APPROACHES.find((item) => item.id === approach)?.description}
      </p>
      {showControls && (
        <PreviewControls
          preview={preview}
          terminal={terminal}
          dispatch={dispatch}
        />
      )}
      <ConceptWorkspace
        runId={preview.runId}
        approach={approach}
        stream={stream}
        seconds={preview.seconds}
        started={preview.started}
        paused={!preview.playing || terminal}
        cancelled={preview.cancelled}
        stalled={preview.scenario === "stalled"}
        previousDiagram={preview.previousDiagram}
        onStart={() => dispatch({ type: "play" })}
        onCancel={() => dispatch({ type: "cancel" })}
        onRegenerate={() => dispatch({ type: "regenerate" })}
      />
      <p className={styles.footerNote}>
        Switch designs at any point. Your place in the preview stays the same.
      </p>
    </main>
  );
}
