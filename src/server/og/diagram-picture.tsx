import { ImageResponse } from "next/og";

import type { DiagramGraph, DiagramGraphNode } from "~/features/diagram/graph";
import { toneClassForNode } from "~/server/generate/graph";
import { geistFontsPromise } from "~/server/og/cards";

// A README picture of a repository's diagram: its groups and parts in the
// diagram's own colours, drawn without a browser (Satori), so it stays cheap
// to serve and is redrawn whenever the diagram is.

const DIAGRAM_PICTURE_SIZE = { width: 1200, height: 630 } as const;

// Camo (GitHub's image proxy) and browsers check back hourly; the CDN keeps a
// day and is refreshed on demand when the diagram is made again.
const PICTURE_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
  "CDN-Cache-Control": "public, max-age=86400, stale-while-revalidate=86400",
  "Vercel-CDN-Cache-Control":
    "public, max-age=86400, stale-while-revalidate=86400",
  "X-Content-Type-Options": "nosniff",
} as const;

const TONES = {
  toneNeutral: { fill: "#f8fafc", stroke: "#334155", text: "#0f172a" },
  toneBlue: { fill: "#dbeafe", stroke: "#2563eb", text: "#172554" },
  toneAmber: { fill: "#fef3c7", stroke: "#d97706", text: "#78350f" },
  toneMint: { fill: "#dcfce7", stroke: "#16a34a", text: "#14532d" },
  toneRose: { fill: "#ffe4e6", stroke: "#e11d48", text: "#881337" },
  toneIndigo: { fill: "#e0e7ff", stroke: "#4f46e5", text: "#312e81" },
  toneTeal: { fill: "#ccfbf1", stroke: "#0f766e", text: "#134e4a" },
} as const;

type Tone = (typeof TONES)[keyof typeof TONES];

const ink = "#17111f";
const brand = "hsl(271 81% 55%)";
const PADDING_X = 48;
const CONTENT_WIDTH = DIAGRAM_PICTURE_SIZE.width - PADDING_X * 2;
const BODY_HEIGHT = 404;
const GAP = 14;
const GROUP_PADDING = 12;
const GROUP_LABEL_HEIGHT = 30;
const LINE_HEIGHT = 30;
const LINE_GAP = 6;
const FONT_SIZE = 16;
// Geist at 16px averages a little under 9px a character.
const CHARACTER_WIDTH = FONT_SIZE * 0.56;

export function truncate(text: string, maxLength: number): string {
  const value = text.replace(/\s+/gu, " ").trim();
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function toneFor(node: DiagramGraphNode, groupOrder: Map<string, number>) {
  const name = toneClassForNode(node, groupOrder) as keyof typeof TONES;
  return TONES[name] ?? TONES.toneNeutral;
}

interface PictureBlock {
  label: string | null;
  tone: Tone | null;
  nodes: Array<{ label: string; tone: Tone }>;
}

/** Group the diagram's parts the way the diagram does. */
export function pictureBlocks(graph: DiagramGraph): PictureBlock[] {
  const groupOrder = new Map(
    graph.groups.map((group, index) => [group.id, index]),
  );
  const toned = (node: DiagramGraphNode) => ({
    label: node.label,
    tone: toneFor(node, groupOrder),
  });
  const blocks: PictureBlock[] = [];
  for (const group of graph.groups) {
    const nodes = graph.nodes.filter((node) => node.groupId === group.id);
    if (!nodes.length) continue;
    blocks.push({
      label: group.label,
      tone: toned(nodes[0]!).tone,
      nodes: nodes.map(toned),
    });
  }
  const loose = graph.nodes.filter(
    (node) => !node.groupId || !groupOrder.has(node.groupId),
  );
  if (loose.length)
    blocks.push({
      label: blocks.length ? "Other parts" : null,
      tone: null,
      nodes: loose.map(toned),
    });
  return blocks;
}

const BLOCK_CHROME = GROUP_PADDING * 2 + 4 + GROUP_LABEL_HEIGHT;
const MIN_LINES = 2;

function blockHeight(lines: number) {
  return BLOCK_CHROME + lines * (LINE_HEIGHT + LINE_GAP) - LINE_GAP;
}

function columnHeight(lines: number[]) {
  return (
    lines.reduce((total, count) => total + blockHeight(count), 0) +
    (lines.length - 1) * GAP
  );
}

export interface PlacedBlock {
  block: PictureBlock;
  /** Parts drawn; the rest are summed up as "+N more". */
  shown: number;
}

/**
 * Stack the blocks in up to four columns, each block under the shortest
 * column so far, then trim the longest lists until every column fits.
 */
export function pictureColumns(blocks: PictureBlock[]) {
  const lone = blocks.length === 1 && !blocks[0]!.label ? blocks[0]! : null;
  if (lone) {
    // No groups: one block, its parts spread over several columns.
    const inner = CONTENT_WIDTH - GROUP_PADDING * 2 - 4;
    const rows = Math.floor(
      (BODY_HEIGHT - GROUP_PADDING * 2 - 4 + LINE_GAP) /
        (LINE_HEIGHT + LINE_GAP),
    );
    const capacity = rows * Math.max(1, Math.floor(inner / 240));
    const total = lone.nodes.length;
    return {
      width: CONTENT_WIDTH,
      columns: [
        [{ block: lone, shown: total <= capacity ? total : capacity - 1 }],
      ],
    };
  }
  const count = Math.max(1, Math.min(4, blocks.length));
  const width = Math.floor((CONTENT_WIDTH - (count - 1) * GAP) / count);
  const columns: PictureBlock[][] = Array.from({ length: count }, () => []);
  const heights = new Array<number>(count).fill(-GAP);
  for (const block of blocks) {
    const shortest = heights.indexOf(Math.min(...heights));
    columns[shortest]!.push(block);
    heights[shortest]! += blockHeight(block.nodes.length) + GAP;
  }
  const placed = columns.map((column) => {
    const lines = column.map((block) => block.nodes.length);
    while (columnHeight(lines) > BODY_HEIGHT) {
      const longest = lines.indexOf(Math.max(...lines));
      if (lines[longest]! <= MIN_LINES) break;
      lines[longest]! -= 1;
    }
    return column.map((block, index): PlacedBlock => {
      const available = lines[index]!;
      return {
        block,
        // The last line of a trimmed list says how many more there are.
        shown:
          available >= block.nodes.length
            ? block.nodes.length
            : Math.max(0, available - 1),
      };
    });
  });
  return { width, columns: placed.filter((column) => column.length) };
}

function NodeLine({
  label,
  tone,
  width,
}: {
  label: string;
  tone: Tone;
  width: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        width,
        height: LINE_HEIGHT,
        padding: "0 10px",
        borderRadius: 6,
        border: `1.5px solid ${tone.stroke}`,
        background: tone.fill,
        color: tone.text,
        fontSize: FONT_SIZE,
        fontWeight: 500,
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
    >
      {truncate(label, Math.floor((width - 22) / CHARACTER_WIDTH))}
    </div>
  );
}

function MoreLine({ count }: { count: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        height: LINE_HEIGHT,
        padding: "0 10px",
        color: "rgba(23, 17, 31, 0.62)",
        fontSize: FONT_SIZE - 1,
        fontWeight: 500,
      }}
    >
      {`+${count} more`}
    </div>
  );
}

function Block({
  placed: { block, shown },
  width,
  grow,
}: {
  placed: PlacedBlock;
  width: number;
  grow: boolean;
}) {
  const inner = width - GROUP_PADDING * 2 - 4;
  // Without groups, one block holds every part in several columns.
  const lineColumns = block.label ? 1 : Math.max(1, Math.floor(inner / 240));
  const lineWidth = Math.floor(
    (inner - (lineColumns - 1) * LINE_GAP) / lineColumns,
  );
  const nodes = block.nodes.slice(0, shown);
  const hidden = block.nodes.length - nodes.length;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width,
        flexGrow: grow ? 1 : 0,
        flexShrink: 0,
        padding: GROUP_PADDING,
        borderRadius: 10,
        border: `2px solid ${ink}`,
        background: "#ffffff",
        boxShadow: `3px 3px 0 ${ink}`,
        overflow: "hidden",
      }}
    >
      {block.label && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            height: GROUP_LABEL_HEIGHT,
            paddingBottom: 6,
            fontSize: 17,
            fontWeight: 700,
            color: ink,
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              width: 10,
              height: 10,
              marginRight: 8,
              borderRadius: 999,
              background: block.tone?.stroke ?? ink,
              flexShrink: 0,
            }}
          />
          {truncate(block.label, Math.floor((inner - 18) / (17 * 0.58)))}
        </div>
      )}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: LINE_GAP,
        }}
      >
        {nodes.map((node, index) => (
          <NodeLine
            key={`${index}:${node.label}`}
            label={node.label}
            tone={node.tone}
            width={lineWidth}
          />
        ))}
        {hidden > 0 && <MoreLine count={hidden} />}
      </div>
    </div>
  );
}

function titleSize(text: string) {
  if (text.length > 56) return 26;
  if (text.length > 40) return 32;
  return 40;
}

function DiagramPicture({
  username,
  repo,
  graph,
}: {
  username: string;
  repo: string;
  graph: DiagramGraph;
}) {
  const layout = pictureColumns(pictureBlocks(graph));
  const title = truncate(`${username}/${repo}`, 72);
  const parts = graph.nodes.length;
  const links = graph.edges.length;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        padding: `34px ${PADDING_X}px 30px`,
        background: "hsl(269 100% 95%)",
        color: ink,
        fontFamily: "Geist, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 56,
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: titleSize(title),
            fontWeight: 700,
            letterSpacing: "-0.04em",
            whiteSpace: "nowrap",
            overflow: "hidden",
            maxWidth: 860,
          }}
        >
          {title}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 32,
            fontWeight: 700,
            letterSpacing: "-0.06em",
          }}
        >
          <span style={{ display: "flex", color: "#111111" }}>Git</span>
          <span style={{ display: "flex", color: brand }}>Diagram</span>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          gap: GAP,
          width: CONTENT_WIDTH,
          height: BODY_HEIGHT,
          marginTop: 22,
          overflow: "hidden",
        }}
      >
        {layout.columns.map((column, columnIndex) => (
          <div
            key={columnIndex}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: GAP,
              width: layout.width,
              height: BODY_HEIGHT,
            }}
          >
            {column.map((placed, index) => (
              <Block
                key={`${index}:${placed.block.label ?? ""}`}
                placed={placed}
                width={layout.width}
                grow={index === column.length - 1}
              />
            ))}
          </div>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 20,
            fontWeight: 500,
            color: "rgba(23, 17, 31, 0.72)",
          }}
        >
          {`Architecture diagram · ${parts} ${parts === 1 ? "part" : "parts"} · ${links} ${links === 1 ? "connection" : "connections"}`}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "8px 16px",
            borderRadius: 8,
            border: `2px solid ${ink}`,
            background: "#bd85fb",
            boxShadow: `2px 2px 0 ${ink}`,
            fontSize: 19,
            fontWeight: 700,
          }}
        >
          Explore it interactively →
        </div>
      </div>
    </div>
  );
}

export async function createDiagramPicture(data: {
  username: string;
  repo: string;
  graph: DiagramGraph;
}) {
  const fonts = await geistFontsPromise;
  return new ImageResponse(<DiagramPicture {...data} />, {
    ...DIAGRAM_PICTURE_SIZE,
    fonts,
    headers: PICTURE_CACHE_HEADERS,
  });
}
