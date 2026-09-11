import { getStarCount } from "~/server/github-stars";
import { HeaderClient } from "./header-client";

export function Header() {
  return <HeaderClient starCount={getStarCount()} />;
}
