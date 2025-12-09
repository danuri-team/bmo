import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  Message as BedrockMessage,
  ContentBlock,
  Tool,
} from "@aws-sdk/client-bedrock-runtime";
import { env } from "../env.js";

export const bedrock = new BedrockRuntimeClient({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
});

export type StreamChunk = {
  type: "thinking_delta" | "text_delta" | "tool_use_start" | "tool_use_delta";
  thinking?: string;
  text?: string;
  toolUseId?: string;
  toolName?: string;
  toolInput?: string;
};

export async function* streamClaude(
  messages: BedrockMessage[],
  system: string,
  tools: Tool[]
): AsyncGenerator<StreamChunk> {
  // 메시지 히스토리에 tool_use가 있는지 확인
  const hasToolUseHistory = messages.some((msg) =>
    msg.content?.some((content: any) => content.toolUse || content.toolResult)
  );

  const command = new ConverseStreamCommand({
    modelId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    messages,
    system: [{ text: system }],
    inferenceConfig: {
      maxTokens: 64000,
      temperature: 1,
    },
    // tool_use 히스토리가 없을 때만 thinking 활성화
    additionalModelRequestFields: !hasToolUseHistory
      ? {
          thinking: {
            type: "enabled",
            budget_tokens: 20000,
          },
        }
      : undefined,
    toolConfig: tools.length > 0 ? { tools } : undefined,
  });

  const response = await bedrock.send(command);

  if (!response.stream) {
    throw new Error("No stream in response");
  }

  for await (const event of response.stream) {
    if (event.contentBlockStart?.start?.toolUse) {
      yield {
        type: "tool_use_start",
        toolUseId: event.contentBlockStart.start.toolUse.toolUseId,
        toolName: event.contentBlockStart.start.toolUse.name,
      };
    }

    if (event.contentBlockDelta?.delta?.text) {
      yield {
        type: "text_delta",
        text: event.contentBlockDelta.delta.text,
      };
    }

    if (event.contentBlockDelta?.delta?.toolUse) {
      yield {
        type: "tool_use_delta",
        toolInput: event.contentBlockDelta.delta.toolUse.input,
      };
    }

    if ((event as any).thinking) {
      yield {
        type: "thinking_delta",
        thinking: (event as any).thinking,
      };
    }
  }
}

export function createBedrockMessage(
  role: "user" | "assistant",
  content: ContentBlock[]
): BedrockMessage {
  return { role, content };
}
