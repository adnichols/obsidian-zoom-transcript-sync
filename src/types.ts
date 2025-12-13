export interface ZoomSyncSettings {
  accountId: string;
  clientId: string;
  clientSecret: string;
  userEmail: string;            // DEPRECATED: Use userEmails instead
  userEmails: string;           // Comma-separated list of Zoom user emails whose recordings to sync
  transcriptFolder: string;     // default: "zoom-transcripts"
  syncIntervalMinutes: number;  // default: 30
  lastSyncTimestamp?: number;
}

export interface SyncState {
  version: 1;
  syncedMeetings: {
    [meetingId: string]: {
      syncedAt: number;       // Unix timestamp
      fileName: string;       // Relative path in vault
    };
  };
}

/**
 * Zoom API response types for recordings endpoint
 */

export interface ZoomRecordingFile {
  id: string;
  meeting_id: string;
  recording_start: string;
  recording_end: string;
  file_type: string;
  file_extension: string;
  file_size: number;
  play_url: string;
  download_url: string;
  status: string;
  recording_type: string;
}

/**
 * Participant audio file entry from Zoom recording metadata.
 * Contains individual audio track for each participant.
 */
export interface ZoomParticipantAudioFile {
  id: string;
  recording_start: string;
  recording_end: string;
  file_name: string;        // e.g., "John Smith's audio.m4a"
  file_type: string;
  file_extension: string;
  file_size: number;
  download_url: string;
  status: string;
}

export interface ZoomRecording {
  uuid: string;
  id: number;
  account_id: string;
  host_id: string;
  topic: string;
  type: number;
  start_time: string;
  duration: number;
  total_size: number;
  recording_count: number;
  recording_files: ZoomRecordingFile[];
  participant_audio_files?: ZoomParticipantAudioFile[];
}

export interface ZoomListRecordingsResponse {
  from: string;
  to: string;
  page_size: number;
  total_records: number;
  next_page_token: string;
  meetings: ZoomRecording[];
}
