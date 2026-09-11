export default function RepoLoading() {
  return (
    <div className="flex flex-col items-center p-4" aria-live="polite">
      <div className="flex w-full justify-center pt-8">
        <div className="neo-panel w-full max-w-3xl rounded-lg p-4 sm:p-8">
          <div className="h-12 animate-pulse rounded-md bg-purple-200/70 dark:bg-white/10" />
          <p className="mt-5 text-sm font-semibold text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
            Loading repository diagram...
          </p>
        </div>
      </div>
    </div>
  );
}
