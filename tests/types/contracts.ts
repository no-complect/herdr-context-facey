import { createReader, decodeResponse } from "../../src/reader-client.js";
import { categoryOf } from "../../src/model.js";
import type { Provider, ContextEvent } from "../../src/contracts.js";

// These examples must stay compile errors; otherwise the public contract has
// silently widened and the editor can no longer protect these call sites.
// @ts-expect-error Unsupported providers are not context targets.
const unsupported: Provider = "gemini-cli";
void unsupported;
// @ts-expect-error Category identities are a closed set.
const category: ContextEvent["category"] = "made-up-category";
void category;

const read = createReader(async () => ({ code: 0, stdout: "" }), "/reader.py");
// @ts-expect-error Unsupported focus is not a valid reader request.
void read({ provider: null });
// @ts-expect-error A detail reference needs a session, revision and fingerprint.
void read({ action: "detail", source: "/transcript" });

const response = decodeResponse("{}");
if (response.status === "detail") {
  response.text.toUpperCase();
  // @ts-expect-error A detail response is not a snapshot.
  response.events;
}
if (response.status === "snapshot") {
  response.events.forEach((event: ContextEvent) => categoryOf(event.category));
}
