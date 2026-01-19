import { resolve } from "path";
import chalk from "chalk";
import { Config, getProjectRoot } from "../config.js";
import { LabState, saveState, updateBootstrapState, updateFoundationState } from "../state.js";
import * as terraform from "../terraform.js";

function getTerraformDir(): string {
  return resolve(getProjectRoot(), "terraform");
}

async function bootstrapStateBackend(
  config: Config,
  state: LabState,
  dryRun: boolean
): Promise<LabState> {
  const bootstrapDir = resolve(getTerraformDir(), "bootstrap");

  console.log(chalk.blue("\n═══ Step 1: Creating Terraform State Backend ═══\n"));

  const variables = {
    lab_name: config.lab.name,
    environment: config.lab.environment,
    aws_region: config.aws.region,
  };

  await terraform.init(bootstrapDir, { awsProfile: config.aws.profile });

  if (dryRun) {
    await terraform.plan(bootstrapDir, variables, config.aws.profile);
    console.log(chalk.yellow("\nDry run - skipping apply"));
    return state;
  }

  await terraform.apply(bootstrapDir, variables, true, config.aws.profile);

  const outputs = await terraform.output(bootstrapDir, config.aws.profile);
  return updateBootstrapState(state, outputs);
}

async function deployFoundation(
  config: Config,
  state: LabState,
  dryRun: boolean
): Promise<LabState> {
  if (!state.bootstrap_outputs) {
    throw new Error("Bootstrap not complete. Run bootstrap first.");
  }

  const foundationDir = resolve(getTerraformDir(), "foundation");

  console.log(chalk.blue("\n═══ Step 2: Deploying Foundation Infrastructure ═══\n"));

  // Generate backend.tf for S3 remote state
  terraform.writeBackendConfig(foundationDir, {
    bucket: state.bootstrap_outputs.state_bucket,
    key: `${config.lab.name}/foundation/terraform.tfstate`,
    region: config.aws.region,
    dynamodb_table: state.bootstrap_outputs.state_lock_table,
  });

  const variables: Record<string, unknown> = {
    lab_name: config.lab.name,
    environment: config.lab.environment,
    aws_region: config.aws.region,
    vpc_cidr: config.foundation.vpc_cidr,
    aurora_min_capacity: config.foundation.aurora.min_capacity,
    aurora_max_capacity: config.foundation.aurora.max_capacity,
  };

  if (config.foundation.s3) {
    variables.data_bucket_name = config.foundation.s3.data_bucket;
    variables.logs_bucket_name = config.foundation.s3.logs_bucket;
  } else {
    variables.data_bucket_name = `${config.lab.name}-lakehouse-data`;
    variables.logs_bucket_name = `${config.lab.name}-logs`;
  }

  await terraform.init(foundationDir, { reconfigure: true, awsProfile: config.aws.profile });

  if (dryRun) {
    await terraform.plan(foundationDir, variables, config.aws.profile);
    console.log(chalk.yellow("\nDry run - skipping apply"));
    return state;
  }

  await terraform.apply(foundationDir, variables, true, config.aws.profile);

  const outputs = await terraform.output(foundationDir, config.aws.profile);
  return updateFoundationState(state, outputs);
}

export interface BootstrapOptions {
  dryRun: boolean;
  skipFoundation: boolean;
  force: boolean;
}

export async function bootstrap(
  config: Config,
  state: LabState,
  options: BootstrapOptions
): Promise<void> {
  const { dryRun, skipFoundation, force } = options;

  console.log(chalk.bold(`\nBootstrapping lab: ${config.lab.name}`));
  console.log(`Region: ${config.aws.region}\n`);

  // Check if already bootstrapped
  if (state.bootstrapped && !force) {
    console.log(chalk.yellow("State backend already exists."));
    if (!state.foundation_deployed && !skipFoundation) {
      console.log("Continuing with foundation deployment...");
    } else if (state.foundation_deployed) {
      console.log(chalk.green("Foundation already deployed. Use --force to re-run."));
      return;
    }
  } else {
    state = await bootstrapStateBackend(config, state, dryRun);
  }

  // Deploy foundation (unless skipped)
  if (!skipFoundation) {
    if (state.foundation_deployed && !force) {
      console.log(chalk.yellow("Foundation already deployed."));
    } else {
      state = await deployFoundation(config, state, dryRun);
    }
  }

  // Save final state
  if (!dryRun) {
    saveState(state);
  }

  console.log(chalk.green("\n═══ Bootstrap complete! ═══\n"));

  if (state.bootstrap_outputs) {
    console.log(`State bucket: ${state.bootstrap_outputs.state_bucket}`);
  }
  if (state.foundation_outputs) {
    console.log(`VPC ID: ${state.foundation_outputs.vpc_id}`);
    console.log(`Aurora endpoint: ${state.foundation_outputs.aurora_cluster_endpoint}`);
    console.log(`Data bucket: ${state.foundation_outputs.data_bucket}`);
  }
}
