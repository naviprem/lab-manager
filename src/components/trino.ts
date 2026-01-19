import { resolve } from "path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import chalk from "chalk";
import { execa } from "execa";
import { Config, getProjectRoot } from "../config.js";
import { LabState, ComponentState } from "../state.js";
import * as helm from "../utils/helm.js";
import * as k8s from "../utils/kubernetes.js";
import { getPolarisUrl } from "./polaris.js";

const TRINO_NAMESPACE = "trino";
const TRINO_RELEASE = "trino";

/**
 * Get temp directory for generated Helm values
 */
function getTempDir(): string {
  const dir = resolve(getProjectRoot(), ".lab", "helm");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Get AWS account ID
 */
async function getAccountId(): Promise<string> {
  try {
    const { stdout } = await execa("aws", [
      "sts",
      "get-caller-identity",
      "--query",
      "Account",
      "--output",
      "text",
    ]);
    return stdout.trim();
  } catch (error) {
    throw new Error("Failed to get AWS account ID");
  }
}

/**
 * Generate Trino Helm values file from template
 */
async function generateTrinoValues(
  config: Config,
  state: LabState
): Promise<string> {
  if (!state.foundation_outputs || !state.eks_outputs) {
    throw new Error("Foundation and EKS outputs not available");
  }

  // Get Polaris URL
  const polarisUrl = await getPolarisUrl();
  if (!polarisUrl) {
    throw new Error("Polaris URL not available. Deploy Polaris first.");
  }

  // Get IRSA role ARN
  const trinoIrsaRoleArn = `arn:aws:iam::${await getAccountId()}:role/${config.lab.name}-trino-role`;

  // Read template
  const templatePath = resolve(
    getProjectRoot(),
    "src",
    "helm",
    "trino-values.yaml.template"
  );
  let template = readFileSync(templatePath, "utf-8");

  // Replace placeholders
  template = template
    .replace(/{{POLARIS_URL}}/g, polarisUrl)
    .replace(/{{AWS_REGION}}/g, config.aws.region)
    .replace(/{{TRINO_IRSA_ROLE_ARN}}/g, trinoIrsaRoleArn);

  // Write generated values file
  const valuesPath = resolve(getTempDir(), "trino-values.yaml");
  writeFileSync(valuesPath, template);

  return valuesPath;
}

/**
 * Wait for Trino to be ready
 */
async function waitForTrinoReady(timeoutMinutes = 15): Promise<void> {
  const timeoutMs = timeoutMinutes * 60 * 1000;
  const startTime = Date.now();
  const pollInterval = 15000; // 15 seconds

  console.log(chalk.blue("Waiting for Trino to be ready..."));

  while (Date.now() - startTime < timeoutMs) {
    try {
      // Check coordinator
      const { stdout: coordStatus } = await execa("kubectl", [
        "get",
        "pods",
        "-n",
        TRINO_NAMESPACE,
        "-l",
        "app=trino,component=coordinator",
        "-o",
        "jsonpath={.items[*].status.phase}",
      ]);

      // Check workers
      const { stdout: workerStatus } = await execa("kubectl", [
        "get",
        "pods",
        "-n",
        TRINO_NAMESPACE,
        "-l",
        "app=trino,component=worker",
        "-o",
        "jsonpath={.items[*].status.phase}",
      ]);

      const coordReady = coordStatus.includes("Running");
      const workerPhases = workerStatus.split(" ").filter((p) => p);
      const workersReady = workerPhases.every((p) => p === "Running");

      if (coordReady && workersReady && workerPhases.length > 0) {
        console.log(
          chalk.green(
            `✓ Trino is ready (Coordinator + ${workerPhases.length} workers)`
          )
        );
        return;
      }

      const coordMsg = coordReady ? "Ready" : "Not ready";
      const workerMsg = workersReady
        ? `${workerPhases.length} ready`
        : `${workerPhases.filter((p) => p === "Running").length}/${workerPhases.length} ready`;

      console.log(
        chalk.dim(`  Coordinator: ${coordMsg}, Workers: ${workerMsg}, waiting...`)
      );
    } catch (error) {
      console.log(chalk.dim("  Error checking Trino status, waiting..."));
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(
    `Timeout waiting for Trino to be ready after ${timeoutMinutes} minutes`
  );
}

/**
 * Get Trino external URL
 */
export async function getTrinoUrl(): Promise<string | null> {
  try {
    const { stdout } = await execa("kubectl", [
      "get",
      "svc",
      TRINO_RELEASE,
      "-n",
      TRINO_NAMESPACE,
      "-o",
      "jsonpath={.status.loadBalancer.ingress[0].hostname}",
    ]);

    if (stdout) {
      return `http://${stdout}:8080`;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Deploy Trino via Helm
 */
export async function deployTrino(
  config: Config,
  state: LabState,
  force = false
): Promise<ComponentState> {
  console.log(chalk.blue("\n═══ Deploying Trino ═══\n"));

  // Check dependencies
  if (!state.components?.polaris?.deployed) {
    throw new Error("Polaris must be deployed before Trino");
  }

  // Check if already deployed
  const exists = await helm.releaseExists(TRINO_RELEASE, TRINO_NAMESPACE);
  if (exists && !force) {
    console.log(chalk.green("Trino already deployed"));
    return {
      deployed: true,
      namespace: TRINO_NAMESPACE,
      release_name: TRINO_RELEASE,
    };
  }

  // 1. Create namespace
  await k8s.createNamespace(TRINO_NAMESPACE);

  // 2. Add Helm repository
  await helm.addHelmRepo("trino", "https://trinodb.github.io/charts");
  await helm.updateHelmRepos();

  // 3. Generate Helm values
  const valuesPath = await generateTrinoValues(config, state);

  // 4. Install Helm chart
  console.log(chalk.blue("Installing Trino chart..."));
  await helm.installChart(
    TRINO_RELEASE,
    "trino/trino",
    TRINO_NAMESPACE,
    valuesPath,
    true,
    "20m"
  );

  // 5. Wait for readiness
  await waitForTrinoReady(15);

  // 6. Get external URL
  const url = await getTrinoUrl();

  console.log(chalk.green("\n✓ Trino deployed successfully\n"));

  if (url) {
    console.log(chalk.bold("Trino Web UI:"), url);
    console.log(chalk.dim("JDBC URL:"), `jdbc:trino://${url.replace("http://", "")}:8080/iceberg`);
    console.log(chalk.dim("Catalog:"), "iceberg (Polaris REST)");
    console.log();
    console.log(chalk.blue("Example queries:"));
    console.log(chalk.dim("  SHOW CATALOGS;"));
    console.log(chalk.dim("  SHOW SCHEMAS IN iceberg;"));
    console.log();
  }

  return {
    deployed: true,
    namespace: TRINO_NAMESPACE,
    release_name: TRINO_RELEASE,
    deployed_at: new Date().toISOString(),
  };
}

/**
 * Undeploy Trino
 */
export async function undeployTrino(): Promise<void> {
  console.log(chalk.blue("\nUndeploying Trino..."));

  await helm.uninstallChart(TRINO_RELEASE, TRINO_NAMESPACE);

  console.log(chalk.green("✓ Trino undeployed"));
}
