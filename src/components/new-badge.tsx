/** Marks something new: the explainer videos, while they are fresh. */
export function NewBadge({ className = "" }: { className?: string }) {
  return <span className={`new-badge ${className}`}>NEW</span>;
}
