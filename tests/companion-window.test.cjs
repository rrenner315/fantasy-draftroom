const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function harness() {
  const windows = [], handlers = new Map(), listeners = new Map();
  class BrowserWindow {
    constructor(options) {
      this.options = options; this.events = new Map(); this.destroyed = false;
      this.webContents = { sent: [], send: (...args) => this.webContents.sent.push(args), on() {}, setWindowOpenHandler() {} };
      windows.push(this);
    }
    on(name, callback) { this.events.set(name, callback); }
    loadFile(file, options) { this.file = file; this.loadOptions = options; }
    isDestroyed() { return this.destroyed; }
    show() { this.shown = true; }
    focus() { this.focused = true; }
    close() { this.destroyed = true; this.events.get('closed')?.(); }
  }
  const electron = { BrowserWindow, ipcMain: { handle: (k, v) => handlers.set(k, v), on: (k, v) => listeners.set(k, v) }, app: { whenReady: () => ({ then() {} }), on() {} } };
  const context = { require: (name) => name === 'electron' ? electron : name === 'node:sqlite' ? {} : require(name), __dirname: path.resolve('electron') };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('electron/main.cjs', 'utf8') + '\nregisterIpc(); createWindow();', context);
  return { windows, handlers, listeners };
}

test('desktop opens one compact window, reuses it, and does not close the owner when it closes', () => {
  const { windows, handlers } = harness();
  const main = windows[0];
  const open = handlers.get('draftroom:open-companion');
  open({ sender: main.webContents });
  const child = windows[1];
  assert.equal(child.loadOptions.query.companion, '1');
  assert.ok(child.options.width < main.options.width);
  assert.equal(child.options.webPreferences.nodeIntegration, false);
  assert.equal(child.options.webPreferences.contextIsolation, true);
  open({ sender: main.webContents });
  assert.equal(windows.length, 2);
  assert.equal(child.focused, true);
  child.close();
  assert.equal(main.destroyed, false);
  open({ sender: main.webContents });
  assert.equal(windows.length, 3);
  main.close();
  assert.equal(windows[2].destroyed, true);
});

test('desktop relays only owner snapshots and companion commands; companion cannot save', () => {
  const { windows, handlers, listeners } = harness();
  const main = windows[0];
  handlers.get('draftroom:open-companion')({ sender: main.webContents });
  const child = windows[1];
  const relay = listeners.get('draftroom:companion-message');
  const command = { channel: 'draft-companion', type: 'command', action: { kind: 'skip' } };
  const snapshot = { channel: 'draft-companion', type: 'snapshot', snapshot: { picks: [] } };
  relay({ sender: child.webContents }, command);
  assert.equal(main.webContents.sent.length, 1);
  relay({ sender: main.webContents }, snapshot);
  assert.equal(child.webContents.sent.length, 1);
  relay({ sender: {} }, command);
  relay({ sender: child.webContents }, snapshot);
  assert.equal(main.webContents.sent.length, 1);
  assert.equal(child.webContents.sent.length, 1);
  assert.throws(() => handlers.get('draftroom:save-state')({ sender: child.webContents }, {}), /Only the full program/);
  handlers.get('draftroom:open-companion')({ sender: child.webContents });
  assert.equal(windows.length, 2);
});
