import { getStarCount } from "~/server/github-stars";
import { HeaderClient } from "./header-client";

export async function Header() {
  const starCount = await getStarCount();

  return <HeaderClient starCount={starCount} />;
}
