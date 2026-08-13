import { describe, expect, it, vi } from "vitest";
import {
  collectSignedUrls,
  createSignedUrlMap,
  groupSignedUrlRequests,
  type SignedUrlRequest,
} from "./signed-urls";

describe("groupSignedUrlRequests", () => {
  it("groups by bucket so each bucket costs one round trip", () => {
    const batches = groupSignedUrlRequests([
      { key: "a", bucket: "docs", path: "one.pdf" },
      { key: "b", bucket: "uploads", path: "two.pdf" },
      { key: "c", bucket: "docs", path: "three.pdf" },
    ]);

    expect(batches).toHaveLength(2);
    expect(batches.find((b) => b.bucket === "docs")!.paths).toEqual(["one.pdf", "three.pdf"]);
    expect(batches.find((b) => b.bucket === "uploads")!.paths).toEqual(["two.pdf"]);
  });

  it("signs a shared path once but remembers every key that wanted it", () => {
    const batches = groupSignedUrlRequests([
      { key: "a", bucket: "docs", path: "same.pdf" },
      { key: "b", bucket: "docs", path: "same.pdf" },
    ]);

    expect(batches[0].paths).toEqual(["same.pdf"]);
    expect(batches[0].keysByPath.get("same.pdf")).toEqual(["a", "b"]);
  });

  it("drops rows with nothing to sign", () => {
    const batches = groupSignedUrlRequests([
      { key: "a", bucket: "docs", path: null },
      { key: "b", bucket: "docs", path: "  " },
      { key: "c", bucket: "", path: "orphan.pdf" },
    ]);

    expect(batches).toEqual([]);
  });
});

describe("collectSignedUrls", () => {
  const batch = groupSignedUrlRequests([
    { key: "a", bucket: "docs", path: "one.pdf" },
    { key: "b", bucket: "docs", path: "one.pdf" },
    { key: "c", bucket: "docs", path: "two.pdf" },
  ])[0];

  it("fans one signature out to every key that asked for it", () => {
    const urls = collectSignedUrls(batch, [{ path: "one.pdf", signedUrl: "https://signed/one" }]);
    expect(urls.get("a")).toBe("https://signed/one");
    expect(urls.get("b")).toBe("https://signed/one");
    expect(urls.has("c")).toBe(false);
  });

  it("skips rows the storage layer could not sign", () => {
    const urls = collectSignedUrls(batch, [
      { path: "one.pdf", signedUrl: null, error: "not found" },
      { path: "two.pdf", signedUrl: "https://signed/two" },
    ]);
    expect(urls.has("a")).toBe(false);
    expect(urls.get("c")).toBe("https://signed/two");
  });

  it("survives a null response", () => {
    expect(collectSignedUrls(batch, null).size).toBe(0);
  });
});

describe("createSignedUrlMap", () => {
  function storageWith(responses: Record<string, unknown>) {
    const createSignedUrls = vi.fn(async (paths: string[]) => paths);
    const from = vi.fn((bucket: string) => ({
      createSignedUrls: vi.fn(async () => responses[bucket] ?? { data: [] }),
    }));
    return { from, createSignedUrls };
  }

  const requests: SignedUrlRequest[] = [
    { key: "a", bucket: "docs", path: "one.pdf" },
    { key: "b", bucket: "uploads", path: "two.pdf" },
  ];

  it("issues one call per bucket, not one per file", async () => {
    const storage = storageWith({
      docs: { data: [{ path: "one.pdf", signedUrl: "https://signed/one" }] },
      uploads: { data: [{ path: "two.pdf", signedUrl: "https://signed/two" }] },
    });

    const urls = await createSignedUrlMap(storage, requests);

    expect(storage.from).toHaveBeenCalledTimes(2);
    expect(urls.get("a")).toBe("https://signed/one");
    expect(urls.get("b")).toBe("https://signed/two");
  });

  it("does nothing at all when there is nothing to sign", async () => {
    const storage = storageWith({});
    const urls = await createSignedUrlMap(storage, [{ key: "a", bucket: "docs", path: null }]);
    expect(storage.from).not.toHaveBeenCalled();
    expect(urls.size).toBe(0);
  });

  it("lets one broken bucket fail without blanking the others", async () => {
    const storage = {
      from: vi.fn((bucket: string) => ({
        createSignedUrls: vi.fn(async () => {
          if (bucket === "docs") throw new Error("bucket offline");
          return { data: [{ path: "two.pdf", signedUrl: "https://signed/two" }] };
        }),
      })),
    };

    const urls = await createSignedUrlMap(storage, requests);

    expect(urls.has("a")).toBe(false);
    expect(urls.get("b")).toBe("https://signed/two");
  });
});
