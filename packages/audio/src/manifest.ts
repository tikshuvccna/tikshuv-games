import type { ABuffer, AContextLike } from './types.js';

export interface AssetEntry { url: string; kind?: 'music' | 'ambience' | 'sfx' }
export type AssetManifest = Record<string, AssetEntry>;
export type FetchLike = (url: string) => Promise<{ ok: boolean; arrayBuffer(): Promise<ArrayBuffer> }>;

/** Lazy asset loader. Every failure resolves to null (never throws) and is remembered. */
export class AssetLoader {
  private manifest: AssetManifest = {};
  private cache = new Map<string, ABuffer>();
  private pending = new Map<string, Promise<ABuffer | null>>();
  readonly failed = new Set<string>();

  constructor(
    private readonly ctx: AContextLike,
    private readonly fetchFn: FetchLike | undefined,
    private readonly onWarn: (msg: string) => void = () => {},
  ) {}

  setManifest(m: AssetManifest): void {
    this.manifest = { ...m };
    this.failed.clear(); // new urls: retry allowed
  }

  has(id: string): boolean { return id in this.manifest; }
  getCached(id: string): ABuffer | null { return this.cache.get(id) ?? null; }

  load(id: string): Promise<ABuffer | null> {
    const hit = this.cache.get(id);
    if (hit) return Promise.resolve(hit);
    if (this.failed.has(id)) return Promise.resolve(null);
    const inflight = this.pending.get(id);
    if (inflight) return inflight;
    const p = this.doLoad(id).finally(() => this.pending.delete(id));
    this.pending.set(id, p);
    return p;
  }

  private async doLoad(id: string): Promise<ABuffer | null> {
    const entry = this.manifest[id];
    if (!entry) { this.failed.add(id); this.onWarn(`audio: no manifest entry for "${id}"`); return null; }
    try {
      if (!this.fetchFn) throw new Error('no fetch available');
      const res = await this.fetchFn(entry.url);
      if (!res.ok) throw new Error('HTTP error');
      const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
      this.cache.set(id, buf);
      return buf;
    } catch (e) {
      this.failed.add(id);
      this.onWarn(`audio: failed to load "${id}" (${entry.url}): ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }
}
