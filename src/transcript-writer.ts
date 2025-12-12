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
