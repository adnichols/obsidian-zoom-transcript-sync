import { Plugin, Notice } from 'obsidian';
import { ZoomSyncSettings } from './types';
import { ZoomSyncSettingTab } from './settings';
import { ZoomApiClient, extractParticipantsFromRecording } from './zoom-api';
import { SyncStateManager } from './sync-state';
import { TranscriptWriter } from './transcript-writer';

const DEFAULT_SETTINGS: ZoomSyncSettings = {
  accountId: "",
  clientId: "",
  clientSecret: "",
  transcriptFolder: "zoom-transcripts",
  syncIntervalMinutes: 30
};

export default class ZoomTranscriptSync extends Plugin {
  settings!: ZoomSyncSettings;
  private syncInProgress = false;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new ZoomSyncSettingTab(this.app, this));
    this.addCommand({
      id: 'sync-now',
      name: 'Sync Zoom Transcripts Now',
      callback: () => this.syncTranscripts()
    });
    this.registerInterval(
      window.setInterval(() => this.syncTranscripts(), this.settings.syncIntervalMinutes * 60 * 1000)
    );
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async syncTranscripts() {
    // Check lock and return early if already syncing
    if (this.syncInProgress) {
      return;
    }

    this.syncInProgress = true;

    try {
      // Create ZoomApiClient with settings
      const apiClient = new ZoomApiClient(this.settings);

      // Create SyncStateManager
      const stateManager = new SyncStateManager(
        this.app.vault,
        this.settings.transcriptFolder
      );

      // Load current sync state
      await stateManager.readState();

      // Get recordings, using lastSyncTimestamp if available
      let recordings;
      try {
        if (this.settings.lastSyncTimestamp) {
          const fromDate = new Date(this.settings.lastSyncTimestamp);
          recordings = await apiClient.listRecordings(fromDate);
        } else {
          recordings = await apiClient.listRecordings();
        }
      } catch (error) {
        // Handle auth errors
        if (error instanceof Error) {
          const message = error.message.toLowerCase();
          if (message.includes('401') || message.includes('403') || message.includes('invalid') || message.includes('unauthorized')) {
            new Notice('Zoom sync failed: invalid credentials. Check settings.');
            return;
          }
          if (message.includes('429') || message.includes('rate')) {
            new Notice('Zoom sync rate limited. Waiting before retry.');
            return;
          }
          if (message.includes('network') || message.includes('timeout') || message.includes('econnreset')) {
            new Notice('Zoom sync failed: network error. Will retry.');
            return;
          }
        }
        throw error;
      }

      let syncedCount = 0;

      // Process one transcript at a time to limit memory usage
      for (const recording of recordings) {
        const meetingId = String(recording.id);

        // Check if already synced (both state and file existence)
        if (stateManager.isSynced(meetingId)) {
          continue;
        }

        // Find transcript file (type: audio_transcript)
        const transcriptFile = recording.recording_files?.find(
          file => file.recording_type === 'audio_transcript'
        );

        if (!transcriptFile || !transcriptFile.download_url) {
          continue;
        }

        // Download VTT content
        let vttContent;
        try {
          vttContent = await apiClient.downloadTranscript(transcriptFile.download_url);
        } catch (error) {
          // Handle download errors
          if (error instanceof Error) {
            const message = error.message.toLowerCase();
            if (message.includes('429') || message.includes('rate')) {
              new Notice('Zoom sync rate limited. Waiting before retry.');
              return;
            }
            if (message.includes('network') || message.includes('timeout') || message.includes('econnreset')) {
              new Notice('Zoom sync failed: network error. Will retry.');
              return;
            }
          }
          throw error;
        }

        // Extract attendees from recording
        const attendees = extractParticipantsFromRecording(recording);

        // Create TranscriptWriter and generate filename
        const writer = new TranscriptWriter(recording);
        let fileName = writer.generateFileName();

        // Check for file collision, append ID if needed
        if (TranscriptWriter.fileExists(this.app.vault, this.settings.transcriptFolder, fileName)) {
          fileName = writer.generateFileName(true);
        }

        // Generate transcript content
        const content = writer.generateTranscript(vttContent, attendees);

        // Write to vault
        await TranscriptWriter.writeToVault(
          this.app.vault,
          this.settings.transcriptFolder,
          fileName,
          content
        );

        // Mark as synced in state
        stateManager.markSynced(meetingId, fileName);

        // Write state after each transcript (for crash recovery)
        await stateManager.writeState();

        syncedCount++;
      }

      // Update lastSyncTimestamp in settings
      this.settings.lastSyncTimestamp = Date.now();
      await this.saveSettings();

      // Show appropriate notice based on results
      if (syncedCount > 0) {
        new Notice(`Synced ${syncedCount} new transcript(s)`);
      }
      // No notice if no new transcripts
    } finally {
      // Always release lock
      this.syncInProgress = false;
    }
  }
}
