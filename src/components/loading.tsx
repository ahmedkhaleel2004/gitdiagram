import { ActivityMark } from "./generation/generation-feedback";
import styles from "./generation/workspace.module.css";

export default function Loading() {
  return (
    <section className={styles.workspace} aria-label="Loading repository">
      <div className={styles.work}>
        <div className={styles.source} aria-hidden="true">
          <div className={styles.repositoryControl}>
            <span className="h-3 w-36 rounded-sm bg-current opacity-10" />
          </div>
        </div>
        <div className={styles.feedback} role="status">
          <div className={styles.statusLine}>
            <ActivityMark />
            <h2 className={styles.statusTitle}>Opening your diagram</h2>
          </div>
        </div>
      </div>
    </section>
  );
}
