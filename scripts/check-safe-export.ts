import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  findForbiddenArchivePaths,
  FORBIDDEN_ARCHIVE_RULES,
  type ForbiddenArchiveMatch,
} from "./safe-export-rules.js";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const MAX_EOCD_SEARCH = 65_557;

export function readZipEntryNames(zipPath: string): string[] {
  const buffer = readFileSync(zipPath);
  const searchStart = Math.max(0, buffer.length - MAX_EOCD_SEARCH);
  let eocdOffset = -1;

  for (let offset = buffer.length - 22; offset >= searchStart; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) {
      eocdOffset = offset;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error(`not a zip archive or missing central directory: ${zipPath}`);
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const names: string[] = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error(`invalid zip central directory near entry ${index + 1}: ${zipPath}`);
    }

    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraFieldLength = buffer.readUInt16LE(offset + 30);
    const fileCommentLength = buffer.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;

    names.push(buffer.subarray(nameStart, nameEnd).toString("utf8"));
    offset = nameEnd + extraFieldLength + fileCommentLength;
  }

  return names;
}

export function checkSafeExportArchive(zipPath: string): ForbiddenArchiveMatch[] {
  return findForbiddenArchivePaths(readZipEntryNames(zipPath));
}

function parseArgs(argv: string[]): { archivePath: string | null; list: boolean } {
  let list = false;
  let archivePath: string | null = null;

  for (const arg of argv) {
    if (arg === "--") {
      continue;
    }
    if (arg === "--list") {
      list = true;
      continue;
    }
    archivePath = arg;
  }

  return { archivePath, list };
}

function main(): void {
  const { archivePath, list } = parseArgs(process.argv.slice(2));

  if (!archivePath) {
    process.stderr.write("usage: pnpm tsx scripts/check-safe-export.ts [--list] <archive.zip>\n");
    process.exit(2);
  }

  const absoluteArchivePath = resolve(archivePath);
  const entries = readZipEntryNames(absoluteArchivePath);
  const forbidden = findForbiddenArchivePaths(entries);

  if (list) {
    for (const entry of entries) {
      process.stdout.write(`${entry}\n`);
    }
  }

  if (forbidden.length > 0) {
    process.stderr.write(`safe-export check FAILED for ${absoluteArchivePath}\n`);
    for (const match of forbidden) {
      process.stderr.write(`  ${match.rule}: ${match.path}\n`);
    }
    process.exit(1);
  }

  process.stderr.write(
    `safe-export check passed for ${absoluteArchivePath}: ${entries.length} entries; ` +
      `checked ${FORBIDDEN_ARCHIVE_RULES.join(", ")}\n`,
  );
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main();
}
