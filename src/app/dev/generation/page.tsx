import { notFound } from "next/navigation";
import type { Metadata } from "next";
import GenerationPlayground from "./playground";

export const metadata: Metadata = {
  title: "Generation playground · GitDiagram",
  robots: { index: false, follow: false },
};

export default async function GenerationPlaygroundPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  const { focus } = await searchParams;
  return <GenerationPlayground focused={focus === "1"} />;
}
