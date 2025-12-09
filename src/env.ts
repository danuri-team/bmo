import { config } from "dotenv";

config();

export const env = {
  // Discord
  DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN!,
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID!,
  DAILY_REPORT_CHANNEL_ID: process.env.DAILY_REPORT_CHANNEL_ID!,

  // MySQL
  MYSQL_HOST: process.env.MYSQL_HOST!,
  MYSQL_PORT: parseInt(process.env.MYSQL_PORT || "3306"),
  MYSQL_USER: process.env.MYSQL_USER!,
  MYSQL_PASSWORD: process.env.MYSQL_PASSWORD!,
  MYSQL_DATABASE: process.env.MYSQL_DATABASE || "four_cut_prod",

  // AWS Bedrock
  AWS_REGION: process.env.AWS_REGION || "us-east-1",
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID!,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY!,

  // Cloudflare R2
  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID!,
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID!,
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY!,
  R2_BUCKET_NAME: process.env.R2_BUCKET_NAME || "fourcut-bmo",
  R2_PUBLIC_URL: process.env.R2_PUBLIC_URL!, // https://your-bucket.r2.dev
};
