import MainCard from "~/components/main-card";
import Hero from "~/components/hero";

export default function HomePage() {
  return (
    <main className="flex-grow px-6 md:p-6">
      <div className="mx-auto mb-4 max-w-4xl lg:my-8">
        <Hero />
        <div className="mt-12"/>
        <p className="mx-auto mt-8 max-w-2xl text-center text-md">
          Turn any <b>GitHub</b> repository into an interactive diagram for
          visualization.
        </p>
        <p className="mx-auto mt-1 max-w-2xl text-center text-md">
          This is useful for quickly visualizing projects.
        </p>
        <p className="mx-auto mt-2 max-w-2xl text-center text-md">
          You can also replace <i>&apos;hub&apos;</i> with <i>&apos;diagram&apos;</i> in any
          Github Repository URL
        </p>
        <p className="mx-auto my-2 max-w-2xl text-center text-md">
          You can also add <i>&apos;?branch=branch_name&apos;</i> to the URL to
          visualize a specific branch.
        </p>
      </div>
      <div className="mb-20 pb-10 flex justify-center lg:mb-0">
        <MainCard />
      </div>
    </main>
  );
}
