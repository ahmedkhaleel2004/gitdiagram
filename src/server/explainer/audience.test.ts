import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  anyDeviceHere,
  audienceBlock,
  audienceMessage,
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

  it("takes Paris and the area around it", () => {
    const fr = (region: string, lat: string, lon: string, city = "") =>
      isInVideoRegion(
        request({
          "x-vercel-ip-country": "FR",
          "x-vercel-ip-country-region": region,
          "x-vercel-ip-latitude": lat,
          "x-vercel-ip-longitude": lon,
          "x-vercel-ip-city": city,
        }),
      );
    expect(fr("IDF", "", "")).toBe(true); // Île-de-France
    expect(fr("", "48.8049", "2.1204")).toBe(true); // Versailles
    expect(fr("", "48.4047", "2.7016")).toBe(true); // Fontainebleau
    expect(fr("CVL", "48.4439", "1.4890")).toBe(false); // Chartres
    expect(fr("", "", "", "Paris")).toBe(true);
    expect(fr("ARA", "45.7640", "4.8357")).toBe(false); // Lyon
    expect(fr("NOR", "49.4432", "1.0999")).toBe(false); // Rouen
  });

  it("lets any device in from an early-access place", () => {
    const inOntario = {
      "x-vercel-ip-country": "CA",
      "x-vercel-ip-country-region": "ON",
    };
    expect(
      canMakeVideosHere(request({ ...inOntario, "user-agent": MAC })),
    ).toBe(true);
    expect(
      canMakeVideosHere(request({ ...inOntario, "user-agent": IPHONE })),
    ).toBe(true);
    expect(
      canMakeVideosHere(request({ ...inOntario, "user-agent": ANDROID })),
    ).toBe(true);
    expect(anyDeviceHere(request({ ...inOntario, "user-agent": MAC }))).toBe(
      true,
    );
  });

  it("keeps everyone else out, with the reason", () => {
    const texas = (agent: string) =>
      request({
        "x-vercel-ip-country": "US",
        "x-vercel-ip-country-region": "TX",
        "user-agent": agent,
      });
    expect(audienceBlock(texas(MAC))).toBe("place");
    expect(audienceBlock(texas(IPHONE))).toBe("place");
    expect(audienceBlock(texas(IPHONE), "desktop")).toBe("mobile");
    expect(audienceMessage("place")).toMatch(/early access/);
    expect(audienceMessage("mobile")).toMatch(/computer/);
  });

  it("widens to any desktop, then everyone, when the operator says so", () => {
    const texasMac = request({
      "x-vercel-ip-country": "US",
      "x-vercel-ip-country-region": "TX",
      "user-agent": MAC,
    });
    const texasPhone = request({
      "x-vercel-ip-country": "US",
      "x-vercel-ip-country-region": "TX",
      "user-agent": IPHONE,
    });
    expect(canMakeVideosHere(texasMac, "priority")).toBe(false);
    expect(canMakeVideosHere(texasMac, "desktop")).toBe(true);
    expect(anyDeviceHere(texasMac, "desktop")).toBe(false);
    expect(canMakeVideosHere(texasPhone, "desktop")).toBe(false);
    expect(canMakeVideosHere(texasPhone, "everyone")).toBe(true);
    expect(anyDeviceHere(texasPhone, "everyone")).toBe(true);
  });
});
