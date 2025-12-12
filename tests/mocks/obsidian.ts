/**
 * Mock implementations of Obsidian APIs for testing.
 * Provides mock implementations of Vault, Plugin, Notice, TFile, TFolder, TAbstractFile.
 */

// Type definitions for mock Obsidian APIs

export interface DataAdapter {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
}

export abstract class TAbstractFile {
  path: string;
  name: string;
  parent: TFolder | null;

  constructor(path: string) {
    this.path = path;
    this.name = path.split('/').pop() || '';
    this.parent = null;
  }
}

export class TFile extends TAbstractFile {
  extension: string;
  basename: string;
  stat: { mtime: number; ctime: number; size: number };

  constructor(path: string) {
    super(path);
    const parts = this.name.split('.');
    this.extension = parts.length > 1 ? parts.pop() || '' : '';
    this.basename = parts.join('.');
    this.stat = { mtime: Date.now(), ctime: Date.now(), size: 0 };
  }
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[];

  constructor(path: string) {
    super(path);
    this.children = [];
  }

  isRoot(): boolean {
    return this.path === '' || this.path === '/';
  }
}

/**
 * Mock DataAdapter implementation for testing.
 * Stores files in memory using a Map.
 */
export class MockDataAdapter implements DataAdapter {
  private files: Map<string, string> = new Map();

  async read(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    return content;
  }

  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async rename(from: string, to: string): Promise<void> {
    const content = this.files.get(from);
    if (content === undefined) {
      throw new Error(`File not found: ${from}`);
    }
    this.files.delete(from);
    this.files.set(to, content);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  // Test helper: set file content directly
  setFile(path: string, content: string): void {
    this.files.set(path, content);
  }

  // Test helper: get file content directly
  getFile(path: string): string | undefined {
    return this.files.get(path);
  }

  // Test helper: check if file exists
  hasFile(path: string): boolean {
    return this.files.has(path);
  }

  // Test helper: clear all files
  clear(): void {
    this.files.clear();
  }

  // Test helper: get all file paths
  getAllPaths(): string[] {
    return Array.from(this.files.keys());
  }
}

/**
 * Mock Vault implementation for testing.
 * Provides mock implementations of Vault methods used by the plugin.
 */
export class MockVault {
  adapter: MockDataAdapter;
  private abstractFiles: Map<string, TAbstractFile> = new Map();

  constructor() {
    this.adapter = new MockDataAdapter();
  }

  /**
   * Creates a new file in the vault.
   * @param path - Path for the new file
   * @param content - Content to write to the file
   * @returns The created TFile
   */
  async create(path: string, content: string): Promise<TFile> {
    if (this.abstractFiles.has(path)) {
      throw new Error(`File already exists: ${path}`);
    }
    await this.adapter.write(path, content);
    const file = new TFile(path);
    this.abstractFiles.set(path, file);
    return file;
  }

  /**
   * Creates a new folder in the vault.
   * @param path - Path for the new folder
   * @returns The created TFolder
   */
  async createFolder(path: string): Promise<TFolder> {
    if (this.abstractFiles.has(path)) {
      throw new Error(`Folder already exists: ${path}`);
    }
    const folder = new TFolder(path);
    this.abstractFiles.set(path, folder);
    return folder;
  }

  /**
   * Gets an abstract file by path.
   * @param path - Path to the file or folder
   * @returns The TAbstractFile or null if not found
   */
  getAbstractFileByPath(path: string): TAbstractFile | null {
    return this.abstractFiles.get(path) || null;
  }

  // Test helper: add a file to the mock vault
  addFile(path: string, content: string = ''): TFile {
    const file = new TFile(path);
    this.abstractFiles.set(path, file);
    this.adapter.setFile(path, content);
    return file;
  }

  // Test helper: add a folder to the mock vault
  addFolder(path: string): TFolder {
    const folder = new TFolder(path);
    this.abstractFiles.set(path, folder);
    return folder;
  }

  // Test helper: clear all files and folders
  clear(): void {
    this.abstractFiles.clear();
    this.adapter.clear();
  }
}

// Export Vault as alias to MockVault for compatibility
export const Vault = MockVault;

/**
 * Mock Plugin class for testing.
 */
export class Plugin {
  app: { vault: MockVault };
  manifest: { id: string; name: string; version: string };

  constructor() {
    this.app = { vault: new MockVault() };
    this.manifest = { id: 'test-plugin', name: 'Test Plugin', version: '1.0.0' };
  }

  async loadData(): Promise<unknown> {
    return {};
  }

  async saveData(_data: unknown): Promise<void> {
    // No-op for testing
  }

  addCommand(_command: unknown): void {
    // No-op for testing
  }

  addSettingTab(_tab: unknown): void {
    // No-op for testing
  }

  registerInterval(_interval: number): void {
    // No-op for testing
  }
}

/**
 * Mock Notice class for testing.
 * Stores notices for verification in tests.
 */
export class Notice {
  static notices: string[] = [];

  message: string;

  constructor(message: string, _timeout?: number) {
    this.message = message;
    Notice.notices.push(message);
  }

  // Test helper: clear all notices
  static clear(): void {
    Notice.notices = [];
  }

  // Test helper: get all notices
  static getAll(): string[] {
    return [...Notice.notices];
  }

  // Test helper: get last notice
  static getLast(): string | undefined {
    return Notice.notices[Notice.notices.length - 1];
  }
}

/**
 * Mock PluginSettingTab class for testing.
 */
export class PluginSettingTab {
  app: unknown;
  plugin: unknown;
  containerEl: { empty: () => void; createEl: () => HTMLElement };

  constructor(app: unknown, plugin: unknown) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = {
      empty: () => {},
      createEl: () => document.createElement('div'),
    };
  }

  display(): void {
    // No-op for testing
  }

  hide(): void {
    // No-op for testing
  }
}

/**
 * Mock Setting class for testing.
 */
export class Setting {
  constructor(_containerEl: unknown) {}

  setName(_name: string): this {
    return this;
  }

  setDesc(_desc: string): this {
    return this;
  }

  addText(_cb: (text: unknown) => void): this {
    return this;
  }

  addTextArea(_cb: (text: unknown) => void): this {
    return this;
  }

  addToggle(_cb: (toggle: unknown) => void): this {
    return this;
  }

  addButton(_cb: (button: unknown) => void): this {
    return this;
  }

  addDropdown(_cb: (dropdown: unknown) => void): this {
    return this;
  }

  addSlider(_cb: (slider: unknown) => void): this {
    return this;
  }
}
