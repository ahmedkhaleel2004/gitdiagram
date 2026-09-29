import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import type { DiagramGraph } from "~/features/diagram/graph";
import {
  createDiagramPicture,
  pictureBlocks,
  pictureColumns,
  truncate,
} from "./diagram-picture";

const BODY_HEIGHT = 404;

function node(id: string, groupId: string | null, label = `Part ${id}`) {
  return {
    id,
    label,
    type: "service",
    description: null,
    groupId,
    path: null,
    shape: null,
  };
}

function graph(groupSizes: number[], loose = 0): DiagramGraph {
  const groups = groupSizes.map((_, index) => ({
    id: `g${index}`,
    label: `Group ${index}`,
    description: null,
  }));
  const nodes = groupSizes.flatMap((size, group) =>
    Array.from({ length: size }, (_, index) =>
      node(`n${group}_${index}`, `g${group}`),
    ),
  );
  for (let index = 0; index < loose; index += 1)
    nodes.push(node(`loose${index}`, null));
  return { groups, nodes, edges: [] };
}

function columnHeight(column: ReturnType<typeof pictureColumns>["columns"][0]) {
  // Mirrors blockHeight: chrome (padding, border, label) plus lines.
  return (
    column.reduce((total, { block, shown }) => {
      const lines = shown + (shown < block.nodes.length ? 1 : 0);
      return total + 58 + lines * 36 - 6;
    }, 0) +
    (column.length - 1) * 14
  );
}

describe("README diagram picture", () => {
  it("groups parts the way the diagram does, loose parts last", () => {
    const blocks = pictureBlocks(graph([2, 1], 2));
    expect(blocks.map((block) => [block.label, block.nodes.length])).toEqual([
      ["Group 0", 2],
      ["Group 1", 1],
      ["Other parts", 2],
    ]);
  });

  it("puts a diagram without groups in one unlabeled block", () => {
    const blocks = pictureBlocks(graph([], 34));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.label).toBeNull();
    const layout = pictureColumns(blocks);
    expect(layout.columns).toEqual([[{ block: blocks[0], shown: 34 }]]);
  });

  it.each([
    [[3], 0],
    [[7, 3, 2, 6], 2],
    [[10, 10, 10, 4], 0],
    [[3, 3, 3, 3, 3, 3, 3, 3, 3, 3], 4],
  ])(
    "fits every column of groups %j (+%i loose) and counts what it leaves out",
    (sizes, loose) => {
      const source = graph(sizes, loose);
      const layout = pictureColumns(pictureBlocks(source));
      expect(layout.columns.length).toBeLessThanOrEqual(4);
      let drawnOrCounted = 0;
      for (const column of layout.columns) {
        expect(columnHeight(column)).toBeLessThanOrEqual(BODY_HEIGHT);
        for (const { block } of column) drawnOrCounted += block.nodes.length;
      }
      expect(drawnOrCounted).toBe(source.nodes.length);
    },
  );

  it("shortens long labels with an ellipsis", () => {
    expect(truncate("A  very long   label", 8)).toBe("A very…");
    expect(truncate("Short", 8)).toBe("Short");
  });

  it("draws a PNG for the largest diagram the planner may return", async () => {
    const response = await createDiagramPicture({
      username: "acme",
      repo: "a-repository-with-a-rather-long-name",
      graph: {
        ...graph([6, 5, 4, 4, 3, 3, 3, 2, 2], 2),
        edges: [
          {
            from: "n0_0",
            to: "n1_0",
            label: null,
            description: null,
            style: null,
          },
        ],
      },
    });
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("max-age=3600");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
    if (process.env.DIAGRAM_PICTURE_OUT)
      await writeFile(process.env.DIAGRAM_PICTURE_OUT, bytes);
  });
});
