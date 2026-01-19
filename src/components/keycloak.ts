import { resolve } from "path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import chalk from "chalk";
import { Config, getProjectRoot } from "../config.js";
import { LabState, ComponentState } from "../state.js";
import { execa } from "execa";
import * as helm from "../utils/helm.js";
import * as db from "../utils/database.js";
import * as aws from "../utils/aws.js";
import * as k8s from "../utils/kubernetes.js";

const KEYCLOAK_NAMESPACE = "keycloak";
const KEYCLOAK_RELEASE = "keycloak";
const KEYCLOAK_DATABASE = "keycloak";

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
 * Generate Keycloak Helm values file from template
 */
async function generateKeycloakValues(
  config: Config,
  state: LabState
): Promise<string> {
  if (!state.foundation_outputs) {
    throw new Error("Foundation outputs not available");
  }

  // Get Aurora credentials from Secrets Manager
  const auroraSecret = await aws.getSecretValue(
    state.foundation_outputs.aurora_secret_arn,
    config.aws.region
  );

  const credentials = db.parseDatabaseCredentials(auroraSecret);

  // Read template
  const templatePath = resolve(
    getProjectRoot(),
    "src",
    "helm",
    "keycloak-values.yaml.template"
  );
  let template = readFileSync(templatePath, "utf-8");

  // Replace placeholders
  template = template
    .replace(/{{AURORA_HOST}}/g, credentials.host)
    .replace(/{{AURORA_PORT}}/g, String(credentials.port))
    .replace(/{{AURORA_USER}}/g, credentials.username)
    .replace(/{{AURORA_PASSWORD}}/g, credentials.password)
    .replace(/{{ADMIN_PASSWORD}}/g, "admin123"); // TODO: Generate secure password

  // Write generated values file
  const valuesPath = resolve(getTempDir(), "keycloak-values.yaml");
  writeFileSync(valuesPath, template);

  return valuesPath;
}

/**
 * Create Keycloak database in Aurora
 */
async function createKeycloakDatabase(
  config: Config,
  state: LabState
): Promise<void> {
  if (!state.foundation_outputs) {
    throw new Error("Foundation outputs not available");
  }

  console.log(chalk.blue("\nCreating Keycloak database..."));

  // Get Aurora credentials
  const auroraSecret = await aws.getSecretValue(
    state.foundation_outputs.aurora_secret_arn,
    config.aws.region
  );

  const credentials = db.parseDatabaseCredentials(auroraSecret);

  // Create database
  await db.createDatabaseIfNotExists(credentials, KEYCLOAK_DATABASE);
}

/**
 * Deploy Keycloak ConfigMap with realm configuration
 */
async function deployRealmConfigMap(): Promise<void> {
  console.log(chalk.blue("Creating Keycloak realm ConfigMap..."));

  const realmPath = resolve(
    getProjectRoot(),
    "src",
    "config",
    "keycloak-realm.json"
  );

  try {
    // Create namespace if needed
    await k8s.createNamespace(KEYCLOAK_NAMESPACE);

    // Delete existing ConfigMap if present
    try {
      await execa("kubectl", [
        "delete",
        "configmap",
        "keycloak-realm",
        "-n",
        KEYCLOAK_NAMESPACE,
        "--ignore-not-found=true",
      ]);
    } catch {
      // Ignore errors
    }

    // Create ConfigMap from realm file
    await execa("kubectl", [
      "create",
      "configmap",
      "keycloak-realm",
      "--from-file",
      `realm.json=${realmPath}`,
      "-n",
      KEYCLOAK_NAMESPACE,
    ]);

    console.log(chalk.green("✓ Realm ConfigMap created"));
  } catch (error) {
    throw new k8s.KubectlError(
      "create configmap",
      1,
      (error as Error).message
    );
  }
}

/**
 * Wait for Keycloak to be ready
 */
async function waitForKeycloakReady(timeoutMinutes = 10): Promise<void> {
  const timeoutMs = timeoutMinutes * 60 * 1000;
  const startTime = Date.now();
  const pollInterval = 15000; // 15 seconds

  console.log(chalk.blue("Waiting for Keycloak to be ready..."));

  while (Date.now() - startTime < timeoutMs) {
    try {
      // Check if pods are running
      const { stdout } = await execa("kubectl", [
        "get",
        "pods",
        "-n",
        KEYCLOAK_NAMESPACE,
        "-l",
        `app.kubernetes.io/name=keycloak`,
        "-o",
        "jsonpath={.items[*].status.phase}",
      ]);

      if (stdout.includes("Running")) {
        console.log(chalk.green("✓ Keycloak is ready"));
        return;
      }

      console.log(chalk.dim("  Keycloak pods not ready yet, waiting..."));
    } catch (error) {
      console.log(chalk.dim("  Error checking Keycloak status, waiting..."));
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(
    `Timeout waiting for Keycloak to be ready after ${timeoutMinutes} minutes`
  );
}

/**
 * Get Keycloak external URL
 */
export async function getKeycloakUrl(): Promise<string | null> {
  try {
    const { stdout } = await execa("kubectl", [
      "get",
      "svc",
      KEYCLOAK_RELEASE,
      "-n",
      KEYCLOAK_NAMESPACE,
      "-o",
      "jsonpath={.status.loadBalancer.ingress[0].hostname}",
    ]);

    if (stdout) {
      return `http://${stdout}`;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Deploy Keycloak via Helm
 */
export async function deployKeycloak(
  config: Config,
  state: LabState,
  force = false
): Promise<ComponentState> {
  console.log(chalk.blue("\n═══ Deploying Keycloak ═══\n"));

  // Check if already deployed
  const exists = await helm.releaseExists(KEYCLOAK_RELEASE, KEYCLOAK_NAMESPACE);
  if (exists && !force) {
    console.log(chalk.green("Keycloak already deployed"));
    return {
      deployed: true,
      namespace: KEYCLOAK_NAMESPACE,
      release_name: KEYCLOAK_RELEASE,
    };
  }

  // 1. Create database
  await createKeycloakDatabase(config, state);

  // 2. Deploy realm ConfigMap
  await deployRealmConfigMap();

  // 3. Add Helm repository
  await helm.addHelmRepo(
    "bitnami",
    "https://charts.bitnami.com/bitnami"
  );
  await helm.updateHelmRepos();

  // 4. Generate Helm values
  const valuesPath = await generateKeycloakValues(config, state);

  // 5. Install Helm chart
  await helm.installChart(
    KEYCLOAK_RELEASE,
    "bitnami/keycloak",
    KEYCLOAK_NAMESPACE,
    valuesPath,
    true,
    "15m"
  );

  // 6. Wait for readiness
  await waitForKeycloakReady(10);

  // 7. Get external URL
  const url = await getKeycloakUrl();

  console.log(chalk.green("\n✓ Keycloak deployed successfully\n"));

  if (url) {
    console.log(chalk.bold("Keycloak URL:"), url);
    console.log(chalk.dim("Admin user:"), "admin");
    console.log(chalk.dim("Admin password:"), "admin123");
    console.log(chalk.dim("Realm:"), "lab-realm");
    console.log();
  }

  return {
    deployed: true,
    namespace: KEYCLOAK_NAMESPACE,
    release_name: KEYCLOAK_RELEASE,
    deployed_at: new Date().toISOString(),
  };
}

/**
 * Undeploy Keycloak
 */
export async function undeployKeycloak(): Promise<void> {
  console.log(chalk.blue("\nUndeploying Keycloak..."));

  await helm.uninstallChart(KEYCLOAK_RELEASE, KEYCLOAK_NAMESPACE);

  console.log(chalk.green("✓ Keycloak undeployed"));
}
