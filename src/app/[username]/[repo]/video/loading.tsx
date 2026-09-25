import controls from "~/components/generation/workspace.module.css";
import styles from "~/components/explainer/explainer-video.module.css";

/** The watch page's own loading state; the repo one announces a diagram. */
export default function VideoLoading() {
  return (
    <section
      className={`${controls.workspace} ${styles.watch}`}
      aria-label="Loading video"
    >
      <span className="sr-only" role="status">
        Loading video
      </span>
    </section>
  );
}
