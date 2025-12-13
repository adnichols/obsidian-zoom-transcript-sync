import { Plugin, Notice } from 'obsidian';
import { ZoomSyncSettings, ZoomPastMeeting } from './types';
import { ZoomSyncSettingTab } from './settings';
import { ZoomApiClient, extractParticipantsFromRecording } from './zoom-api';
import { SyncStateManager } from './sync-state';
import { TranscriptWriter } from './transcript-writer';

const DEFAULT_SETTINGS: ZoomSyncSettings = {
  accountId: "",
  clientId: "",
  clientSecret: "",
  userEmail: "",
  userEmails: "",
  transcriptFolder: "zoom-transcripts",
  syncIntervalMinutes: 30,
  fetchRecordingTranscripts: true,
  fetchAICompanionTranscripts: false
};

export default class ZoomTranscriptSync extends Plugin {
  settings!: ZoomSyncSettings;
  private syncInProgress = false;
  private apiClient: ZoomApiClient | null = null;
  autoSyncEnabled = true;

  private devLog(message: string): void {
    if (process.env.NODE_ENV !== 'production') {
      console.log(message);
    }
  }

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new ZoomSyncSettingTab(this.app, this));
    this.addCommand({
      id: 'sync-now',
      name: 'Sync Zoom Transcripts Now',
      callback: () => this.syncTranscripts()
    });
    this.registerInterval(
      window.setInterval(() => {
        if (this.autoSyncEnabled) {
          this.syncTranscripts();
        }
      }, this.settings.syncIntervalMinutes * 60 * 1000)
    );
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /**
   * Handles common API errors and returns true if sync should stop.
   */
  private handleApiError(error: unknown, apiClient: ZoomApiClient): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (message.includes('401') || message.includes('403') || message.includes('invalid') || message.includes('unauthorized')) {
        apiClient.clearAccessToken();
        this.autoSyncEnabled = false;
        new Notice('Zoom sync failed: invalid credentials. Check settings.');
        return true;
      }
      if (message.includes('429') || message.includes('rate')) {
        new Notice('Zoom sync rate limited. Waiting before retry.');
        return true;
      }
      if (message.includes('network') || message.includes('timeout') || message.includes('econnreset')) {
        new Notice('Zoom sync failed: network error. Will retry.');
        return true;
      }
    }
    return false;
  }

  async syncTranscripts() {
    // Check lock and return early if already syncing
    if (this.syncInProgress) {
      return;
    }

    // Check if at least one transcript source is enabled
    if (!this.settings.fetchRecordingTranscripts && !this.settings.fetchAICompanionTranscripts) {
      this.devLog('No transcript sources enabled, skipping sync');
      return;
    }

    this.syncInProgress = true;
    this.devLog('Zoom sync starting...');

    try {
      // Create ZoomApiClient with settings (store as instance variable)
      this.apiClient = new ZoomApiClient(this.settings);
      const apiClient = this.apiClient;

      // Create SyncStateManager
      const stateManager = new SyncStateManager(
        this.app.vault,
        this.settings.transcriptFolder
      );

      // Load current sync state
      await stateManager.readState();

      let syncedCount = 0;
      let skippedCount = 0;
      let failedCount = 0;

      // Track processed meeting UUIDs to avoid duplicates across sources
      const processedUuids = new Set<string>();

      // Determine start date for queries
      const fromDate = this.settings.lastSyncTimestamp
        ? new Date(this.settings.lastSyncTimestamp)
        : undefined;

      // ============================================
      // Source 1: Cloud Recording Transcripts
      // ============================================
      if (this.settings.fetchRecordingTranscripts) {
        this.devLog('Fetching cloud recording transcripts...');

        let recordings;
        try {
          recordings = await apiClient.listRecordings(fromDate);
        } catch (error) {
          if (this.handleApiError(error, apiClient)) {
            return;
          }
          throw error;
        }

        this.devLog(`Fetched ${recordings.length} recordings with transcripts`);

        for (const recording of recordings) {
          const meetingId = String(recording.id);
          const meetingUuid = recording.uuid;

          // Track as processed
          processedUuids.add(meetingUuid);

          // Check if already synced
          if (stateManager.isSynced(meetingId)) {
            skippedCount++;
            this.devLog(`Skipped (already exists): ${meetingId}`);
            continue;
          }

          // Find transcript file
          const transcriptFile = recording.recording_files?.find(
            file => file.recording_type === 'audio_transcript'
          );

          if (!transcriptFile || !transcriptFile.download_url) {
            continue;
          }

          try {
            // Download VTT content
            let vttContent;
            try {
              vttContent = await apiClient.downloadTranscript(transcriptFile.download_url);
            } catch (error) {
              if (this.handleApiError(error, apiClient)) {
                return;
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
            await stateManager.writeState();

            this.devLog(`Synced (recording): ${fileName}`);
            syncedCount++;
          } catch (error) {
            failedCount++;
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.devLog(`Failed: ${meetingId} - ${errorMessage}`);
          }
        }
      }

      // ============================================
      // Source 2: AI Companion Transcripts
      // ============================================
      if (this.settings.fetchAICompanionTranscripts) {
        this.devLog('Fetching AI Companion transcripts...');

        let pastMeetings: ZoomPastMeeting[] = [];
        try {
          pastMeetings = await apiClient.listPastMeetings(fromDate);
        } catch (error) {
          if (this.handleApiError(error, apiClient)) {
            return;
          }
          // Log but don't fail entire sync if reports API fails
          this.devLog(`Failed to list past meetings: ${error instanceof Error ? error.message : String(error)}`);
        }

        this.devLog(`Fetched ${pastMeetings.length} past meetings to check for AI transcripts`);

        for (const meeting of pastMeetings) {
          const meetingId = String(meeting.id);
          const meetingUuid = meeting.uuid;

          // Skip if already processed from recordings
          if (processedUuids.has(meetingUuid)) {
            continue;
          }

          // Check if already synced
          if (stateManager.isSynced(meetingId)) {
            skippedCount++;
            this.devLog(`Skipped (already exists): ${meetingId}`);
            continue;
          }

          try {
            // Try to get transcript for this meeting
            this.devLog(`Checking transcript for meeting ${meetingId}, UUID: ${meetingUuid}`);
            let transcripts;
            try {
              transcripts = await apiClient.getMeetingTranscript(meetingUuid);
            } catch (error) {
              // Don't treat auth errors on transcript endpoint as fatal - might just be missing scope
              // Log and skip this meeting
              const errorMessage = error instanceof Error ? error.message : String(error);
              this.devLog(`Transcript fetch error for ${meetingUuid}: ${errorMessage}`);
              if (errorMessage.includes('401') || errorMessage.includes('403') || errorMessage.includes('404')) {
                continue;
              }
              throw error;
            }

            if (!transcripts || transcripts.length === 0) {
              // No transcript available for this meeting
              continue;
            }

            // Get the first transcript that can be downloaded
            const transcript = transcripts.find(t => t.can_download && t.download_url);
            if (!transcript) {
              this.devLog(`No downloadable transcript found for ${meetingId}`);
              continue;
            }

            this.devLog(`Downloading transcript from: ${transcript.download_url}`);

            // Download the transcript content
            let transcriptContent;
            try {
              transcriptContent = await apiClient.downloadTranscriptDirect(transcript.download_url);
              this.devLog(`Downloaded transcript content length: ${transcriptContent?.length || 0}`);
            } catch (error) {
              // Don't treat download auth errors as fatal for AI Companion
              const errorMessage = error instanceof Error ? error.message : String(error);
              if (errorMessage.includes('401') || errorMessage.includes('403')) {
                this.devLog(`Skipping ${meetingId}: download returned ${errorMessage}`);
                continue;
              }
              if (this.handleApiError(error, apiClient)) {
                return;
              }
              throw error;
            }

            // Create a pseudo-recording object for TranscriptWriter
            const pseudoRecording = {
              uuid: meetingUuid,
              id: meeting.id,
              account_id: transcript.account_id,
              host_id: transcript.host_id,
              topic: meeting.topic || transcript.meeting_topic,
              type: meeting.type,
              start_time: meeting.start_time,
              duration: meeting.duration,
              total_size: 0,
              recording_count: 0,
              recording_files: []
            };

            // Create TranscriptWriter and generate filename
            const writer = new TranscriptWriter(pseudoRecording);
            let fileName = writer.generateFileName();

            // Check for file collision, append ID if needed
            if (TranscriptWriter.fileExists(this.app.vault, this.settings.transcriptFolder, fileName)) {
              fileName = writer.generateFileName(true);
            }

            // Generate transcript content (AI Companion transcripts may be VTT or plain text)
            const content = writer.generateTranscript(transcriptContent, []);

            // Write to vault
            await TranscriptWriter.writeToVault(
              this.app.vault,
              this.settings.transcriptFolder,
              fileName,
              content
            );

            // Mark as synced in state
            stateManager.markSynced(meetingId, fileName);
            await stateManager.writeState();

            this.devLog(`Synced (AI Companion): ${fileName}`);
            syncedCount++;
          } catch (error) {
            // Individual transcript failed - log and continue to next
            // Don't increment failedCount for 404s (no transcript available)
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (!errorMessage.includes('404')) {
              failedCount++;
              this.devLog(`Failed: ${meetingId} - ${errorMessage}`);
            }
          }
        }
      }

      // Update lastSyncTimestamp in settings
      this.settings.lastSyncTimestamp = Date.now();
      await this.saveSettings();

      this.devLog(`Zoom sync complete: ${syncedCount} synced, ${skippedCount} skipped, ${failedCount} failed`);

      // Show appropriate notice based on results
      if (syncedCount > 0 && failedCount > 0) {
        new Notice(`Synced ${syncedCount} transcript(s), ${failedCount} failed`);
      } else if (syncedCount > 0 && failedCount === 0) {
        new Notice(`Synced ${syncedCount} new transcript(s)`);
      } else if (syncedCount === 0 && failedCount > 0) {
        new Notice(`Sync failed for ${failedCount} transcript(s)`);
      }
      // No notice if syncedCount === 0 && failedCount === 0
    } finally {
      // Always release lock
      this.syncInProgress = false;
    }
  }
}
