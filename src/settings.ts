import { App, PluginSettingTab } from 'obsidian';
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
    // Setting fields will be added in task 2.0
  }
}
