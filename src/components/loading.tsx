import styles from "./generation/workspace.module.css";

export default function Loading() {
  return (
    <section className={styles.workspace} aria-label="Loading repository">
      <span className="sr-only" role="status">
        Loading diagram
      </span>
    </section>
  );
}
