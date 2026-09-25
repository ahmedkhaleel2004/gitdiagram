import { describe, expect, it } from "vitest";

import { isPriorityPlace } from "./priority-places";

const place = (
  country: string,
  region = "",
  city = "",
  lat: number | null = null,
  lon: number | null = null,
) => ({ country, region, city, lat, lon });

describe("priority places", () => {
  it("covers the early-access states and provinces", () => {
    expect(isPriorityPlace(place("US", "CA"))).toBe(true);
    expect(isPriorityPlace(place("US", "WA"))).toBe(true);
    expect(isPriorityPlace(place("US", "NY"))).toBe(true);
    expect(isPriorityPlace(place("CA", "ON"))).toBe(true);
    expect(isPriorityPlace(place("CA", "BC"))).toBe(true);
    expect(isPriorityPlace(place("US", "TX", "Austin"))).toBe(false);
    // Canada's "CA" is not California.
    expect(isPriorityPlace(place("CA", "QC"))).toBe(false);
  });

  it("covers 60 km around London by coordinates, not the city's name", () => {
    // Reading and Guildford are not "London", but are within 60 km.
    expect(isPriorityPlace(place("GB", "ENG", "Reading", 51.454, -0.978))).toBe(
      true,
    );
    expect(
      isPriorityPlace(place("GB", "ENG", "Guildford", 51.236, -0.57)),
    ).toBe(true);
    // Birmingham is not, and neither is a "London Road" outside the radius.
    expect(
      isPriorityPlace(place("GB", "ENG", "Birmingham", 52.486, -1.89)),
    ).toBe(false);
    expect(isPriorityPlace(place("GB", "ENG", "London", 52.486, -1.89))).toBe(
      false,
    );
    // Without coordinates, the city's name decides.
    expect(isPriorityPlace(place("GB", "ENG", "London"))).toBe(true);
    expect(isPriorityPlace(place("GB", "ENG", "Leeds"))).toBe(false);
  });

  it("covers Paris by radius and all of Île-de-France", () => {
    expect(isPriorityPlace(place("FR", "IDF", "Fontainebleau"))).toBe(true);
    expect(isPriorityPlace(place("FR", "HDF", "Creil", 49.26, 2.47))).toBe(
      true,
    );
    expect(isPriorityPlace(place("FR", "ARA", "Lyon", 45.76, 4.84))).toBe(
      false,
    );
    expect(isPriorityPlace(place("FR", "", "Paris"))).toBe(true);
  });

  it("widens to all of the US, Canada and the UK, keeping Paris", () => {
    const wide = (p: Parameters<typeof isPriorityPlace>[0]) =>
      isPriorityPlace(p, "countries");
    expect(wide(place("US", "TX", "Austin"))).toBe(true);
    expect(wide(place("CA", "QC", "Montreal"))).toBe(true);
    expect(wide(place("GB", "SCT", "Edinburgh", 55.95, -3.19))).toBe(true);
    expect(wide(place("FR", "IDF", "Versailles"))).toBe(true);
    expect(wide(place("FR", "ARA", "Lyon", 45.76, 4.84))).toBe(false);
    expect(wide(place("DE", "BE", "Berlin"))).toBe(false);
    expect(isPriorityPlace(place("US", "TX", "Austin"))).toBe(false);
  });
});
