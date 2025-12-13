import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import { ZoomApiClient } from './zoom-api';
import ZoomTranscriptSync from './main';

export class ZoomSyncSettingTab extends PluginSettingTab {
  plugin: ZoomTranscriptSync;

  constructor(app: App, plugin: ZoomTranscriptSync) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Zoom Transcript Sync Settings' });

    containerEl.createEl('h3', { text: 'Zoom API Credentials' });

    new Setting(containerEl)
      .setName('Account ID')
      .setDesc('Your Zoom account ID')
      .addText(text => text
        .setPlaceholder('')
        .setValue(this.plugin.settings.accountId)
        .onChange(async (value) => {
          this.plugin.settings.accountId = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Client ID')
      .setDesc('Your Zoom OAuth app client ID')
      .addText(text => text
        .setPlaceholder('')
        .setValue(this.plugin.settings.clientId)
        .onChange(async (value) => {
          this.plugin.settings.clientId = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Client Secret')
      .setDesc('Your Zoom OAuth app client secret')
      .addText(text => {
        text.inputEl.type = 'password';
        text
          .setPlaceholder('')
          .setValue(this.plugin.settings.clientSecret)
          .onChange(async (value) => {
            this.plugin.settings.clientSecret = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('User Email')
      .setDesc('Email of the Zoom user whose recordings to sync (required for Server-to-Server OAuth)')
      .addText(text => text
        .setPlaceholder('user@example.com')
        .setValue(this.plugin.settings.userEmail)
        .onChange(async (value) => {
          this.plugin.settings.userEmail = value;
          await this.plugin.saveSettings();
        }));

    containerEl.createEl('h3', { text: 'Sync Configuration' });

    new Setting(containerEl)
      .setName('Transcript Folder')
      .setDesc('Folder path where transcripts will be saved')
      .addText(text => text
        .setPlaceholder('zoom-transcripts')
        .setValue(this.plugin.settings.transcriptFolder)
        .onChange(async (value) => {
          this.plugin.settings.transcriptFolder = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Sync Interval')
      .setDesc('How often to sync transcripts (in minutes)')
      .addText(text => {
        text.inputEl.type = 'number';
        text
          .setPlaceholder('30')
          .setValue(String(this.plugin.settings.syncIntervalMinutes))
          .onChange(async (value) => {
            const numValue = parseInt(value, 10);
            if (!isNaN(numValue) && numValue > 0) {
              this.plugin.settings.syncIntervalMinutes = numValue;
              await this.plugin.saveSettings();
            }
          });
      });

    new Setting(containerEl)
      .setName('Test Connection')
      .addButton(button => button
        .setButtonText('Test Connection')
        .onClick(async () => {
          try {
            const client = new ZoomApiClient(this.plugin.settings);
            await client.getAccessToken();
            // Re-enable auto-sync on successful connection
            this.plugin.autoSyncEnabled = true;
            new Notice('Connection successful!');
          } catch {
            new Notice('Connection failed: invalid credentials');
          }
        }));

    new Setting(containerEl)
      .setName('Sync Now')
      .addButton(button => button
        .setButtonText('Sync Now')
        .onClick(async () => {
          await this.plugin.syncTranscripts();
        }));

    new Setting(containerEl)
      .setName('Full Re-sync')
      .setDesc('Clear sync history and fetch all recordings from the beginning')
      .addButton(button => button
        .setButtonText('Reset & Sync All')
        .setWarning()
        .onClick(async () => {
          // Clear the lastSyncTimestamp
          this.plugin.settings.lastSyncTimestamp = undefined;
          await this.plugin.saveSettings();
          new Notice('Sync history cleared. Starting full sync...');
          await this.plugin.syncTranscripts();
        }));
  }
}
