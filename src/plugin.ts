import streamDeck, { action, SingletonAction, type WillAppearEvent, type WillDisappearEvent,
  type DidReceiveSettingsEvent, type PropertyInspectorDidAppearEvent, type KeyAction,
  type SendToPluginEvent, type KeyDownEvent } from "@elgato/streamdeck";
import { readMicrophone, toggleMicrophone } from "./cli.ts";
import { StatusMonitor } from "./monitor.ts";
import { presentation, renderSvg, type Snapshot } from "./status.ts";

declare const __DEFAULT_CLI_PATH__: string;
type Settings = { cliPath?: string };
type Binding = { unsubscribe: () => void; key: KeyAction<Settings>; path: string; last?: Snapshot; image?: string };

@action({ UUID: "com.dario.teams-cli.mic-status" })
class MicrophoneStatus extends SingletonAction<Settings> {
  private monitors = new Map<string, StatusMonitor>();
  private bindings = new Map<string, Binding>();
  private inspector?: string;

  override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
    if (!ev.action.isKey()) return;
    this.bind(ev.action, ev.payload.settings);
    if (!ev.payload.settings.cliPath) await ev.action.setSettings({ ...ev.payload.settings, cliPath: __DEFAULT_CLI_PATH__ });
  }

  override onWillDisappear(ev: WillDisappearEvent<Settings>): void {
    this.bindings.get(ev.action.id)?.unsubscribe();
    this.bindings.delete(ev.action.id);
    if (this.inspector === ev.action.id) this.inspector = undefined;
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): void {
    if (ev.action.isKey() && this.bindings.has(ev.action.id)) this.bind(ev.action, ev.payload.settings);
  }

  override onPropertyInspectorDidAppear(ev: PropertyInspectorDidAppearEvent<Settings>): void {
    this.inspector = ev.action.id;
    const binding = this.bindings.get(ev.action.id);
    if (binding?.last) this.sendDetail(binding.last);
  }

  override onPropertyInspectorDidDisappear(): void { this.inspector = undefined; }

  override onSendToPlugin(ev: SendToPluginEvent<{ request?: string }, Settings>): void {
    if (ev.payload && typeof ev.payload === "object" && "request" in ev.payload && ev.payload.request === "status") {
      this.inspector = ev.action.id;
      const last = this.bindings.get(ev.action.id)?.last;
      if (last) this.sendDetail(last);
    }
  }

  override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
    const binding = this.bindings.get(ev.action.id);
    if (!binding) return;
    const result = await this.monitors.get(binding.path)?.toggle(
      () => toggleMicrophone(binding.path), () => this.bindings.get(ev.action.id) === binding
    );
    if (!result) return;
    streamDeck.logger.info("Microphone toggle", result.success ? "confirmed" : "failed", result.snapshot.reason ?? "");
    if (!result.success && this.bindings.get(ev.action.id) === binding) {
      await binding.key.showAlert().catch((error) => streamDeck.logger.debug("Could not show toggle failure", error));
    }
  }

  private bind(key: KeyAction<Settings>, settings: Settings): void {
    const path = typeof settings.cliPath === "string" ? settings.cliPath.trim() : __DEFAULT_CLI_PATH__;
    const previous = this.bindings.get(key.id);
    if (previous?.path === path) return;
    previous?.unsubscribe();
    let monitor = this.monitors.get(path);
    if (!monitor) {
      monitor = new StatusMonitor(() => readMicrophone(path));
      this.monitors.set(path, monitor);
    }
    const binding: Binding = { key, path, unsubscribe: () => {} };
    this.bindings.set(key.id, binding);
    binding.unsubscribe = monitor.subscribe((snapshot) => {
      if (this.bindings.get(key.id) !== binding) return;
      const previous = binding.last;
      binding.last = snapshot;
      const svg = renderSvg(snapshot);
      if (svg !== binding.image) {
        binding.image = svg;
        void key.setImage(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`).catch((error) => streamDeck.logger.error("Could not render microphone status", error));
      }
      if (previous?.status !== snapshot.status || previous?.reason !== snapshot.reason) {
        streamDeck.logger.info("Microphone status", snapshot.status, snapshot.reason ?? "");
        if (this.inspector === key.id) this.sendDetail(snapshot);
      }
    });
  }

  private sendDetail(snapshot: Snapshot): void {
    void streamDeck.ui.sendToPropertyInspector({ ...presentation(snapshot), reason: snapshot.reason ?? "" })
      .catch((error) => streamDeck.logger.debug("Property inspector unavailable", error));
  }
}

streamDeck.actions.registerAction(new MicrophoneStatus());
streamDeck.connect().then(() => streamDeck.logger.info("Teams CLI microphone plug-in connected"));
