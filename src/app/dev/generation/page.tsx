import { notFound } from "next/navigation";
import type { Metadata } from "next";
import GenerationPlayground from "./playground";

export const metadata: Metadata = {
  title: "Generation playground · GitDiagram",
  robots: { index: false, follow: false },
};

export default function GenerationPlaygroundPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <GenerationPlayground />;
}
