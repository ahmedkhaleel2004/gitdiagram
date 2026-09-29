import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { JsonLd, serializeJsonLd } from "./json-ld";

describe("JsonLd", () => {
  it("cannot be closed early by a value", () => {
    const data = { name: "</script><script>alert(1)</script> & more" };
    const html = renderToStaticMarkup(<JsonLd data={data} />);

    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(serializeJsonLd(data)).not.toMatch(/[<>&]/);
    // Still the same data once parsed.
    expect(JSON.parse(serializeJsonLd(data))).toEqual(data);
  });
});
