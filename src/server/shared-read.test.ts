import { afterEach, describe, expect, it, vi } from "vitest";

import { outliveRequest, sharedRead } from "./shared-read";

const contextSymbol = Symbol.for("__cloudflare-context__");
const globals = globalThis as Record<symbol, unknown>;

afterEach(() => {
  delete globals[contextSymbol];
  vi.useRealTimers();
});

describe("sharedRead", () => {
  it("shares one read between concurrent callers and starts a new one after it settles", async () => {
    let release: (value: number) => void = () => undefined;
    const read = vi.fn(
      () => new Promise<number>((resolve) => (release = resolve)),
    );
    const shared = sharedRead(read);
    const first = shared();
    const second = shared();
    expect(read).toHaveBeenCalledTimes(1);
    release(7);
    await expect(Promise.all([first, second])).resolves.toEqual([7, 7]);
    void shared();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("starts again after a failed read", async () => {
    const read = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce("ok");
    const shared = sharedRead(read);
    await expect(shared()).rejects.toThrow("down");
    await expect(shared()).resolves.toBe("ok");
  });

  it("gives up on a read that never settles, so later callers are not hung", async () => {
    vi.useFakeTimers();
    const read = vi
      .fn<() => Promise<string>>()
      .mockReturnValueOnce(new Promise(() => undefined))
      .mockResolvedValueOnce("fresh");
    const shared = sharedRead(read);
    void shared();
    vi.advanceTimersByTime(29_000);
    void shared();
    expect(read).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_000);
    await expect(shared()).resolves.toBe("fresh");
  });

  it("forget() makes the next caller start a new read", async () => {
    const read = vi
      .fn<() => Promise<string>>()
      .mockReturnValueOnce(new Promise(() => undefined))
      .mockResolvedValueOnce("new");
    const shared = sharedRead(read);
    void shared();
    shared.forget();
    await expect(shared()).resolves.toBe("new");
  });

  it("keeps the starting request alive on Workers until the read settles", async () => {
    const waitUntil = vi.fn();
    globals[contextSymbol] = { env: {}, ctx: { waitUntil } };
    const shared = sharedRead(() => Promise.reject(new Error("boom")));
    await expect(shared()).rejects.toThrow("boom");
    expect(waitUntil).toHaveBeenCalledTimes(1);
    // What waitUntil holds never rejects, whatever the read does.
    await expect(waitUntil.mock.calls[0]![0]).resolves.toBeUndefined();
  });
});

describe("outliveRequest", () => {
  it("returns the same promise and does nothing off Workers", async () => {
    const promise = Promise.resolve(1);
    expect(outliveRequest(promise)).toBe(promise);
  });

  it("survives a waitUntil that throws", () => {
    globals[contextSymbol] = {
      env: {},
      ctx: {
        waitUntil() {
          throw new Error("no request");
        },
      },
    };
    const promise = Promise.resolve(1);
    expect(outliveRequest(promise)).toBe(promise);
  });
});
