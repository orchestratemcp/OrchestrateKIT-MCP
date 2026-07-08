export type ForbiddenArchiveMatch = {
  path: string;
  rule: string;
};

export const FORBIDDEN_ARCHIVE_RULES = [
  ".claude/",
  ".claude/settings.local.json",
  ".env*",
  ".wrangler/",
  "dist/",
  ".next/",
  ".labos/",
  "node_modules/",
  "*.db",
  "*.sqlite",
  "logs",
  "root ai-agent-briefing-*",
] as const;

function normalizeArchivePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function pathParts(path: string): string[] {
  return normalizeArchivePath(path)
    .split("/")
    .filter((part) => part.length > 0);
}

function hasSegment(parts: string[], segment: string): boolean {
  return parts.some((part) => part.toLowerCase() === segment);
}

export function findForbiddenArchivePaths(paths: string[]): ForbiddenArchiveMatch[] {
  const matches: ForbiddenArchiveMatch[] = [];

  for (const originalPath of paths) {
    const normalized = normalizeArchivePath(originalPath);
    const lower = normalized.toLowerCase();
    const parts = pathParts(normalized);
    const lowerParts = parts.map((part) => part.toLowerCase());
    const basename = lowerParts.at(-1) ?? "";
    const isRootBriefing =
      (parts.length === 1 && lower.startsWith("ai-agent-briefing-")) ||
      (parts.length === 2 &&
        lowerParts[0] === "orchestratekit-mcp" &&
        lowerParts[1].startsWith("ai-agent-briefing-"));

    if (hasSegment(parts, ".claude")) {
      matches.push({ path: originalPath, rule: ".claude/" });
      continue;
    }

    if (lower.endsWith("/.claude/settings.local.json")) {
      matches.push({ path: originalPath, rule: ".claude/settings.local.json" });
      continue;
    }

    if (basename.startsWith(".env")) {
      matches.push({ path: originalPath, rule: ".env*" });
      continue;
    }

    if (hasSegment(parts, ".wrangler")) {
      matches.push({ path: originalPath, rule: ".wrangler/" });
      continue;
    }

    if (hasSegment(parts, "dist")) {
      matches.push({ path: originalPath, rule: "dist/" });
      continue;
    }

    if (hasSegment(parts, ".next")) {
      matches.push({ path: originalPath, rule: ".next/" });
      continue;
    }

    if (hasSegment(parts, ".labos")) {
      matches.push({ path: originalPath, rule: ".labos/" });
      continue;
    }

    if (hasSegment(parts, "node_modules")) {
      matches.push({ path: originalPath, rule: "node_modules/" });
      continue;
    }

    if (basename.endsWith(".db")) {
      matches.push({ path: originalPath, rule: "*.db" });
      continue;
    }

    if (basename.endsWith(".sqlite")) {
      matches.push({ path: originalPath, rule: "*.sqlite" });
      continue;
    }

    if (basename.endsWith(".log") || hasSegment(parts, "logs")) {
      matches.push({ path: originalPath, rule: "logs" });
      continue;
    }

    if (isRootBriefing) {
      matches.push({ path: originalPath, rule: "root ai-agent-briefing-*" });
    }
  }

  return matches;
}
