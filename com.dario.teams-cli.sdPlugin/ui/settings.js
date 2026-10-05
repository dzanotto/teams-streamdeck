/* Stream Deck's documented property-inspector WebSocket interface. No remote scripts. */
window.connectElgatoStreamDeckSocket = (port, uuid, registerEvent, info, actionInfo) => {
  const action = JSON.parse(actionInfo);
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
    settings = { ...settings, cliPath: path };
    send("setSettings", settings);
    detail.textContent = "Path saved. Reading microphone status…";
  };
  input.oninput = () => input.setCustomValidity("");
};
