import { Vault } from 'obsidian';
import { SyncState } from './types';

export class SyncStateManager {
  private vault: Vault;
  private transcriptFolder: string;
  private state: SyncState | null = null;

  constructor(vault: Vault, transcriptFolder: string) {
    this.vault = vault;
    this.transcriptFolder = transcriptFolder;
  }

  get stateFilePath(): string {
    return `${this.transcriptFolder}/.zoom-sync-state.json`;
  }

  public async readState(): Promise<SyncState> {
    try {
      const content = await this.vault.adapter.read(this.stateFilePath);
      this.state = JSON.parse(content) as SyncState;
      return this.state;
    } catch {
      // File doesn't exist or invalid JSON, return default state
      this.state = { version: 1, syncedMeetings: {} };
      return this.state;
    }
  }

  public async writeState(): Promise<void> {
    if (!this.state) {
      throw new Error('No state to write. Call readState() first.');
    }

    const content = JSON.stringify(this.state, null, 2);
    const tempPath = `${this.stateFilePath}.tmp`;

    // Write to temp file first
    await this.vault.adapter.write(tempPath, content);

    // Atomic rename to actual file
    await this.vault.adapter.rename(tempPath, this.stateFilePath);
  }

  public isSynced(meetingId: string): boolean {
    if (!this.state) {
      return false;
    }
    return meetingId in this.state.syncedMeetings;
  }

  public markSynced(meetingId: string, fileName: string): void {
    if (!this.state) {
      this.state = { version: 1, syncedMeetings: {} };
    }
    this.state.syncedMeetings[meetingId] = {
      syncedAt: Date.now(),
      fileName: fileName,
    };
  }
}
