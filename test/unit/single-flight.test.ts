import { describe, expect, it } from "vitest";
import { SingleFlight } from "../../src/index.js";

describe("SingleFlight", () => {
  it("reports size while a leader promise is pending and clears afterward", async () => {
    const flight = new SingleFlight();
    let resolve!: (value: string) => void;
    const pending = new Promise<string>((r) => {
      resolve = r;
    });

    const first = flight.do("key", () => pending);
    const second = flight.do("key", async () => "unused");

    expect(flight.size()).toBe(1);
    resolve("ok");

    await expect(first).resolves.toEqual({ value: "ok", shared: false });
    await expect(second).resolves.toEqual({ value: "ok", shared: true });
    expect(flight.size()).toBe(0);
  });
});
