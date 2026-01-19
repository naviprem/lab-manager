import { execa } from "execa";
import chalk from "chalk";

export class AwsCliError extends Error {
  constructor(
    public command: string,
    public exitCode: number,
    public stderr: string
  ) {
    super(`AWS CLI command failed: ${command}`);
    this.name = "AwsCliError";
  }
}

/**
 * Check if AWS CLI is installed
 */
export async function checkAwsCliInstalled(): Promise<boolean> {
  try {
    await execa("aws", ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get EKS cluster status
 */
export async function getEksClusterStatus(
  clusterName: string,
  region: string
): Promise<string | null> {
  try {
    const { stdout } = await execa("aws", [
      "eks",
      "describe-cluster",
      "--name",
      clusterName,
      "--region",
      region,
      "--query",
      "cluster.status",
      "--output",
      "text",
    ]);

    return stdout.trim();
  } catch (error) {
    const exitCode = (error as { exitCode?: number }).exitCode ?? 1;

    // Cluster not found
    if (exitCode === 254 || (error as { stderr?: string }).stderr?.includes("ResourceNotFoundException")) {
      return null;
    }

    throw new AwsCliError(
      "eks describe-cluster",
      exitCode,
      (error as { stderr?: string }).stderr ?? ""
    );
  }
}

/**
 * Get secret value from AWS Secrets Manager
 */
export async function getSecretValue(
  secretArn: string,
  region: string
): Promise<Record<string, unknown>> {
  try {
    const { stdout } = await execa("aws", [
      "secretsmanager",
      "get-secret-value",
      "--secret-id",
      secretArn,
      "--region",
      region,
      "--query",
      "SecretString",
      "--output",
      "text",
    ]);

    return JSON.parse(stdout);
  } catch (error) {
    const exitCode = (error as { exitCode?: number }).exitCode ?? 1;
    throw new AwsCliError(
      "secretsmanager get-secret-value",
      exitCode,
      (error as { stderr?: string }).stderr ?? ""
    );
  }
}

/**
 * Check if S3 bucket exists
 */
export async function checkS3BucketExists(
  bucketName: string,
  region: string
): Promise<boolean> {
  try {
    await execa("aws", [
      "s3api",
      "head-bucket",
      "--bucket",
      bucketName,
      "--region",
      region,
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check Aurora cluster status
 */
export async function checkAuroraClusterStatus(
  clusterIdentifier: string,
  region: string
): Promise<string | null> {
  try {
    const { stdout } = await execa("aws", [
      "rds",
      "describe-db-clusters",
      "--db-cluster-identifier",
      clusterIdentifier,
      "--region",
      region,
      "--query",
      "DBClusters[0].Status",
      "--output",
      "text",
    ]);

    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Wait for EKS cluster to reach ACTIVE status
 */
export async function waitForEksClusterActive(
  clusterName: string,
  region: string,
  timeoutMinutes = 10
): Promise<void> {
  const timeoutMs = timeoutMinutes * 60 * 1000;
  const startTime = Date.now();
  const pollInterval = 15000; // 15 seconds

  console.log(chalk.blue("Waiting for EKS cluster to become ACTIVE..."));

  while (Date.now() - startTime < timeoutMs) {
    const status = await getEksClusterStatus(clusterName, region);

    if (status === "ACTIVE") {
      console.log(chalk.green("EKS cluster is ACTIVE"));
      return;
    }

    if (status === "FAILED" || status === "DELETING") {
      throw new Error(
        `EKS cluster is in ${status} state. Check AWS Console for details.`
      );
    }

    console.log(chalk.dim(`  Cluster status: ${status}, waiting...`));
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(
    `Timeout waiting for EKS cluster to become ACTIVE after ${timeoutMinutes} minutes`
  );
}
