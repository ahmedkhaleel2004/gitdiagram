import { describe, expect, it } from "vitest";

import { parseSSEChunk, parseSSEStreamBuffer } from "~/features/diagram/sse";

describe("parseSSEChunk", () => {
  it("parses valid SSE data lines", () => {
    const chunk =
      'data: {"status":"started","message":"Starting"}\n\n' +
      'data: {"status":"diagram_chunk","chunk":"flowchart TD"}\n\n';

    const messages = parseSSEChunk(chunk);

    expect(messages).toHaveLength(2);
    expect(messages[0]?.status).toBe("started");
    expect(messages[1]?.chunk).toBe("flowchart TD");
  });

  it("ignores malformed lines", () => {
    const chunk =
      "event: custom\n" +
      "data: {not-json}\n" +
      'data: {"status":"complete"}\n';

    const messages = parseSSEChunk(chunk);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.status).toBe("complete");
  });

  it("handles events split across network boundaries", () => {
    const firstHalf = 'data: {"status":"diagram_fix_attempt","message":"Attempt 1';
    const secondHalf = '/3"}\n\n';

    const firstPass = parseSSEStreamBuffer(firstHalf);
    expect(firstPass.messages).toHaveLength(0);

    const secondPass = parseSSEStreamBuffer(firstPass.remainder + secondHalf);
    expect(secondPass.messages).toHaveLength(1);
    expect(secondPass.messages[0]?.status).toBe("diagram_fix_attempt");
    expect(secondPass.messages[0]?.message).toBe("Attempt 1/3");
  });
});
