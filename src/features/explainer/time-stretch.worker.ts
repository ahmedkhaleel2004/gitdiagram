// Stretches narration off the main thread: a minute of speech takes a phone
// long enough to freeze the page, and the player asks for it mid-playback.
import { stretchChannels } from "./time-stretch";

export interface StretchRequest {
  id: number;
  channels: Float32Array[];
  sampleRate: number;
  rate: number;
}

export interface StretchResponse {
  id: number;
  channels: Float32Array<ArrayBuffer>[];
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<StretchRequest>) => void) | null;
  postMessage(message: StretchResponse, transfer: Transferable[]): void;
};

scope.onmessage = (event) => {
  const { id, channels, sampleRate, rate } = event.data;
  const output = stretchChannels(channels, sampleRate, rate);
  scope.postMessage(
    { id, channels: output },
    output.map((channel) => channel.buffer),
  );
};
