// Countries where making new videos is limited to keep spend in check: a
// large share of GitDiagram's traffic comes from them, far more than the
// video budget can pay for. Everyone there can still watch and download every
// video already made. The operator picks how limited from /admin:
// - "blocked": no new videos from these countries.
// - "some": each day, a random share of connections (10% unless the operator
//   sets another) may make one video, always on the standard models.
// - "open": the same rules as everywhere else.
//
// Shared by the server's rule and the /admin dashboard, which names them.

const LIMITED_COUNTRIES: readonly string[] = [
  "IN", // India
  "VN", // Vietnam
  "BR", // Brazil
  "PH", // Philippines
  "PK", // Pakistan
  "ID", // Indonesia
];

export const LIMITED_COUNTRY_NAMES =
  "India, Vietnam, Brazil, the Philippines, Pakistan and Indonesia";

/** Percent of connections let in each day under "some", unless set in /admin. */
export const DEFAULT_LIMITED_COUNTRY_SHARE = 10;

export function isLimitedCountry(country: string): boolean {
  return LIMITED_COUNTRIES.includes(country.toUpperCase());
}
