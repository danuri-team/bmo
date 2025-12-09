import {
  Client,
  GatewayIntentBits,
  TextChannel,
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
import { getDailyReportPrompt } from "./prompts/daily-report.js";

async function generateDailyReport() {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  });

  await client.login(env.DISCORD_BOT_TOKEN);

  try {
    const channel = await client.channels.fetch(env.DAILY_REPORT_CHANNEL_ID);

    if (!channel || !channel.isTextBased()) {
      throw new Error("Invalid channel");
    }

    const textChannel = channel as TextChannel;

    // 리포트 생성 시작 메시지
    let reportMessage = await textChannel.send("📊 **일일 리포트 생성 중...**");

    const dbSchema = await getDatabaseSchema();
    const systemPrompt = getSystemPrompt(dbSchema);
    const reportPrompt = getDailyReportPrompt();

    const tools = [
      {
        toolSpec: {
          name: "execute_sql_query",
          description:
            "MySQL 데이터베이스에서 읽기 전용으로 쿼리를 실행합니다.",
          inputSchema: {
            json: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "SQL 쿼리 문자열",
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
          description: "R2에 파일을 업로드합니다.",
          inputSchema: {
            json: {
              type: "object",
              properties: {
                filename: { type: "string" },
                content: { type: "string" },
                contentType: { type: "string", default: "text/plain" },
              },
              required: ["filename", "content"],
            },
          },
        },
      },
      {
        toolSpec: {
          name: "create_chart",
          description: "차트를 생성합니다.",
          inputSchema: {
            json: {
              type: "object",
              properties: {
                title: { type: "string" },
                type: { type: "string", enum: ["bar", "line", "pie"] },
                data: { type: "object" },
              },
              required: ["title", "type", "data"],
            },
          },
        },
      },
    ] as Tool[];

    const maxIterations = 50;
    const bedrockMessages = [
      createBedrockMessage("user", [{ text: reportPrompt }]),
    ];

    let finalReport = "";
    const chartAttachments: AttachmentBuilder[] = [];

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      let responseText = "";
      const toolsToExecute: { id: string; name: string; input: any }[] = [];
      const toolInputMap = new Map<string, string>();
      let currentToolIndex = -1;

      // 스트리밍
      for await (const chunk of streamClaude(
        bedrockMessages,
        systemPrompt,
        tools
      )) {
        if (chunk.type === "text_delta") {
          responseText += chunk.text || "";
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

      // 최종 텍스트 저장
      if (responseText) {
        finalReport = responseText;
      }

      // 도구 실행 없으면 종료
      if (toolsToExecute.length === 0) {
        break;
      }

      // 도구 실행
      const toolResults: ContentBlock[] = [];

      for (const tool of toolsToExecute) {
        let toolResult: any;

        if (tool.name === "execute_sql_query") {
          console.log(`Executing query: ${tool.input.query?.slice(0, 100)}...`);

          const result = await executeQuery(tool.input.query || "");

          if (result.success) {
            toolResult = {
              ...result,
              rows: maskSensitiveData(result.rows),
            };
          } else {
            toolResult = result;
          }
        } else if (tool.name === "upload_to_r2") {
          console.log(`Uploading to R2: ${tool.input.filename}`);
          toolResult = await uploadToR2(
            tool.input.filename,
            tool.input.content,
            tool.input.contentType
          );
        } else if (tool.name === "create_chart") {
          console.log(`Generating chart: ${tool.input.title}`);

          try {
            const chartBuffer = await generateChart(
              tool.input.title,
              tool.input.type,
              tool.input.data as ChartData
            );

            chartAttachments.push(
              new AttachmentBuilder(chartBuffer, {
                name: `chart_${chartAttachments.length + 1}.png`,
              })
            );

            toolResult = { success: true };
          } catch (err) {
            toolResult = {
              success: false,
              error: err instanceof Error ? err.message : String(err),
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

      if (iteration === maxIterations - 1) {
        break;
      }
    }

    // 최종 리포트 전송
    await reportMessage.delete();

    // 리포트를 여러 메시지로 분할 (2000자 제한)
    const chunks = splitMessage(finalReport, 2000);

    for (let i = 0; i < chunks.length; i++) {
      if (i === 0 && chartAttachments.length > 0) {
        await textChannel.send({
          content: chunks[i],
          files: chartAttachments,
        });
      } else {
        await textChannel.send(chunks[i]);
      }
    }

    console.log("✅ Daily report sent successfully");
  } catch (err) {
    console.error("❌ Error generating daily report:", err);
    throw err;
  } finally {
    client.destroy();
  }
}

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

// 직접 실행 시
if (import.meta.url === `file://${process.argv[1]}`) {
  generateDailyReport()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

export { generateDailyReport };
