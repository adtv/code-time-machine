import * as vscode from 'vscode';
import type { LineEnding } from '../../shared/models/revision';
import { decodeUtf8, isProbablyBinary, splitLines } from '../../shared/util/text';

export interface WorkingTreeSnapshot {
  kind: 'text' | 'binary';
  lines: string[];
  eol: LineEnding;
  byteLength: number;
  /** True when the snapshot comes from an unsaved editor buffer. */
  dirty: boolean;
}

/** Reads the current on-disk / in-editor content of a file. Pure interface for testability. */
export interface WorkingTreeReader {
  /** Returns undefined when the file does not exist. */
  read(fileFsPath: string): Promise<WorkingTreeSnapshot | undefined>;
}

/**
 * Prefers the open TextDocument (what the user sees, including unsaved edits) and falls back to
 * the file system.
 */
export class VsCodeWorkingTreeReader implements WorkingTreeReader {
  async read(fileFsPath: string): Promise<WorkingTreeSnapshot | undefined> {
    const uri = vscode.Uri.file(fileFsPath);
    const open = vscode.workspace.textDocuments.find(
      (doc) => doc.uri.scheme === 'file' && doc.uri.fsPath === uri.fsPath,
    );
    if (open) {
      const text = open.getText();
      const { lines, eol } = splitLines(text);
      return {
        kind: 'text',
        lines,
        eol,
        byteLength: Buffer.byteLength(text, 'utf8'),
        dirty: open.isDirty,
      };
    }
    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(uri);
    } catch {
      return undefined;
    }
    if (isProbablyBinary(bytes)) {
      return { kind: 'binary', lines: [], eol: 'none', byteLength: bytes.length, dirty: false };
    }
    const { lines, eol } = splitLines(decodeUtf8(bytes));
    return { kind: 'text', lines, eol, byteLength: bytes.length, dirty: false };
  }
}
