/* Stream Deck's documented property-inspector WebSocket interface. No remote scripts. */
window.connectElgatoStreamDeckSocket = (port, uuid, registerEvent, info, actionInfo) => {
  const action = JSON.parse(actionInfo);
  const isCamera = action.action === "com.dario.teams-cli.camera-status";
  const isHand = action.action === "com.dario.teams-cli.hand-status";
  const isCallEnd = action.action === "com.dario.teams-cli.call-end";
  const control = isCamera ? "camera" : isHand ? "hand" : "microphone";
  document.title = isCallEnd ? "Teams end call" : `Teams ${control} status`;
  document.getElementById("description").textContent = isCallEnd
    ? "Press the key to leave your active Teams call. While ENDING is shown, additional presses are ignored. Teams may bring its main window forward when the call closes."
    : `Shows the ${control} state reported by Microsoft Teams. Press the key to ${isCamera ? "turn the camera on or off" : isHand ? "raise or lower your hand" : "toggle mute"}. While TOGGLING is shown, additional presses are ignored.`;
  document.getElementById("operationHint").textContent = isCallEnd
    ? "The command runs only when you press the key. END CALL is an action label, not a call-status indicator."
    : "Reads refresh automatically while this key is visible.";
  let settings = action.payload.settings ?? {};
  const input = document.getElementById("cliPath");
  const button = document.getElementById("save");
  const detail = document.getElementById("detail");
  input.value = settings.cliPath ?? "";
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const send = (event, payload) => socket.send(JSON.stringify({ event, action: action.action, context: action.context ?? uuid, ...(payload ? { payload } : {}) }));
  socket.onopen = () => {
    socket.send(JSON.stringify({ event: registerEvent, uuid }));
    button.disabled = false;
    send("getSettings");
    send("sendToPlugin", { request: "status" });
  };
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.event === "didReceiveSettings") {
      settings = message.payload.settings;
      if (document.activeElement !== input) input.value = settings.cliPath ?? "";
    }
    if (message.event === "sendToPropertyInspector") {
      const { label, detail: text, color, reason } = message.payload;
      document.getElementById("label").textContent = label;
      detail.textContent = text;
      document.getElementById("reason").textContent = reason ? `Detail: ${reason}` : "";
      document.getElementById("status").style.borderColor = color;
    }
  };
  socket.onclose = () => {
    button.disabled = true;
    document.getElementById("label").textContent = "DISCONNECTED";
    detail.textContent = "Reconnect Stream Deck to refresh status.";
  };
  document.getElementById("settings").onsubmit = (event) => {
    event.preventDefault();
    const path = input.value.trim();
    input.setCustomValidity(path.startsWith("/") ? "" : "Enter an absolute path beginning with /.");
    if (!input.reportValidity() || socket.readyState !== WebSocket.OPEN) return;
    settings = { ...settings, cliPath: path, cliPathManual: true };
    send("setSettings", settings);
    detail.textContent = isCallEnd ? "Path saved. Press the key to leave your active call." : `Path saved. Reading ${control} status…`;
  };
  input.oninput = () => input.setCustomValidity("");
};
