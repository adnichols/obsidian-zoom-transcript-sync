import { Plugin } from 'obsidian';
import { ZoomSyncSettings } from './types';
import { ZoomSyncSettingTab } from './settings';

const DEFAULT_SETTINGS: ZoomSyncSettings = {
  accountId: "",
  clientId: "",
  clientSecret: "",
  transcriptFolder: "zoom-transcripts",
  syncIntervalMinutes: 30
};

export default class ZoomTranscriptSync extends Plugin {
  settings!: ZoomSyncSettings;

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
    // Placeholder - will be fully implemented in Phase 3
  }
}
