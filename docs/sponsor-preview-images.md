# Sponsor placement screenshots

The images in `public/sponsor-previews` were captured on September 20, 2026
from production GitDiagram and the public GitHub README. They show the active
Sent campaign with the approved wordmark layout, smaller sponsorship label, and
stacked tagline. No branding or page content was substituted.

| Image         | Source                                           | Framing                                                            |
| ------------- | ------------------------------------------------ | ------------------------------------------------------------------ |
| `home.png`    | `https://gitdiagram.com/`                        | Homepage heading, lookup panel, and sponsor slot                   |
| `diagram.png` | `https://gitdiagram.com/fastapi/fastapi`         | Lower portion of the saved diagram and the sponsor slot beneath it |
| `browse.png`  | `https://gitdiagram.com/browse?sort=stars_desc`  | Catalog controls, first repository listings, and the sponsor row   |
| `readme.png`  | `https://github.com/ahmedkhaleel2004/gitdiagram` | README introduction, sponsor mention, and Features section         |

Refresh these screenshots when a placement changes. Capture at 2x pixel density,
include enough surrounding content to establish the location, and keep personal
browser chrome and development controls outside the crop. Update the image
dimensions and descriptions in `src/app/advertise/sponsor-content.ts` if needed.

These are static placement illustrations. The sponsor page gets its audience
and placement metrics separately from the existing live stats source.

The preview dialog draws a red outline over each sponsor slot without changing
the screenshot. Its `highlight` coordinates in `sponsor-content.ts` use the
image's native pixel dimensions. Update these bounds when replacing a capture.
The full-size link opens the original screenshot.
