import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { checkSafeExportArchive } from "./check-safe-export.js";
import {
  findForbiddenArchivePaths,
  FORBIDDEN_ARCHIVE_RULES,
} from "./safe-export-rules.js";

const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const UTF8_FILE_NAME_FLAG = 0x0800;
const DOS_EPOCH_DATE = 0x0021;
const DOS_EPOCH_TIME = 0x0000;

type ZipEntry = {
  name: string;
  data: Buffer;
  crc32: number;
  localHeaderOffset: number;
};

function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
}

function outputPath(root: string, argv: string[]): string {
  const outputFlagIndex = argv.findIndex((arg) => arg === "--output" || arg === "-o");
  const configuredPath =
    outputFlagIndex >= 0
      ? argv[outputFlagIndex + 1]
      : argv.find((arg) => arg !== "--" && !arg.startsWith("-"));
  const fallback = join(root, "exports", "orchestratekit-mcp-source.zip");

  if (!configuredPath) return fallback;
  return isAbsolute(configuredPath) ? configuredPath : resolve(root, configuredPath);
}

function sourceFilePaths(root: string): string[] {
  const output = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: root },
  );

  return output
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((path) => {
      const absolutePath = join(root, path);
      return existsSync(absolutePath) && statSync(absolutePath).isFile();
    })
    .filter((path) => findForbiddenArchivePaths([`orchestratekit-mcp/${path}`]).length === 0)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function localFileHeader(entry: ZipEntry): Buffer {
  const name = Buffer.from(entry.name, "utf8");
  const header = Buffer.alloc(30);
  header.writeUInt32LE(ZIP_LOCAL_FILE_HEADER_SIGNATURE, 0);
  header.writeUInt16LE(10, 4);
  header.writeUInt16LE(UTF8_FILE_NAME_FLAG, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(DOS_EPOCH_TIME, 10);
  header.writeUInt16LE(DOS_EPOCH_DATE, 12);
  header.writeUInt32LE(entry.crc32, 14);
  header.writeUInt32LE(entry.data.length, 18);
  header.writeUInt32LE(entry.data.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, name]);
}

function centralDirectoryHeader(entry: ZipEntry): Buffer {
  const name = Buffer.from(entry.name, "utf8");
  const header = Buffer.alloc(46);
  header.writeUInt32LE(ZIP_CENTRAL_DIRECTORY_SIGNATURE, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(10, 6);
  header.writeUInt16LE(UTF8_FILE_NAME_FLAG, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(DOS_EPOCH_TIME, 12);
  header.writeUInt16LE(DOS_EPOCH_DATE, 14);
  header.writeUInt32LE(entry.crc32, 16);
  header.writeUInt32LE(entry.data.length, 20);
  header.writeUInt32LE(entry.data.length, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(entry.localHeaderOffset, 42);
  return Buffer.concat([header, name]);
}

function endOfCentralDirectory(entryCount: number, centralSize: number, centralOffset: number): Buffer {
  const header = Buffer.alloc(22);
  header.writeUInt32LE(ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
  header.writeUInt16LE(0, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(entryCount, 8);
  header.writeUInt16LE(entryCount, 10);
  header.writeUInt32LE(centralSize, 12);
  header.writeUInt32LE(centralOffset, 16);
  header.writeUInt16LE(0, 20);
  return header;
}

function writeSourceZip(root: string, archivePath: string): number {
  const entries: ZipEntry[] = [];
  const localParts: Buffer[] = [];
  let offset = 0;

  for (const relPath of sourceFilePaths(root)) {
    const name = `orchestratekit-mcp/${relPath.replace(/\\/g, "/")}`;
    const data = readFileSync(join(root, relPath));
    const entry: ZipEntry = {
      name,
      data,
      crc32: crc32(data),
      localHeaderOffset: offset,
    };
    const header = localFileHeader(entry);
    localParts.push(header, data);
    offset += header.length + data.length;
    entries.push(entry);
  }

  const centralParts = entries.map(centralDirectoryHeader);
  const centralDirectory = Buffer.concat(centralParts);
  const eocd = endOfCentralDirectory(entries.length, centralDirectory.length, offset);
  writeFileSync(archivePath, Buffer.concat([...localParts, centralDirectory, eocd]));
  return entries.length;
}

function main(): void {
  const root = repoRoot();
  const archivePath = outputPath(root, process.argv.slice(2));

  mkdirSync(dirname(archivePath), { recursive: true });
  const entryCount = writeSourceZip(root, archivePath);

  const forbidden = checkSafeExportArchive(archivePath);
  if (forbidden.length > 0) {
    process.stderr.write(`safe export created an unsafe archive: ${archivePath}\n`);
    for (const match of forbidden) {
      process.stderr.write(`  ${match.rule}: ${match.path}\n`);
    }
    process.exit(1);
  }

  process.stderr.write(
    `safe export ready: ${archivePath} (${entryCount} source files)\n` +
      `checked forbidden paths: ${FORBIDDEN_ARCHIVE_RULES.join(", ")}\n`,
  );
}

main();
