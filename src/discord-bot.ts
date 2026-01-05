import {
  Client,
  GatewayIntentBits,
  Message,
  AttachmentBuilder,
} from "discord.js";
import { ContentBlock, Tool } from "@aws-sdk/client-bedrock-runtime";
import { env } from "./env.js";
import { streamClaude, createBedrockMessage } from "./utils/bedrock.js";
import { executeQuery, getDatabaseSchema } from "./utils/mysql.js";
import { uploadToR2 } from "./utils/r2.js";
import { generateChart, ChartData } from "./utils/chart.js";
import { maskSensitiveData } from "./utils/masking.js";
import { getSystemPrompt } from "./prompts/system.js";
import { startScheduler } from "./scheduler.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const MESSAGE_UPDATE_INTERVAL = 1000;
const MIN_UPDATE_CHARS = 50;
const MESSAGE_LIMIT = 2000;

client.on("ready", () => {
  console.log(`✅ Logged in as ${client.user?.tag}`);
  // startScheduler();
});

client.on("messageCreate", async (message: Message) => {
  // 봇 자신의 메시지 무시
  if (message.author.bot) return;

  // 멘션 확인
  const botMention = `<@${client.user?.id}>`;
  if (!message.content.includes(botMention)) return;

  // 멘션 제거한 실제 메시지
  const userMessage = message.content.replace(botMention, "").trim();

  if (!userMessage) {
    await message.reply("안녕하세요! 무엇을 도와드릴까요? 🥔");
    return;
  }

  // 리액션 추가
  await message.react("👀");

  let botMessage: Message | null = null;
  let lastUpdateTime = Date.now();
  let lastUpdateText = "";

  const updateMessage = async (text: string, force = false) => {
    const now = Date.now();
    const timeSinceUpdate = now - lastUpdateTime;
    const charsSinceUpdate = text.length - lastUpdateText.length;

    if (
      force ||
      (timeSinceUpdate >= MESSAGE_UPDATE_INTERVAL &&
        charsSinceUpdate >= MIN_UPDATE_CHARS)
    ) {
      const chunks = splitMessage(text || "💭 생각 중...", MESSAGE_LIMIT);

      if (!botMessage) {
        botMessage = await message.reply(chunks[0]);
      } else {
        await botMessage.edit(chunks[0]);
      }

      // Discord는 단일 메시지만 편집 가능, 추가 청크는 새 메시지로
      // 간단히 하기 위해 첫 청크만 사용 (긴 응답은 파일로)

      lastUpdateTime = now;
      lastUpdateText = text;
    }
  };

  try {
    // 스레드 메시지 수집 (최대 10개)
    const threadMessages: any[] = [];

    if (message.reference?.messageId) {
      const channel = message.channel;
      if (channel.isTextBased()) {
        const messages = await channel.messages.fetch({ limit: 10 });
        const sortedMessages = Array.from(messages.values()).sort(
          (a, b) => a.createdTimestamp - b.createdTimestamp
        );

        for (const msg of sortedMessages) {
          if (
            msg.id === message.id ||
            msg.author.bot !== (msg.author.id === client.user?.id)
          ) {
            continue;
          }

          const role =
            msg.author.id === message.author.id ? "user" : "assistant";
          const content = msg.content.replace(botMention, "").trim();

          if (content) {
            threadMessages.push({ role, content });
          }
        }
      }
    }

    // 현재 메시지 추가
    const messages = [
      ...threadMessages,
      { role: "user", content: userMessage },
    ];

    // DB 스키마 가져오기
    const dbSchema = await getDatabaseSchema();
    const systemPrompt = getSystemPrompt(dbSchema);

    // Bedrock 도구 정의
    const tools = [
      {
        toolSpec: {
          name: "execute_sql_query",
          description:
            "MySQL 데이터베이스에서 읽기 전용으로 쿼리를 실행합니다. SELECT 쿼리만 가능합니다.",
          inputSchema: {
            json: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description:
                    "SQL 쿼리 문자열. 쿼리 상단에 주석(-- 또는 /* */)으로 설명을 포함하세요.",
                },
              },
              required: ["query"],
            },
          },
        },
      },
      {
        toolSpec: {
          name: "upload_to_r2",
          description:
            "Cloudflare R2에 데이터를 업로드하고 다운로드 URL을 생성합니다.",
          inputSchema: {
            json: {
              type: "object",
              properties: {
                filename: {
                  type: "string",
                  description: "업로드할 파일 이름 (예: report.json, data.csv)",
                },
                content: {
                  type: "string",
                  description: "업로드할 파일 내용",
                },
                contentType: {
                  type: "string",
                  description: "MIME 타입 (예: application/json, text/csv)",
                  default: "text/plain",
                },
              },
              required: ["filename", "content"],
            },
          },
        },
      },
      {
        toolSpec: {
          name: "create_chart",
          description:
            "데이터를 시각화하여 차트 이미지를 생성하고 Discord에 업로드합니다.",
          inputSchema: {
            json: {
              type: "object",
              properties: {
                title: {
                  type: "string",
                  description: "차트 제목",
                },
                type: {
                  type: "string",
                  enum: ["bar", "line", "pie"],
                  description: "차트 타입",
                },
                data: {
                  type: "object",
                  description:
                    "차트 데이터. { labels: string[], datasets: [{ label: string, data: number[] }] }",
                },
              },
              required: ["title", "type", "data"],
            },
          },
        },
      },
    ] as Tool[];

    const maxIterations = 50;
    const bedrockMessages: any[] = messages.map((m) =>
      createBedrockMessage(m.role, [{ text: m.content }])
    );

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      let responseText = "";
      let thinkingText = "";
      const toolsToExecute: { id: string; name: string; input: any }[] = [];
      const toolInputMap = new Map<string, string>();
      let currentToolIndex = -1;

      // 스트리밍
      for await (const chunk of streamClaude(
        bedrockMessages,
        systemPrompt,
        tools
      )) {
        if (chunk.type === "thinking_delta") {
          thinkingText += chunk.thinking || "";
          await updateMessage(
            `💭 **생각 중...**\n\`\`\`\n${thinkingText}\n\`\`\``
          );
        } else if (chunk.type === "text_delta") {
          responseText += chunk.text || "";
          await updateMessage(responseText);
        } else if (chunk.type === "tool_use_start") {
          currentToolIndex = toolsToExecute.length;
          toolsToExecute.push({
            id: chunk.toolUseId!,
            name: chunk.toolName!,
            input: {},
          });
          toolInputMap.set(chunk.toolUseId!, "");
        } else if (chunk.type === "tool_use_delta" && currentToolIndex >= 0) {
          const toolId = toolsToExecute[currentToolIndex]?.id;
          if (toolId) {
            const current = toolInputMap.get(toolId) || "";
            toolInputMap.set(toolId, current + (chunk.toolInput || ""));
          }
        }
      }

      // 도구 입력 파싱
      for (const tool of toolsToExecute) {
        const inputJson = toolInputMap.get(tool.id);
        if (inputJson) {
          try {
            tool.input = JSON.parse(inputJson);
          } catch {
            tool.input = {};
          }
        }
      }

      // 최종 업데이트
      if (responseText && toolsToExecute.length === 0) {
        await updateMessage(responseText, true);
        break;
      }

      // 도구 실행
      if (toolsToExecute.length > 0) {
        const toolResults: ContentBlock[] = [];

        for (const tool of toolsToExecute) {
          let toolResult: any;
          let statusMessage = "";

          if (tool.name === "execute_sql_query") {
            const query = tool.input.query || "";
            const truncatedQuery =
              query.length > 500 ? query.slice(0, 500) + "..." : query;

            statusMessage = `🔍 **데이터베이스 조회 중...**\n\`\`\`sql\n${truncatedQuery}\n\`\`\``;
            await updateMessage(responseText + "\n\n" + statusMessage, true);

            const result = await executeQuery(query);

            // 민감 정보 마스킹
            if (result.success) {
              toolResult = {
                ...result,
                rows: maskSensitiveData(result.rows),
              };
            } else {
              toolResult = result;
            }
          } else if (tool.name === "upload_to_r2") {
            const { filename, content, contentType } = tool.input;

            statusMessage = `📤 **R2에 파일 업로드 중**: ${filename}`;
            await updateMessage(responseText + "\n\n" + statusMessage, true);

            toolResult = await uploadToR2(filename, content, contentType);
          } else if (tool.name === "create_chart") {
            const { title, type, data } = tool.input;

            statusMessage = `📊 **차트 생성 중**: ${title}`;
            await updateMessage(responseText + "\n\n" + statusMessage, true);

            try {
              // 입력 데이터 검증 및 로깅
              console.log("차트 생성 시작:", {
                title,
                type,
                dataLabels: data?.labels,
                datasetCount: data?.datasets?.length,
                datasets: data?.datasets?.map((d: any) => ({
                  label: d.label,
                  dataLength: d.data?.length,
                  data: d.data
                }))
              });

              const chartBuffer = await generateChart(
                title,
                type,
                data as ChartData
              );

              console.log("차트 버퍼 생성 완료:", {
                bufferSize: chartBuffer?.length,
                isBuffer: Buffer.isBuffer(chartBuffer)
              });

              const attachment = new AttachmentBuilder(chartBuffer, {
                name: "chart.png",
              });

              if (message.channel && "send" in message.channel) {
                await message.channel.send({
                  content: `📊 **${title}**`,
                  files: [attachment],
                });
                console.log("차트 Discord 전송 완료");
              }

              toolResult = { success: true, message: "차트 생성 및 전송 완료" };
            } catch (err) {
              console.error("차트 생성 실패 - 상세 에러:", {
                errorMessage: err instanceof Error ? err.message : String(err),
                errorStack: err instanceof Error ? err.stack : undefined,
                inputData: { title, type, data }
              });

              toolResult = {
                success: false,
                error: err instanceof Error ? err.message : String(err),
                details: err instanceof Error ? err.stack : "스택 트레이스 없음"
              };
            }
          }

          toolResults.push({
            toolResult: {
              toolUseId: tool.id,
              content: [{ json: toolResult }],
            },
          });
        }

        // 메시지 업데이트
        if (responseText) {
          await updateMessage(responseText, true);
        }

        // Bedrock 메시지에 추가
        bedrockMessages.push(
          createBedrockMessage("assistant", [
            ...(responseText ? [{ text: responseText }] : []),
            ...toolsToExecute.map((t) => ({
              toolUse: {
                toolUseId: t.id,
                name: t.name,
                input: t.input,
              },
            })),
          ]),
          createBedrockMessage("user", toolResults)
        );
      } else {
        break;
      }

      if (iteration === maxIterations - 1) {
        await updateMessage(responseText || "지금은 응답할 수 없어요.", true);
      }
    }

    // 완료 리액션
    try {
      await message.reactions.removeAll();
    } catch (permissionError) {
      const botReactions = message.reactions.cache.filter((reaction) =>
        reaction.users.cache.has(client.user!.id)
      );
      for (const reaction of botReactions.values()) {
        await reaction.users.remove(client.user!.id).catch(() => {});
      }
    }
    await message.react("✅");
  } catch (err) {
    console.error("Error:", err);

    if (botMessage) {
      await botMessage.edit(
        `❌ 오류가 발생했어요.\n\`\`\`${
          err instanceof Error ? err.message : String(err)
        }\`\`\``
      );
    }

    try {
      await message.reactions.removeAll();
    } catch (permissionError) {
      // 권한이 없는 경우 봇이 추가한 반응만 제거
      const botReactions = message.reactions.cache.filter((reaction) =>
        reaction.users.cache.has(client.user!.id)
      );
      for (const reaction of botReactions.values()) {
        await reaction.users.remove(client.user!.id).catch(() => {});
      }
    }
    await message.react("❌");
  }
});

function splitMessage(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let current = "";
  const lines = text.split("\n");

  for (const line of lines) {
    if ((current + "\n" + line).length > limit) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current = current ? current + "\n" + line : line;
    }
  }

  if (current) chunks.push(current);

  return chunks;
}

client.login(env.DISCORD_BOT_TOKEN);
