#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { loadConfig, getProjectRoot } from "./config.js";
import { loadState } from "./state.js";
import { bootstrap } from "./commands/bootstrap.js";
import { up } from "./commands/up.js";
import { down } from "./commands/down.js";
import { seed } from "./commands/seed.js";
import { TerraformError } from "./terraform.js";

const program = new Command();

program
  .name("lab")
  .description("Cloud-native laboratory manager for exploratory data engineering")
  .version("0.1.0");

// Bootstrap command
program
  .command("bootstrap")
  .description("Provision persistent AWS infrastructure (VPC, Aurora, S3)")
  .option("--dry-run", "Only run terraform plan, don't apply changes", false)
  .option("--skip-foundation", "Only create state backend, skip foundation infrastructure", false)
  .option("-f, --force", "Force re-run even if already bootstrapped", false)
  .action(async (options) => {
    try {
      const config = loadConfig();
      const state = loadState(config.lab.name);
      await bootstrap(config, state, options);
    } catch (error) {
      if (error instanceof TerraformError) {
        console.error(chalk.red(`Terraform error: ${error.message}`));
      } else {
        console.error(chalk.red((error as Error).message));
      }
      process.exit(1);
    }
  });

// Up command
program
  .command("up [components...]")
  .description("Deploy EKS cluster and optional components (keycloak, polaris, trino, spark, opa)")
  .option("--dry-run", "Only run terraform plan, don't apply changes", false)
  .option("--all", "Deploy all available components", false)
  .option("-f, --force", "Force re-provision/re-deploy even if exists", false)
  .option("--skip-essentials", "Skip namespace/secret creation", false)
  .option("--skip-components", "Only provision EKS, skip component deployment", false)
  .action(async (components, options) => {
    try {
      const config = loadConfig();
      const state = loadState(config.lab.name);
      await up(config, state, components, {
        dryRun: options.dryRun,
        all: options.all,
        force: options.force,
        skipEssentials: options.skipEssentials,
        skipComponents: options.skipComponents,
      });
    } catch (error) {
      console.error(chalk.red((error as Error).message));
      process.exit(1);
    }
  });

// Down command
program
  .command("down")
  .description("Teardown the EKS cluster while preserving persistent data")
  .option("-f, --force", "Skip confirmation prompt", false)
  .option("--destroy-foundation", "Also destroy foundation infrastructure. DANGEROUS!", false)
  .action(async (options) => {
    try {
      const config = loadConfig();
      const state = loadState(config.lab.name);
      await down(config, state, {
        force: options.force,
        destroyFoundation: options.destroyFoundation,
      });
    } catch (error) {
      console.error(chalk.red((error as Error).message));
      process.exit(1);
    }
  });

// Seed command
program
  .command("seed")
  .description("Populate the lab with sample data, users, and policies")
  .option("--tables-only", "Only seed Iceberg tables", false)
  .option("--users-only", "Only reset Keycloak users", false)
  .option("--skip-users", "Don't reset Keycloak users", false)
  .option("--rows <number>", "Number of rows to generate", "10000")
  .action(async (options) => {
    try {
      const config = loadConfig();
      const state = loadState(config.lab.name);
      await seed(config, state, {
        tablesOnly: options.tablesOnly,
        usersOnly: options.usersOnly,
        skipUsers: options.skipUsers,
        rows: parseInt(options.rows, 10),
      });
    } catch (error) {
      console.error(chalk.red((error as Error).message));
      process.exit(1);
    }
  });

// Status command
program
  .command("status")
  .description("Show the current lab status")
  .action(async () => {
    try {
      const config = loadConfig();
      const state = loadState(config.lab.name);

      console.log(chalk.bold("\n╭─────────────────────────────────────╮"));
      console.log(chalk.bold("│           Lab Status                │"));
      console.log(chalk.bold("╰─────────────────────────────────────╯\n"));

      console.log(`Lab Name:     ${state.lab_name}`);
      console.log(`Environment:  ${config.lab.environment}`);
      console.log(`AWS Region:   ${config.aws.region}`);
      console.log();
      console.log(
        `Bootstrap:    ${state.bootstrapped ? chalk.green("Complete") : chalk.yellow("Not started")}`
      );
      console.log(
        `Foundation:   ${state.foundation_deployed ? chalk.green("Deployed") : chalk.yellow("Not deployed")}`
      );
      console.log(
        `EKS Cluster:  ${state.eks_deployed ? chalk.green("Running") : chalk.dim("Not deployed")}`
      );

      if (state.eks_deployed && state.cluster_ready) {
        console.log(
          `Cluster Ready: ${state.cluster_ready ? chalk.green("Yes") : chalk.yellow("No")}`
        );
        if (state.cluster_context) {
          console.log(`Kubectl Context: ${chalk.dim(state.cluster_context)}`);
        }
        if (state.essentials_deployed) {
          console.log(
            `Essentials:   ${chalk.green("Deployed")}`
          );
        }
      }

      if (state.bootstrap_outputs) {
        console.log();
        console.log(chalk.dim("State Bucket: ") + state.bootstrap_outputs.state_bucket);
      }

      if (state.foundation_outputs) {
        console.log(chalk.dim("VPC ID:       ") + state.foundation_outputs.vpc_id);
        console.log(chalk.dim("Aurora:       ") + state.foundation_outputs.aurora_cluster_endpoint);
        console.log(chalk.dim("Data Bucket:  ") + state.foundation_outputs.data_bucket);
      }

      if (state.eks_outputs) {
        console.log(chalk.dim("Cluster Name: ") + state.eks_outputs.cluster_name);
      }

      // Show component status
      if (state.components && Object.keys(state.components).length > 0) {
        console.log();
        console.log(chalk.bold("Components:"));

        const components = state.components;
        if (components.keycloak?.deployed) {
          console.log(`  Keycloak:   ${chalk.green("Deployed")} ${chalk.dim(`(${components.keycloak.namespace})`)}`);
        }
        if (components.polaris?.deployed) {
          console.log(`  Polaris:    ${chalk.green("Deployed")} ${chalk.dim(`(${components.polaris.namespace})`)}`);
        }
        if (components.trino?.deployed) {
          console.log(`  Trino:      ${chalk.green("Deployed")} ${chalk.dim(`(${components.trino.namespace})`)}`);
        }
        if (components.spark?.deployed) {
          console.log(`  Spark:      ${chalk.green("Deployed")} ${chalk.dim(`(${components.spark.namespace})`)}`);
        }
        if (components.opa?.deployed) {
          console.log(`  OPA:        ${chalk.green("Deployed")} ${chalk.dim(`(${components.opa.namespace})`)}`);
        }
      }

      console.log();
    } catch (error) {
      console.log(chalk.yellow("No lab.yaml found. Run in a lab directory or create lab.yaml."));
      process.exit(1);
    }
  });

program.parse();
