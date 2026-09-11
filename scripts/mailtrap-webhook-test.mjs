/**
 * Sends a correctly signed Mailtrap Inbound webhook at your own endpoint.
 *
 * A 401 from a real Mailtrap delivery is ambiguous: the secret could be wrong,
 * the body could have been altered in transit by a proxy, or the signature
 * header could be arriving under a name we do not read. This proves which, by
 * signing a known payload with a known secret and showing the exact response.
 *
 *   node scripts/mailtrap-webhook-test.mjs http://localhost:3000/api/inbound/email
 *   node scripts/mailtrap-webhook-test.mjs https://your-host/api/inbound/email
 *
 * The secret comes from MAILTRAP_SIGNING_SECRET in .env, or a second argument.
 * NOTE: it must match the secret the SERVER reads. If the server takes its
 * secret from the Settings table rather than the environment, they can differ —
 * that on its own explains a 401.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function envFromFile() {
  try {
    const out = {};
    for (const line of readFileSync(join(root, ".env"), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return out;
  } catch {
    return {};
  }
}

const [, , urlArg, secretArg] = process.argv;
const url = urlArg ?? "http://localhost:3000/api/inbound/email";
const fileEnv = envFromFile();
const secret = secretArg ?? process.env.MAILTRAP_SIGNING_SECRET ?? fileEnv.MAILTRAP_SIGNING_SECRET;

if (!secret) {
  console.error(
    "No signing secret. Pass it as the second argument or set MAILTRAP_SIGNING_SECRET in .env.",
  );
  process.exit(1);
}

// The payload shape Mailtrap documents for an inbound delivery.
const body = JSON.stringify({
  events: [
    {
      event: "inbound.message_received",
      event_id: "test-" + Date.now(),
      timestamp: Date.now(),
      inbox_id: Number(fileEnv.MAILTRAP_INBOUND_INBOX_ID || 1),
      message_id: "1875440790670688064",
      from: "Test Sender <sender@example.com>",
    },
  ],
});

const signature = createHmac("sha256", secret).update(body, "utf8").digest("hex");

console.log(`POST ${url}`);
console.log(`  secret: ${secret.length} chars, ending "${secret.slice(-4)}"`);
console.log(`  body:   ${Buffer.byteLength(body, "utf8")} bytes`);
console.log(`  sig:    ${signature.slice(0, 16)}… (${signature.length} chars)\n`);

let res;
try {
  res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Mailtrap-Signature": signature },
    body,
  });
} catch (err) {
  console.error(`Could not reach ${url}: ${err instanceof Error ? err.message : err}`);
  console.error("Is the app running, and is the URL right?");
  process.exit(1);
}
const text = await res.text();
console.log(`HTTP ${res.status}`);
console.log(text);

if (res.status === 401) {
  console.log(
    "\n401 with a locally correct signature means the SERVER is using a different secret.",
  );
  console.log("Check Settings → Mailtrap → Webhook signing secret, or MAILTRAP_SIGNING_SECRET.");
} else if (res.status === 503) {
  console.log("\n503 means the server has no signing secret configured at all.");
} else if (res.status === 500) {
  console.log(
    "\nSignature accepted. The failure is downstream — fetching the message from Mailtrap.",
  );
  console.log("The message id above is fake, so 'fetch-failed' here is expected and fine.");
} else if (res.ok) {
  console.log("\nSignature accepted and the event was handled.");
}
