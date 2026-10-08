import {
  DESIGNER_ACTIONS,
  DESIGNER_KINDS,
  SHOT_TRANSITIONS,
} from "~/features/explainer/types";

// The two tools the film's writers call: the director's script and the
// designers' shots (see script.ts and shots.ts for how each reply is checked).

type JsonSchema = Record<string, unknown>;
const str: JsonSchema = { type: "string" };
const num: JsonSchema = { type: "number" };
const bool: JsonSchema = { type: "boolean" };
const arr = (items: JsonSchema): JsonSchema => ({ type: "array", items });

// Both roles get both tools so the cached prefix (tools → system → repo) is shared.
export const SCRIPT_TOOL = {
  name: "write_script",
  description: "DIRECTOR only: submit the film's script.",
  input_schema: {
    type: "object",
    properties: {
      title: str,
      story: {
        type: "string",
        description:
          "The whole narration as one flowing paragraph, written before the beats; the beats split it word for word.",
      },
      outro: str,
      beats: arr({
        type: "object",
        properties: { scene: str, narration: str, brief: str },
        required: ["scene", "narration", "brief"],
      }),
    },
    required: ["title", "story", "outro", "beats"],
  },
};

export const SHOTS_TOOL = {
  name: "write_shots",
  description:
    "DESIGNER only: submit the exact shots for the beats you were assigned.",
  input_schema: {
    type: "object",
    properties: {
      layout: {
        type: "object",
        description:
          'The whole scene\'s arrangement: nested {"row":[…]} and {"col":[…]} of element ids, {"id":…,"in":{…}} for a browser window around a layout, {"slot":[…]} for elements that take turns in one place.',
      },
      shots: arr({
        type: "object",
        properties: {
          beat: { type: "integer" },
          transition: { type: "string", enum: SHOT_TRANSITIONS },
          elements: arr({
            type: "object",
            properties: {
              id: str,
              kind: { type: "string", enum: DESIGNER_KINDS },
              at: str,
              text: str,
              size: str,
              tone: str,
              mono: bool,
              title: str,
              lines: arr(str),
              focus: arr({ type: "integer" }),
              label: str,
              sub: str,
              icon: str,
              path: str,
              paths: arr(str),
              columns: arr(str),
              rows: arr(arr(str)),
              items: { type: "array" },
              unit: str,
              value: num,
              prefix: str,
              suffix: str,
              url: str,
              method: str,
              status: { type: ["integer", "null"] },
              src: str,
              fit: str,
              from: str,
              to: str,
              dashed: bool,
              flow: bool,
            },
            required: ["id", "kind"],
          }),
          actions: arr({
            type: "object",
            properties: {
              at: str,
              do: { type: "string", enum: DESIGNER_ACTIONS },
              target: {},
              lines: arr({ type: "integer" }),
              rows: arr({ type: "integer" }),
              text: str,
              value: num,
              line: str,
            },
            required: ["do"],
          }),
        },
        required: ["beat", "elements", "actions"],
      }),
    },
    required: ["layout", "shots"],
  },
};
