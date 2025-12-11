import { ChartJSNodeCanvas } from "chartjs-node-canvas";

export type ChartData = {
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    backgroundColor?: string | string[];
    borderColor?: string | string[];
  }[];
};

export async function generateChart(
  title: string,
  type: "bar" | "line" | "pie",
  data: ChartData
): Promise<Buffer> {
  console.log("generateChart 함수 시작:", {
    title,
    type,
    hasData: !!data,
    labels: data?.labels,
    datasets: data?.datasets?.length,
  });

  try {
    const width = 800;
    const height = 600;

    console.log("ChartJSNodeCanvas 초기화 시작");
    const chartJSNodeCanvas = new ChartJSNodeCanvas({
      width,
      height,
      backgroundColour: "white",
    });
    console.log("ChartJSNodeCanvas 초기화 완료");

    const configuration: any = {
      type,
      data,
      options: {
        responsive: false,
        plugins: {
          title: {
            display: true,
            text: title,
            font: {
              size: 20,
            },
          },
          legend: {
            display: true,
            position: "top",
          },
        },
      },
    };

    if (type === "bar" || type === "line") {
      configuration.options.scales = {
        y: {
          beginAtZero: true,
        },
      };
    }

    console.log("차트 설정:", JSON.stringify(configuration, null, 2));

    console.log("renderToBuffer 시작");
    const buffer = await chartJSNodeCanvas.renderToBuffer(configuration);
    console.log("renderToBuffer 완료, 버퍼 크기:", buffer.length);

    return buffer;
  } catch (error) {
    console.error("generateChart 에러 발생:", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      title,
      type,
      data
    });
    throw error;
  }
}
    