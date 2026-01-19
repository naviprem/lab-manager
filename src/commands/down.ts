import { resolve } from "path";
import chalk from "chalk";
import { Config, getProjectRoot } from "../config.js";
import { LabState, saveState, clearEphemeralState, clearComponentState } from "../state.js";
import * as terraform from "../terraform.js";
import * as aws from "../utils/aws.js";
import * as k8s from "../utils/kubernetes.js";
import { confirm, confirmDestructive, infoBox } from "../utils/prompts.js";
import * as keycloak from "../components/keycloak.js";
import * as polaris from "../components/polaris.js";
import * as trino from "../components/trino.js";
import * as spark from "../components/spark.js";
import * as opa from "../components/opa.js";

function getTerraformDir(): string {
  return resolve(getProjectRoot(), "terraform");
}

/**
 * Undeploy components
 */
async function undeployComponents(state: LabState): Promise<void> {
  console.log(chalk.blue("\n═══ Step 1: Undeploying Components ═══\n"));

  const components = state.components || {};

  // Undeploy in reverse dependency order
  // OPA, Spark and Trino can be undeployed in parallel (all independent at this level)
  const undeployPromises = [];

  if (components.opa?.deployed) {
    undeployPromises.push(
      (async () => {
        try {
          await opa.undeployOpa();
          clearComponentState(state, "opa");
        } catch (error) {
          console.log(chalk.yellow(`Warning: Failed to undeploy OPA: ${(error as Error).message}`));
        }
      })()
    );
  }

  if (components.spark?.deployed) {
    undeployPromises.push(
      (async () => {
        try {
          await spark.undeploySpark();
          clearComponentState(state, "spark");
        } catch (error) {
          console.log(chalk.yellow(`Warning: Failed to undeploy Spark: ${(error as Error).message}`));
        }
      })()
    );
  }

  if (components.trino?.deployed) {
    undeployPromises.push(
      (async () => {
        try {
          await trino.undeployTrino();
          clearComponentState(state, "trino");
        } catch (error) {
          console.log(chalk.yellow(`Warning: Failed to undeploy Trino: ${(error as Error).message}`));
        }
      })()
    );
  }

  // Wait for all to be undeployed
  if (undeployPromises.length > 0) {
    await Promise.all(undeployPromises);
  }

  // Then undeploy Polaris
  if (components.polaris?.deployed) {
    try {
      await polaris.undeployPolaris();
      clearComponentState(state, "polaris");
    } catch (error) {
      console.log(chalk.yellow(`Warning: Failed to undeploy Polaris: ${(error as Error).message}`));
    }
  }

  // Finally undeploy Keycloak
  if (components.keycloak?.deployed) {
    try {
      await keycloak.undeployKeycloak();
      clearComponentState(state, "keycloak");
    } catch (error) {
      console.log(chalk.yellow(`Warning: Failed to undeploy Keycloak: ${(error as Error).message}`));
    }
  }

  console.log(chalk.green("✓ Components undeployed\n"));
}

/**
 * Gracefully shutdown workloads on the cluster
 */
async function gracefulShutdown(): Promise<void> {
  console.log(chalk.blue("Graceful shutdown..."));

  const namespaces = ["spark", "trino"];

  console.log(chalk.blue("Deleting remaining namespaces..."));
  for (const ns of namespaces) {
    await k8s.deleteNamespace(ns);
  }

  console.log(chalk.dim("\nWaiting 30s for graceful termination..."));
  await new Promise((resolve) => setTimeout(resolve, 30000));

  console.log(chalk.green("✓ Workloads shutdown complete\n"));
}

/**
 * Destroy EKS cluster via Terraform
 */
async function destroyEks(config: Config, state: LabState): Promise<void> {
  const ephemeralDir = resolve(getTerraformDir(), "ephemeral");

  // Configure backend
  if (state.bootstrap_outputs) {
    terraform.writeBackendConfig(ephemeralDir, {
      bucket: state.bootstrap_outputs.state_bucket,
      key: `${config.lab.name}/ephemeral/terraform.tfstate`,
      region: config.aws.region,
      dynamodb_table: state.bootstrap_outputs.state_lock_table,
    });
  }

  const variables: Record<string, unknown> = {
    lab_name: config.lab.name,
    environment: config.lab.environment,
    aws_region: config.aws.region,
    state_bucket: state.bootstrap_outputs?.state_bucket,
    eks_instance_types: config.ephemeral?.eks?.instance_types || ["t3.medium"],
    eks_desired_size: config.ephemeral?.eks?.desired_size || 2,
  };

  await terraform.init(ephemeralDir, { reconfigure: true });
  await terraform.destroy(ephemeralDir, variables, true);

  console.log(chalk.green("✓ EKS cluster destroyed\n"));
}

/**
 * Verify foundation resources are intact
 */
async function verifyFoundationIntact(
  config: Config,
  state: LabState
): Promise<void> {
  console.log(chalk.blue("\n═══ Step 3: Verifying Foundation ═══\n"));

  if (!state.foundation_outputs) {
    console.log(chalk.yellow("No foundation deployed, skipping verification"));
    return;
  }

  // Check S3 bucket
  const s3Exists = await aws.checkS3BucketExists(
    state.foundation_outputs.data_bucket,
    config.aws.region
  );

  if (s3Exists) {
    console.log(chalk.green(`✓ S3 bucket intact: ${state.foundation_outputs.data_bucket}`));
  } else {
    console.log(
      chalk.yellow(`⚠ S3 bucket not found: ${state.foundation_outputs.data_bucket}`)
    );
  }

  // Check Aurora cluster
  const auroraEndpoint = state.foundation_outputs.aurora_cluster_endpoint;
  const auroraIdentifier = auroraEndpoint.split(".")[0];

  const auroraStatus = await aws.checkAuroraClusterStatus(
    auroraIdentifier,
    config.aws.region
  );

  if (auroraStatus) {
    console.log(
      chalk.green(`✓ Aurora cluster intact: ${auroraIdentifier} (${auroraStatus})`)
    );
  } else {
    console.log(chalk.yellow(`⚠ Aurora cluster not found: ${auroraIdentifier}`));
  }

  console.log();
}

/**
 * Destroy all infrastructure including foundation
 */
async function destroyAll(config: Config, state: LabState): Promise<void> {
  console.log(
    chalk.red("\n⚠ DANGER: Destroying ALL infrastructure including foundation ⚠\n")
  );

  // Destroy ephemeral
  if (state.eks_deployed) {
    await destroyEks(config, state);
  }

  // Destroy foundation
  if (state.foundation_deployed) {
    console.log(chalk.blue("═══ Destroying Foundation ═══\n"));

    const foundationDir = resolve(getTerraformDir(), "foundation");

    if (state.bootstrap_outputs) {
      terraform.writeBackendConfig(foundationDir, {
        bucket: state.bootstrap_outputs.state_bucket,
        key: `${config.lab.name}/foundation/terraform.tfstate`,
        region: config.aws.region,
        dynamodb_table: state.bootstrap_outputs.state_lock_table,
      });
    }

    await terraform.init(foundationDir, { reconfigure: true });
    await terraform.destroy(
      foundationDir,
      {
        lab_name: config.lab.name,
        environment: config.lab.environment,
        aws_region: config.aws.region,
      },
      true
    );

    console.log(chalk.green("✓ Foundation destroyed\n"));
  }

  // Destroy bootstrap
  if (state.bootstrapped) {
    console.log(chalk.blue("═══ Destroying Bootstrap ═══\n"));

    const bootstrapDir = resolve(getTerraformDir(), "bootstrap");

    await terraform.init(bootstrapDir);
    await terraform.destroy(
      bootstrapDir,
      {
        lab_name: config.lab.name,
        environment: config.lab.environment,
        aws_region: config.aws.region,
      },
      true
    );

    console.log(chalk.green("✓ Bootstrap destroyed\n"));
  }

  // Clear entire state
  state.bootstrapped = false;
  state.bootstrap_outputs = undefined;
  state.foundation_deployed = false;
  state.foundation_outputs = undefined;
  clearEphemeralState(state);
  saveState(state);
}

export interface DownOptions {
  force: boolean;
  destroyFoundation: boolean;
}

export async function down(
  config: Config,
  state: LabState,
  options: DownOptions
): Promise<void> {
  const { force, destroyFoundation } = options;

  console.log(chalk.bold(`\nTearing down lab session: ${config.lab.name}`));
  console.log(`Region: ${config.aws.region}\n`);

  try {
    // 1. Validate state
    if (!state.eks_deployed) {
      console.log(chalk.yellow("No EKS cluster deployed. Nothing to tear down."));
      return;
    }

    // 2. Handle --destroy-foundation
    if (destroyFoundation) {
      console.log(
        chalk.red(
          "\n⚠ WARNING: You are about to destroy ALL infrastructure including:\n"
        )
      );
      console.log(chalk.red("  • EKS Cluster (ephemeral)"));
      console.log(chalk.red("  • Aurora Database (persistent data will be LOST)"));
      console.log(chalk.red("  • S3 Buckets (all data will be LOST)"));
      console.log(chalk.red("  • VPC and networking"));
      console.log(chalk.red("  • State backend\n"));

      const confirmed = await confirmDestructive(
        chalk.red("This action is IRREVERSIBLE and will DELETE ALL DATA."),
        config.lab.name
      );

      if (!confirmed) {
        console.log(chalk.yellow("\nAborted by user."));
        return;
      }

      await destroyAll(config, state);

      console.log(chalk.green("\n═══ Complete Teardown Successful ═══\n"));
      console.log(
        chalk.yellow("All infrastructure has been destroyed. State file cleared.")
      );
      return;
    }

    // 3. Normal teardown - show cluster info and confirm
    if (!force) {
      const lines = [
        `Cluster: ${state.eks_outputs?.cluster_name || "unknown"}`,
        `Context: ${state.cluster_context || "unknown"}`,
        "",
        "This will:",
        "  • Delete namespaces (spark, trino, polaris, keycloak)",
        "  • Destroy the EKS cluster",
        "  • Preserve Aurora and S3 data",
      ];

      infoBox("Teardown Plan", lines);

      const confirmed = await confirm(
        chalk.yellow("Are you sure you want to tear down the EKS cluster?"),
        false
      );

      if (!confirmed) {
        console.log(chalk.yellow("\nAborted by user."));
        return;
      }
    }

    // 4. Undeploy components and graceful shutdown
    const hasKubectl = await k8s.checkKubectlInstalled();
    if (hasKubectl && state.cluster_ready) {
      try {
        // Undeploy Helm charts first
        await undeployComponents(state);

        // Then clean up remaining resources
        await gracefulShutdown();
      } catch (error) {
        console.log(
          chalk.yellow(
            `Warning: Could not gracefully shutdown workloads: ${(error as Error).message}`
          )
        );
        console.log(chalk.dim("Continuing with cluster destruction...\n"));
      }
    } else {
      console.log(
        chalk.yellow(
          "Cluster not accessible via kubectl, skipping graceful shutdown\n"
        )
      );
    }

    // 5. Destroy EKS cluster
    console.log(chalk.blue("═══ Step 2: Destroying EKS Cluster ═══\n"));
    await destroyEks(config, state);

    // 6. Verify foundation intact
    await verifyFoundationIntact(config, state);

    // 7. Update state (clear ephemeral and component state)
    clearEphemeralState(state);
    // Component state already cleared in undeployComponents
    saveState(state);

    // 8. Display summary
    console.log(chalk.green("═══ Teardown Complete ═══\n"));

    if (state.foundation_outputs) {
      console.log(chalk.bold("Your data is safe in:"));
      console.log(`  Aurora: ${state.foundation_outputs.aurora_cluster_endpoint}`);
      console.log(`  S3:     ${state.foundation_outputs.data_bucket}`);
      console.log();
    }

    console.log(chalk.blue("Next steps:"));
    console.log(`  ${chalk.dim("•")} lab up - provision a new cluster`);
    console.log(`  ${chalk.dim("•")} lab status - check current state`);
    console.log();
  } catch (error) {
    console.error(
      chalk.red(`\nError during 'lab down': ${(error as Error).message}`)
    );
    process.exit(1);
  }
}
