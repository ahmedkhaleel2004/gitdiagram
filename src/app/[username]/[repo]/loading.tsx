import Loading from "~/components/loading";

export default function RepoLoading() {
  return (
    <div className="flex flex-col items-center p-4">
      <div className="flex w-full justify-center pt-8" aria-hidden="true">
        <div className="flex w-full max-w-[880px] gap-2 py-4 sm:py-6">
          <div className="h-[46px] flex-1 animate-pulse rounded-[10px] border border-purple-200/60 bg-white/40 motion-reduce:animate-none dark:border-white/10 dark:bg-white/5" />
          <div className="h-[46px] w-24 animate-pulse rounded-[10px] bg-purple-300/30 motion-reduce:animate-none dark:bg-purple-300/15" />
        </div>
      </div>
      <div className="mt-8 flex w-full justify-center">
        <Loading status="idle" />
      </div>
    </div>
  );
}
