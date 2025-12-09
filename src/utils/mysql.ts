import mysql from "mysql2/promise";
import { env } from "../env.js";

export const pool = mysql.createPool({
  host: env.MYSQL_HOST,
  port: env.MYSQL_PORT,
  user: env.MYSQL_USER,
  password: env.MYSQL_PASSWORD,
  database: env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: "+09:00",
  dateStrings: true,
});

type QueryResult =
  | {
      success: true;
      count: number;
      rows: any[];
    }
  | {
      success: false;
      error: string;
    };

export async function executeQuery(query: string): Promise<QueryResult> {
  const connection = await pool.getConnection();

  try {
    // 읽기 전용 트랜잭션 시작
    await connection.query("SET TRANSACTION READ ONLY");
    await connection.beginTransaction();

    const [rows] = await connection.query(query);

    await connection.commit();

    return {
      success: true,
      count: Array.isArray(rows) ? rows.length : 0,
      rows: Array.isArray(rows) ? rows : [rows],
    };
  } catch (err) {
    await connection.rollback();

    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    connection.release();
  }
}

// 데이터베이스 스키마 캐싱
let schemaCache: any = null;

export async function getDatabaseSchema() {
  if (schemaCache) {
    return schemaCache;
  }

  const connection = await pool.getConnection();

  try {
    // 테이블 정보
    const [tables] = await connection.query(
      `
      SELECT 
        TABLE_NAME as table_name,
        TABLE_COMMENT as table_comment
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ?
        AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
    `,
      [env.MYSQL_DATABASE]
    );

    // 컬럼 정보
    const [columns] = await connection.query(
      `
      SELECT 
        TABLE_NAME as table_name,
        COLUMN_NAME as column_name,
        DATA_TYPE as data_type,
        IS_NULLABLE as is_nullable,
        COLUMN_DEFAULT as column_default,
        COLUMN_COMMENT as column_comment,
        COLUMN_KEY as column_key
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME, ORDINAL_POSITION
    `,
      [env.MYSQL_DATABASE]
    );

    // 외래키 정보
    const [foreignKeys] = await connection.query(
      `
      SELECT 
        TABLE_NAME as table_name,
        COLUMN_NAME as column_name,
        REFERENCED_TABLE_NAME as referenced_table,
        REFERENCED_COLUMN_NAME as referenced_column
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = ?
        AND REFERENCED_TABLE_NAME IS NOT NULL
    `,
      [env.MYSQL_DATABASE]
    );

    // 데이터 구조화
    const schema: any = { tables: [] };
    const tableMap = new Map();

    for (const table of tables as any[]) {
      const tableInfo = {
        table_name: table.table_name,
        table_comment: table.table_comment,
        columns: [],
      };
      tableMap.set(table.table_name, tableInfo);
      schema.tables.push(tableInfo);
    }

    for (const column of columns as any[]) {
      const table = tableMap.get(column.table_name);
      if (table) {
        const fk = (foreignKeys as any[]).find(
          (fk) =>
            fk.table_name === column.table_name &&
            fk.column_name === column.column_name
        );

        table.columns.push({
          column_name: column.column_name,
          data_type: column.data_type,
          is_nullable: column.is_nullable === "YES",
          column_default: column.column_default,
          column_comment: column.column_comment,
          is_primary_key: column.column_key === "PRI",
          foreign_key: fk
            ? {
                table: fk.referenced_table,
                column: fk.referenced_column,
              }
            : null,
        });
      }
    }

    schemaCache = schema;
    return schema;
  } finally {
    connection.release();
  }
}
