import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  canMakeVideosHere,
  isDesktopRequest,
  isInVideoRegion,
} from "./audience";

const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

const request = (headers: Record<string, string>) =>
  new Request("https://gitdiagram.com/api/video/generate", { headers });

describe("who may make new videos", () => {
  it("lets desktops in and keeps phones out", () => {
    expect(isDesktopRequest(request({ "user-agent": MAC }))).toBe(true);
    expect(isDesktopRequest(request({ "user-agent": WINDOWS }))).toBe(true);
    expect(isDesktopRequest(request({ "user-agent": IPHONE }))).toBe(false);
    expect(isDesktopRequest(request({ "user-agent": ANDROID }))).toBe(false);
    expect(
      isDesktopRequest(
        request({ "user-agent": WINDOWS, "sec-ch-ua-mobile": "?1" }),
      ),
    ).toBe(false);
    expect(isDesktopRequest(request({}))).toBe(false);
  });

  it("matches the early-access states and provinces", () => {
    const at = (country: string, region: string) =>
      isInVideoRegion(
        request({
          "x-vercel-ip-country": country,
          "x-vercel-ip-country-region": region,
        }),
      );
    expect(at("US", "CA")).toBe(true);
    expect(at("US", "WA")).toBe(true);
    expect(at("US", "NY")).toBe(true);
    expect(at("CA", "ON")).toBe(true);
    expect(at("CA", "BC")).toBe(true);
    expect(at("US", "TX")).toBe(false);
    expect(at("CA", "QC")).toBe(false);
    expect(at("DE", "BE")).toBe(false);
  });

  it("takes anywhere around London, by distance or by city", () => {
    const uk = (lat: string, lon: string, city = "") =>
      isInVideoRegion(
        request({
          "x-vercel-ip-country": "GB",
          "x-vercel-ip-country-region": "ENG",
          "x-vercel-ip-latitude": lat,
          "x-vercel-ip-longitude": lon,
          "x-vercel-ip-city": city,
        }),
      );
    expect(uk("51.3762", "-0.0982")).toBe(true); // Croydon
    expect(uk("51.7520", "-1.2577")).toBe(false); // Oxford
    expect(uk("53.4808", "-2.2426")).toBe(false); // Manchester
    expect(uk("", "", "London")).toBe(true);
  });

  it("needs both a desktop and an early-access place", () => {
    const inNewYork = {
      "x-vercel-ip-country": "US",
      "x-vercel-ip-country-region": "NY",
    };
    expect(
      canMakeVideosHere(request({ ...inNewYork, "user-agent": MAC })),
    ).toBe(true);
    expect(
      canMakeVideosHere(request({ ...inNewYork, "user-agent": IPHONE })),
    ).toBe(false);
    expect(
      canMakeVideosHere(
        request({
          "x-vercel-ip-country": "US",
          "x-vercel-ip-country-region": "TX",
          "user-agent": MAC,
        }),
      ),
    ).toBe(false);
  });
});
