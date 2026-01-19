import { resolve } from "path";
import chalk from "chalk";
import { Config, getProjectRoot } from "../config.js";
import {
  LabState,
  saveState,
  updateEksState,
  updateClusterReadyState,
  updateComponentState,
} from "../state.js";
import * as terraform from "../terraform.js";
import * as aws from "../utils/aws.js";
import * as k8s from "../utils/kubernetes.js";
import * as helm from "../utils/helm.js";
import * as db from "../utils/database.js";
import * as keycloak from "../components/keycloak.js";
import * as polaris from "../components/polaris.js";
import * as trino from "../components/trino.js";
import * as spark from "../components/spark.js";
import * as opa from "../components/opa.js";

function getTerraformDir(): string {
  return resolve(getProjectRoot(), "terraform");
}

/**
 * Pre-flight checks before provisioning
 */
async function preFlightChecks(state: LabState, skipComponents: boolean): Promise<void> {
  console.log(chalk.blue("\n═══ Pre-flight Checks ═══\n"));

  // Check foundation is deployed
  if (!state.foundation_deployed || !state.bootstrap_outputs) {
    throw new Error("Foundation not deployed. Run 'lab bootstrap' first.");
  }
  console.log(chalk.green("✓ Foundation deployed"));

  // Check kubectl installed
  const hasKubectl = await k8s.checkKubectlInstalled();
  if (!hasKubectl) {
    throw new Error(
      "kubectl is not installed.\n" +
        "Install kubectl: https://kubernetes.io/docs/tasks/tools/"
    );
  }
  console.log(chalk.green("✓ kubectl installed"));

  // Check AWS CLI installed
  const hasAwsCli = await aws.checkAwsCliInstalled();
  if (!hasAwsCli) {
    throw new Error(
      "AWS CLI is not installed.\n" +
        "Install AWS CLI: https://aws.amazon.com/cli/"
    );
  }
  console.log(chalk.green("✓ AWS CLI installed"));

  // Check Helm and psql if deploying components
  if (!skipComponents) {
    const hasHelm = await helm.checkHelmInstalled();
    if (!hasHelm) {
      throw new Error(
        "Helm is not installed.\n" +
          "Install Helm: https://helm.sh/docs/intro/install/"
      );
    }
    console.log(chalk.green("✓ Helm installed"));

    const hasPsql = await db.checkPsqlInstalled();
    if (!hasPsql) {
      console.log(
        chalk.yellow(
          "⚠ psql (PostgreSQL client) is not installed."
        )
      );
      console.log(
        chalk.yellow(
          "Database operations may fail. Install: https://www.postgresql.org/download/"
        )
      );
    } else {
      console.log(chalk.green("✓ psql installed"));
    }
  }
}

/**
 * Deploy EKS cluster via Terraform
 */
async function deployEks(
  config: Config,
  state: LabState,
  dryRun: boolean
): Promise<LabState> {
  const ephemeralDir = resolve(getTerraformDir(), "ephemeral");

  console.log(chalk.blue("\n═══ Step 1: Provisioning EKS Cluster ═══\n"));

  // Generate backend.tf for S3 remote state
  terraform.writeBackendConfig(ephemeralDir, {
    bucket: state.bootstrap_outputs!.state_bucket,
    key: `${config.lab.name}/ephemeral/terraform.tfstate`,
    region: config.aws.region,
    dynamodb_table: state.bootstrap_outputs!.state_lock_table,
  });

  const variables: Record<string, unknown> = {
    lab_name: config.lab.name,
    environment: config.lab.environment,
    aws_region: config.aws.region,
    state_bucket: state.bootstrap_outputs!.state_bucket,
    eks_instance_types: config.ephemeral?.eks?.instance_types || ["t3.medium"],
    eks_desired_size: config.ephemeral?.eks?.desired_size || 2,
  };

  await terraform.init(ephemeralDir, { reconfigure: true });

  if (dryRun) {
    await terraform.plan(ephemeralDir, variables);
    console.log(chalk.yellow("\nDry run - skipping apply"));
    return state;
  }

  await terraform.apply(ephemeralDir, variables, true);

  const outputs = await terraform.output(ephemeralDir);
  return updateEksState(state, outputs);
}

/**
 * Wait for cluster to be ready and configure kubectl
 */
async function waitForClusterReady(
  config: Config,
  state: LabState
): Promise<void> {
  if (!state.eks_outputs) {
    throw new Error("EKS outputs not available");
  }

  console.log(chalk.blue("\n═══ Step 2: Waiting for Cluster Readiness ═══\n"));

  // Wait for AWS cluster status to be ACTIVE
  await aws.waitForEksClusterActive(
    state.eks_outputs.cluster_name,
    config.aws.region,
    10
  );

  // Configure kubeconfig
  const contextName = `${config.lab.name}-context`;
  await k8s.configureKubeconfig(
    state.eks_outputs.cluster_name,
    config.aws.region,
    contextName
  );

  // Wait for nodes to be ready
  await k8s.waitForClusterReady(state.eks_outputs.cluster_name, 10);

  console.log(chalk.green("\n✓ Cluster ready\n"));
}

/**
 * Deploy essentials (namespaces and secrets)
 */
async function deployEssentials(
  config: Config,
  state: LabState
): Promise<void> {
  if (!state.foundation_outputs) {
    throw new Error("Foundation outputs not available");
  }

  console.log(chalk.blue("═══ Step 3: Deploying Essentials ═══\n"));

  // Create namespaces
  const namespaces = ["spark", "trino", "polaris", "keycloak"];
  console.log(chalk.blue("Creating namespaces..."));

  for (const ns of namespaces) {
    await k8s.createNamespace(ns);
  }

  // Create Aurora credentials secret in default namespace
  console.log(chalk.blue("\nCreating Aurora credentials secret..."));
  await k8s.createSecretFromAWS(
    "aurora-credentials",
    "default",
    state.foundation_outputs.aurora_secret_arn,
    config.aws.region
  );

  console.log(chalk.green("\n✓ Essentials deployed\n"));
}

/**
 * Deploy selected components
 */
async function deployComponents(
  config: Config,
  state: LabState,
  componentArgs: string[],
  options: { all: boolean; force: boolean }
): Promise<void> {
  const { all, force } = options;

  // Determine which components to deploy
  const availableComponents = ["keycloak", "polaris", "trino", "spark", "opa"];
  let componentsToDeploy: string[] = [];

  if (all) {
    componentsToDeploy = availableComponents;
  } else if (componentArgs.length > 0) {
    componentsToDeploy = componentArgs.filter((c) =>
      availableComponents.includes(c.toLowerCase())
    );

    // Warn about invalid components
    const invalid = componentArgs.filter(
      (c) => !availableComponents.includes(c.toLowerCase())
    );
    if (invalid.length > 0) {
      console.log(
        chalk.yellow(
          `Warning: Unknown components will be skipped: ${invalid.join(", ")}`
        )
      );
    }
  } else {
    // Default: deploy core components (keycloak, polaris)
    componentsToDeploy = ["keycloak", "polaris"];
  }

  if (componentsToDeploy.length === 0) {
    console.log(chalk.dim("\nNo components to deploy."));
    return;
  }

  console.log(chalk.blue("\n═══ Step 5: Deploying Components ═══\n"));
  console.log(
    `Components to deploy: ${chalk.bold(componentsToDeploy.join(", "))}\n`
  );

  // Deploy in dependency order
  let deployedCount = 0;

  // 1. Deploy Keycloak (foundational)
  if (componentsToDeploy.includes("keycloak")) {
    console.log(chalk.blue(`[${++deployedCount}/${componentsToDeploy.length}] Deploying Keycloak...`));

    try {
      const componentState = await keycloak.deployKeycloak(config, state, force);
      state = updateComponentState(state, "keycloak", componentState);
    } catch (error) {
      console.error(
        chalk.red(`Failed to deploy Keycloak: ${(error as Error).message}`)
      );
      throw error;
    }
  }

  // 2. Deploy Polaris (depends on Keycloak)
  if (componentsToDeploy.includes("polaris")) {
    console.log(chalk.blue(`[${++deployedCount}/${componentsToDeploy.length}] Deploying Polaris...`));

    try {
      const componentState = await polaris.deployPolaris(config, state, force);
      state = updateComponentState(state, "polaris", componentState);
    } catch (error) {
      console.error(
        chalk.red(`Failed to deploy Polaris: ${(error as Error).message}`)
      );
      // Don't throw - allow continuation
      console.log(chalk.yellow("Continuing without Polaris..."));
    }
  }

  // 3. Deploy Trino (depends on Polaris)
  if (componentsToDeploy.includes("trino")) {
    console.log(chalk.blue(`[${++deployedCount}/${componentsToDeploy.length}] Deploying Trino...`));

    try {
      const componentState = await trino.deployTrino(config, state, force);
      state = updateComponentState(state, "trino", componentState);
    } catch (error) {
      console.error(
        chalk.red(`Failed to deploy Trino: ${(error as Error).message}`)
      );
      console.log(chalk.yellow("Continuing without Trino..."));
    }
  }

  // 4. Deploy Spark (depends on Polaris, optional)
  if (componentsToDeploy.includes("spark")) {
    console.log(chalk.blue(`[${++deployedCount}/${componentsToDeploy.length}] Deploying Spark...`));

    try {
      const componentState = await spark.deploySpark(config, state, force);
      state = updateComponentState(state, "spark", componentState);
    } catch (error) {
      console.error(
        chalk.red(`Failed to deploy Spark: ${(error as Error).message}`)
      );
      console.log(chalk.yellow("Continuing without Spark..."));
    }
  }

  // 5. Deploy OPA (optional, for policy enforcement)
  if (componentsToDeploy.includes("opa")) {
    console.log(chalk.blue(`[${++deployedCount}/${componentsToDeploy.length}] Deploying OPA...`));

    try {
      const componentState = await opa.deployOpa(config, state, force);
      state = updateComponentState(state, "opa", componentState);
    } catch (error) {
      console.error(
        chalk.red(`Failed to deploy OPA: ${(error as Error).message}`)
      );
      console.log(chalk.yellow("Continuing without OPA..."));
    }
  }

  console.log(chalk.green("\n✓ Component deployment complete\n"));
}

export interface UpOptions {
  dryRun: boolean;
  all: boolean;
  force: boolean;
  skipEssentials: boolean;
  skipComponents: boolean;
}

export async function up(
  config: Config,
  state: LabState,
  components: string[],
  options: UpOptions
): Promise<void> {
  const { dryRun, all, force, skipEssentials, skipComponents } = options;

  console.log(chalk.bold(`\nDeploying lab session: ${config.lab.name}`));
  console.log(`Region: ${config.aws.region}\n`);

  try {
    // 1. Pre-flight checks
    await preFlightChecks(state, skipComponents);

    // 2. Provision EKS cluster
    const needsProvisioning = !state.eks_deployed || force;

    if (needsProvisioning) {
      state = await deployEks(config, state, dryRun);

      if (dryRun) {
        return;
      }
    } else {
      console.log(chalk.green("\nEKS Cluster already deployed."));
    }

    // 3. Wait for cluster readiness and configure kubectl
    if (needsProvisioning || !state.cluster_ready) {
      await waitForClusterReady(config, state);

      const contextName = `${config.lab.name}-context`;
      state = updateClusterReadyState(state, contextName, false);
    } else {
      console.log(chalk.green("\nCluster already configured and ready."));
    }

    // 4. Deploy essentials (namespaces and secrets)
    if (!skipEssentials && (!state.essentials_deployed || force)) {
      await deployEssentials(config, state);
      state = updateClusterReadyState(
        state,
        state.cluster_context!,
        true
      );
    } else if (skipEssentials) {
      console.log(chalk.yellow("\nSkipping essentials deployment."));
    } else {
      console.log(chalk.green("\nEssentials already deployed."));
    }

    // 5. Deploy components
    if (!skipComponents && !dryRun) {
      await deployComponents(config, state, components, { all, force });
    } else if (skipComponents) {
      console.log(chalk.yellow("\nSkipping component deployment."));
    }

    // Save final state
    saveState(state);

    // Display summary
    console.log(chalk.green("\n═══ Lab UP Complete ═══\n"));

    if (state.eks_outputs) {
      const nodeStatus = await k8s.getNodeStatus();

      console.log(`Cluster Name:    ${chalk.bold(state.eks_outputs.cluster_name)}`);
      console.log(`Kubectl Context: ${chalk.bold(state.cluster_context)}`);
      console.log(`Nodes:           ${chalk.bold(`${nodeStatus.ready}/${nodeStatus.total} ready`)}`);
      console.log(`Endpoint:        ${chalk.dim(state.eks_outputs.cluster_endpoint)}`);

      console.log(chalk.blue("\nNext steps:"));
      console.log(`  ${chalk.dim("•")} kubectl get nodes`);
      console.log(`  ${chalk.dim("•")} kubectl get namespaces`);
      console.log(`  ${chalk.dim("•")} lab status`);
      console.log();
    }
  } catch (error) {
    console.error(
      chalk.red(`\nError during 'lab up': ${(error as Error).message}`)
    );
    process.exit(1);
  }
}
