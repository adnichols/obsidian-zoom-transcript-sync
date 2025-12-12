# Zoom Transcript Sync

An Obsidian plugin that automatically syncs Zoom meeting transcripts as Markdown files.

## Features

- **Automatic transcript syncing** on a configurable interval
- **Manual sync command** via Command Palette
- **YAML frontmatter** with meeting metadata:
  - Meeting name
  - Meeting time
  - Duration
  - Attendees
  - Topic
  - Host
  - Recording URL
  - Zoom meeting ID
  - Sync timestamp
- **VTT transcript parsing** with speaker identification
- **Collision prevention** - no duplicate transcripts
- **Settings UI** for easy configuration

## Requirements

- Obsidian 0.15.0 or later
- Zoom account with Pro, Business, or Enterprise plan (cloud recording required)
- Zoom Server-to-Server OAuth app with `recording:read:admin` scope

## Zoom API Setup

Follow these steps to create a Zoom Server-to-Server OAuth app:

### Step 1: Access the Zoom App Marketplace

1. Go to the [Zoom App Marketplace](https://marketplace.zoom.us/)
2. Sign in with your Zoom account
3. Click **Develop** in the top-right corner
4. Select **Build App**

### Step 2: Create a Server-to-Server OAuth App

1. Click **Server-to-Server OAuth** as the app type
2. Click **Create**
3. Enter an app name (e.g., "Obsidian Transcript Sync")
4. Click **Create**

### Step 3: Copy Your Credentials

On the **App Credentials** page, copy the following values:

- **Account ID** - Your Zoom account identifier
- **Client ID** - OAuth application client ID
- **Client Secret** - OAuth application client secret

Save these values securely. You will enter them in the plugin settings.

### Step 4: Add Required Scopes

1. Navigate to the **Scopes** tab
2. Click **Add Scopes**
3. Search for and add: `recording:read:admin`
4. Click **Done**

This scope allows the app to read cloud recordings from your account.

### Step 5: Activate the App

1. Navigate to the **Activation** tab
2. Click **Activate your app**
3. Confirm activation

Your app is now ready to use with the plugin.

## Installation

### Manual Installation

1. Download the latest release from the [Releases](../../releases) page
2. Extract the files to your vault's plugins folder: `<vault>/.obsidian/plugins/zoom-transcript-sync/`
3. Reload Obsidian
4. Enable the plugin in Settings > Community Plugins

### Build from Source

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd obsidian-zoom-transcripts
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the plugin:
   ```bash
   npm run build
   ```

4. Copy the output files (`main.js`, `manifest.json`) to your vault's plugins folder:
   ```bash
   cp main.js manifest.json <vault>/.obsidian/plugins/zoom-transcript-sync/
   ```

5. Reload Obsidian and enable the plugin

## Configuration

Open Settings > Zoom Transcript Sync to configure the plugin.

### Zoom API Credentials

| Setting | Description |
|---------|-------------|
| **Account ID** | Your Zoom account ID from the Server-to-Server OAuth app |
| **Client ID** | OAuth app client ID |
| **Client Secret** | OAuth app client secret (stored securely) |

### Sync Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| **Transcript Folder** | Folder path where transcripts are saved | `zoom-transcripts` |
| **Sync Interval** | How often to automatically sync (in minutes) | `30` |

### Action Buttons

| Button | Description |
|--------|-------------|
| **Test Connection** | Validates your API credentials with Zoom |
| **Sync Now** | Immediately syncs new transcripts |

## Usage

### Manual Sync

1. Open the Command Palette (Ctrl/Cmd + P)
2. Search for **Sync Zoom Transcripts Now**
3. Press Enter to execute

New transcripts will be downloaded and saved to your configured transcript folder.

### Automatic Sync

The plugin automatically syncs transcripts at the configured interval (default: 30 minutes). Sync runs in the background when Obsidian is open.

Auto-sync is temporarily disabled if authentication fails. Use the **Test Connection** button in settings to re-enable it after fixing credentials.

### Transcript File Format

Transcripts are saved as Markdown files with the meeting topic as the filename.

**Example filename:** `Weekly Team Standup.md`

If a file with the same name already exists, the meeting ID is appended: `Weekly Team Standup (123456789).md`

**File structure:**

```markdown
---
meeting_name: "Weekly Team Standup"
meeting_time: 2025-01-15T10:00:00Z
meeting_duration: 45
attendees:
  - John Smith
  - Jane Doe
topic: "Weekly Team Standup"
host: ""
recording_url: "https://zoom.us/rec/play/..."
zoom_meeting_id: "123456789"
synced_at: 2025-01-15T11:30:00Z
---

# Weekly Team Standup

**Date:** January 15, 2025
**Duration:** 45 minutes
**Host:**

## Attendees
- John Smith
- Jane Doe

## Transcript

**00:00:16 - John Smith:**
Good morning everyone, let's get started.

**00:00:22 - Jane Doe:**
Morning! I have a quick update on the project.
```

### File Location

Transcripts are saved to the folder specified in settings (default: `zoom-transcripts`). The folder is created automatically if it does not exist.

## Troubleshooting

### Authentication Errors

**Error:** "Zoom sync failed: invalid credentials. Check settings."

**Solutions:**
- Verify Account ID, Client ID, and Client Secret are entered correctly
- Ensure the Server-to-Server OAuth app is activated in the Zoom Marketplace
- Check that the `recording:read:admin` scope is added to the app
- Use the **Test Connection** button to validate credentials

### Rate Limiting

**Error:** "Zoom sync rate limited. Waiting before retry."

**Solutions:**
- The plugin automatically retries with exponential backoff
- If rate limiting persists, increase the sync interval in settings
- Zoom API has rate limits; avoid syncing too frequently

### Network Errors

**Error:** "Zoom sync failed: network error. Will retry."

**Solutions:**
- Check your internet connection
- The plugin automatically retries on network failures
- If the error persists, try syncing manually later

### No Transcripts Found

**Possible causes:**
- Recordings do not have transcripts enabled
- Recordings are older than 30 days (Zoom API default date range)
- Cloud recording is not enabled for your Zoom account

**Solutions:**
- Enable transcription in Zoom meeting settings before recording
- Ensure your Zoom plan supports cloud recording

### Missing Attendees

Attendee information is extracted from participant audio files in the recording. If attendees are missing:
- The recording may not have individual participant audio tracks
- Participants may have joined without enabling audio

## License

MIT License
