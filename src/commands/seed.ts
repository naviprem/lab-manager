import chalk from "chalk";
import { Config } from "../config.js";
import { LabState } from "../state.js";

export interface SeedOptions {
  tablesOnly: boolean;
  usersOnly: boolean;
  skipUsers: boolean;
  rows: number;
}

export async function seed(
  config: Config,
  state: LabState,
  options: SeedOptions
): Promise<void> {
  console.log(chalk.bold(`\nSeeding lab environment: ${config.lab.name}\n`));

  try {
    // 1. Check prerequisites
    console.log(chalk.blue("═══ Checking Prerequisites ═══\n"));

    if (!state.eks_deployed || !state.cluster_ready) {
      throw new Error("EKS cluster must be running. Run 'lab up' first.");
    }
    console.log(chalk.green("✓ EKS cluster running"));

    if (!state.components?.polaris?.deployed) {
      throw new Error("Polaris catalog must be deployed. Run 'lab up polaris' first.");
    }
    console.log(chalk.green("✓ Polaris deployed"));

    if (!state.components?.spark?.deployed) {
      console.log(chalk.yellow("⚠ Spark not deployed - manual data loading required"));
    } else {
      console.log(chalk.green("✓ Spark deployed"));
    }

    // 2. Display seeding plan
    console.log(chalk.blue("\n═══ Seeding Plan ═══\n"));

    if (!options.usersOnly) {
      console.log(chalk.bold("Sample Tables to Create:"));
      console.log(chalk.dim("  1. sales.transactions (10,000 rows)"));
      console.log(chalk.dim("     - Transaction data with departments"));
      console.log(chalk.dim("     - Use case: Row-level security demo"));
      console.log();
      console.log(chalk.dim("  2. hr.employees (1,000 rows)"));
      console.log(chalk.dim("     - Employee data with PII"));
      console.log(chalk.dim("     - Use case: Column masking demo"));
      console.log();
      console.log(chalk.dim("  3. iot.sensor_readings (50,000 rows)"));
      console.log(chalk.dim("     - Time-series sensor data"));
      console.log(chalk.dim("     - Use case: Analytics demo"));
      console.log();
    }

    if (!options.tablesOnly && !options.skipUsers) {
      console.log(chalk.bold("Keycloak Users to Reset:"));
      console.log(chalk.dim("  - admin (admin123)"));
      console.log(chalk.dim("  - analyst (analyst123)"));
      console.log(chalk.dim("  - engineer (engineer123)"));
      console.log();
    }

    // 3. Provide manual instructions (placeholder for actual implementation)
    console.log(chalk.yellow("═══ Manual Seeding Instructions ═══\n"));
    console.log(chalk.bold("The automated seeding feature is coming soon."));
    console.log(chalk.dim("For now, you can manually create sample data:\n"));

    console.log(chalk.blue("Step 1: Create namespaces in Polaris"));
    console.log(chalk.dim("  Use Polaris REST API or UI to create:"));
    console.log(chalk.dim("  - sales namespace"));
    console.log(chalk.dim("  - hr namespace"));
    console.log(chalk.dim("  - iot namespace\n"));

    console.log(chalk.blue("Step 2: Create tables via Trino"));
    console.log(chalk.dim("  Connect to Trino and run:"));
    console.log(chalk.dim(`
  CREATE SCHEMA IF NOT EXISTS iceberg.sales;
  CREATE TABLE iceberg.sales.transactions (
    transaction_id BIGINT,
    date DATE,
    customer_id BIGINT,
    product_id BIGINT,
    amount DECIMAL(10,2),
    department VARCHAR,
    region VARCHAR
  ) WITH (format = 'PARQUET');
    `));

    console.log(chalk.blue("Step 3: Insert sample data"));
    console.log(chalk.dim("  Use Trino or Spark to insert synthetic data\n"));

    console.log(chalk.green("✓ Seeding instructions provided\n"));

    // 4. Display example queries
    console.log(chalk.blue("═══ Example Queries ═══\n"));
    console.log(chalk.dim("After creating tables, try these queries:\n"));

    console.log(chalk.dim("-- List catalogs"));
    console.log(chalk.dim("SHOW CATALOGS;\n"));

    console.log(chalk.dim("-- List schemas"));
    console.log(chalk.dim("SHOW SCHEMAS IN iceberg;\n"));

    console.log(chalk.dim("-- Query transactions (row-level filtering applies)"));
    console.log(chalk.dim("SELECT * FROM iceberg.sales.transactions LIMIT 10;\n"));

    console.log(chalk.dim("-- Query employees (column masking applies to PII)"));
    console.log(chalk.dim("SELECT * FROM iceberg.hr.employees LIMIT 10;\n"));

  } catch (error) {
    console.error(chalk.red(`\nError during seeding: ${(error as Error).message}`));
    process.exit(1);
  }
}
