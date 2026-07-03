import type { ContextManifest, SharedContext } from "./types";

export function createContextManifest(input: {
  renderedPrompt: string;
  userTask?: string;
  sharedContext: SharedContext;
  digest?: (value: string) => string;
}): ContextManifest {
  const digest = input.digest ?? stableDigest;
  const files = input.sharedContext.files?.map((file) => ({
    path: file.path,
    digest: file.digest ?? digest(file.content ?? ""),
  }));
  const references = input.sharedContext.references?.map((reference) => ({
    label: reference.label,
    digest: reference.digest ?? digest(reference.uri ?? ""),
  }));

  return {
    renderedPromptHash: digest(input.renderedPrompt),
    userTaskHash:
      input.userTask === undefined ? undefined : digest(input.userTask),
    sharedContextHash: digest(stableStringify(input.sharedContext)),
    files,
    references,
  };
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(
        ([key, entryValue]) =>
          `${JSON.stringify(key)}:${stableStringify(entryValue)}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function stableDigest(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
