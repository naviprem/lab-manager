import { execa } from "execa";
import chalk from "chalk";

export class DatabaseError extends Error {
  constructor(
    public command: string,
    public exitCode: number,
    public stderr: string
  ) {
    super(`Database operation failed: ${command}`);
    this.name = "DatabaseError";
  }
}

export interface DatabaseCredentials {
  username: string;
  password: string;
  host: string;
  port?: number;
}

/**
 * Check if psql is installed
 */
export async function checkPsqlInstalled(): Promise<boolean> {
  try {
    await execa("psql", ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Execute SQL command via psql
 */
async function executePsql(
  credentials: DatabaseCredentials,
  database: string,
  sql: string
): Promise<string> {
  const env = {
    ...process.env,
    PGPASSWORD: credentials.password,
  };

  const port = credentials.port || 5432;

  try {
    const { stdout } = await execa(
      "psql",
      [
        "-h",
        credentials.host,
        "-p",
        String(port),
        "-U",
        credentials.username,
        "-d",
        database,
        "-c",
        sql,
        "-t", // Tuples only
        "-A", // Unaligned output
      ],
      {
        env,
        stdio: "pipe",
      }
    );

    return stdout.trim();
  } catch (error) {
    const exitCode = (error as { exitCode?: number }).exitCode ?? 1;
    throw new DatabaseError(
      "psql",
      exitCode,
      (error as { stderr?: string }).stderr ?? ""
    );
  }
}

/**
 * Check if a database exists
 */
export async function checkDatabaseExists(
  credentials: DatabaseCredentials,
  dbName: string
): Promise<boolean> {
  try {
    const result = await executePsql(
      credentials,
      "postgres", // Connect to default postgres DB
      `SELECT 1 FROM pg_database WHERE datname = '${dbName}'`
    );

    return result === "1";
  } catch (error) {
    console.log(
      chalk.yellow(`Warning: Could not check database: ${(error as Error).message}`)
    );
    return false;
  }
}

/**
 * Create a database if it doesn't exist
 */
export async function createDatabaseIfNotExists(
  credentials: DatabaseCredentials,
  dbName: string
): Promise<void> {
  console.log(chalk.blue(`Checking database: ${dbName}`));

  const exists = await checkDatabaseExists(credentials, dbName);

  if (exists) {
    console.log(chalk.dim(`Database already exists: ${dbName}`));
    return;
  }

  console.log(chalk.blue(`Creating database: ${dbName}`));

  try {
    await executePsql(
      credentials,
      "postgres",
      `CREATE DATABASE "${dbName}"`
    );

    console.log(chalk.green(`✓ Database created: ${dbName}`));
  } catch (error) {
    throw new DatabaseError(
      "CREATE DATABASE",
      1,
      (error as Error).message
    );
  }
}

/**
 * Execute SQL in a specific database
 */
export async function executeSql(
  credentials: DatabaseCredentials,
  dbName: string,
  sql: string
): Promise<string> {
  return await executePsql(credentials, dbName, sql);
}

/**
 * Drop a database if it exists
 */
export async function dropDatabaseIfExists(
  credentials: DatabaseCredentials,
  dbName: string
): Promise<void> {
  console.log(chalk.yellow(`Dropping database: ${dbName}`));

  const exists = await checkDatabaseExists(credentials, dbName);

  if (!exists) {
    console.log(chalk.dim(`Database does not exist: ${dbName}`));
    return;
  }

  try {
    // Terminate existing connections first
    await executePsql(
      credentials,
      "postgres",
      `SELECT pg_terminate_backend(pg_stat_activity.pid) FROM pg_stat_activity WHERE pg_stat_activity.datname = '${dbName}' AND pid <> pg_backend_pid()`
    );

    // Drop the database
    await executePsql(
      credentials,
      "postgres",
      `DROP DATABASE IF EXISTS "${dbName}"`
    );

    console.log(chalk.green(`✓ Database dropped: ${dbName}`));
  } catch (error) {
    throw new DatabaseError(
      "DROP DATABASE",
      1,
      (error as Error).message
    );
  }
}

/**
 * Get database credentials from Aurora secret
 */
export function parseDatabaseCredentials(
  secretData: Record<string, unknown>
): DatabaseCredentials {
  return {
    username: secretData.username as string,
    password: secretData.password as string,
    host: secretData.host as string,
    port: (secretData.port as number) || 5432,
  };
}
