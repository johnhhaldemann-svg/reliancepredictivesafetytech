// Batched signed-URL generation.
//
// The HR review pages signed every document one at a time, in three sequential
// for-loops, each awaiting its own round trip to Supabase Storage before the
// page could paint. With fifteen to thirty documents per employee that is a
// pure waterfall that grows every time an HR template is added.
//
// Supabase exposes createSignedUrls (plural) per bucket, so the whole page
// needs one round trip per DISTINCT bucket instead of one per file. The
// grouping is pure and unit-tested; only the dispatch touches the network.

/** Default lifetime. The old 60s expired before anyone clicked the link. */
export const defaultSignedUrlTtlSeconds = 300;

export interface SignedUrlRequest {
  /** Whatever the caller wants to look the result up by (assignment id, file id…). */
  key: string;
  bucket: string;
  path: string | null | undefined;
}

export interface BucketBatch {
  bucket: string;
  /** Deduplicated — two records pointing at one object cost one signature. */
  paths: string[];
  /** path -> every key that asked for it. */
  keysByPath: Map<string, string[]>;
}

/**
 * Groups requests into one batch per bucket, dropping entries with no path.
 */
export function groupSignedUrlRequests(requests: readonly SignedUrlRequest[]): BucketBatch[] {
  const byBucket = new Map<string, BucketBatch>();

  for (const request of requests) {
    const path = typeof request.path === "string" ? request.path.trim() : "";
    if (!path || !request.bucket) continue;

    let batch = byBucket.get(request.bucket);
    if (!batch) {
      batch = { bucket: request.bucket, paths: [], keysByPath: new Map() };
      byBucket.set(request.bucket, batch);
    }

    const existing = batch.keysByPath.get(path);
    if (existing) {
      existing.push(request.key);
    } else {
      batch.keysByPath.set(path, [request.key]);
      batch.paths.push(path);
    }
  }

  return [...byBucket.values()];
}

/** Shape of the rows Supabase returns from createSignedUrls. */
export interface SignedUrlRow {
  path?: string | null;
  signedUrl?: string | null;
  error?: string | null;
}

/** Folds one bucket's response back onto the caller's keys. */
export function collectSignedUrls(batch: BucketBatch, rows: readonly SignedUrlRow[] | null | undefined): Map<string, string> {
  const urls = new Map<string, string>();

  for (const row of rows ?? []) {
    const path = typeof row?.path === "string" ? row.path : null;
    const signedUrl = typeof row?.signedUrl === "string" ? row.signedUrl : null;
    if (!path || !signedUrl) continue;

    for (const key of batch.keysByPath.get(path) ?? []) {
      urls.set(key, signedUrl);
    }
  }

  return urls;
}

/** Same convention as the modules that call this (see lib/files/access.ts). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseStorage = any;

/**
 * Signs everything in `requests`, one round trip per bucket, all in parallel.
 *
 * A bucket that fails contributes nothing rather than throwing: a signed URL is
 * a convenience on a page that still renders without it, and one broken bucket
 * must not blank out the others.
 */
export async function createSignedUrlMap(
  storage: LooseStorage,
  requests: readonly SignedUrlRequest[],
  expiresIn: number = defaultSignedUrlTtlSeconds,
): Promise<Map<string, string>> {
  const batches = groupSignedUrlRequests(requests);
  if (batches.length === 0) return new Map();

  const results = await Promise.all(
    batches.map(async (batch) => {
      try {
        const { data } = await storage.from(batch.bucket).createSignedUrls(batch.paths, expiresIn);
        return collectSignedUrls(batch, data as SignedUrlRow[] | null);
      } catch {
        return new Map<string, string>();
      }
    }),
  );

  const merged = new Map<string, string>();
  for (const result of results) {
    for (const [key, url] of result) merged.set(key, url);
  }
  return merged;
}
