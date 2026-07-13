const $ = (selector) => document.querySelector(selector);
let approvalToken = "";
let proposal = null;

async function api(path, body) {
  const accessToken = $("#access-token").value.trim();
  if (!accessToken) throw new Error("Enter the demo access code first.");
  const response = await fetch(`/api/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data;
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  if (label) button.textContent = busy ? label : button.dataset.label;
}

function showStatus(message, error = false) {
  $("#status").textContent = message;
  $("#status").className = error ? "error" : "";
}

function renderProposal(data) {
  approvalToken = data.approvalToken;
  proposal = data.proposal;
  $("#request-title").textContent = proposal.message.subject;
  $("#request-from").textContent = `From ${proposal.message.from}`;
  $("#request-body").textContent = proposal.message.bodyText;
  $("#event-preview").textContent = `${proposal.eventTitle} · ${proposal.timeZone}`;
  $("#draft-to").textContent = proposal.draft.to;
  $("#draft-subject").textContent = proposal.draft.subject;
  $("#draft-body").textContent = proposal.draft.bodyText;
  $("#slots").replaceChildren(...proposal.slots.map((slot, index) => {
    const label = document.createElement("label");
    label.className = "slot";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "slot";
    radio.value = String(index);
    radio.checked = index === 0;
    label.append(radio, document.createTextNode(slot.label));
    return label;
  }));
  $("#proposal-card").classList.remove("hidden");
  $("#proposal-card").scrollIntoView({ behavior: "smooth", block: "start" });
}

$("#scan").dataset.label = $("#scan").textContent;
$("#scan").addEventListener("click", async () => {
  const button = $("#scan");
  try {
    setBusy(button, true, "Reading Gmail + Calendar…");
    showStatus("Finding a real meeting request and two conflict-free slots…");
    renderProposal(await api("scan"));
    showStatus("Review every detail below. No write has happened.");
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    setBusy(button, false, "");
  }
});

$("#approve").dataset.label = $("#approve").textContent;
$("#approve").addEventListener("click", async () => {
  const button = $("#approve");
  try {
    const selected = document.querySelector('input[name="slot"]:checked');
    if (!selected || !proposal) throw new Error("Choose a proposed slot.");
    setBusy(button, true, "Creating approved artifacts…");
    showStatus("Approval recorded. Creating exactly one Calendar event and one Gmail draft…");
    const result = await api("approve", { approvalToken, selectedSlotIndex: Number(selected.value) });
    $("#result-copy").textContent = `Run ${result.runId}. LAB telemetry: ${result.labOptional ? "enabled (optional)" : "not configured — structured Vercel audit log retained"}.`;
    $("#calendar-link").href = result.event.htmlLink;
    $("#result-card").classList.remove("hidden");
    $("#result-card").scrollIntoView({ behavior: "smooth", block: "start" });
    showStatus("Complete.");
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    setBusy(button, false, "");
  }
});

fetch("/api/health")
  .then((response) => response.json())
  .then((data) => {
    const ready = data.configured && data.configured.google && data.configured.openrouter && data.configured.approval;
    $("#health").textContent = ready
      ? `Ready · Google ✓ · OpenRouter ✓ · Approval gate ✓ · LAB ${data.configured.labOptional ? "optional ✓" : "optional —"}`
      : "Deployment is missing one or more required connections.";
    $("#health").classList.toggle("not-ready", !ready);
  })
  .catch(() => { $("#health").textContent = "Health check unavailable."; });
