import { ChartJSNodeCanvas } from "chartjs-node-canvas";

const CHART_COLORS = [
  "#5470c6", // 파랑
  "#91cc75", // 초록
  "#fac858", // 노랑
  "#ee6666", // 빨강
  "#73c0de", // 하늘
  "#3ba272", // 진초록
  "#fc8452", // 주황
  "#9a60b4", // 보라
];

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
      chartCallback: (ChartJS) => {
        ChartJS.defaults.font.family =
          "Noto Sans CJK KR, Noto Sans KR, sans-serif";
      },
    });
    console.log("ChartJSNodeCanvas 초기화 완료");

    const coloredData = {
      ...data,
      datasets: data.datasets.map((dataset, index) => {
        const color = CHART_COLORS[index % CHART_COLORS.length];
        return {
          ...dataset,
          backgroundColor:
            dataset.backgroundColor ?? (type === "line" ? `${color}33` : color),
          borderColor: dataset.borderColor ?? color,
          borderWidth: 2,
        };
      }),
    };

    const configuration: any = {
      type,
      data: coloredData,
      options: {
        responsive: false,
        plugins: {
          title: {
            display: true,
            text: title,
            font: {
              size: 20,
              weight: "bold",
            },
            color: "#333",
          },
          legend: {
            display: true,
            position: "top",
            labels: {
              color: "#666",
            },
          },
        },
      },
    };

    if (type === "bar" || type === "line") {
      configuration.options.scales = {
        x: {
          ticks: { color: "#666" },
          grid: { color: "#e0e0e0" },
        },
        y: {
          beginAtZero: true,
          ticks: { color: "#666" },
          grid: { color: "#e0e0e0" },
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
      data,
    });
    throw error;
  }
}
