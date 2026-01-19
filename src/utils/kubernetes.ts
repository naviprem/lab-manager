import { execa } from "execa";
import chalk from "chalk";
import { getSecretValue } from "./aws.js";
import { existsSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";

export class KubectlError extends Error {
  constructor(
    public command: string,
    public exitCode: number,
    public stderr: string
  ) {
    super(`kubectl command failed: ${command}`);
    this.name = "KubectlError";
  }
}

/**
 * Check if kubectl is installed
 */
export async function checkKubectlInstalled(): Promise<boolean> {
  try {
    await execa("kubectl", ["version", "--client", "--output=json"], {
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Configure kubeconfig for EKS cluster
 */
export async function configureKubeconfig(
  clusterName: string,
  region: string,
  contextName: string
): Promise<void> {
  console.log(chalk.blue("Configuring kubeconfig..."));

  try {
    await execa("aws", [
      "eks",
      "update-kubeconfig",
      "--name",
      clusterName,
      "--region",
      region,
      "--alias",
      contextName,
    ]);

    console.log(chalk.green(`Kubeconfig updated with context: ${contextName}`));
  } catch (error) {
    const exitCode = (error as { exitCode?: number }).exitCode ?? 1;
    throw new KubectlError(
      "aws eks update-kubeconfig",
      exitCode,
      (error as { stderr?: string }).stderr ?? ""
    );
  }
}

/**
 * Get node status information
 */
export async function getNodeStatus(): Promise<{
  ready: number;
  total: number;
}> {
  try {
    const { stdout } = await execa("kubectl", [
      "get",
      "nodes",
      "--no-headers",
      "-o",
      "custom-columns=STATUS:.status.conditions[?(@.type=='Ready')].status",
    ]);

    const lines = stdout.trim().split("\n").filter((line) => line);
    const ready = lines.filter((line) => line.trim() === "True").length;

    return { ready, total: lines.length };
  } catch (error) {
    const exitCode = (error as { exitCode?: number }).exitCode ?? 1;
    throw new KubectlError(
      "get nodes",
      exitCode,
      (error as { stderr?: string }).stderr ?? ""
    );
  }
}

/**
 * Wait for all nodes to be ready
 */
export async function waitForClusterReady(
  clusterName: string,
  timeoutMinutes = 10
): Promise<void> {
  const timeoutMs = timeoutMinutes * 60 * 1000;
  const startTime = Date.now();
  const pollInterval = 10000; // 10 seconds

  console.log(chalk.blue("Waiting for cluster nodes to be ready..."));

  while (Date.now() - startTime < timeoutMs) {
    try {
      const { ready, total } = await getNodeStatus();

      if (total > 0 && ready === total) {
        console.log(chalk.green(`All nodes ready: ${ready}/${total}`));
        return;
      }

      console.log(chalk.dim(`  Nodes: ${ready}/${total} ready, waiting...`));
    } catch (error) {
      // Cluster might not be accessible yet
      console.log(chalk.dim("  Cluster not yet accessible, waiting..."));
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(
    `Timeout waiting for cluster nodes to be ready after ${timeoutMinutes} minutes`
  );
}

/**
 * Apply a Kubernetes manifest file
 */
export async function applyManifest(manifestPath: string): Promise<void> {
  if (!existsSync(manifestPath)) {
    throw new Error(`Manifest file not found: ${manifestPath}`);
  }

  try {
    await execa("kubectl", ["apply", "-f", manifestPath], {
      stdio: "inherit",
    });
  } catch (error) {
    const exitCode = (error as { exitCode?: number }).exitCode ?? 1;
    throw new KubectlError(
      "apply",
      exitCode,
      (error as { stderr?: string }).stderr ?? ""
    );
  }
}

/**
 * Create a namespace (idempotent)
 */
export async function createNamespace(name: string): Promise<void> {
  try {
    await execa("kubectl", ["create", "namespace", name], {
      stdio: "pipe",
    });
    console.log(chalk.green(`Created namespace: ${name}`));
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? "";

    // Already exists is OK
    if (stderr.includes("AlreadyExists")) {
      console.log(chalk.dim(`Namespace already exists: ${name}`));
    } else {
      const exitCode = (error as { exitCode?: number }).exitCode ?? 1;
      throw new KubectlError("create namespace", exitCode, stderr);
    }
  }
}

/**
 * Delete a namespace
 */
export async function deleteNamespace(name: string): Promise<void> {
  try {
    await execa("kubectl", ["delete", "namespace", name, "--ignore-not-found=true"], {
      stdio: "pipe",
    });
    console.log(chalk.green(`Deleted namespace: ${name}`));
  } catch (error) {
    // Ignore errors for namespace deletion during teardown
    console.log(chalk.yellow(`Warning: Could not delete namespace ${name}`));
  }
}

/**
 * Create a Kubernetes secret from AWS Secrets Manager
 */
export async function createSecretFromAWS(
  secretName: string,
  namespace: string,
  awsSecretArn: string,
  region: string
): Promise<void> {
  console.log(chalk.blue(`Creating secret ${secretName} in namespace ${namespace}...`));

  try {
    // Check if secret already exists
    try {
      await execa("kubectl", [
        "get",
        "secret",
        secretName,
        "-n",
        namespace,
      ], { stdio: "pipe" });

      console.log(chalk.dim(`Secret ${secretName} already exists, skipping`));
      return;
    } catch {
      // Secret doesn't exist, continue to create
    }

    // Fetch secret from AWS Secrets Manager
    const secretData = await getSecretValue(awsSecretArn, region);

    // Create kubectl secret command
    const args = [
      "create",
      "secret",
      "generic",
      secretName,
      "-n",
      namespace,
    ];

    for (const [key, value] of Object.entries(secretData)) {
      args.push(`--from-literal=${key}=${value}`);
    }

    await execa("kubectl", args, { stdio: "pipe" });
    console.log(chalk.green(`Created secret: ${secretName}`));
  } catch (error) {
    const exitCode = (error as { exitCode?: number }).exitCode ?? 1;
    throw new KubectlError(
      "create secret",
      exitCode,
      (error as { stderr?: string }).stderr ?? ""
    );
  }
}

/**
 * Check if kubeconfig exists
 */
export function checkKubeconfigExists(): boolean {
  const kubeconfigPath = resolve(homedir(), ".kube", "config");
  return existsSync(kubeconfigPath);
}

/**
 * Get current kubectl context
 */
export async function getCurrentContext(): Promise<string | null> {
  try {
    const { stdout } = await execa("kubectl", [
      "config",
      "current-context",
    ], { stdio: "pipe" });

    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Switch kubectl context
 */
export async function switchContext(contextName: string): Promise<void> {
  try {
    await execa("kubectl", [
      "config",
      "use-context",
      contextName,
    ], { stdio: "pipe" });

    console.log(chalk.green(`Switched to context: ${contextName}`));
  } catch (error) {
    const exitCode = (error as { exitCode?: number }).exitCode ?? 1;
    throw new KubectlError(
      "config use-context",
      exitCode,
      (error as { stderr?: string }).stderr ?? ""
    );
  }
}
