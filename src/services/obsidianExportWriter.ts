import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

/**
 * MAR-79 — Obsidian export: file writer.
 * Writes the exported markdown vault to disk.
 */

export type WriteResult = {
  export_dir: string;
  files_written: number;
  errors: string[];
};

/**
 * Write the exported markdown files to a directory.
 * Creates the directory structure and writes each file as UTF-8 markdown.
 */
export function writeExportToDisk(
  exportDir: string,
  files: Array<{ path: string; content: string }>,
): WriteResult {
  const errors: string[] = [];
  let filesWritten = 0;

  try {
    // Ensure root directory exists
    if (!existsSync(exportDir)) {
      mkdirSync(exportDir, { recursive: true });
    }

    for (const file of files) {
      const fullPath = `${exportDir}/${file.path}`;
      const dirPath = dirname(fullPath);

      try {
        // Create parent directories if needed
        if (!existsSync(dirPath)) {
          mkdirSync(dirPath, { recursive: true });
        }

        // Write file as UTF-8
        writeFileSync(fullPath, file.content, { encoding: "utf-8" });
        filesWritten++;
      } catch (err) {
        errors.push(`Failed to write ${file.path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    errors.push(`Export directory error: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    export_dir: exportDir,
    files_written: filesWritten,
    errors,
  };
}
