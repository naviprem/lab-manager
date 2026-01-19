import { resolve } from "path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import chalk from "chalk";
import { execa } from "execa";
import { Config, getProjectRoot } from "../config.js";
import { LabState, ComponentState } from "../state.js";
import * as helm from "../utils/helm.js";
import * as k8s from "../utils/kubernetes.js";

const SPARK_NAMESPACE = "spark";
const SPARK_RELEASE = "spark-operator";

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
 * Generate Spark Operator Helm values file from template
 */
async function generateSparkValues(config: Config): Promise<string> {
  // Get IRSA role ARN
  const sparkIrsaRoleArn = `arn:aws:iam::${await getAccountId()}:role/${config.lab.name}-spark-role`;

  // Read template
  const templatePath = resolve(
    getProjectRoot(),
    "src",
    "helm",
    "spark-operator-values.yaml.template"
  );
  let template = readFileSync(templatePath, "utf-8");

  // Replace placeholders
  template = template.replace(/{{SPARK_IRSA_ROLE_ARN}}/g, sparkIrsaRoleArn);

  // Write generated values file
  const valuesPath = resolve(getTempDir(), "spark-operator-values.yaml");
  writeFileSync(valuesPath, template);

  return valuesPath;
}

/**
 * Wait for Spark Operator to be ready
 */
async function waitForSparkReady(timeoutMinutes = 10): Promise<void> {
  const timeoutMs = timeoutMinutes * 60 * 1000;
  const startTime = Date.now();
  const pollInterval = 10000; // 10 seconds

  console.log(chalk.blue("Waiting for Spark Operator to be ready..."));

  while (Date.now() - startTime < timeoutMs) {
    try {
      // Check if operator pod is running
      const { stdout } = await execa("kubectl", [
        "get",
        "pods",
        "-n",
        SPARK_NAMESPACE,
        "-l",
        "app.kubernetes.io/name=spark-operator",
        "-o",
        "jsonpath={.items[*].status.phase}",
      ]);

      if (stdout.includes("Running")) {
        console.log(chalk.green("✓ Spark Operator is ready"));
        return;
      }

      console.log(chalk.dim("  Operator pod not ready yet, waiting..."));
    } catch (error) {
      console.log(chalk.dim("  Error checking Spark Operator status, waiting..."));
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(
    `Timeout waiting for Spark Operator to be ready after ${timeoutMinutes} minutes`
  );
}

/**
 * Create example SparkApplication manifest
 */
async function createExampleManifest(
  config: Config,
  state: LabState
): Promise<string> {
  if (!state.foundation_outputs) {
    throw new Error("Foundation outputs not available");
  }

  // Read template
  const templatePath = resolve(
    getProjectRoot(),
    "src",
    "config",
    "spark-iceberg-example.yaml"
  );
  let template = readFileSync(templatePath, "utf-8");

  // Get Polaris URL (if available)
  let polarisUrl = "http://polaris.polaris.svc.cluster.local:8181";
  try {
    const { stdout } = await execa("kubectl", [
      "get",
      "svc",
      "polaris",
      "-n",
      "polaris",
      "-o",
      "jsonpath={.status.loadBalancer.ingress[0].hostname}",
    ]);
    if (stdout) {
      polarisUrl = `http://${stdout}:8181`;
    }
  } catch {
    // Use internal service URL
  }

  // Replace placeholders
  template = template
    .replace(/{{POLARIS_URL}}/g, polarisUrl)
    .replace(/{{DATA_BUCKET}}/g, state.foundation_outputs.data_bucket)
    .replace(/{{AWS_REGION}}/g, config.aws.region);

  // Write manifest to temp dir
  const examplesDir = resolve(getTempDir(), "..", "examples");
  if (!existsSync(examplesDir)) {
    mkdirSync(examplesDir, { recursive: true });
  }

  const manifestPath = resolve(examplesDir, "spark-iceberg-example.yaml");
  writeFileSync(manifestPath, template);

  return manifestPath;
}

/**
 * Deploy Spark Operator via Helm
 */
export async function deploySpark(
  config: Config,
  state: LabState,
  force = false
): Promise<ComponentState> {
  console.log(chalk.blue("\n═══ Deploying Spark ═══\n"));

  // Check if Polaris is deployed (soft dependency)
  if (!state.components?.polaris?.deployed) {
    console.log(
      chalk.yellow(
        "Warning: Polaris is not deployed. Spark jobs won't be able to access the catalog."
      )
    );
  }

  // Check if already deployed
  const exists = await helm.releaseExists(SPARK_RELEASE, SPARK_NAMESPACE);
  if (exists && !force) {
    console.log(chalk.green("Spark Operator already deployed"));
    return {
      deployed: true,
      namespace: SPARK_NAMESPACE,
      release_name: SPARK_RELEASE,
    };
  }

  // 1. Create namespace
  await k8s.createNamespace(SPARK_NAMESPACE);

  // 2. Add Helm repository
  await helm.addHelmRepo(
    "spark-operator",
    "https://kubeflow.github.io/spark-operator"
  );
  await helm.updateHelmRepos();

  // 3. Generate Helm values
  const valuesPath = await generateSparkValues(config);

  // 4. Install Helm chart
  console.log(chalk.blue("Installing Spark Operator chart..."));
  await helm.installChart(
    SPARK_RELEASE,
    "spark-operator/spark-operator",
    SPARK_NAMESPACE,
    valuesPath,
    true,
    "15m"
  );

  // 5. Wait for readiness
  await waitForSparkReady(10);

  // 6. Create example manifest
  const examplePath = await createExampleManifest(config, state);

  console.log(chalk.green("\n✓ Spark Operator deployed successfully\n"));

  console.log(chalk.bold("Spark Operator:"), "Running in spark namespace");
  console.log(chalk.dim("Service Account:"), "spark (with IRSA)");
  console.log();
  console.log(chalk.blue("Submit example job:"));
  console.log(chalk.dim(`  kubectl apply -f ${examplePath}`));
  console.log();
  console.log(chalk.blue("Check job status:"));
  console.log(chalk.dim("  kubectl get sparkapplications -n spark"));
  console.log();
  console.log(chalk.blue("View logs:"));
  console.log(chalk.dim("  kubectl logs -n spark spark-iceberg-example-driver"));
  console.log();

  return {
    deployed: true,
    namespace: SPARK_NAMESPACE,
    release_name: SPARK_RELEASE,
    deployed_at: new Date().toISOString(),
  };
}

/**
 * Undeploy Spark Operator
 */
export async function undeploySpark(): Promise<void> {
  console.log(chalk.blue("\nUndeploying Spark Operator..."));

  // First delete any running SparkApplications
  try {
    console.log(chalk.dim("Deleting running Spark applications..."));
    await execa("kubectl", [
      "delete",
      "sparkapplications",
      "--all",
      "-n",
      SPARK_NAMESPACE,
      "--timeout=60s",
    ]);
  } catch (error) {
    console.log(chalk.yellow("Warning: Could not delete Spark applications"));
  }

  // Uninstall Helm chart
  await helm.uninstallChart(SPARK_RELEASE, SPARK_NAMESPACE);

  console.log(chalk.green("✓ Spark Operator undeployed"));
}
