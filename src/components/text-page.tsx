export interface TextPageSection {
  heading: string;
  body: string[];
}

/** A plain page of headed paragraphs: the privacy policy, terms and support. */
export function TextPage({
  title,
  updated,
  sections,
}: {
  title: string;
  updated: string;
  sections: TextPageSection[];
}) {
  return (
    <main className="container mx-auto max-w-2xl px-6 py-12 text-black dark:text-neutral-100">
      <h1 className="text-3xl font-bold">{title}</h1>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        Last updated {updated}
      </p>
      {sections.map((section) => (
        <section key={section.heading} className="mt-8">
          <h2 className="text-xl font-semibold">{section.heading}</h2>
          {section.body.map((paragraph) => (
            <p key={paragraph} className="mt-3 leading-relaxed">
              {paragraph}
            </p>
          ))}
        </section>
      ))}
    </main>
  );
}
