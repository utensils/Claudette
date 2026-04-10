import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "./useAppStore";
import type { AgentQuestion } from "./useAppStore";
import type { ConversationCheckpoint } from "../types/checkpoint";

const WS_ID = "test-workspace";

function makeQuestion(wsId: string = WS_ID): AgentQuestion {
  return {
    workspaceId: wsId,
    toolUseId: "tool-1",
    questions: [
      {
        question: "Pick a framework",
        options: [{ label: "React" }, { label: "Vue" }],
      },
    ],
  };
}

function addToolActivities(wsId: string = WS_ID) {
  useAppStore.setState({
    toolActivities: {
      [wsId]: [
        {
          toolUseId: "tool-1",
          toolName: "AskUserQuestion",
          inputJson: "{}",
          resultText: "",
          collapsed: true,
          summary: "",
        },
      ],
    },
  });
}

describe("agentQuestion lifecycle (per-workspace)", () => {
  beforeEach(() => {
    useAppStore.setState({
      agentQuestions: {},
      toolActivities: {},
      completedTurns: {},
      chatMessages: {},
    });
  });

  it("setAgentQuestion stores question keyed by workspace", () => {
    const q = makeQuestion();
    useAppStore.getState().setAgentQuestion(q);
    expect(useAppStore.getState().agentQuestions[WS_ID]).toEqual(q);
  });

  it("clearAgentQuestion removes question for that workspace only", () => {
    useAppStore.getState().setAgentQuestion(makeQuestion(WS_ID));
    useAppStore.getState().setAgentQuestion(makeQuestion("other-ws"));
    useAppStore.getState().clearAgentQuestion(WS_ID);
    expect(useAppStore.getState().agentQuestions[WS_ID]).toBeUndefined();
    expect(useAppStore.getState().agentQuestions["other-ws"]).toBeDefined();
  });

  it("finalizeTurn does NOT clear agentQuestions", () => {
    const q = makeQuestion();
    useAppStore.getState().setAgentQuestion(q);
    addToolActivities();

    useAppStore.getState().finalizeTurn(WS_ID, 1);

    expect(useAppStore.getState().toolActivities[WS_ID]).toEqual([]);
    expect(useAppStore.getState().completedTurns[WS_ID]).toHaveLength(1);
    expect(useAppStore.getState().agentQuestions[WS_ID]).toEqual(q);
  });

  it("agentQuestion persists across multiple finalizeTurn calls", () => {
    const q = makeQuestion();
    useAppStore.getState().setAgentQuestion(q);

    useAppStore.getState().finalizeTurn(WS_ID, 0);
    useAppStore.getState().finalizeTurn(WS_ID, 0);

    expect(useAppStore.getState().agentQuestions[WS_ID]).toEqual(q);
  });

  it("questions are isolated per workspace", () => {
    const qa = makeQuestion("ws-a");
    const qb = makeQuestion("ws-b");
    useAppStore.getState().setAgentQuestion(qa);
    useAppStore.getState().setAgentQuestion(qb);

    expect(useAppStore.getState().agentQuestions["ws-a"]).toEqual(qa);
    expect(useAppStore.getState().agentQuestions["ws-b"]).toEqual(qb);
  });
});

describe("finalizeTurn afterMessageIndex", () => {
  beforeEach(() => {
    useAppStore.setState({
      toolActivities: {},
      completedTurns: {},
      chatMessages: {},
    });
  });

  it("records afterMessageIndex as current chatMessages length", () => {
    useAppStore.setState({
      chatMessages: {
        [WS_ID]: [
          { id: "m1", workspace_id: WS_ID, role: "User", content: "hi", cost_usd: null, duration_ms: null, created_at: "" },
          { id: "m2", workspace_id: WS_ID, role: "Assistant", content: "hello", cost_usd: null, duration_ms: null, created_at: "" },
        ],
      },
    });
    addToolActivities();

    useAppStore.getState().finalizeTurn(WS_ID, 1);

    const turns = useAppStore.getState().completedTurns[WS_ID];
    expect(turns).toHaveLength(1);
    expect(turns[0].afterMessageIndex).toBe(2);
  });

  it("records 0 when no messages exist", () => {
    addToolActivities();
    useAppStore.getState().finalizeTurn(WS_ID, 0);

    const turns = useAppStore.getState().completedTurns[WS_ID];
    expect(turns[0].afterMessageIndex).toBe(0);
  });

  it("successive turns get increasing afterMessageIndex", () => {
    useAppStore.setState({
      chatMessages: { [WS_ID]: [{ id: "m1", workspace_id: WS_ID, role: "Assistant", content: "a", cost_usd: null, duration_ms: null, created_at: "" }] },
    });
    addToolActivities();
    useAppStore.getState().finalizeTurn(WS_ID, 1);

    useAppStore.setState({
      chatMessages: {
        [WS_ID]: [
          { id: "m1", workspace_id: WS_ID, role: "Assistant", content: "a", cost_usd: null, duration_ms: null, created_at: "" },
          { id: "m2", workspace_id: WS_ID, role: "User", content: "b", cost_usd: null, duration_ms: null, created_at: "" },
          { id: "m3", workspace_id: WS_ID, role: "Assistant", content: "c", cost_usd: null, duration_ms: null, created_at: "" },
        ],
      },
    });
    addToolActivities();
    useAppStore.getState().finalizeTurn(WS_ID, 1);

    const turns = useAppStore.getState().completedTurns[WS_ID];
    expect(turns).toHaveLength(2);
    expect(turns[0].afterMessageIndex).toBe(1);
    expect(turns[1].afterMessageIndex).toBe(3);
  });
});

// --- Checkpoint tests ---

function makeCheckpoint(
  id: string,
  wsId: string,
  messageId: string,
  turnIndex: number,
): ConversationCheckpoint {
  return {
    id,
    workspace_id: wsId,
    message_id: messageId,
    commit_hash: `hash-${turnIndex}`,
    turn_index: turnIndex,
    message_count: 1,
    created_at: "",
  };
}

describe("checkpoint management", () => {
  beforeEach(() => {
    useAppStore.setState({ checkpoints: {} });
  });

  it("setCheckpoints stores checkpoints keyed by workspace", () => {
    const cps = [makeCheckpoint("cp1", WS_ID, "m2", 0)];
    useAppStore.getState().setCheckpoints(WS_ID, cps);
    expect(useAppStore.getState().checkpoints[WS_ID]).toEqual(cps);
  });

  it("addCheckpoint appends to existing list", () => {
    useAppStore.getState().setCheckpoints(WS_ID, [
      makeCheckpoint("cp1", WS_ID, "m2", 0),
    ]);
    useAppStore.getState().addCheckpoint(
      WS_ID,
      makeCheckpoint("cp2", WS_ID, "m4", 1),
    );
    expect(useAppStore.getState().checkpoints[WS_ID]).toHaveLength(2);
    expect(useAppStore.getState().checkpoints[WS_ID][1].id).toBe("cp2");
  });

  it("addCheckpoint creates list when none exists", () => {
    useAppStore.getState().addCheckpoint(
      WS_ID,
      makeCheckpoint("cp1", WS_ID, "m2", 0),
    );
    expect(useAppStore.getState().checkpoints[WS_ID]).toHaveLength(1);
  });
});

describe("rollbackConversation", () => {
  beforeEach(() => {
    useAppStore.setState({
      chatMessages: {},
      completedTurns: {},
      toolActivities: {},
      streamingContent: {},
      agentQuestions: {},
      planApprovals: {},
      checkpoints: {},
    });
  });

  it("replaces chat messages with truncated list", () => {
    useAppStore.setState({
      chatMessages: {
        [WS_ID]: [
          { id: "m1", workspace_id: WS_ID, role: "User", content: "q1", cost_usd: null, duration_ms: null, created_at: "" },
          { id: "m2", workspace_id: WS_ID, role: "Assistant", content: "a1", cost_usd: null, duration_ms: null, created_at: "" },
          { id: "m3", workspace_id: WS_ID, role: "User", content: "q2", cost_usd: null, duration_ms: null, created_at: "" },
          { id: "m4", workspace_id: WS_ID, role: "Assistant", content: "a2", cost_usd: null, duration_ms: null, created_at: "" },
        ],
      },
      checkpoints: {
        [WS_ID]: [
          makeCheckpoint("cp1", WS_ID, "m2", 0),
          makeCheckpoint("cp2", WS_ID, "m4", 1),
        ],
      },
    });

    // Simulate backend returning truncated messages.
    const truncated = [
      { id: "m1", workspace_id: WS_ID, role: "User" as const, content: "q1", cost_usd: null, duration_ms: null, created_at: "" },
      { id: "m2", workspace_id: WS_ID, role: "Assistant" as const, content: "a1", cost_usd: null, duration_ms: null, created_at: "" },
    ];
    useAppStore.getState().rollbackConversation(WS_ID, "cp1", truncated);

    expect(useAppStore.getState().chatMessages[WS_ID]).toEqual(truncated);
  });

  it("clears completedTurns and toolActivities for workspace", () => {
    addToolActivities();
    useAppStore.getState().finalizeTurn(WS_ID, 1);
    useAppStore.setState({
      checkpoints: { [WS_ID]: [makeCheckpoint("cp1", WS_ID, "m1", 0)] },
    });

    useAppStore.getState().rollbackConversation(WS_ID, "cp1", []);

    expect(useAppStore.getState().completedTurns[WS_ID]).toEqual([]);
    expect(useAppStore.getState().toolActivities[WS_ID]).toEqual([]);
  });

  it("clears streaming content for workspace", () => {
    useAppStore.setState({
      streamingContent: { [WS_ID]: "some partial text" },
      checkpoints: { [WS_ID]: [makeCheckpoint("cp1", WS_ID, "m1", 0)] },
    });

    useAppStore.getState().rollbackConversation(WS_ID, "cp1", []);

    expect(useAppStore.getState().streamingContent[WS_ID]).toBe("");
  });

  it("trims checkpoints after the target", () => {
    useAppStore.setState({
      checkpoints: {
        [WS_ID]: [
          makeCheckpoint("cp1", WS_ID, "m2", 0),
          makeCheckpoint("cp2", WS_ID, "m4", 1),
          makeCheckpoint("cp3", WS_ID, "m6", 2),
        ],
      },
    });

    useAppStore.getState().rollbackConversation(WS_ID, "cp1", []);

    const remaining = useAppStore.getState().checkpoints[WS_ID];
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe("cp1");
  });

  it("does not affect other workspaces", () => {
    const OTHER_WS = "other-ws";
    useAppStore.setState({
      chatMessages: {
        [WS_ID]: [{ id: "m1", workspace_id: WS_ID, role: "User", content: "q1", cost_usd: null, duration_ms: null, created_at: "" }],
        [OTHER_WS]: [{ id: "m2", workspace_id: OTHER_WS, role: "User", content: "q2", cost_usd: null, duration_ms: null, created_at: "" }],
      },
      checkpoints: {
        [WS_ID]: [makeCheckpoint("cp1", WS_ID, "m1", 0)],
        [OTHER_WS]: [makeCheckpoint("cp2", OTHER_WS, "m2", 0)],
      },
    });

    useAppStore.getState().rollbackConversation(WS_ID, "cp1", []);

    expect(useAppStore.getState().chatMessages[OTHER_WS]).toHaveLength(1);
    expect(useAppStore.getState().checkpoints[OTHER_WS]).toHaveLength(1);
  });
});
