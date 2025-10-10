/**
 * Minimal DOMParser polyfill for Cloudflare Workers.
 *
 * Some dependencies expect a browser-like DOMParser to exist, but Workers don't
 * provide one by default. This stub prevents runtime ReferenceError crashes by
 * returning an empty document-like object whenever parsing is requested.
 */

type MinimalDocument = {
  textContent: string | null;
  querySelector: (selector: string) => null;
  querySelectorAll: (selector: string) => [];
  getElementsByTagName: (tagName: string) => [];
};

if (typeof (globalThis as unknown as { DOMParser?: unknown }).DOMParser === 'undefined') {
  class WorkerDOMParser {
    parseFromString(): MinimalDocument {
      console.warn(
        'DOMParser is not available in this environment. Returning an empty document.'
      );
      return {
        textContent: null,
        querySelector: () => null,
        querySelectorAll: () => [],
        getElementsByTagName: () => [],
      } satisfies MinimalDocument;
    }
  }

  (globalThis as typeof globalThis & { DOMParser: typeof WorkerDOMParser }).DOMParser =
    WorkerDOMParser;
}
