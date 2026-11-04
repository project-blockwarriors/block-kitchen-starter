export type Manifest = {
  protocol: 'dreamweaver.v4' | 'dream-kitchen.v1';
  runtime: 'node24' | 'python312';
  entrypoint: string;
  name: string;
};
export type SubmissionReceipt = {
  sha: string;
  manifest: Manifest;
  files: number;
  expandedBytes: number;
  archiveBytes: number;
  archiveSha256: string;
  uncommittedChanges: boolean;
};
export function validateManifest(manifest: unknown): Manifest;
export function loadSubmission(ref?: string, cwd?: string): { receipt: SubmissionReceipt; archive: Buffer };
export function inspectSubmission(ref?: string, cwd?: string): SubmissionReceipt;
