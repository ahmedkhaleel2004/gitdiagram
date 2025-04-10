import MainCard from "~/components/main-card";
import Hero from "~/components/hero";

export default function HomePage() {
  return (
    <main className="flex-grow px-8 pb-8 md:p-8">
      <div className="mx-auto mb-4 max-w-4xl sm:my-16 lg:my-8">
        <Hero />
        <div className="mt-12"></div>
        <p className="mx-auto mt-8 max-w-2xl text-center text-lg">
          Turn any GitHub repository into an interactive diagram for
          visualization.
        </p>
        <p className="mx-auto mt-0 max-w-2xl text-center text-lg">
          This is useful for quickly visualizing projects.
        </p>
        <p className="mx-auto mt-2 max-w-2xl text-center text-lg">
          You can also replace &apos;hub&apos; with &apos;diagram&apos; in any
          Github URL
        </p>
      </div>
      <div className="mb-16 flex justify-center lg:mb-0">
        <MainCard />
      </div>
    </main>
  );
}
