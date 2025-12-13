import { Vault, TAbstractFile, TFolder } from 'obsidian';
import { ZoomRecording, SyncState } from './types';

/**
 * Represents a parsed VTT entry with timestamp, speaker, and text.
 */
export interface VttEntry {
  timestamp: string;  // Format: "HH:MM:SS" (simplified from full timestamp)
  speaker: string;    // Extracted speaker name, empty string if not present
  text: string;       // The dialogue text
}

/**
 * Parses WebVTT format content and extracts entries.
 *
 * Expected VTT format:
 * ```
 * WEBVTT
 *
 * 1
 * 00:00:16.239 --> 00:00:27.079
 * Speaker Name: Dialogue text
 * ```
 *
 * @param vttContent - Raw VTT file content
 * @returns Array of parsed VTT entries
 */
export function parseVtt(vttContent: string): VttEntry[] {
  const entries: VttEntry[] = [];

  // Split content into lines and normalize line endings
  const lines = vttContent.replace(/\r\n/g, '\n').split('\n');

  // Regex to match timestamp lines: "00:00:16.239 --> 00:00:27.079"
  const timestampRegex = /^(\d{2}:\d{2}:\d{2})\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}$/;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();

    // Check if this line is a timestamp line
    const timestampMatch = line.match(timestampRegex);
    if (timestampMatch) {
      const timestamp = timestampMatch[1]; // Extract "HH:MM:SS" portion

      // Next line(s) should contain the dialogue
      i++;
      const dialogueLines: string[] = [];

      // Collect dialogue lines until we hit an empty line or end of content
      while (i < lines.length && lines[i].trim() !== '') {
        dialogueLines.push(lines[i].trim());
        i++;
      }

      if (dialogueLines.length > 0) {
        const fullDialogue = dialogueLines.join(' ');

        // Extract speaker and text from dialogue line
        // Format: "Speaker Name: Dialogue text"
        const colonIndex = fullDialogue.indexOf(':');

        let speaker = '';
        let text = fullDialogue;

        if (colonIndex > 0) {
          // Check if the part before colon looks like a speaker name
          // (not a URL scheme like "http" or "https")
          const potentialSpeaker = fullDialogue.substring(0, colonIndex).trim();
          const afterColon = fullDialogue.substring(colonIndex + 1).trim();

          // Simple heuristic: speaker names don't start with common URL schemes
          // and typically don't contain special characters
          if (!potentialSpeaker.match(/^https?$/i) && afterColon.length > 0) {
            speaker = potentialSpeaker;
            text = afterColon;
          }
        }

        entries.push({
          timestamp,
          speaker,
          text
        });
      }
    }

    i++;
  }

  return entries;
}

/**
 * Formats VTT entries into readable Markdown format.
 *
 * Output format:
 * - With speaker: `**00:00:16 - Speaker Name:**\nDialogue text`
 * - Without speaker: `**00:00:16:**\nDialogue text`
 *
 * Entries are separated by blank lines for readability.
 *
 * @param entries - Array of parsed VTT entries
 * @returns Formatted transcript string
 */
export function formatVttEntries(entries: VttEntry[]): string {
  return entries
    .map((entry) => {
      const header = entry.speaker
        ? `**${entry.timestamp} - ${entry.speaker}:**`
        : `**${entry.timestamp}:**`;
      return `${header}\n${entry.text}`;
    })
    .join('\n\n');
}

/**
 * TranscriptWriter generates Markdown transcript files from Zoom recording data.
 * Coordinates frontmatter generation and body generation.
 */
export class TranscriptWriter {
  private recording: ZoomRecording;

  /**
   * Creates a new TranscriptWriter instance.
   * @param recording - Zoom recording metadata
   */
  constructor(recording: ZoomRecording) {
    this.recording = recording;
  }

  /**
   * Generates a filesystem-safe filename from the meeting topic.
   * Sanitizes the title by removing/replacing unsafe characters.
   *
   * Unsafe characters removed/replaced:
   * - / \ : * ? " < > | (filesystem unsafe)
   * - Leading/trailing whitespace trimmed
   * - Length limited to 200 characters (before extension)
   *
   * @param includeId - If true, appends the meeting ID before .md extension for collision prevention
   * @returns Sanitized filename with .md extension
   *
   * @example
   * // topic: "Q4 Planning: What's Next?", start_time: "2025-12-10T14:30:00Z", id: 123456789
   * // generateFileName() returns: "Q4 Planning - Whats Next - 2025-12-10 1430.md"
   * // generateFileName(true) returns: "Q4 Planning - Whats Next - 2025-12-10 1430 (123456789).md"
   */
  generateFileName(includeId?: boolean): string {
    const topic = this.recording.topic || 'Untitled Meeting';

    // Sanitize the topic for filesystem safety
    let sanitized = topic
      // Replace colon with " -" for readability (e.g., "Topic: Subtopic" -> "Topic - Subtopic")
      .replace(/:/g, ' -')
      // Remove unsafe filesystem characters: / \ * ? " < > |
      .replace(/[/\\*?"<>|]/g, '')
      // Remove single quotes for cleaner filenames
      .replace(/'/g, '')
      // Collapse multiple spaces into single space
      .replace(/\s+/g, ' ')
      // Trim leading/trailing whitespace
      .trim();

    // Handle edge case of empty result after sanitization
    if (sanitized.length === 0) {
      sanitized = 'Untitled Meeting';
    }

    // Limit length to 200 characters (reasonable filesystem limit)
    if (sanitized.length > 200) {
      sanitized = sanitized.substring(0, 200).trim();
    }

    // Format the meeting time as "YYYY-MM-DD HHMM" for the filename suffix
    const timeSuffix = this.formatTimeForFilename(this.recording.start_time);

    // Build filename with time suffix
    const baseName = timeSuffix ? `${sanitized} - ${timeSuffix}` : sanitized;

    // Append meeting ID if requested (for collision prevention)
    if (includeId) {
      return `${baseName} (${this.recording.id}).md`;
    }

    return `${baseName}.md`;
  }

  /**
   * Formats an ISO 8601 date string into a filesystem-safe format for filenames.
   * Example: "2025-12-10T14:30:00Z" -> "2025-12-10 1430"
   *
   * @param isoDate - ISO 8601 date string
   * @returns Formatted date string safe for filenames, or empty string if invalid
   */
  private formatTimeForFilename(isoDate: string | undefined): string {
    if (!isoDate) {
      return '';
    }

    const date = new Date(isoDate);

    // Check for invalid date
    if (isNaN(date.getTime())) {
      return '';
    }

    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}${minutes}`;
  }

  /**
   * Generates a complete Markdown transcript file.
   * Combines YAML frontmatter with formatted transcript body.
   *
   * @param vttContent - Raw VTT file content
   * @param attendees - List of attendee names
   * @returns Complete Markdown file content with frontmatter and transcript
   */
  generateTranscript(vttContent: string, attendees: string[]): string {
    const frontmatter = this.generateFrontmatter(attendees);
    const body = this.generateBody(vttContent, attendees);

    return `${frontmatter}\n\n${body}`;
  }

  /**
   * Generates YAML frontmatter for the transcript.
   *
   * Fields included:
   * - meeting_name: from recording topic
   * - meeting_time: ISO 8601 timestamp from recording start_time
   * - meeting_duration: duration in minutes
   * - attendees: array of attendee names
   * - topic: from recording topic
   * - host: empty string (not available from ZoomRecording)
   * - recording_url: play_url from first recording file, or empty
   * - zoom_meeting_id: recording id as string
   * - synced_at: current timestamp in ISO 8601 format
   *
   * @param attendees - List of attendee names
   * @returns YAML frontmatter string including delimiters
   */
  protected generateFrontmatter(attendees: string[]): string {
    const meetingName = this.escapeYamlString(this.recording.topic || '');
    const meetingTime = this.recording.start_time || '';
    const meetingDuration = this.recording.duration || 0;
    const topic = this.escapeYamlString(this.recording.topic || '');
    const host = ''; // Not available from ZoomRecording type
    const recordingUrl = this.getRecordingUrl();
    const zoomMeetingId = String(this.recording.id || '');
    const syncedAt = new Date().toISOString();

    const attendeeLines = attendees
      .map((name) => `  - ${this.escapeYamlString(name)}`)
      .join('\n');

    const frontmatter = `---
meeting_name: "${meetingName}"
meeting_time: ${meetingTime}
meeting_duration: ${meetingDuration}
attendees:
${attendeeLines}
topic: "${topic}"
host: "${host}"
recording_url: "${recordingUrl}"
zoom_meeting_id: "${zoomMeetingId}"
synced_at: ${syncedAt}
---`;

    return frontmatter;
  }

  /**
   * Escapes special characters in a string for safe YAML output.
   * Handles quotes and backslashes.
   *
   * @param value - The string value to escape
   * @returns Escaped string safe for YAML
   */
  private escapeYamlString(value: string): string {
    return value
      .replace(/\\/g, '\\\\')  // Escape backslashes first
      .replace(/"/g, '\\"');   // Escape double quotes
  }

  /**
   * Gets the recording URL from the first available recording file.
   *
   * @returns The play_url from the first recording file, or empty string
   */
  private getRecordingUrl(): string {
    if (
      this.recording.recording_files &&
      this.recording.recording_files.length > 0
    ) {
      return this.recording.recording_files[0].play_url || '';
    }
    return '';
  }

  /**
   * Generates the Markdown body from VTT content.
   * Includes header section, attendees section, and transcript section.
   *
   * @param vttContent - Raw VTT file content
   * @param attendees - List of attendee names
   * @returns Formatted Markdown transcript body
   */
  protected generateBody(vttContent: string, attendees: string[]): string {
    const header = this.generateHeader();
    const attendeesSection = this.generateAttendeesSection(attendees);
    const transcriptSection = this.generateTranscriptSection(vttContent);

    return `${header}\n\n${attendeesSection}\n\n${transcriptSection}`;
  }

  /**
   * Generates the header section with meeting topic, date, duration, and host.
   *
   * @returns Header section as Markdown string
   */
  private generateHeader(): string {
    const topic = this.recording.topic || '';
    const date = this.formatDate(this.recording.start_time);
    const duration = this.recording.duration || 0;
    const host = ''; // Not available from ZoomRecording type

    const lines = [
      `# ${topic}`,
      '',
      `**Date:** ${date}`,
      `**Duration:** ${duration} minutes`,
      `**Host:** ${host}`
    ];

    return lines.join('\n');
  }

  /**
   * Formats an ISO 8601 date string into human-readable format.
   * Example: "2025-12-10T10:00:00Z" -> "December 10, 2025"
   *
   * @param isoDate - ISO 8601 date string
   * @returns Human-readable date string (e.g., "December 10, 2025")
   */
  private formatDate(isoDate: string | undefined): string {
    if (!isoDate) {
      return '';
    }

    const date = new Date(isoDate);

    // Check for invalid date
    if (isNaN(date.getTime())) {
      return '';
    }

    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const month = months[date.getUTCMonth()];
    const day = date.getUTCDate();
    const year = date.getUTCFullYear();

    return `${month} ${day}, ${year}`;
  }

  /**
   * Generates the attendees section with H2 header and bulleted list.
   *
   * @param attendees - List of attendee names
   * @returns Attendees section as Markdown string
   */
  private generateAttendeesSection(attendees: string[]): string {
    const lines = ['## Attendees'];

    for (const attendee of attendees) {
      lines.push(`- ${attendee}`);
    }

    return lines.join('\n');
  }

  /**
   * Generates the transcript section with H2 header and formatted entries.
   *
   * @param vttContent - Raw VTT file content
   * @returns Transcript section as Markdown string
   */
  private generateTranscriptSection(vttContent: string): string {
    const entries = parseVtt(vttContent);
    const formattedTranscript = formatVttEntries(entries);

    return `## Transcript\n\n${formattedTranscript}`;
  }

  /**
   * Checks if a file exists in the specified folder.
   * Uses vault.getAbstractFileByPath() for file existence check.
   *
   * @param vault - Obsidian Vault instance for file operations
   * @param transcriptFolder - Path to the transcript folder within the vault
   * @param fileName - Name of the file to check (not full path)
   * @returns true if file exists, false otherwise
   */
  static fileExists(vault: Vault, transcriptFolder: string, fileName: string): boolean {
    const fullPath = `${transcriptFolder}/${fileName}`;
    const file: TAbstractFile | null = vault.getAbstractFileByPath(fullPath);
    return file !== null;
  }

  /**
   * Ensures the transcript folder exists.
   * Uses vault.createFolder() to create the folder if it doesn't exist.
   * Handles the case where the folder already exists without throwing an error.
   *
   * @param vault - Obsidian Vault instance for file operations
   * @param transcriptFolder - Path to the transcript folder within the vault
   * @returns Promise that resolves when folder exists
   */
  static async ensureFolderExists(vault: Vault, transcriptFolder: string): Promise<void> {
    const folder: TAbstractFile | null = vault.getAbstractFileByPath(transcriptFolder);

    if (folder === null) {
      // Folder doesn't exist, create it
      await vault.createFolder(transcriptFolder);
    } else if (!(folder instanceof TFolder)) {
      // Path exists but is not a folder (it's a file)
      throw new Error(`Path "${transcriptFolder}" exists but is not a folder`);
    }
    // If folder already exists as TFolder, nothing to do
  }

  /**
   * Writes a transcript file to the vault.
   * Ensures folder exists first, then checks for file collision before writing.
   * Uses vault.create() to write the file.
   *
   * @param vault - Obsidian Vault instance for file operations
   * @param transcriptFolder - Path to the transcript folder within the vault
   * @param fileName - Name of the file to create (not full path)
   * @param content - Content to write to the file
   * @returns Promise resolving to the file path that was created or already existed
   */
  static async writeToVault(
    vault: Vault,
    transcriptFolder: string,
    fileName: string,
    content: string
  ): Promise<string> {
    const fullPath = `${transcriptFolder}/${fileName}`;

    // Ensure the folder exists first
    await TranscriptWriter.ensureFolderExists(vault, transcriptFolder);

    // Check if file already exists (skip if exists)
    if (TranscriptWriter.fileExists(vault, transcriptFolder, fileName)) {
      return fullPath;
    }

    // Create the new file
    await vault.create(fullPath, content);

    return fullPath;
  }
}

/**
 * Checks if a meeting should be synced based on sync state.
 * This is an optional efficiency check - secondary to file existence check.
 *
 * @param meetingId - The Zoom meeting ID to check
 * @param syncState - The current sync state
 * @returns false if already synced (skip), true if should sync
 */
export function shouldSync(meetingId: string, syncState: SyncState): boolean {
  // Check if meeting is already in sync state
  if (meetingId in syncState.syncedMeetings) {
    return false;
  }

  return true;
}
