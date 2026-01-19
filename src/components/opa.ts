import { resolve } from "path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import chalk from "chalk";
import { execa } from "execa";
import { Config, getProjectRoot } from "../config.js";
import { LabState, ComponentState } from "../state.js";
import * as helm from "../utils/helm.js";
import * as k8s from "../utils/kubernetes.js";

const OPA_NAMESPACE = "opa";
const OPA_RELEASE = "opa";

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
 * Generate OPA Helm values file from template
 */
async function generateOpaValues(): Promise<string> {
  // Read template
  const templatePath = resolve(
    getProjectRoot(),
    "src",
    "helm",
    "opa-values.yaml.template"
  );
  const template = readFileSync(templatePath, "utf-8");

  // No placeholders to replace for OPA - use as is

  // Write generated values file
  const valuesPath = resolve(getTempDir(), "opa-values.yaml");
  writeFileSync(valuesPath, template);

  return valuesPath;
}

/**
 * Create ConfigMap with OPA policies
 */
async function createPolicyConfigMaps(): Promise<void> {
  console.log(chalk.blue("Creating policy ConfigMaps..."));

  const policiesDir = resolve(getProjectRoot(), "src", "config", "policies");

  // Read policy files
  const dataAccessPolicy = readFileSync(
    resolve(policiesDir, "data-access.rego"),
    "utf-8"
  );
  const columnMaskingPolicy = readFileSync(
    resolve(policiesDir, "column-masking.rego"),
    "utf-8"
  );
  const tableAccessPolicy = readFileSync(
    resolve(policiesDir, "table-access.rego"),
    "utf-8"
  );

  // Create temporary directory for policies
  const tempPoliciesDir = resolve(getTempDir(), "..", "policies");
  if (!existsSync(tempPoliciesDir)) {
    mkdirSync(tempPoliciesDir, { recursive: true });
  }

  // Write policies to temp directory
  writeFileSync(
    resolve(tempPoliciesDir, "data-access.rego"),
    dataAccessPolicy
  );
  writeFileSync(
    resolve(tempPoliciesDir, "column-masking.rego"),
    columnMaskingPolicy
  );
  writeFileSync(
    resolve(tempPoliciesDir, "table-access.rego"),
    tableAccessPolicy
  );

  // Delete existing ConfigMap if present
  try {
    await execa("kubectl", [
      "delete",
      "configmap",
      "opa-policies",
      "-n",
      OPA_NAMESPACE,
      "--ignore-not-found=true",
    ]);
  } catch {
    // Ignore errors
  }

  // Create ConfigMap from policy directory
  try {
    await execa("kubectl", [
      "create",
      "configmap",
      "opa-policies",
      "--from-file",
      tempPoliciesDir,
      "-n",
      OPA_NAMESPACE,
    ]);

    console.log(chalk.green("✓ ConfigMap created: opa-policies"));
    console.log(chalk.dim("  Policies loaded:"));
    console.log(chalk.dim("    - data-access.rego (row-level security)"));
    console.log(chalk.dim("    - column-masking.rego (PII masking)"));
    console.log(chalk.dim("    - table-access.rego (table permissions)"));
  } catch (error) {
    throw new Error(`Failed to create policy ConfigMap: ${(error as Error).message}`);
  }
}

/**
 * Wait for OPA to be ready
 */
async function waitForOpaReady(timeoutMinutes = 10): Promise<void> {
  const timeoutMs = timeoutMinutes * 60 * 1000;
  const startTime = Date.now();
  const pollInterval = 10000; // 10 seconds

  console.log(chalk.blue("Waiting for OPA to be ready..."));

  while (Date.now() - startTime < timeoutMs) {
    try {
      // Check if OPA pod is running
      const { stdout } = await execa("kubectl", [
        "get",
        "pods",
        "-n",
        OPA_NAMESPACE,
        "-l",
        "app=opa",
        "-o",
        "jsonpath={.items[*].status.phase}",
      ]);

      if (stdout.includes("Running")) {
        console.log(chalk.green("✓ OPA is ready"));
        return;
      }

      console.log(chalk.dim("  OPA pod not ready yet, waiting..."));
    } catch (error) {
      console.log(chalk.dim("  Error checking OPA status, waiting..."));
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(
    `Timeout waiting for OPA to be ready after ${timeoutMinutes} minutes`
  );
}

/**
 * Test OPA policy evaluation
 */
async function testOpaPolicy(): Promise<void> {
  console.log(chalk.blue("Testing policy evaluation..."));

  try {
    // Port forward to OPA service
    console.log(chalk.dim("  Setting up port forward to OPA..."));

    // Start port forward in background
    const portForward = execa("kubectl", [
      "port-forward",
      "-n",
      OPA_NAMESPACE,
      "svc/opa",
      "8181:8181",
    ]);

    // Wait a bit for port forward to establish
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Test 1: Admin access
    console.log(chalk.dim("  Testing admin access..."));
    const test1 = {
      input: {
        user: { username: "admin", roles: ["admin"] },
        action: "SELECT",
        schema: "hr",
        table: "employees",
      },
    };

    try {
      const { stdout: result1 } = await execa("curl", [
        "-s",
        "-X",
        "POST",
        "http://localhost:8181/v1/data/trino/rules/allow",
        "-H",
        "Content-Type: application/json",
        "-d",
        JSON.stringify(test1),
      ]);

      const response1 = JSON.parse(result1);
      if (response1.result) {
        console.log(chalk.green("  ✓ Policy test passed: Admin access"));
      }
    } catch (error) {
      console.log(chalk.yellow("  ⚠ Policy test skipped (OPA not accessible)"));
    }

    // Kill port forward
    portForward.kill();
  } catch (error) {
    console.log(
      chalk.yellow("  ⚠ Policy testing skipped (port forward failed)")
    );
  }
}

/**
 * Deploy OPA via Helm
 */
export async function deployOpa(
  config: Config,
  state: LabState,
  force = false
): Promise<ComponentState> {
  console.log(chalk.blue("\n═══ Deploying OPA ═══\n"));

  // Check dependencies (soft - OPA can work standalone)
  if (!state.components?.keycloak?.deployed) {
    console.log(
      chalk.yellow(
        "Warning: Keycloak is not deployed. OPA will work but user context may be limited."
      )
    );
  }

  // Check if already deployed
  const exists = await helm.releaseExists(OPA_RELEASE, OPA_NAMESPACE);
  if (exists && !force) {
    console.log(chalk.green("OPA already deployed"));
    return {
      deployed: true,
      namespace: OPA_NAMESPACE,
      release_name: OPA_RELEASE,
    };
  }

  // 1. Create namespace
  await k8s.createNamespace(OPA_NAMESPACE);

  // 2. Create policy ConfigMaps
  await createPolicyConfigMaps();

  // 3. Generate Helm values
  const valuesPath = await generateOpaValues();

  // 4. Add Helm repository
  console.log(chalk.blue("\nInstalling OPA via Helm..."));
  await helm.addHelmRepo("opa", "https://open-policy-agent.github.io/kube-mgmt/charts");
  await helm.updateHelmRepos();

  // 5. Install Helm chart
  await helm.installChart(
    OPA_RELEASE,
    "opa/opa",
    OPA_NAMESPACE,
    valuesPath,
    true,
    "15m"
  );

  // 6. Wait for readiness
  await waitForOpaReady(10);

  // 7. Test policies (optional)
  await testOpaPolicy();

  console.log(chalk.green("\n✓ OPA deployed successfully\n"));

  console.log(chalk.bold("OPA Service:"), "http://opa.opa.svc.cluster.local:8181");
  console.log(chalk.dim("Policies:"), "3 policies loaded");
  console.log(chalk.dim("ConfigMap:"), "opa-policies");
  console.log();
  console.log(chalk.blue("API Endpoints:"));
  console.log(chalk.dim("  Policy evaluation:"), "/v1/data/trino/rules/allow");
  console.log(chalk.dim("  Row filtering:"), "/v1/data/trino/rules/rowfilter");
  console.log(chalk.dim("  Column masking:"), "/v1/data/trino/columnmasking/mask");
  console.log();
  console.log(chalk.yellow("Note: Update Trino configuration to enable OPA authorization"));
  console.log();

  return {
    deployed: true,
    namespace: OPA_NAMESPACE,
    release_name: OPA_RELEASE,
    deployed_at: new Date().toISOString(),
  };
}

/**
 * Undeploy OPA
 */
export async function undeployOpa(): Promise<void> {
  console.log(chalk.blue("\nUndeploying OPA..."));

  // Delete ConfigMap
  try {
    await execa("kubectl", [
      "delete",
      "configmap",
      "opa-policies",
      "-n",
      OPA_NAMESPACE,
      "--ignore-not-found=true",
    ]);
  } catch {
    // Ignore errors
  }

  // Uninstall Helm chart
  await helm.uninstallChart(OPA_RELEASE, OPA_NAMESPACE);

  console.log(chalk.green("✓ OPA undeployed"));
}
