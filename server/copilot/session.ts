import "server-only";
import { CopilotClient, approveAll, type CopilotSession, type Tool } from "@github/copilot-sdk";
import { TOOL_NAMES } from "./tools";

export interface CopilotHandle {
  client: CopilotClient;
  session: CopilotSession;
}

/**
 * Starts a Copilot CLI runtime and creates a session restricted to our custom
 * tools (the agent can only act through them — a sandbox). The session's working
 * directory is the target project so file reads resolve correctly.
 */
export async function createCopilotSession(opts: {
  workingDirectory: string;
  tools: Tool[];
}): Promise<CopilotHandle> {
  const client = new CopilotClient();
  await client.start();

  const model = process.env.WIZARD_MODEL;
  const session = await client.createSession({
    clientName: "wizard-testing",
    ...(model ? { model } : {}),
    workingDirectory: opts.workingDirectory,
    tools: opts.tools,
    // Restrict the agent to only the wizard tools.
    availableTools: TOOL_NAMES,
    onPermissionRequest: approveAll,
  });

  return { client, session };
}

export async function disposeCopilot(handle: CopilotHandle | null): Promise<void> {
  if (!handle) return;
  try {
    await handle.session.disconnect();
  } catch {
    /* ignore */
  }
  try {
    await handle.client.stop();
  } catch {
    /* ignore */
  }
}
