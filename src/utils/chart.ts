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
  const width = 800;
  const height = 600;

  const chartJSNodeCanvas = new ChartJSNodeCanvas({
    width,
    height,
    backgroundColour: "white",
  });

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

  return await chartJSNodeCanvas.renderToBuffer(configuration);
}
    