import styles from "./workspace.module.css";

/** The 3×3 pixel mark that pulses while GitDiagram is working. */
export function ActivityMark({ active = true }: { active?: boolean }) {
  return (
    <span
      className={styles.activityMark}
      data-active={active}
      aria-hidden="true"
    >
      {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((dot) => (
        <i key={dot} />
      ))}
    </span>
  );
}
