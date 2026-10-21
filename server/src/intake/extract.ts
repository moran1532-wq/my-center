import { convert } from "html-to-text";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import type { Extracted } from "./types.js";
export type { Extracted };

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_CHARS = 60_000;

export class ExtractError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}


function finish(text: string, kind: Extracted["kind"], pageTitle?: string): Extracted {
  const clean = text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) throw new ExtractError("empty");
  const truncated = clean.length > MAX_TEXT_CHARS;
  return { text: truncated ? clean.slice(0, MAX_TEXT_CHARS) : clean, kind, truncated, ...(pageTitle ? { pageTitle } : {}) };
}

/** Text only: scripts, styles and images are dropped, links keep their visible text. */
export function htmlToText(html: string) {
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim();
  const text = convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "a", options: { ignoreHref: true } },
      { selector: "img", format: "skip" },
      { selector: "script", format: "skip" },
      { selector: "style", format: "skip" },
      { selector: "nav", format: "skip" },
    ],
  });
  return { text, title };
}

export async function extractFromFile(data: Buffer, filename: string): Promise<Extracted> {
  if (data.length > MAX_FILE_BYTES) throw new ExtractError("too_large");
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  try {
    if (ext === "pdf") {
      const pdf = await getDocumentProxy(new Uint8Array(data));
      const { text } = await extractText(pdf, { mergePages: true });
      return finish(Array.isArray(text) ? text.join("\n\n") : text, "pdf");
    }
    if (ext === "docx") {
      const { value } = await mammoth.extractRawText({ buffer: data });
      return finish(value, "word");
    }
    if (ext === "html" || ext === "htm") {
      const { text, title } = htmlToText(data.toString("utf8"));
      return finish(text, "html", title);
    }
    if (ext === "txt" || ext === "md") return finish(data.toString("utf8"), "text");
  } catch (e) {
    if (e instanceof ExtractError) throw e;
    throw new ExtractError("unreadable");
  }
  throw new ExtractError("unsupported");
}

export function extractFromPaste(text: string): Extracted {
  return finish(text, "paste");
}

const MAX_LINK_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;

/** Allowed when the host is listed, or is a subdomain of a listed host. */
export function hostAllowed(host: string, allowed: string[]) {
  const h = host.toLowerCase();
  return allowed.some((a) => {
    const x = a.trim().toLowerCase();
    return x && (h === x || h.endsWith("." + x));
  });
}

/**
 * Reads a web page - only from approved hosts, so the server can't be pointed at other internal services.
 * Every redirect is checked against the same list.
 */
export async function extractFromLink(
  raw: string,
  allowedHosts: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<Extracted & { finalUrl: string }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ExtractError("bad_link");
  }
  for (let hop = 0; ; hop++) {
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new ExtractError("bad_link");
    if (url.username || url.password) throw new ExtractError("bad_link");
    if (!hostAllowed(url.hostname, allowedHosts)) throw new ExtractError("host_not_allowed");

    let res: Response;
    try {
      res = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
    } catch {
      throw new ExtractError("link_unreachable");
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      if (hop >= MAX_REDIRECTS) throw new ExtractError("link_unreachable");
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok) throw new ExtractError("link_unreachable");
    if (Number(res.headers.get("content-length") ?? 0) > MAX_LINK_BYTES) throw new ExtractError("too_large");

    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_LINK_BYTES) {
          await reader.cancel();
          throw new ExtractError("too_large");
        }
        chunks.push(value);
      }
    }
    const body = Buffer.concat(chunks);
    const type = res.headers.get("content-type") ?? "";
    let out: Extracted;
    if (type.includes("pdf")) out = await extractFromFile(body, "page.pdf");
    else if (type.includes("html")) {
      const { text, title } = htmlToText(body.toString("utf8"));
      out = finish(text, "link", title);
    } else if (type.startsWith("text/")) out = finish(body.toString("utf8"), "link");
    else throw new ExtractError("unsupported");
    return { ...out, kind: "link", finalUrl: url.toString() };
  }
}
