import type { CaptureResult } from "posthog-js";
import { describe, expect, it } from "vitest";

import { dropNoiseExceptions } from "./exception-noise";

function exception(...values: string[]): CaptureResult {
  return {
    uuid: "id",
    event: "$exception",
    properties: {
      $exception_list: values.map((value) => ({ type: "Error", value })),
    },
  };
}

describe("dropNoiseExceptions", () => {
  it("drops ResizeObserver loop notices", () => {
    expect(
      dropNoiseExceptions(
        exception(
          "ResizeObserver loop completed with undelivered notifications.",
        ),
      ),
    ).toBeNull();
    expect(
      dropNoiseExceptions(exception("ResizeObserver loop limit exceeded")),
    ).toBeNull();
  });

  it("drops bot object rejections", () => {
    expect(
      dropNoiseExceptions(
        exception(
          "Non-Error promise rejection captured with value: Object Not Found Matching Id:2, MethodName:update, ParamCount:4",
        ),
      ),
    ).toBeNull();
  });

  it("keeps real errors, including a chain mixing noise and a real error", () => {
    const chunk = exception(
      "Failed to load chunk /_next/static/immutable/chunks/a.js from module 1",
    );
    expect(dropNoiseExceptions(chunk)).toBe(chunk);
    const mixed = exception(
      "ResizeObserver loop limit exceeded",
      "TypeError: x is undefined",
    );
    expect(dropNoiseExceptions(mixed)).toBe(mixed);
  });

  it("never touches other events", () => {
    const pageview: CaptureResult = {
      uuid: "id",
      event: "$pageview",
      properties: { $exception_message: "ResizeObserver loop limit exceeded" },
    };
    expect(dropNoiseExceptions(pageview)).toBe(pageview);
    expect(dropNoiseExceptions(null)).toBeNull();
  });
});
