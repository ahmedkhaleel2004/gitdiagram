import Link from "next/link";

export function Footer() {
  return (
    <footer className="mt-auto border-t-[3px] border-black py-4 lg:px-8 dark:border-black">
      <div className="container mx-auto flex h-8 max-w-4xl items-center justify-center">
        <span className="text-sm font-medium text-black dark:text-neutral-100">
          Made by{" "}
          <Link
            href="https://ahmedkhaleel.com"
            className="neo-link hover:underline"
          >
            Ahmed Khaleel
          </Link>
        </span>
      </div>
    </footer>
  );
}
