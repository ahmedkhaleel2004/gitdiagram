import LocalPageClient from "./local-page-client";

export default async function LocalPage({
  searchParams,
}: {
  searchParams: Promise<{ path?: string }>;
}) {
  const localPath = (await searchParams).path?.trim() ?? "";

  if (!localPath) {
    return (
      <main className="flex min-h-[calc(100svh-8.5rem)] items-center justify-center p-4">
        <div className="neo-panel max-w-xl !bg-[hsl(var(--neo-panel))] p-6 text-center">
          <h1 className="text-xl font-bold">Missing local path</h1>
          <p className="mt-2 text-sm text-[hsl(var(--neo-soft-text))]">
            Enable local mode and submit a repository folder from the home page.
          </p>
        </div>
      </main>
    );
  }

  return <LocalPageClient localPath={localPath} />;
}
