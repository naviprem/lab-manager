import { resolve } from "path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import chalk from "chalk";
import { execa } from "execa";
import { Config, getProjectRoot } from "../config.js";
import { LabState, ComponentState } from "../state.js";
import * as helm from "../utils/helm.js";
import * as db from "../utils/database.js";
import * as aws from "../utils/aws.js";
import * as k8s from "../utils/kubernetes.js";
import { getKeycloakUrl } from "./keycloak.js";

const POLARIS_NAMESPACE = "polaris";
const POLARIS_RELEASE = "polaris";
const POLARIS_DATABASE = "polaris";

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
 * Generate Polaris Helm values file from template
 */
async function generatePolarisValues(
  config: Config,
  state: LabState
): Promise<string> {
  if (!state.foundation_outputs || !state.eks_outputs) {
    throw new Error("Foundation and EKS outputs not available");
  }

  // Get Aurora credentials from Secrets Manager
  const auroraSecret = await aws.getSecretValue(
    state.foundation_outputs.aurora_secret_arn,
    config.aws.region
  );

  const credentials = db.parseDatabaseCredentials(auroraSecret);

  // Get Keycloak URL
  const keycloakUrl = await getKeycloakUrl();
  if (!keycloakUrl) {
    throw new Error("Keycloak URL not available. Deploy Keycloak first.");
  }

  // Get IRSA role ARN (placeholder - this should come from Terraform outputs)
  const polarisIrsaRoleArn = `arn:aws:iam::${await getAccountId()}:role/${config.lab.name}-polaris-role`;

  // Read template
  const templatePath = resolve(
    getProjectRoot(),
    "src",
    "helm",
    "polaris-values.yaml.template"
  );
  let template = readFileSync(templatePath, "utf-8");

  // Replace placeholders
  template = template
    .replace(/{{AURORA_HOST}}/g, credentials.host)
    .replace(/{{AURORA_PORT}}/g, String(credentials.port))
    .replace(/{{AURORA_USER}}/g, credentials.username)
    .replace(/{{AURORA_PASSWORD}}/g, credentials.password)
    .replace(/{{DATA_BUCKET}}/g, state.foundation_outputs.data_bucket)
    .replace(/{{AWS_REGION}}/g, config.aws.region)
    .replace(/{{KEYCLOAK_URL}}/g, keycloakUrl)
    .replace(/{{POLARIS_CLIENT_SECRET}}/g, "polaris-secret-123") // TODO: Get from Keycloak
    .replace(/{{POLARIS_IRSA_ROLE_ARN}}/g, polarisIrsaRoleArn);

  // Write generated values file
  const valuesPath = resolve(getTempDir(), "polaris-values.yaml");
  writeFileSync(valuesPath, template);

  return valuesPath;
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
 * Create Polaris database in Aurora
 */
async function createPolarisDatabase(
  config: Config,
  state: LabState
): Promise<void> {
  if (!state.foundation_outputs) {
    throw new Error("Foundation outputs not available");
  }

  console.log(chalk.blue("\nCreating Polaris database..."));

  // Get Aurora credentials
  const auroraSecret = await aws.getSecretValue(
    state.foundation_outputs.aurora_secret_arn,
    config.aws.region
  );

  const credentials = db.parseDatabaseCredentials(auroraSecret);

  // Create database
  await db.createDatabaseIfNotExists(credentials, POLARIS_DATABASE);
}

/**
 * Wait for Polaris to be ready
 */
async function waitForPolarisReady(timeoutMinutes = 10): Promise<void> {
  const timeoutMs = timeoutMinutes * 60 * 1000;
  const startTime = Date.now();
  const pollInterval = 15000; // 15 seconds

  console.log(chalk.blue("Waiting for Polaris to be ready..."));

  while (Date.now() - startTime < timeoutMs) {
    try {
      // Check if pods are running
      const { stdout } = await execa("kubectl", [
        "get",
        "pods",
        "-n",
        POLARIS_NAMESPACE,
        "-l",
        `app.kubernetes.io/name=polaris`,
        "-o",
        "jsonpath={.items[*].status.phase}",
      ]);

      if (stdout.includes("Running")) {
        console.log(chalk.green("✓ Polaris is ready"));
        return;
      }

      console.log(chalk.dim("  Polaris pods not ready yet, waiting..."));
    } catch (error) {
      console.log(chalk.dim("  Error checking Polaris status, waiting..."));
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(
    `Timeout waiting for Polaris to be ready after ${timeoutMinutes} minutes`
  );
}

/**
 * Get Polaris external URL
 */
export async function getPolarisUrl(): Promise<string | null> {
  try {
    const { stdout } = await execa("kubectl", [
      "get",
      "svc",
      POLARIS_RELEASE,
      "-n",
      POLARIS_NAMESPACE,
      "-o",
      "jsonpath={.status.loadBalancer.ingress[0].hostname}",
    ]);

    if (stdout) {
      return `http://${stdout}:8181`;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Deploy Polaris via Helm
 */
export async function deployPolaris(
  config: Config,
  state: LabState,
  force = false
): Promise<ComponentState> {
  console.log(chalk.blue("\n═══ Deploying Polaris ═══\n"));

  // Check if Keycloak is deployed
  if (!state.components?.keycloak?.deployed) {
    throw new Error("Keycloak must be deployed before Polaris");
  }

  // Check if already deployed
  const exists = await helm.releaseExists(POLARIS_RELEASE, POLARIS_NAMESPACE);
  if (exists && !force) {
    console.log(chalk.green("Polaris already deployed"));
    return {
      deployed: true,
      namespace: POLARIS_NAMESPACE,
      release_name: POLARIS_RELEASE,
    };
  }

  // 1. Create database
  await createPolarisDatabase(config, state);

  // 2. Create namespace
  await k8s.createNamespace(POLARIS_NAMESPACE);

  // 3. Generate Helm values
  const valuesPath = await generatePolarisValues(config, state);

  // 4. Install Helm chart
  // Note: As of 2024, Polaris may not have an official Helm chart
  // This is a placeholder - may need to use custom manifests
  console.log(
    chalk.yellow(
      "Note: Apache Polaris Helm chart may not be officially available yet."
    )
  );
  console.log(chalk.yellow("Attempting to install from custom chart..."));

  try {
    // Try to add custom Polaris Helm repo (if available)
    await helm.addHelmRepo(
      "polaris",
      "https://apache.github.io/polaris"
    );
    await helm.updateHelmRepos();

    await helm.installChart(
      POLARIS_RELEASE,
      "polaris/polaris",
      POLARIS_NAMESPACE,
      valuesPath,
      true,
      "15m"
    );
  } catch (error) {
    console.log(
      chalk.red(
        "\nPolaris Helm chart not found. You may need to deploy using custom manifests."
      )
    );
    console.log(
      chalk.yellow(
        "For now, skipping Polaris deployment. This will be implemented when the official chart is available."
      )
    );

    return {
      deployed: false,
      namespace: POLARIS_NAMESPACE,
      release_name: POLARIS_RELEASE,
    };
  }

  // 5. Wait for readiness
  await waitForPolarisReady(10);

  // 6. Get external URL
  const url = await getPolarisUrl();

  console.log(chalk.green("\n✓ Polaris deployed successfully\n"));

  if (url) {
    console.log(chalk.bold("Polaris URL:"), url);
    console.log(chalk.dim("Catalog API:"), `${url}/api/catalog/v1`);
    console.log(chalk.dim("Storage:"), `s3://${state.foundation_outputs?.data_bucket}/warehouses`);
    console.log();
  }

  return {
    deployed: true,
    namespace: POLARIS_NAMESPACE,
    release_name: POLARIS_RELEASE,
    deployed_at: new Date().toISOString(),
  };
}

/**
 * Undeploy Polaris
 */
export async function undeployPolaris(): Promise<void> {
  console.log(chalk.blue("\nUndeploying Polaris..."));

  await helm.uninstallChart(POLARIS_RELEASE, POLARIS_NAMESPACE);

  console.log(chalk.green("✓ Polaris undeployed"));
}
