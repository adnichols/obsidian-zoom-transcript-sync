/**
 * Unit tests for VTT parsing logic.
 * Tests parseVtt() and formatVttEntries() functions from src/transcript-writer.ts
 */

import { describe, it, expect, vi } from 'vitest';

// Mock the obsidian module before importing transcript-writer
vi.mock('obsidian', async () => {
  const mocks = await import('./mocks/obsidian');
  return mocks;
});

import { parseVtt, formatVttEntries, VttEntry } from '../src/transcript-writer';

describe('parseVtt', () => {
  describe('standard VTT format with timestamps and speaker names', () => {
    it('parses standard VTT format with single entry', () => {
      const vttContent = `WEBVTT

1
00:00:16.239 --> 00:00:27.079
John Smith: Hello everyone, welcome to the meeting.`;

      const entries = parseVtt(vttContent);

      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual({
        timestamp: '00:00:16',
        speaker: 'John Smith',
        text: 'Hello everyone, welcome to the meeting.',
      });
    });

    it('parses VTT with multiple entries', () => {
      const vttContent = `WEBVTT

1
00:00:16.239 --> 00:00:27.079
John Smith: Hello everyone, welcome to the meeting.

2
00:00:30.000 --> 00:00:45.500
Jane Doe: Thank you John, glad to be here.

3
00:01:00.100 --> 00:01:15.200
John Smith: Let's get started with the agenda.`;

      const entries = parseVtt(vttContent);

      expect(entries).toHaveLength(3);
      expect(entries[0].speaker).toBe('John Smith');
      expect(entries[0].text).toBe('Hello everyone, welcome to the meeting.');
      expect(entries[1].speaker).toBe('Jane Doe');
      expect(entries[1].timestamp).toBe('00:00:30');
      expect(entries[2].timestamp).toBe('00:01:00');
    });
  });

  describe('VTT with multiple speakers', () => {
    it('correctly extracts different speaker names', () => {
      const vttContent = `WEBVTT

1
00:00:05.000 --> 00:00:10.000
Alice Johnson: First point.

2
00:00:15.000 --> 00:00:20.000
Bob Williams: Second point.

3
00:00:25.000 --> 00:00:30.000
Charlie Brown: Third point.`;

      const entries = parseVtt(vttContent);

      expect(entries).toHaveLength(3);
      expect(entries.map(e => e.speaker)).toEqual([
        'Alice Johnson',
        'Bob Williams',
        'Charlie Brown',
      ]);
    });
  });

  describe('VTT with no speaker names (just text)', () => {
    it('parses VTT without speaker names', () => {
      const vttContent = `WEBVTT

1
00:00:05.000 --> 00:00:10.000
This is some dialogue without a speaker.

2
00:00:15.000 --> 00:00:20.000
Another line of text without speaker.`;

      const entries = parseVtt(vttContent);

      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({
        timestamp: '00:00:05',
        speaker: '',
        text: 'This is some dialogue without a speaker.',
      });
      expect(entries[1].speaker).toBe('');
    });
  });

  describe('empty VTT content', () => {
    it('returns empty array for empty string', () => {
      const entries = parseVtt('');
      expect(entries).toEqual([]);
    });

    it('returns empty array for VTT header only', () => {
      const entries = parseVtt('WEBVTT\n\n');
      expect(entries).toEqual([]);
    });

    it('returns empty array for whitespace only', () => {
      const entries = parseVtt('   \n\n   ');
      expect(entries).toEqual([]);
    });
  });

  describe('malformed timestamps', () => {
    it('ignores entries with invalid timestamp format', () => {
      const vttContent = `WEBVTT

1
00:00:05.000 --> 00:00:10.000
Valid entry with speaker: Some text.

2
invalid timestamp line
This should be ignored.

3
00:00:15.000 --> 00:00:20.000
Another Valid: Entry text.`;

      const entries = parseVtt(vttContent);

      expect(entries).toHaveLength(2);
      expect(entries[0].text).toBe('Some text.');
      expect(entries[1].text).toBe('Entry text.');
    });

    it('ignores entries with partial timestamp', () => {
      const vttContent = `WEBVTT

1
00:00:05 --> 00:00:10
Missing milliseconds.

2
00:00:15.000 --> 00:00:20.000
Valid: Entry here.`;

      const entries = parseVtt(vttContent);

      // Only the valid timestamp should be parsed
      expect(entries).toHaveLength(1);
      expect(entries[0].speaker).toBe('Valid');
    });
  });

  describe('multi-line dialogue entries', () => {
    it('combines multi-line dialogue into single entry', () => {
      const vttContent = `WEBVTT

1
00:00:05.000 --> 00:00:15.000
Speaker Name: This is the first line
and this is the second line
and a third line.`;

      const entries = parseVtt(vttContent);

      expect(entries).toHaveLength(1);
      expect(entries[0].speaker).toBe('Speaker Name');
      expect(entries[0].text).toBe('This is the first line and this is the second line and a third line.');
    });

    it('handles multi-line dialogue without speaker', () => {
      const vttContent = `WEBVTT

1
00:00:05.000 --> 00:00:15.000
First line of dialogue
second line continues
third line ends.`;

      const entries = parseVtt(vttContent);

      expect(entries).toHaveLength(1);
      expect(entries[0].speaker).toBe('');
      expect(entries[0].text).toBe('First line of dialogue second line continues third line ends.');
    });
  });

  describe('edge cases', () => {
    it('handles Windows line endings (CRLF)', () => {
      const vttContent = "WEBVTT\r\n\r\n1\r\n00:00:05.000 --> 00:00:10.000\r\nSpeaker: Text here.\r\n";

      const entries = parseVtt(vttContent);

      expect(entries).toHaveLength(1);
      expect(entries[0].speaker).toBe('Speaker');
      expect(entries[0].text).toBe('Text here.');
    });

    it('handles text containing URL with colon', () => {
      const vttContent = `WEBVTT

1
00:00:05.000 --> 00:00:10.000
Speaker: Check out https://example.com for more info.`;

      const entries = parseVtt(vttContent);

      expect(entries).toHaveLength(1);
      expect(entries[0].speaker).toBe('Speaker');
      expect(entries[0].text).toBe('Check out https://example.com for more info.');
    });

    it('does not treat http as speaker name', () => {
      const vttContent = `WEBVTT

1
00:00:05.000 --> 00:00:10.000
http://example.com is a website.`;

      const entries = parseVtt(vttContent);

      expect(entries).toHaveLength(1);
      expect(entries[0].speaker).toBe('');
      expect(entries[0].text).toBe('http://example.com is a website.');
    });

    it('handles speaker name with special characters', () => {
      const vttContent = `WEBVTT

1
00:00:05.000 --> 00:00:10.000
Dr. John Smith Jr.: Medical advice here.`;

      const entries = parseVtt(vttContent);

      expect(entries).toHaveLength(1);
      expect(entries[0].speaker).toBe('Dr. John Smith Jr.');
      expect(entries[0].text).toBe('Medical advice here.');
    });

    it('handles entry numbers greater than single digits', () => {
      const vttContent = `WEBVTT

10
00:00:05.000 --> 00:00:10.000
Speaker: Entry number ten.

100
00:00:15.000 --> 00:00:20.000
Another Speaker: Entry number one hundred.`;

      const entries = parseVtt(vttContent);

      expect(entries).toHaveLength(2);
      expect(entries[0].text).toBe('Entry number ten.');
      expect(entries[1].text).toBe('Entry number one hundred.');
    });
  });
});

describe('formatVttEntries', () => {
  describe('formatting entries to Markdown', () => {
    it('formats entry with speaker', () => {
      const entries: VttEntry[] = [
        {
          timestamp: '00:00:16',
          speaker: 'John Smith',
          text: 'Hello everyone.',
        },
      ];

      const result = formatVttEntries(entries);

      expect(result).toBe('**00:00:16 - John Smith:**\nHello everyone.');
    });

    it('formats entry without speaker', () => {
      const entries: VttEntry[] = [
        {
          timestamp: '00:00:16',
          speaker: '',
          text: 'Hello everyone.',
        },
      ];

      const result = formatVttEntries(entries);

      expect(result).toBe('**00:00:16:**\nHello everyone.');
    });

    it('formats multiple entries with blank line separator', () => {
      const entries: VttEntry[] = [
        {
          timestamp: '00:00:05',
          speaker: 'Alice',
          text: 'First message.',
        },
        {
          timestamp: '00:00:15',
          speaker: 'Bob',
          text: 'Second message.',
        },
        {
          timestamp: '00:00:25',
          speaker: 'Charlie',
          text: 'Third message.',
        },
      ];

      const result = formatVttEntries(entries);

      const expected = `**00:00:05 - Alice:**
First message.

**00:00:15 - Bob:**
Second message.

**00:00:25 - Charlie:**
Third message.`;

      expect(result).toBe(expected);
    });

    it('formats mixed entries (with and without speakers)', () => {
      const entries: VttEntry[] = [
        {
          timestamp: '00:00:05',
          speaker: 'Alice',
          text: 'With speaker.',
        },
        {
          timestamp: '00:00:15',
          speaker: '',
          text: 'Without speaker.',
        },
      ];

      const result = formatVttEntries(entries);

      const expected = `**00:00:05 - Alice:**
With speaker.

**00:00:15:**
Without speaker.`;

      expect(result).toBe(expected);
    });

    it('returns empty string for empty entries array', () => {
      const result = formatVttEntries([]);
      expect(result).toBe('');
    });
  });
});
