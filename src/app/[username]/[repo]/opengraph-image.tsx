import { renderRepoSocialImage } from "./social-image";

export const runtime = "nodejs";
export const alt = "GitDiagram repository preview";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default renderRepoSocialImage;
